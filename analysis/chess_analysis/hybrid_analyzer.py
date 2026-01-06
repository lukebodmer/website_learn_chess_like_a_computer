"""
Hybrid Chess Analyzer

Combines database lookups with GCP Stockfish API for optimal performance:
1. Check database for existing evaluations (fast)
2. Send remaining positions to GCP API for evaluation (scalable)
3. Generate complete game analysis with proper accuracy calculation
"""

import chess
import re
from typing import Dict, List, Any, Optional
from .database_evaluator import DatabaseEvaluator
from .gcp_evaluator import GCPStockfishClient
from .lichess_accuracy import LichessAccuracyCalculator
import logging

logger = logging.getLogger(__name__)

class HybridStockfishAnalyzer:
    """
    Hybrid analyzer using database + GCP Stockfish API
    """

    def __init__(self):
        self.db_evaluator = DatabaseEvaluator()
        self.gcp_client = GCPStockfishClient()

    def parse_moves_string(self, moves_string: str) -> List[str]:
        """Parse moves string into individual moves"""
        # Remove move numbers and clean up
        moves_clean = re.sub(r"\d+\.+", "", moves_string)
        moves_clean = re.sub(r"\s+", " ", moves_clean).strip()

        # Split into individual moves
        moves = moves_clean.split()

        # Filter out any remaining artifacts
        valid_moves = []
        for move in moves:
            if move and not move.isdigit() and "." not in move:
                valid_moves.append(move)

        return valid_moves

    def analyze_game(self, game_json: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze a single game using database + GCP hybrid approach

        Args:
            game_json: Game data with moves string

        Returns:
            Analysis result with evaluations and statistics
        """
        moves_string = game_json.get("moves", "")
        if not moves_string:
            return {"error": "No moves found in game"}

        try:
            # Parse moves
            moves = self.parse_moves_string(moves_string)
            if not moves:
                return {"error": "No valid moves found"}

            # Check if game already has comprehensive analysis
            existing_analysis = game_json.get("analysis", [])
            if len(existing_analysis) > len(moves) * 0.8:
                return {"skipped": "Game already has comprehensive analysis"}

            # Step 1: Get all positions and check database
            logger.info(f"Analyzing game with {len(moves)} moves")
            fens, db_evaluations = self.db_evaluator.get_game_positions_with_evaluations(moves)

            # Step 2: Collect positions that need GCP evaluation
            positions_for_gcp = []
            positions_map = {}  # Maps FEN to position index

            for i, (fen, db_eval) in enumerate(zip(fens, db_evaluations)):
                if db_eval is None:
                    positions_for_gcp.append(fen)
                    positions_map[fen] = i

            # Step 3: Send to GCP if needed
            gcp_results = {}
            if positions_for_gcp:
                logger.info(f"Sending {len(positions_for_gcp)} positions to GCP")
                gcp_results = self.gcp_client.evaluate_positions_batch(positions_for_gcp)

            # Step 4: Build final evaluations list
            evaluations = []
            database_count = 0
            gcp_count = 0
            existing_count = 0

            for i, (fen, db_eval) in enumerate(zip(fens, db_evaluations)):
                if i < len(existing_analysis) and existing_analysis[i].get("eval") is not None:
                    # Use existing evaluation
                    existing_eval = existing_analysis[i].get("eval", 0)
                    evaluations.append({
                        "move_number": i + 1,
                        "move": moves[i - 1] if i > 0 else "start",
                        "eval": existing_eval,
                        "source": "existing"
                    })
                    existing_count += 1

                elif db_eval is not None:
                    # Use database evaluation
                    evaluations.append({
                        "move_number": i + 1,
                        "move": moves[i - 1] if i > 0 else "start",
                        "eval": db_eval["evaluation"],
                        "source": "database",
                        "depth": db_eval["depth"],
                        "knodes": db_eval["knodes"]
                    })
                    database_count += 1

                elif fen in gcp_results and "error" not in gcp_results[fen]:
                    # Use GCP evaluation
                    gcp_eval = gcp_results[fen]
                    evaluations.append({
                        "move_number": i + 1,
                        "move": moves[i - 1] if i > 0 else "start",
                        "eval": gcp_eval["evaluation"],
                        "source": "gcp_stockfish",
                        "depth": gcp_eval["depth"],
                        "time_ms": gcp_eval.get("time_ms", 0)
                    })
                    gcp_count += 1

                else:
                    # No evaluation available
                    logger.warning(f"No evaluation available for position {i}")

            # Step 5: Calculate mistakes (simplified)
            mistakes = self._find_mistakes_from_evaluations(evaluations)

            logger.info(
                f"Analysis complete: {database_count} database, "
                f"{gcp_count} GCP, {existing_count} existing evaluations"
            )

            return {
                "evaluations": evaluations,
                "mistakes": mistakes,
                "total_moves_analyzed": len(evaluations),
                "database_evaluations": database_count,
                "stockfish_evaluations": gcp_count,
                "existing_evaluations": existing_count,
                "new_evaluations": gcp_count  # GCP evaluations are "new"
            }

        except Exception as e:
            logger.error(f"Analysis failed for game: {e}")
            return {"error": f"Analysis failed: {str(e)}"}

    def _find_mistakes_from_evaluations(self, evaluations: List[Dict]) -> List[Dict]:
        """
        Find mistakes from evaluation sequence

        Args:
            evaluations: List of move evaluations

        Returns:
            List of mistakes with classifications
        """
        mistakes = []

        for i in range(1, len(evaluations)):
            current_eval = evaluations[i].get("eval", 0)
            prev_eval = evaluations[i - 1].get("eval", 0)

            # Calculate evaluation change from player's perspective
            move_number = evaluations[i].get("move_number", i + 1)
            is_white_move = move_number % 2 == 1

            # Stockfish evals are always from White's perspective
            # For White: good move increases eval, bad move decreases eval
            # For Black: good move decreases eval, bad move increases eval
            if is_white_move:
                eval_loss = prev_eval - current_eval
            else:
                eval_loss = current_eval - prev_eval

            # Only count positive losses as mistakes
            if eval_loss <= 0:
                continue

            # Classify mistakes based on evaluation loss
            if eval_loss > 300:  # Lost 3+ pawns
                mistake_type = "blunder"
            elif eval_loss > 150:  # Lost 1.5+ pawns
                mistake_type = "mistake"
            elif eval_loss > 50:   # Lost 0.5+ pawns
                mistake_type = "inaccuracy"
            else:
                continue  # Not a mistake

            mistakes.append({
                "move_number": move_number,
                "move": evaluations[i].get("move", "unknown"),
                "type": mistake_type,
                "eval_loss": eval_loss,
                "color": "white" if is_white_move else "black"
            })

        return mistakes

    def analyze_accuracy_from_evaluations(self, evaluations: List[Dict], color: str) -> float:
        """
        Calculate accuracy percentage for a player using Lichess algorithm

        Args:
            evaluations: List of move evaluations
            color: "white" or "black"

        Returns:
            Accuracy percentage (0-100)
        """
        if len(evaluations) < 2:
            return 100.0  # Default for very short games

        # Extract evaluation values for Lichess calculator
        eval_values = [ev.get("eval", 0) for ev in evaluations]

        # Use Lichess accuracy calculator
        accuracy_calculator = LichessAccuracyCalculator()
        accuracy = accuracy_calculator.calculate_game_accuracy(eval_values, color)

        return round(accuracy, 1) if accuracy is not None else 100.0