from typing import Dict, List, Any, Tuple
from .hybrid_analyzer import HybridStockfishAnalyzer
from .database_evaluator import DatabaseEvaluator
from .gcp_evaluator import GCPStockfishClient
from .lichess_accuracy import LichessAccuracyCalculator
import chess
import re
import time


class GameEnricher:
    """Enriches game data with Stockfish analysis for games lacking evaluation data"""

    def __init__(self, games: List[Dict[str, Any]]):
        self.games = games

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
            if len(existing_analysis) >= len(moves) * 0.8:
                game_data.append({"skipped": "Game already has analysis", "positions": []})
                continue

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
                    "source": "existing"
                }

                # Copy all existing evaluation data
                existing_data = existing_analysis[move_index]
                if existing_data.get("eval") is not None:
                    eval_entry["eval"] = existing_data["eval"]
                if existing_data.get("mate") is not None:
                    eval_entry["mate"] = existing_data["mate"]
                if existing_data.get("best"):
                    eval_entry["best"] = existing_data["best"]
                if existing_data.get("variation"):
                    eval_entry["variation"] = existing_data["variation"]

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
                        "best": eval_data.get("best"),
                        "variation": eval_data.get("variation")
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

        # Find mistakes from the evaluations
        mistakes = self._find_mistakes_from_evaluations(evaluations)

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

    def build_game_evaluations(self, game_data: Dict, db_results: Dict, gcp_results: Dict) -> Dict[str, Any]:
        """Build evaluation results for a single game"""
        if "error" in game_data or "skipped" in game_data:
            return game_data

        game_positions = game_data["positions"]
        moves = game_data["moves"]
        existing_analysis = game_data["existing_analysis"]

        evaluations = []
        db_count = gcp_count = existing_count = 0

        for i, fen in enumerate(game_positions):
            if i < len(existing_analysis) and existing_analysis[i].get("eval") is not None:
                # Use existing evaluation
                evaluations.append({
                    "move_number": i + 1,
                    "move": moves[i - 1] if i > 0 else "start",
                    "eval": existing_analysis[i].get("eval", 0),
                    "source": "existing"
                })
                existing_count += 1

            elif fen in db_results:
                # Use database evaluation
                db_eval = db_results[fen]
                eval_entry = {
                    "move_number": i + 1,
                    "move": moves[i - 1] if i > 0 else "start",
                    "eval": db_eval["evaluation"],
                    "source": "database",
                    "depth": db_eval["depth"],
                    "knodes": db_eval["knodes"],
                    "best": db_eval.get("best"),
                    "variation": db_eval.get("variation")
                }
                # Include mate information if available
                if "mate" in db_eval and db_eval["mate"] is not None:
                    eval_entry["mate"] = db_eval["mate"]
                evaluations.append(eval_entry)
                db_count += 1

            elif fen in gcp_results and "error" not in gcp_results[fen]:
                # Use GCP evaluation
                gcp_eval = gcp_results[fen]
                eval_entry = {
                    "move_number": i + 1,
                    "move": moves[i - 1] if i > 0 else "start",
                    "eval": gcp_eval["evaluation"],
                    "source": "gcp_stockfish",
                    "depth": gcp_eval["depth"],
                    "time_ms": gcp_eval.get("time_ms", 0),
                    "best": gcp_eval.get("best"),
                    "variation": gcp_eval.get("variation")
                }
                # Include mate information if available
                if "mate" in gcp_eval and gcp_eval["mate"] is not None:
                    eval_entry["mate"] = gcp_eval["mate"]
                evaluations.append(eval_entry)
                gcp_count += 1

        # Find mistakes
        mistakes = self._find_mistakes_from_evaluations(evaluations)

        return {
            "evaluations": evaluations,
            "mistakes": mistakes,
            "total_moves_analyzed": len(evaluations),
            "database_evaluations": db_count,
            "stockfish_evaluations": gcp_count,
            "existing_evaluations": existing_count,
            "new_evaluations": gcp_count
        }

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

    def _find_mistakes_from_evaluations(self, evaluations: List[Dict]) -> List[Dict]:
        """Find mistakes from evaluation sequence (handles both eval and mate scores)"""
        mistakes = []

        for i in range(1, len(evaluations)):
            move_number = evaluations[i].get("move_number", i + 1)
            is_white_move = move_number % 2 == 1

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

            mistakes.append({
                "move_number": move_number,
                "move": evaluations[i].get("move", "unknown"),
                "type": mistake_type,
                "eval_loss": eval_loss,
                "color": "white" if is_white_move else "black"
            })

        return mistakes

    def enrich_games_with_stockfish_streaming(self, username: str):
        """Generator that yields individual game analysis results as they complete"""
        games_needing_analysis = self._find_games_needing_analysis(username)
        total_games = len(games_needing_analysis)

        # DEBUG: Save original data before enrichment
        if games_needing_analysis:
            self._debug_save_enrichment_data(games_needing_analysis, "streaming_before_enrichment")

        yield {
            "type": "init",
            "total_games": total_games,
            "games_found": total_games
        }

        if not games_needing_analysis:
            return

        hard_limit_for_debugging = 5
        selected_games = games_needing_analysis[:hard_limit_for_debugging]

        # Start concurrent processing for all games
        import concurrent.futures
        import threading

        # Create shared GCP client to avoid auth token conflicts
        gcp_client = GCPStockfishClient()

        # Use ThreadPoolExecutor to process games concurrently (reduced to avoid API overload)
        max_workers = min(2, len(selected_games))  # Reduced from 3 to 2
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all games for processing simultaneously
            future_to_game = {}
            for i, game in enumerate(selected_games):
                yield {
                    "type": "game_start",
                    "game_index": i + 1,
                    "total_games": len(selected_games),
                    "game_info": {
                        "white_player": game["white_player"],
                        "black_player": game["black_player"],
                        "opening": game["opening"]
                    }
                }

                future = executor.submit(self._process_single_game_with_shared_client, game, username, gcp_client)
                future_to_game[future] = (i + 1, game)

            # Yield results as they complete
            for future in concurrent.futures.as_completed(future_to_game):
                game_index, game = future_to_game[future]

                try:
                    game_result = future.result()

                    yield {
                        "type": "game_complete",
                        "game_index": game_index,
                        "total_games": len(selected_games),
                        "analysis_result": game_result,
                        "enriched_game": game
                    }

                except Exception as e:
                    yield {
                        "type": "game_error",
                        "game_index": game_index,
                        "total_games": len(selected_games),
                        "error": str(e)
                    }

        # DEBUG: Save enriched data after streaming processing
        self._debug_save_enrichment_data(selected_games, "streaming_after_enrichment")

        # DEBUG: Save the complete enriched games data as it would appear in the report
        self._debug_save_complete_report_data(selected_games, "complete_enriched_games")

        yield {"type": "complete"}

    def _process_single_game_with_shared_client(self, game: Dict[str, Any], username: str, gcp_client: GCPStockfishClient) -> Dict[str, Any]:
        """Process a single game with database + GCP analysis using shared client and new architecture"""
        # Collect game data with new architecture
        unique_positions, game_data_list = self.collect_all_game_data([game])

        if not unique_positions or not game_data_list or "error" in game_data_list[0]:
            return {"error": "Failed to extract positions from game"}

        game_data = game_data_list[0]

        # Query database for all unique positions
        db_evaluator = DatabaseEvaluator()
        db_results = db_evaluator.get_multiple_position_evaluations(unique_positions)

        # Query GCP for remaining positions using shared client
        positions_for_gcp = [pos for pos in unique_positions if pos not in db_results]
        gcp_results = {}
        if positions_for_gcp:
            gcp_results = gcp_client.evaluate_positions_parallel(positions_for_gcp, depth=24, max_concurrent=15)

        # Merge all evaluation sources
        global_evaluations = self.merge_evaluation_sources(db_results, gcp_results)

        # DEBUG: Show evaluation source breakdown
        print(f"DEBUG EVALUATION SOURCES (streaming):")
        print(f"  Database results: {len(db_results)} positions")
        print(f"  GCP results: {len(gcp_results)} positions")
        print(f"  Total global evaluations: {len(global_evaluations)} positions")
        if global_evaluations:
            sample_pos = list(global_evaluations.keys())[0]
            sample_eval = global_evaluations[sample_pos]
            print(f"  Sample evaluation: {sample_eval.get('evaluation')} from {sample_eval.get('source')}")

        # Build analysis for this specific game using global evaluations
        analysis_result = self.build_single_game_analysis(game_data, global_evaluations)

        if "error" not in analysis_result and "skipped" not in analysis_result:
            # Create the analysis array and inject user stats
            self._create_game_analysis_array(analysis_result["game"], analysis_result)

            # Inject user-specific accuracy data
            analyzer = HybridStockfishAnalyzer()
            self._inject_user_accuracy_stats(analysis_result["game"], analysis_result, username, analyzer)

        return analysis_result

    def _process_single_game(self, game: Dict[str, Any], username: str) -> Dict[str, Any]:
        """Process a single game with database + GCP analysis"""
        # Collect game data
        all_positions, game_data_list = self.collect_all_game_data([game])

        if not all_positions or not game_data_list or "error" in game_data_list[0]:
            return {"error": "Failed to extract positions from game"}

        game_data = game_data_list[0]

        # Query database for this game's positions (preserve order)
        unique_positions = []
        seen = set()
        for pos in all_positions:
            if pos not in seen:
                unique_positions.append(pos)
                seen.add(pos)

        db_evaluator = DatabaseEvaluator()
        db_results = db_evaluator.get_multiple_position_evaluations(unique_positions)

        # Query GCP for remaining positions
        positions_for_gcp = [pos for pos in unique_positions if pos not in db_results]
        gcp_results = {}
        if positions_for_gcp:
            gcp_client = GCPStockfishClient()
            gcp_results = gcp_client.evaluate_positions_batch(positions_for_gcp)

        # Build analysis result
        analysis_result = self.build_game_evaluations(game_data, db_results, gcp_results)

        if "error" not in analysis_result and "skipped" not in analysis_result:
            # First, create the full game analysis array (for all moves)
            self._create_game_analysis_array(game, analysis_result)

            # Then inject user-specific accuracy data
            analyzer = HybridStockfishAnalyzer()
            self._inject_user_accuracy_stats(game, analysis_result, username, analyzer)

        return analysis_result

    def enrich_games_with_stockfish(self, username: str) -> Dict[str, Any]:
        """Find games needing analysis and enrich them with optimized batch processing"""
        enrichment_results = {
            "total_games_analyzed": 0,
            "games_with_new_analysis": 0,
            "total_mistakes_found": 0,
            "mistake_breakdown": {"blunders": 0, "mistakes": 0, "inaccuracies": 0},
            "analysis_errors": 0,
            "games_skipped": 0,
            "database_evaluations_used": 0,
            "stockfish_evaluations_used": 0,
            "existing_evaluations_used": 0,
        }

        # Step 1: Find games needing analysis
        games_needing_analysis = self._find_games_needing_analysis(username)
        print(f"Found {len(games_needing_analysis)} games needing analysis")

        # DEBUG: Save original data before enrichment
        if games_needing_analysis:
            self._debug_save_enrichment_data(games_needing_analysis, "before_enrichment")

        try:
            hard_limit_for_debugging = 5
            selected_games = games_needing_analysis[:hard_limit_for_debugging]

            if not selected_games:
                return enrichment_results

            print(f"Starting optimized batch analysis for {len(selected_games)} games...")

            # Step 2: Collect all game data and unique positions (new architecture)
            unique_positions, game_data_list = self.collect_all_game_data(selected_games)

            if not unique_positions:
                print("No positions found to analyze")
                return enrichment_results

            # Step 3: Batch query database for ALL unique positions
            print(f"Batch querying database for {len(unique_positions)} unique positions...")
            db_evaluator = DatabaseEvaluator()
            db_results = db_evaluator.get_multiple_position_evaluations(unique_positions)

            # Step 4: Parallel query GCP for remaining positions
            positions_for_gcp = [pos for pos in unique_positions if pos not in db_results]
            gcp_results = {}
            if positions_for_gcp:
                print(f"Parallel querying GCP for {len(positions_for_gcp)} positions...")
                gcp_client = GCPStockfishClient()
                gcp_results = gcp_client.evaluate_positions_parallel(positions_for_gcp, depth=24, max_concurrent=15)

            # Step 5: Merge all evaluation sources into global dict
            global_evaluations = self.merge_evaluation_sources(db_results, gcp_results)

            # Step 6: Process each game individually using global evaluations
            total_db_count = 0
            total_gcp_count = 0

            for i, game_data in enumerate(game_data_list):
                if "error" in game_data or "skipped" in game_data:
                    if "error" in game_data:
                        enrichment_results["analysis_errors"] += 1
                        print(f"Game {i+1} error: {game_data['error']}")
                    else:
                        enrichment_results["games_skipped"] += 1
                    continue

                print(f"Processing game {i+1}/{len(game_data_list)}")
                enrichment_results["total_games_analyzed"] += 1

                # Build analysis for this specific game
                analysis_result = self.build_single_game_analysis(game_data, global_evaluations)

                # Count evaluations
                db_count = analysis_result.get("database_evaluations", 0)
                gcp_count = analysis_result.get("stockfish_evaluations", 0)
                existing_count = analysis_result.get("existing_evaluations", 0)

                total_db_count += db_count
                total_gcp_count += gcp_count

                if db_count + gcp_count > 0:
                    enrichment_results["games_with_new_analysis"] += 1

                    # Create game analysis array and inject user stats
                    game = analysis_result["game"]
                    self._create_game_analysis_array(game, analysis_result)

                    analyzer = HybridStockfishAnalyzer()
                    self._inject_user_accuracy_stats(game, analysis_result, username, analyzer)

                # Update totals
                enrichment_results["database_evaluations_used"] += db_count
                enrichment_results["stockfish_evaluations_used"] += gcp_count
                enrichment_results["existing_evaluations_used"] += existing_count

                # Count mistakes
                mistakes = analysis_result.get("mistakes", [])
                enrichment_results["total_mistakes_found"] += len(mistakes)

                for mistake in mistakes:
                    mistake_type = mistake["type"]
                    if mistake_type in enrichment_results["mistake_breakdown"]:
                        enrichment_results["mistake_breakdown"][mistake_type] += 1

                # Store detailed analysis for debugging
                game["stockfish_analysis"] = analysis_result

            print(f"Batch analysis complete: {total_db_count} database hits, {total_gcp_count} GCP evaluations")

            # DEBUG: Save enriched data after processing
            self._debug_save_enrichment_data(selected_games, "after_enrichment")

        except Exception as e:
            enrichment_results["error"] = f"Stockfish analysis failed: {str(e)}"

        return enrichment_results

    def _find_games_needing_analysis(self, username: str) -> List[Dict[str, Any]]:
        """Find games without comprehensive analysis"""
        games_needing_analysis = []

        for game in self.games:
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
        analysis_result: Dict[str, Any]
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

                # Check if this move is a mistake/blunder/inaccuracy
                move_number = move_eval.get("move_number", i + 1)
                move_mistakes = [m for m in mistakes if m.get("move_number") == move_number]

                if move_mistakes:
                    mistake = move_mistakes[0]
                    mistake_type = mistake["type"]

                    # Add best move and variation if available
                    if move_eval.get("best"):
                        eval_entry["best"] = move_eval["best"]
                    if move_eval.get("variation"):
                        eval_entry["variation"] = move_eval["variation"]

                    # Create judgment object matching Lichess format
                    if mistake_type == "blunders":
                        eval_entry["judgment"] = {
                            "name": "Blunder",
                            "comment": f"Blunder. {move_eval.get('best', 'Better move')} was best."
                        }
                    elif mistake_type == "mistakes":
                        if "mate" in eval_entry:
                            eval_entry["judgment"] = {
                                "name": "Mistake",
                                "comment": "Checkmate is now unavoidable. " + f"{move_eval.get('best', 'Better move')} was best."
                            }
                        else:
                            eval_entry["judgment"] = {
                                "name": "Mistake",
                                "comment": f"Mistake. {move_eval.get('best', 'Better move')} was best."
                            }
                    elif mistake_type == "inaccuracies":
                        eval_entry["judgment"] = {
                            "name": "Inaccuracy",
                            "comment": f"Inaccuracy. {move_eval.get('best', 'Better move')} was best."
                        }

                analysis_array.append(eval_entry)

            # Add the analysis array at the root level
            raw_json["analysis"] = analysis_array
            game["raw_json"] = raw_json

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

        # DEBUG: Print evaluation values to see what we're working with
        print(f"DEBUG: Evaluation values for accuracy calculation: {eval_values[:10]}...")  # First 10 values
        print(f"DEBUG: Total evaluations: {len(eval_values)}")
        print(f"DEBUG: White mistakes: {len(white_mistakes)}, Black mistakes: {len(black_mistakes)}")

        # DEBUG: Check if mistakes are detected with large eval swings
        if len(white_mistakes) > 5 or len(black_mistakes) > 5:
            print("DEBUG: Many mistakes detected, but checking if eval swings are captured...")
            # Check consecutive eval differences
            big_swings = []
            for i in range(1, len(eval_values)):
                diff = abs(eval_values[i] - eval_values[i-1])
                if diff > 200:  # Should be blunder-level
                    big_swings.append(f"Move {i}: {eval_values[i-1]} → {eval_values[i]} (swing: {diff})")

            if big_swings:
                print(f"DEBUG: Found {len(big_swings)} large eval swings:")
                for swing in big_swings[:5]:  # Show first 5
                    print(f"  {swing}")
            else:
                print("DEBUG: WARNING - No large eval swings found despite many mistakes!")
                print(f"DEBUG: Max eval swing: {max(abs(eval_values[i] - eval_values[i-1]) for i in range(1, len(eval_values))) if len(eval_values) > 1 else 0}")

        # Calculate accuracy for both White and Black
        white_accuracy = accuracy_calculator.calculate_game_accuracy(eval_values, "white") or 0.0
        black_accuracy = accuracy_calculator.calculate_game_accuracy(eval_values, "black") or 0.0

        print(f"DEBUG: Calculated accuracies - White: {white_accuracy}%, Black: {black_accuracy}%")

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

        print(f"Injected analysis for both players:")
        print(f"  White: accuracy={white_accuracy}%, acpl={white_acpl}, "
              f"inaccuracies={white_inaccuracies}, mistakes={white_mistakes_count}, blunders={white_blunders}")
        print(f"  Black: accuracy={black_accuracy}%, acpl={black_acpl}, "
              f"inaccuracies={black_inaccuracies}, mistakes={black_mistakes_count}, blunders={black_blunders}")

    def _debug_save_enrichment_data(self, games_data: List[Dict], prefix: str = "debug"):
        """Save enrichment data for debugging purposes"""
        import json
        import time

        timestamp = int(time.time())
        filename = f"{prefix}_enriched_data_{timestamp}.json"

        # Create a simplified version for debugging
        debug_data = []
        for game in games_data:  # Save ALL games
            raw_json = game.get("raw_json", {})
            analysis_array = raw_json.get("analysis", [])

            # Show first 10 moves of analysis for debugging
            first_analysis_moves = []
            for i, analysis_entry in enumerate(analysis_array[:10]):
                first_analysis_moves.append({
                    "move_index": i,
                    "eval": analysis_entry.get("eval"),
                    "mate": analysis_entry.get("mate"),
                    "best": analysis_entry.get("best")
                })

            debug_game = {
                "game_id": raw_json.get("id", "unknown"),
                "white_player": game.get("white_player"),
                "black_player": game.get("black_player"),
                "moves": raw_json.get("moves", ""),
                "moves_list": raw_json.get("moves", "").split()[:10] if raw_json.get("moves") else [],
                "first_10_analysis": first_analysis_moves,
                "analysis_count": len(analysis_array),
                "enrichment_data": game.get("stockfish_analysis", {}),
                "players_accuracy": raw_json.get("players", {})
            }
            debug_data.append(debug_game)

        try:
            with open(filename, 'w') as f:
                json.dump(debug_data, f, indent=2)
            print(f"DEBUG: Saved enrichment data to {filename} ({len(debug_data)} games)")

            # Also print a quick summary for immediate debugging
            if debug_data:
                game = debug_data[0]
                print(f"DEBUG SUMMARY for game {game['game_id']}:")
                print(f"  Moves: {game['moves_list']}")
                print(f"  Analysis entries: {game['analysis_count']}")
                if game['first_10_analysis']:
                    print("  First 5 evaluations:")
                    for i, entry in enumerate(game['first_10_analysis'][:5]):
                        print(f"    Move {i+1}: eval={entry['eval']}, mate={entry['mate']}")

        except Exception as e:
            print(f"DEBUG: Failed to save enrichment data: {e}")

    def _debug_save_complete_report_data(self, games_data: List[Dict], prefix: str = "complete"):
        """Save complete games data as it appears in the report"""
        import json
        import time

        timestamp = int(time.time())

        # Save complete enriched games data (first 10 as shown in report)
        enriched_filename = f"{prefix}_enriched_games_{timestamp}.json"
        try:
            # Extract the complete raw_json for each game (this is what goes to the report)
            enriched_games_for_report = []
            for game in games_data:  # ALL games, not just first 10
                enriched_games_for_report.append(game.get("raw_json", {}))

            with open(enriched_filename, 'w') as f:
                json.dump(enriched_games_for_report, f, indent=2)
            print(f"DEBUG: Saved complete enriched games data to {enriched_filename} ({len(enriched_games_for_report)} games)")

            # Show analysis array samples
            if enriched_games_for_report:
                game = enriched_games_for_report[0]
                analysis = game.get("analysis", [])
                print(f"DEBUG: First enriched game {game.get('id', 'unknown')} has {len(analysis)} analysis entries")
                if analysis:
                    print("First 5 analysis entries:")
                    for i, entry in enumerate(analysis[:5]):
                        print(f"  [{i}]: eval={entry.get('eval')}, mate={entry.get('mate')}")

        except Exception as e:
            print(f"DEBUG: Failed to save complete enriched games data: {e}")
