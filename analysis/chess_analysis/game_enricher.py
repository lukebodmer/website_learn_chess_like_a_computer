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
            # A game has sufficient analysis if it has analysis for most moves
            # analysis array should be roughly equal to number of moves

            # Generate positions for this game
            game_positions = self.generate_positions_for_game(moves)
            if not game_positions:
                game_data.append({"error": "Position generation failed", "positions": []})
                continue

            game_data.append({
                "game": game,  # Keep reference to original game
                "moves": moves,
                "positions": game_positions,  # Ordered positions for THIS game
                "existing_analysis": existing_analysis
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

    def _find_mistakes_from_evaluations(self, evaluations: List[Dict], positions: List[str], global_evaluations: Dict[str, Dict]) -> List[Dict]:
        """Find mistakes from evaluation sequence (handles both eval and mate scores)"""
        mistakes = []

        for i in range(1, len(evaluations)):
            move_number = evaluations[i].get("move_number", i + 1)
            is_white_move = move_number % 2 == 1

            # Skip mistake detection if current position is checkmate (mate: 0)
            # This means the player just delivered checkmate, which is not a mistake
            current_eval = evaluations[i]
            if "mate" in current_eval and current_eval["mate"] == 0:
                continue

            current_cp = self._get_centipawn_value(evaluations[i])
            prev_cp = self._get_centipawn_value(evaluations[i - 1])

            # Calculate evaluation change from the moving player's perspective
            # Stockfish evals are always from White's perspective
            # For White: good move increases eval, bad move decreases eval
            # For Black: good move decreases eval, bad move increases eval
            if is_white_move:
                # White move: eval loss = previous eval - current eval
                eval_loss = prev_cp - current_cp
            else:
                # Black move: eval loss = current eval - previous eval
                # (because a good black move makes the eval more negative)
                eval_loss = current_cp - prev_cp

            # Only count positive losses as mistakes
            if eval_loss <= 0:
                continue

            # Classify mistakes based on evaluation loss
            if eval_loss > 300:
                mistake_type = "blunders"
            elif eval_loss > 150:
                mistake_type = "mistakes"
            elif eval_loss > 50:
                mistake_type = "inaccuracies"
            else:
                continue

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
                "eval_loss": eval_loss,
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
        """Check if a specific game needs new analysis"""
        raw_json = game.get("raw_json", {})
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

        # Immediately yield already-complete games
        completed_game_count = 0
        for game in games_already_complete:
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

        # Only create analysis array once - don't overwrite if it already exists
        if "analysis" not in raw_json:
            analysis_array = []
            mistakes = analysis_result.get("mistakes", [])

            # The analysis array should match position order:
            # analysis[0] = evaluation after move 1 (from starting position)
            # analysis[i] = evaluation after move i+1
            for i, move_eval in enumerate(analysis_result["evaluations"]):
                eval_entry = {}

                # Use mate information if available, otherwise use eval
                if "mate" in move_eval and move_eval["mate"] is not None:
                    eval_entry["mate"] = move_eval["mate"]
                elif "eval" in move_eval:
                    eval_entry["eval"] = move_eval["eval"]

                # Always add best move and variation from the current position
                # (what the engine thinks is best from this position)
                current_position_fen = move_eval.get("position_fen")
                current_best_move = None
                current_best_variation = None

                # Get the current position's analysis from global evaluations
                if current_position_fen and current_position_fen in global_evaluations:
                    current_eval_data = global_evaluations[current_position_fen]
                    print(f"DEBUG: Found eval data for position {current_position_fen[:30]}... - best: {current_eval_data.get('best')}")

                    if current_eval_data.get("best"):
                        original_best = current_eval_data["best"]
                        current_best_move = self.convert_uci_to_san(current_position_fen, original_best)
                        print(f"DEBUG: Converted '{original_best}' to '{current_best_move}'")

                    if current_eval_data.get("variation"):
                        original_variation = current_eval_data["variation"]
                        current_best_variation = self.convert_uci_variation_to_san(current_position_fen, original_variation)
                        print(f"DEBUG: Converted variation '{original_variation[:30]}...' to '{current_best_variation[:30]}...'")
                else:
                    if current_position_fen:
                        print(f"DEBUG: No eval data found for position {current_position_fen[:30]}... in global_evaluations")
                    else:
                        print(f"DEBUG: current_position_fen is None for move {move_eval.get('move_number')}")

                # Set the current position's best move and variation
                if current_best_move:
                    eval_entry["best"] = current_best_move
                if current_best_variation:
                    eval_entry["variation"] = current_best_variation

                # Check if this move is a mistake/blunder/inaccuracy
                move_number = move_eval.get("move_number", i + 1)
                move_mistakes = [m for m in mistakes if m.get("move_number") == move_number]

                if move_mistakes:
                    mistake = move_mistakes[0]
                    mistake_type = mistake["type"]

                    # For mistakes, we want to show what the player SHOULD have done
                    # (from the previous position), not what's best in the current position
                    alternative_move = mistake.get("best_move", "Better move")
                    alternative_variation = mistake.get("best_variation")

                    # Override with the alternative move data for the judgment
                    # but keep the current position's best move in the "best" field
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
