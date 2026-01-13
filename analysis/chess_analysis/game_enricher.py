from typing import Dict, List, Any, Tuple
from .hybrid_analyzer import HybridStockfishAnalyzer
from .database_evaluator import DatabaseEvaluator
from .gcp_evaluator import GCPStockfishClient
from .lichess_accuracy import LichessAccuracyCalculator
from .game_divider import GameDivider, divide_game_from_pgn_moves
import chess
import re
import time


class GameEnricher:
    """Enriches game data with Stockfish analysis for games lacking evaluation data"""

    def __init__(self, games: List[Dict[str, Any]], max_concurrent: int = 40, stockfish_depth: int = 20):
        self.games = games
        self.max_concurrent = max_concurrent
        self.stockfish_depth = stockfish_depth

    def parse_moves_string(self, moves_string: str) -> List[str]:
        """Parse moves string into individual moves"""
        moves_clean = re.sub(r"\d+\.+", "", moves_string)
        moves_clean = re.sub(r"\s+", " ", moves_clean).strip()
        moves = moves_clean.split()

        # Filter out any remaining artifacts
        valid_moves = []
        for move in moves:
            if move and not move.isdigit() and "." not in move:
                valid_moves.append(move)

        return valid_moves

    def convert_uci_to_san(self, fen: str, uci_move: str) -> str:
        """Convert UCI move to SAN notation given a FEN position"""
        if not uci_move or not fen:
            return uci_move

        try:
            # Validate FEN first
            board = chess.Board(fen)
            # Validate UCI move format
            if len(uci_move) < 4 or len(uci_move) > 5:
                return uci_move

            move = chess.Move.from_uci(uci_move)
            if move in board.legal_moves:
                san_move = board.san(move)
                return san_move
            else:
                # Move not legal in this position
                return uci_move
        except Exception as e:
            # Log the error for debugging but don't crash
            print(f"UCI to SAN conversion failed for {uci_move} in position {fen[:20]}...: {str(e)}")
            return uci_move

    def convert_uci_variation_to_san(self, fen: str, uci_variation: str) -> str:
        """Convert UCI variation string to SAN notation"""
        if not uci_variation or not fen:
            return uci_variation

        try:
            board = chess.Board(fen)
            uci_moves = uci_variation.split()
            san_moves = []

            for uci_move in uci_moves:
                try:
                    if len(uci_move) < 4 or len(uci_move) > 5:
                        break

                    move = chess.Move.from_uci(uci_move)
                    if move in board.legal_moves:
                        san_move = board.san(move)
                        san_moves.append(san_move)
                        board.push(move)
                    else:
                        break
                except Exception:
                    break  # Stop if any move is invalid

            return " ".join(san_moves) if san_moves else uci_variation
        except Exception as e:
            print(f"UCI variation to SAN conversion failed for {uci_variation[:50]}... in position {fen[:20]}...: {str(e)}")
            return uci_variation

    def generate_positions_for_game(self, moves: List[str]) -> List[str]:
        """Generate FEN positions for a game's moves"""
        try:
            board = chess.Board()
            positions = [board.fen()]

            for move_str in moves:
                try:
                    move = board.parse_san(move_str)
                    board.push(move)
                    positions.append(board.fen())
                except:
                    break

            return positions
        except Exception:
            return []

    def generate_board_positions_for_game(self, moves: List[str]) -> List[chess.Board]:
        """Generate chess.Board positions for a game's moves (for division analysis)"""
        try:
            board = chess.Board()
            boards = [board.copy()]

            for move_str in moves:
                try:
                    move = board.parse_san(move_str)
                    board.push(move)
                    boards.append(board.copy())
                except:
                    break

            return boards
        except Exception:
            return []

    def collect_all_game_data(self, games: List[Dict[str, Any]]) -> Tuple[List[str], List[Dict]]:
        """
        Parse all games and collect position data with proper per-game tracking

        Returns:
            Tuple of (unique_positions_list, game_data_list)
        """
        unique_positions_needed = set()
        game_data = []

        for game in games:
            raw_json = game.get("raw_json", {})
            moves_string = raw_json.get("moves", "")

            if not moves_string:
                game_data.append({"error": "No moves found", "positions": []})
                continue

            moves = self.parse_moves_string(moves_string)
            if not moves:
                game_data.append({"error": "No valid moves found", "positions": []})
                continue

            # Check if game already has analysis
            existing_analysis = raw_json.get("analysis", [])

            # NEW: Preserve original Lichess analysis if it exists
            # Lichess games are identified by the "fullId" field
            is_lichess = "fullId" in raw_json

            if is_lichess and existing_analysis:
                # Save Lichess analysis to separate field before we overwrite it
                # This preserves the original Lichess evaluations for comparison
                raw_json["lichess_analysis"] = existing_analysis
                game["raw_json"] = raw_json

            # Generate positions for this game (always needed for our analysis)
            game_positions = self.generate_positions_for_game(moves)
            if not game_positions:
                game_data.append({"error": "Position generation failed", "positions": []})
                continue

            game_data.append({
                "game": game,  # Keep reference to original game
                "moves": moves,
                "positions": game_positions,  # Ordered positions for THIS game
                "existing_analysis": existing_analysis,
                "is_lichess": is_lichess
            })

            # Add to global set for evaluation
            unique_positions_needed.update(game_positions)

        # Convert set to list for evaluation
        unique_positions_list = list(unique_positions_needed)

        return unique_positions_list, game_data

    def build_single_game_analysis(
        self,
        game_data: Dict,
        global_evaluations: Dict[str, Dict]
    ) -> Dict[str, Any]:
        """
        Build analysis for a single game using global evaluations

        Args:
            game_data: Single game data with positions
            global_evaluations: Dict mapping FEN -> evaluation data

        Returns:
            Analysis result for this game
        """
        if "error" in game_data or "skipped" in game_data:
            return game_data

        game = game_data["game"]
        positions = game_data["positions"]
        moves = game_data["moves"]
        existing_analysis = game_data["existing_analysis"]

        evaluations = []
        db_count = gcp_count = existing_count = 0

        # CRITICAL FIX: Proper alignment between positions and analysis
        # positions = [start_pos, pos_after_move1, pos_after_move2, ...]  (len = moves + 1)
        # existing_analysis = [eval_after_move1, eval_after_move2, ...]   (len = moves)
        # We need to evaluate positions[1:] and align with existing_analysis[0:]

        for move_index in range(len(moves)):
            position_index = move_index + 1  # Skip starting position
            if position_index >= len(positions):
                break

            fen = positions[position_index]  # Position after this move
            move = moves[move_index]         # The move that led to this position

            # Check if we already have analysis for this move
            has_existing_eval = (
                move_index < len(existing_analysis)
                and existing_analysis[move_index] is not None
                and (existing_analysis[move_index].get("eval") is not None
                     or existing_analysis[move_index].get("mate") is not None)
            )

            if has_existing_eval:
                # Use existing evaluation - preserve existing structure
                eval_entry = {
                    "move_number": move_index + 1,
                    "move": move,
                    "source": "existing",
                    "position_fen": fen  # Store the FEN for this position
                }

                # Copy all existing evaluation data
                existing_data = existing_analysis[move_index]
                if existing_data.get("eval") is not None:
                    eval_entry["eval"] = existing_data["eval"]
                if existing_data.get("mate") is not None:
                    eval_entry["mate"] = existing_data["mate"]
                # Note: We don't copy best/variation from existing data here
                # as these will be set correctly in _create_game_analysis_array
                # based on mistake analysis from the previous position

                evaluations.append(eval_entry)
                existing_count += 1

                # Add existing analysis data to global_evaluations so it can be accessed later
                # This is needed for UCI to SAN conversion of the "best" field
                if fen not in global_evaluations:
                    global_evaluations[fen] = {
                        "source": "existing",
                        "evaluation": existing_data.get("eval", 0),
                        "best": existing_data.get("best"),
                        "variation": existing_data.get("variation")
                    }
                    if existing_data.get("mate") is not None:
                        global_evaluations[fen]["mate"] = existing_data["mate"]

            elif fen in global_evaluations:
                # Use global evaluation result
                eval_data = global_evaluations[fen]

                if "error" not in eval_data:
                    eval_entry = {
                        "move_number": move_index + 1,
                        "move": move,
                        "eval": eval_data["evaluation"],
                        "source": eval_data["source"],
                        "depth": eval_data.get("depth"),
                        "position_fen": fen  # Store the FEN for this position
                        # Note: best/variation not included here - will be set correctly
                        # in _create_game_analysis_array based on mistake analysis
                    }

                    # Include additional data based on source
                    if eval_data["source"] == "database":
                        eval_entry["knodes"] = eval_data.get("knodes")
                    elif eval_data["source"] == "gcp_stockfish":
                        eval_entry["time_ms"] = eval_data.get("time_ms", 0)

                    # Include mate information if available
                    if "mate" in eval_data and eval_data["mate"] is not None:
                        eval_entry["mate"] = eval_data["mate"]

                    evaluations.append(eval_entry)

                    # Count by source
                    if eval_data["source"] == "database":
                        db_count += 1
                    elif eval_data["source"] == "gcp_stockfish":
                        gcp_count += 1

        # Find mistakes from the evaluations, passing positions and global evaluations for context
        mistakes = self._find_mistakes_from_evaluations(evaluations, positions, global_evaluations)

        return {
            "game": game,
            "evaluations": evaluations,
            "mistakes": mistakes,
            "total_moves_analyzed": len(evaluations),
            "database_evaluations": db_count,
            "stockfish_evaluations": gcp_count,
            "existing_evaluations": existing_count,
            "new_evaluations": gcp_count
        }

    def merge_evaluation_sources(
        self,
        db_results: Dict[str, Dict],
        gcp_results: Dict[str, Dict]
    ) -> Dict[str, Dict]:
        """
        Merge database and GCP results into a single evaluation dictionary

        Args:
            db_results: Database evaluation results
            gcp_results: GCP Stockfish results

        Returns:
            Dict mapping FEN -> evaluation data with source info
        """
        global_evaluations = {}

        # Add database results
        for fen, db_eval in db_results.items():
            global_evaluations[fen] = {
                **db_eval,  # Include all database data
                "source": "database"
            }

        # Add GCP results (only for positions not in database)
        for fen, gcp_eval in gcp_results.items():
            if fen not in global_evaluations and "error" not in gcp_eval:
                global_evaluations[fen] = {
                    **gcp_eval,  # Include all GCP data
                    "source": "gcp_stockfish"
                }

        return global_evaluations


    def _get_centipawn_value(self, evaluation: Dict) -> int:
        """Convert mate/eval to centipawn value for comparison - NO perspective conversion"""
        if "mate" in evaluation and evaluation["mate"] is not None:
            mate_score = evaluation["mate"]
            # Convert mate scores to large centipawn values (keep original sign)
            if mate_score > 0:
                cp_value = 10000 - abs(mate_score) * 10  # Winning mate
            else:
                cp_value = -10000 + abs(mate_score) * 10  # Losing mate
        else:
            cp_value = evaluation.get("eval", 0)

        # NO PERSPECTIVE CONVERSION - Stockfish always reports from White's perspective
        return cp_value

    def _get_winning_chances(self, cp: int) -> float:
        """
        Calculate winning chances from centipawns using Lichess formula.
        Returns a value between -1 and +1 where:
        - +1 = 100% chance for white to win
        - -1 = 100% chance for black to win
        - 0 = equal position (50-50)

        Formula from Lichess: https://github.com/lichess-org/lila/pull/11148
        """
        MULTIPLIER = -0.00368208
        winning_chances = 2 / (1 + pow(2.71828182845904523536, MULTIPLIER * cp)) - 1
        # Clamp to [-1, +1]
        return max(-1.0, min(1.0, winning_chances))

    def _get_win_percent(self, evaluation: Dict) -> float:
        """
        Convert evaluation to win percentage (0-100) for white using Lichess formula.

        Args:
            evaluation: Dict with 'eval' (centipawns) or 'mate' fields

        Returns:
            Win percentage for white (0-100)
        """
        # Handle mate scores
        if "mate" in evaluation and evaluation["mate"] is not None:
            mate_score = evaluation["mate"]
            if mate_score == 0:
                # Checkmate delivered - need context to determine winner
                # For now, treat as extreme advantage
                return 100.0 if mate_score >= 0 else 0.0
            elif mate_score > 0:
                return 100.0  # White has mate
            else:
                return 0.0  # Black has mate

        # Convert centipawns to winning chances
        cp = evaluation.get("eval", 0)
        winning_chances = self._get_winning_chances(cp)

        # Convert to percentage: 50 + 50 * winning_chances
        win_percent = 50 + 50 * winning_chances
        return win_percent

    def _find_mistakes_from_evaluations(self, evaluations: List[Dict], positions: List[str], global_evaluations: Dict[str, Dict]) -> List[Dict]:
        """
        Find mistakes from evaluation sequence using Lichess winning chances formula.

        Lichess classification (based on lila/modules/analyse/src/main/Advice.scala):
        - Blunder: 0.3 or more loss in winning chances (in [-1, +1] scale)
        - Mistake: 0.2 or more loss in winning chances
        - Inaccuracy: 0.1 or more loss in winning chances

        Special handling for mate sequences:
        - MateCreated: No mate before, mate after (opponent getting mated)
        - MateLost: Mate before, no mate after (losing a winning mate sequence)
        - MateDelayed: Mate before and after, but longer sequence (not classified as mistake)

        Note: winning chances are in [-1, +1] scale where:
        - +1 = white has 100% chance to win
        - -1 = black has 100% chance to win
        - 0 = equal position
        """
        mistakes = []

        for i in range(1, len(evaluations)):
            move_number = evaluations[i].get("move_number", i + 1)
            is_white_move = move_number % 2 == 1

            # Skip mistake detection if current position is checkmate (mate: 0)
            # This means the player just delivered checkmate, which is not a mistake
            current_eval = evaluations[i]
            if "mate" in current_eval and current_eval["mate"] == 0:
                continue

            prev_eval = evaluations[i - 1]
            prev_mate = prev_eval.get("mate")
            current_mate = current_eval.get("mate")

            # Get centipawn values (for mate sequence classification)
            prev_cp = self._get_centipawn_value(prev_eval)
            current_cp = self._get_centipawn_value(current_eval)

            # Invert perspective based on who moved
            # For the player who just moved, we want their evaluation from their perspective
            if is_white_move:
                # White moved, so we want evaluations from white's perspective (no change needed)
                prev_cp_player_pov = prev_cp
                current_cp_player_pov = current_cp
                prev_mate_player_pov = prev_mate
                current_mate_player_pov = current_mate
            else:
                # Black moved, so we want evaluations from black's perspective (invert)
                prev_cp_player_pov = -prev_cp
                current_cp_player_pov = -current_cp
                prev_mate_player_pov = -prev_mate if prev_mate is not None else None
                current_mate_player_pov = -current_mate if current_mate is not None else None

            # Check for mate sequences (Lichess MateAdvice logic)
            mistake_type = None
            mate_sequence = None

            # MateCreated: No mate before, negative mate after (opponent getting mated)
            if prev_mate_player_pov is None and current_mate_player_pov is not None and current_mate_player_pov < 0:
                mate_sequence = "MateCreated"
                # Classify based on how bad the previous position was
                if prev_cp_player_pov < -999:
                    mistake_type = "inaccuracies"
                elif prev_cp_player_pov < -700:
                    mistake_type = "mistakes"
                else:
                    mistake_type = "blunders"

            # MateLost: Positive mate before, no mate after (or negative mate after)
            elif prev_mate_player_pov is not None and prev_mate_player_pov > 0:
                if current_mate_player_pov is None or current_mate_player_pov < 0:
                    mate_sequence = "MateLost"
                    # Classify based on how good the resulting position is
                    if current_cp_player_pov > 999:
                        mistake_type = "inaccuracies"
                    elif current_cp_player_pov > 700:
                        mistake_type = "mistakes"
                    else:
                        mistake_type = "blunders"

            # MateDelayed: Positive mate before and after, but not classified as mistake
            # (This is handled by not setting mistake_type)

            # If we detected a mate sequence mistake, add it
            if mistake_type:
                # Get the best move and variation from the PREVIOUS position
                prev_position_fen = positions[move_number - 1] if move_number - 1 < len(positions) else None
                best_move_uci = None
                best_variation_uci = None

                if prev_position_fen and prev_position_fen in global_evaluations:
                    prev_eval_data = global_evaluations[prev_position_fen]
                    best_move_uci = prev_eval_data.get("best")
                    best_variation_uci = prev_eval_data.get("variation")

                # Convert UCI to SAN
                best_move_san = None
                best_variation_san = None

                if prev_position_fen and best_move_uci:
                    best_move_san = self.convert_uci_to_san(prev_position_fen, best_move_uci)

                if prev_position_fen and best_variation_uci:
                    best_variation_san = self.convert_uci_variation_to_san(prev_position_fen, best_variation_uci)

                # For mate sequences, eval_loss is not really applicable in the same way
                # Set it to 0 or a large value to indicate special case
                mistakes.append({
                    "move_number": move_number,
                    "move": current_eval.get("move", "unknown"),
                    "type": mistake_type,
                    "eval_loss": 100.0 if mate_sequence == "MateLost" else 50.0,  # Arbitrary high values for mate mistakes
                    "color": "white" if is_white_move else "black",
                    "best_move": best_move_san,
                    "best_variation": best_variation_san,
                    "mate_sequence": mate_sequence
                })
                continue  # Skip normal centipawn-based classification

            # Normal centipawn-based mistake detection (CpAdvice logic)
            # Only apply if both positions have centipawn evaluations (not mate)
            if prev_mate is not None or current_mate is not None:
                continue  # Skip if either position has a mate score

            prev_winning_chances = self._get_winning_chances(prev_cp)
            current_winning_chances = self._get_winning_chances(current_cp)

            # Calculate delta from white's perspective
            # delta = currentWinningChances - prevWinningChances
            delta = current_winning_chances - prev_winning_chances

            # Adjust delta based on who moved (Lichess logic: info.color.fold(-d, d))
            # If WHITE moved: negate delta (because white wants positive delta)
            # If BLACK moved: keep delta (because black wants negative delta)
            if is_white_move:
                delta = -delta

            # Now delta represents how much the moving player LOST
            # Positive delta = player lost winning chances
            # Negative delta = player gained winning chances

            # Only count positive losses as mistakes (threshold in [-1, +1] scale)
            if delta < 0.1:  # Less than 0.1 loss is not a mistake
                continue

            # Classify mistakes based on winning chance loss (Lichess thresholds in [-1, +1] scale)
            if delta >= 0.3:
                mistake_type = "blunders"
            elif delta >= 0.2:
                mistake_type = "mistakes"
            elif delta >= 0.1:
                mistake_type = "inaccuracies"
            else:
                continue

            # Convert delta to percentage points for display (0-100 scale)
            winning_chance_loss = delta * 100

            # Get the best move and variation from the PREVIOUS position (before the mistake)
            prev_position_fen = positions[move_number - 1] if move_number - 1 < len(positions) else None
            best_move_uci = None
            best_variation_uci = None

            if prev_position_fen and prev_position_fen in global_evaluations:
                prev_eval_data = global_evaluations[prev_position_fen]
                best_move_uci = prev_eval_data.get("best")
                best_variation_uci = prev_eval_data.get("variation")

            # Convert UCI to SAN if we have the data
            best_move_san = None
            best_variation_san = None

            if prev_position_fen and best_move_uci:
                best_move_san = self.convert_uci_to_san(prev_position_fen, best_move_uci)
                # Debug: Check if conversion happened for mistake analysis
                if best_move_san == best_move_uci and len(best_move_uci) == 4:
                    print(f"DEBUG: Mistake UCI conversion failed for '{best_move_uci}' in prev position {prev_position_fen[:30]}...")

            if prev_position_fen and best_variation_uci:
                best_variation_san = self.convert_uci_variation_to_san(prev_position_fen, best_variation_uci)
                if best_variation_san == best_variation_uci:
                    print(f"DEBUG: Mistake variation conversion failed for '{best_variation_uci[:50]}...' in prev position {prev_position_fen[:30]}...")

            mistakes.append({
                "move_number": move_number,
                "move": evaluations[i].get("move", "unknown"),
                "type": mistake_type,
                "eval_loss": winning_chance_loss,  # Now in percentage points (0-100)
                "color": "white" if is_white_move else "black",
                "best_move": best_move_san,
                "best_variation": best_variation_san
            })

        return mistakes

    def _find_all_user_games(self, username: str) -> List[Dict[str, Any]]:
        """Find all games where the user participated"""
        all_user_games = []

        for game in self.games:
            is_user = (
                game["white_player"].lower() == username.lower()
                or game["black_player"].lower() == username.lower()
            )

            if is_user:
                all_user_games.append(game)

        return all_user_games

    def _game_needs_analysis(self, game: Dict[str, Any], username: str) -> bool:
        """
        Check if a specific game needs new analysis.

        IMPORTANT: Lichess games ALWAYS need analysis even if they have
        existing evaluation data, because we want complete best/variation
        data for all moves (not just mistakes). Lichess only provides
        best/variation for mistakes, but we need it for every position.
        """
        raw_json = game.get("raw_json", {})

        # Check if this is a Lichess game (has "fullId" field)
        is_lichess = "fullId" in raw_json

        if is_lichess:
            # Always re-analyze Lichess games for complete best/variation data
            return True

        # For Chess.com games, check if user's accuracy is missing
        players_data = raw_json.get("players", {})

        if (
            game["white_player"].lower() == username.lower()
            and "white" in players_data
        ):
            white_analysis = players_data["white"].get("analysis", {})
            return white_analysis.get("accuracy") is None
        elif (
            game["black_player"].lower() == username.lower()
            and "black" in players_data
        ):
            black_analysis = players_data["black"].get("analysis", {})
            return black_analysis.get("accuracy") is None

        # If no player data found, assume it needs analysis
        return True

    def enrich_games_with_stockfish_streaming(self, username: str):
        """Generator that yields individual game completions and API progress updates"""
        # Get ALL user games first
        all_user_games = self._find_all_user_games(username)

        # Separate into games that need analysis vs already complete games
        games_needing_analysis = []
        games_already_complete = []

        for game in all_user_games:
            if self._game_needs_analysis(game, username):
                games_needing_analysis.append(game)
            else:
                games_already_complete.append(game)

        total_all_games = len(all_user_games)
        games_needing_analysis_count = len(games_needing_analysis)

        # Step 1: Collect all game data and unique positions for games needing analysis
        unique_positions, game_data_list = self.collect_all_game_data(games_needing_analysis)

        total_positions = len(unique_positions) if unique_positions else 0

        yield {
            "type": "init",
            "total_positions": total_positions,
            "total_games": total_all_games,
            "message": f"Found {total_all_games} total games ({games_needing_analysis_count} need analysis, {len(games_already_complete)} already complete) with {total_positions} positions to evaluate"
        }

        # Immediately yield already-complete games (after converting UCI to SAN)
        completed_game_count = 0
        for game in games_already_complete:
            # Convert any UCI "best" moves to SAN in existing analysis
            self.convert_existing_analysis_uci_to_san(game)

            completed_game_count += 1
            yield {
                "type": "game_complete",
                "game_index": completed_game_count - 1,
                "game_analysis": {"game": game},  # Minimal structure for already-complete games
                "completed_games": completed_game_count,
                "total_games": total_all_games
            }

        if not unique_positions:
            # No new analysis needed, all games were already complete
            yield {
                "type": "complete",
                "completed_games": completed_game_count,
                "total_games": total_all_games,
                "total_positions": 0
            }
            return

        # Step 2: Database lookups
        from .database_evaluator import DatabaseEvaluator
        db_evaluator = DatabaseEvaluator()
        db_results = db_evaluator.get_multiple_position_evaluations(unique_positions)

        # Step 3: Initialize streaming processor with DB results (add source info)
        from .streaming_processor import StreamingGameProcessor

        # Add source information to database results
        db_results_with_source = {}
        for fen, db_eval in db_results.items():
            db_results_with_source[fen] = {
                **db_eval,
                "source": "database"
            }

        processor = StreamingGameProcessor(game_data_list, db_results_with_source)

        # Step 4: Check if any games can be completed with just DB results
        initial_completed = processor.add_evaluation("", {})  # Trigger check with empty eval
        processor.available_evaluations.pop("", None)  # Remove the empty eval we added

        # Process any games that were completed with just database results
        for game_idx, analysis_result in initial_completed:
            if "error" not in analysis_result and "skipped" not in analysis_result:
                # Create the analysis array and inject user stats
                self._create_game_analysis_array(analysis_result["game"], analysis_result, processor.available_evaluations)
                from .hybrid_analyzer import HybridStockfishAnalyzer
                analyzer = HybridStockfishAnalyzer()
                self._inject_user_accuracy_stats(analysis_result["game"], analysis_result, username, analyzer)

                yield {
                    "type": "game_complete",
                    "game_index": len(games_already_complete) + game_idx,  # Offset by already-complete games
                    "game_analysis": analysis_result,
                    "completed_games": len(games_already_complete) + len(processor.get_completed_game_indices()),
                    "total_games": total_all_games
                }

        # Step 5: Handle remaining positions that need GCP evaluation
        positions_for_gcp = [pos for pos in unique_positions if pos not in db_results]
        completed_api_calls = len(db_results)

        yield {
            "type": "api_progress",
            "completed_calls": completed_api_calls,
            "total_calls": total_positions,
            "current_phase": f"Database: {len(db_results)} hits, {len(positions_for_gcp)} API calls needed"
        }

        if positions_for_gcp:
            from .gcp_evaluator import GCPStockfishClient
            gcp_client = GCPStockfishClient()

            # Stream individual position completions
            for update in gcp_client.evaluate_positions_parallel_streaming(
                positions_for_gcp,
                depth=self.stockfish_depth,
                max_concurrent=self.max_concurrent
            ):
                if update["type"] == "position_complete":
                    # Add source information to GCP result
                    gcp_result_with_source = {
                        **update["result"],
                        "source": "gcp_stockfish"
                    }

                    # Add this position to the processor and check for newly completed games
                    newly_completed = processor.add_evaluation(update["position"], gcp_result_with_source)

                    # Process each newly completed game
                    for game_idx, analysis_result in newly_completed:
                        if "error" not in analysis_result and "skipped" not in analysis_result:
                            # Create the analysis array and inject user stats
                            self._create_game_analysis_array(analysis_result["game"], analysis_result, processor.available_evaluations)
                            from .hybrid_analyzer import HybridStockfishAnalyzer
                            analyzer = HybridStockfishAnalyzer()
                            self._inject_user_accuracy_stats(analysis_result["game"], analysis_result, username, analyzer)

                            yield {
                                "type": "game_complete",
                                "game_index": len(games_already_complete) + game_idx,  # Offset by already-complete games
                                "game_analysis": analysis_result,
                                "completed_games": len(games_already_complete) + len(processor.get_completed_game_indices()),
                                "total_games": total_all_games
                            }

                    # Update API progress
                    completed_api_calls = len(db_results) + update["completed_count"]
                    yield {
                        "type": "api_progress",
                        "completed_calls": completed_api_calls,
                        "total_calls": total_positions,
                        "current_phase": f"Stockfish API: {update['completed_count']}/{len(positions_for_gcp)} positions, {len(games_already_complete) + len(processor.get_completed_game_indices())}/{total_all_games} games complete"
                    }

                elif update["type"] == "progress":
                    # Additional progress update from GCP client
                    completed_api_calls = len(db_results) + update["completed"]
                    yield {
                        "type": "api_progress",
                        "completed_calls": completed_api_calls,
                        "total_calls": total_positions,
                        "current_phase": f"Stockfish API: {update['completed']}/{len(positions_for_gcp)} positions evaluated"
                    }

                elif update["type"] == "complete":
                    # All API calls finished
                    pass

        # Final completion
        stats = processor.get_completion_stats()
        yield {
            "type": "complete",
            "completed_games": len(games_already_complete) + stats["completed_games"],
            "total_games": total_all_games,
            "total_positions": total_positions
        }


    def _find_games_needing_analysis(self, username: str) -> List[Dict[str, Any]]:
        """Find games without comprehensive analysis"""
        games_needing_analysis = []

        for i, game in enumerate(self.games):
            is_user = (
                game["white_player"].lower() == username.lower()
                or game["black_player"].lower() == username.lower()
            )

            if not is_user:
                continue

            raw_json = game.get("raw_json", {})
            players_data = raw_json.get("players", {})
            user_has_accuracy = False

            if (
                game["white_player"].lower() == username.lower()
                and "white" in players_data
            ):
                white_analysis = players_data["white"].get("analysis", {})
                user_has_accuracy = white_analysis.get("accuracy") is not None
            elif (
                game["black_player"].lower() == username.lower()
                and "black" in players_data
            ):
                black_analysis = players_data["black"].get("analysis", {})
                user_has_accuracy = black_analysis.get("accuracy") is not None

            if not user_has_accuracy:
                games_needing_analysis.append(game)

        return games_needing_analysis

    def convert_existing_analysis_uci_to_san(
        self,
        game: Dict[str, Any]
    ) -> None:
        """Convert existing Lichess analysis 'best' moves from UCI to SAN format"""
        raw_json = game.get("raw_json", {})
        existing_analysis = raw_json.get("analysis", [])

        if not existing_analysis:
            return

        # Get moves to generate positions
        moves_string = raw_json.get("moves", "")
        if not moves_string:
            return

        moves = self.parse_moves_string(moves_string)
        if not moves:
            return

        # Generate positions for the game
        positions = self.generate_positions_for_game(moves)
        if not positions or len(positions) != len(moves) + 1:
            return

        # Convert UCI "best" moves to SAN for each analysis entry
        # Note: analysis[i] contains the evaluation AFTER move i+1 was played
        # The "best" field shows what SHOULD have been played instead (from the position BEFORE the move)
        for move_index, analysis_entry in enumerate(existing_analysis):
            if not analysis_entry or not isinstance(analysis_entry, dict):
                continue

            # Only convert if "best" field exists and looks like UCI format
            best_move_uci = analysis_entry.get("best")
            if not best_move_uci:
                continue

            # Check if it looks like UCI (4-5 chars, starts with letter+digit)
            if not (len(best_move_uci) in [4, 5] and
                    best_move_uci[0].isalpha() and
                    best_move_uci[1].isdigit()):
                continue  # Already in SAN format

            # Get the position BEFORE this move (where the player should have played the best move)
            # analysis[0] = after move 1, so the "best" is from position[0]
            # analysis[i] = after move i+1, so the "best" is from position[i]
            position_before_move_fen = positions[move_index]

            # Convert UCI to SAN
            best_move_san = self.convert_uci_to_san(position_before_move_fen, best_move_uci)

            # Update the analysis entry
            if best_move_san != best_move_uci:
                analysis_entry["best"] = best_move_san
                print(f"Converted existing analysis UCI '{best_move_uci}' to SAN '{best_move_san}' at move {move_index + 1}")

        # Update the raw_json with converted analysis
        raw_json["analysis"] = existing_analysis
        game["raw_json"] = raw_json

    def _create_game_analysis_array(
        self,
        game: Dict[str, Any],
        analysis_result: Dict[str, Any],
        global_evaluations: Dict[str, Dict]
    ) -> None:
        """Create the analysis array for all moves in the game"""
        if (
            "evaluations" not in analysis_result
            or len(analysis_result["evaluations"]) == 0
        ):
            return

        raw_json = game.get("raw_json", {})

        # If analysis already exists, convert any UCI "best" moves to SAN
        if "analysis" in raw_json:
            self.convert_existing_analysis_uci_to_san(game)
            return

        # Only create analysis array if it doesn't already exist
        if "analysis" not in raw_json:
            analysis_array = []
            mistakes = analysis_result.get("mistakes", [])

            # The analysis array should match position order:
            # analysis[0] = evaluation after move 1 (from starting position)
            # analysis[i] = evaluation after move i+1
            #
            # IMPORTANT: For Lichess compatibility, the "best" and "variation" fields
            # should show what SHOULD have been played from the PREVIOUS position,
            # not what's best from the current position.

            # Get moves to reconstruct positions
            raw_json = game.get("raw_json", {})
            moves_string = raw_json.get("moves", "")
            moves = self.parse_moves_string(moves_string)
            positions = self.generate_positions_for_game(moves)

            for i, move_eval in enumerate(analysis_result["evaluations"]):
                eval_entry = {}

                # Use mate information if available, otherwise use eval
                if "mate" in move_eval and move_eval["mate"] is not None:
                    eval_entry["mate"] = move_eval["mate"]
                elif "eval" in move_eval:
                    eval_entry["eval"] = move_eval["eval"]

                # Get the "best" move and variation from the PREVIOUS position
                # (what the player should have played to reach this position optimally)
                move_number = move_eval.get("move_number", i + 1)
                previous_position_fen = positions[move_number - 1] if (move_number - 1 < len(positions)) else None

                best_move_from_prev = None
                variation_from_prev = None

                # Get the analysis from the PREVIOUS position
                if previous_position_fen and previous_position_fen in global_evaluations:
                    prev_eval_data = global_evaluations[previous_position_fen]

                    if prev_eval_data.get("best"):
                        original_best = prev_eval_data["best"]
                        # Convert UCI to SAN from the previous position
                        best_move_from_prev = self.convert_uci_to_san(previous_position_fen, original_best)

                    if prev_eval_data.get("variation"):
                        original_variation = prev_eval_data["variation"]
                        # Convert UCI variation to SAN from the previous position
                        variation_from_prev = self.convert_uci_variation_to_san(previous_position_fen, original_variation)

                # Set the best move and variation (from previous position)
                if best_move_from_prev:
                    eval_entry["best"] = best_move_from_prev
                if variation_from_prev:
                    eval_entry["variation"] = variation_from_prev

                # Check if this move is a mistake/blunder/inaccuracy
                move_mistakes = [m for m in mistakes if m.get("move_number") == move_number]

                if move_mistakes:
                    mistake = move_mistakes[0]
                    mistake_type = mistake["type"]

                    # For mistakes, the best move is already in eval_entry["best"]
                    # Just need to add the judgment
                    alternative_move = mistake.get("best_move", "Better move")

                    # Create judgment object matching Lichess format
                    if mistake_type == "blunders":
                        eval_entry["judgment"] = {
                            "name": "Blunder",
                            "comment": f"Blunder. {alternative_move} was best."
                        }
                    elif mistake_type == "mistakes":
                        if "mate" in eval_entry:
                            eval_entry["judgment"] = {
                                "name": "Mistake",
                                "comment": f"Checkmate is now unavoidable. {alternative_move} was best."
                            }
                        else:
                            eval_entry["judgment"] = {
                                "name": "Mistake",
                                "comment": f"Mistake. {alternative_move} was best."
                            }
                    elif mistake_type == "inaccuracies":
                        eval_entry["judgment"] = {
                            "name": "Inaccuracy",
                            "comment": f"Inaccuracy. {alternative_move} was best."
                        }

                analysis_array.append(eval_entry)

            # Add the analysis array at the root level
            raw_json["analysis"] = analysis_array

            # Add division data for Chess.com games (Lichess already has this)
            self._add_division_data(game, analysis_result)

            game["raw_json"] = raw_json

    def _add_division_data(
        self,
        game: Dict[str, Any],
        analysis_result: Dict[str, Any]
    ) -> None:
        """Add division (opening/middlegame/endgame) data to Chess.com games"""
        raw_json = game.get("raw_json", {})

        # Only add division if it doesn't already exist (Lichess games already have this)
        if "division" in raw_json:
            return

        # Try to get moves from the raw_json
        moves_string = raw_json.get("moves", "")
        if not moves_string:
            return

        try:
            # Parse moves and calculate division
            moves = self.parse_moves_string(moves_string)
            if not moves:
                return

            # Generate board positions for division analysis
            boards = self.generate_board_positions_for_game(moves)
            if not boards:
                return

            # Calculate division
            division = GameDivider.divide_game(boards)
            division_dict = division.to_dict()

            # Add division data if we have meaningful results
            if division_dict:
                raw_json["division"] = division_dict
                game["raw_json"] = raw_json

        except Exception as e:
            # Don't crash if division calculation fails
            print(f"Division calculation failed for game: {str(e)}")
            pass

    def _inject_user_accuracy_stats(
        self,
        game: Dict[str, Any],
        analysis_result: Dict[str, Any],
        username: str,
        analyzer: HybridStockfishAnalyzer,
    ) -> None:
        """Inject user-specific accuracy statistics into game's JSON structure"""
        if (
            "evaluations" not in analysis_result
            or len(analysis_result["evaluations"]) == 0
        ):
            return

        # Determine user's color
        is_white_player = game["white_player"].lower() == username.lower()
        user_color = "white" if is_white_player else "black"

        # Count mistakes for both players first
        mistakes = analysis_result.get("mistakes", [])
        white_mistakes = [m for m in mistakes if m.get("color") == "white"]
        black_mistakes = [m for m in mistakes if m.get("color") == "black"]

        # Calculate accuracy for BOTH players using Lichess algorithm
        # Extract eval values using the SAME logic as mistake detection
        eval_values = []
        for ev in analysis_result["evaluations"]:
            eval_values.append(self._get_centipawn_value(ev))

        accuracy_calculator = LichessAccuracyCalculator()



        # Calculate accuracy for both White and Black
        white_accuracy = accuracy_calculator.calculate_game_accuracy(eval_values, "white") or 0.0
        black_accuracy = accuracy_calculator.calculate_game_accuracy(eval_values, "black") or 0.0


        # Calculate ACPL for both players
        white_acpl = accuracy_calculator.calculate_acpl(eval_values, "white")
        black_acpl = accuracy_calculator.calculate_acpl(eval_values, "black")

        # Count mistake types for White
        white_inaccuracies = len([m for m in white_mistakes if m["type"] == "inaccuracies"])
        white_mistakes_count = len([m for m in white_mistakes if m["type"] == "mistakes"])
        white_blunders = len([m for m in white_mistakes if m["type"] == "blunders"])

        # Count mistake types for Black
        black_inaccuracies = len([m for m in black_mistakes if m["type"] == "inaccuracies"])
        black_mistakes_count = len([m for m in black_mistakes if m["type"] == "mistakes"])
        black_blunders = len([m for m in black_mistakes if m["type"] == "blunders"])

        # Update the raw_json with analysis for BOTH players
        raw_json = game.get("raw_json", {})
        if "players" not in raw_json:
            raw_json["players"] = {}

        # Ensure both player objects exist
        if "white" not in raw_json["players"]:
            raw_json["players"]["white"] = {}
        if "black" not in raw_json["players"]:
            raw_json["players"]["black"] = {}

        # Inject analysis stats for White
        raw_json["players"]["white"]["analysis"] = {
            "inaccuracy": white_inaccuracies,
            "mistake": white_mistakes_count,
            "blunder": white_blunders,
            "acpl": white_acpl,
            "accuracy": white_accuracy
        }

        # Inject analysis stats for Black
        raw_json["players"]["black"]["analysis"] = {
            "inaccuracy": black_inaccuracies,
            "mistake": black_mistakes_count,
            "blunder": black_blunders,
            "acpl": black_acpl,
            "accuracy": black_accuracy
        }

        game["raw_json"] = raw_json
