import chess
import chess.engine
from typing import Dict, List, Any, Optional, Tuple
import re


class StockfishAnalyzer:
    def __init__(self, stockfish_path="stockfish", depth=20):
        self.stockfish_path = stockfish_path
        self.depth = depth
        self.engine = None

    def __enter__(self):
        """Context manager entry"""
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(self.stockfish_path)
            return self
        except Exception as e:
            print(f"Failed to start Stockfish: {e}")
            return None

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        if self.engine:
            self.engine.quit()

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
        """Analyze a single game and return evaluations and mistakes"""
        if not self.engine:
            return {"error": "Stockfish engine not available"}

        moves_string = game_json.get("moves", "")
        if not moves_string:
            return {"error": "No moves found in game"}

        try:
            # Parse moves
            moves = self.parse_moves_string(moves_string)

            # Check if game already has analysis
            existing_analysis = game_json.get("analysis", [])
            if (
                len(existing_analysis) > len(moves) * 0.8
            ):  # If 80%+ moves have analysis, skip
                return {"skipped": "Game already has comprehensive analysis"}

            # Analyze positions
            board = chess.Board()
            evaluations = []
            mistakes = []

            prev_eval = 0  # Starting eval (roughly equal)

            for i, move_str in enumerate(moves):
                try:
                    # Check if this position already has analysis
                    if (
                        i < len(existing_analysis)
                        and existing_analysis[i].get("eval") is not None
                    ):
                        # Use existing evaluation
                        existing_eval = existing_analysis[i].get("eval", 0)
                        evaluations.append(
                            {
                                "move_number": i + 1,
                                "move": move_str,
                                "eval": existing_eval,
                                "source": "existing",
                            }
                        )
                        prev_eval = existing_eval
                        continue

                    # Make the move
                    move = board.parse_san(move_str)
                    board.push(move)

                    # Analyze position with Stockfish
                    analysis = self.engine.analyse(
                        board, chess.engine.Limit(depth=self.depth)
                    )

                    # Extract evaluation
                    score = analysis["score"].relative
                    if score.is_mate():
                        # Convert mate scores
                        mate_in = score.mate()
                        eval_cp = 9999 if mate_in > 0 else -9999
                    else:
                        eval_cp = score.score()  # In centipawns

                    evaluations.append(
                        {
                            "move_number": i + 1,
                            "move": move_str,
                            "eval": eval_cp,
                            "source": "stockfish",
                        }
                    )

                    # Detect mistakes (eval swing from previous position)
                    # Note: We flip eval for black moves
                    current_eval = eval_cp if (i % 2 == 0) else -eval_cp
                    eval_change = current_eval - prev_eval

                    # Mistake detection (negative change is bad for the player)
                    if eval_change < -200:  # Lost 2+ pawns
                        mistakes.append(
                            {
                                "move_number": i + 1,
                                "move": move_str,
                                "type": "blunder",
                                "eval_loss": abs(eval_change),
                            }
                        )
                    elif eval_change < -100:  # Lost 1+ pawns
                        mistakes.append(
                            {
                                "move_number": i + 1,
                                "move": move_str,
                                "type": "mistake",
                                "eval_loss": abs(eval_change),
                            }
                        )
                    elif eval_change < -50:  # Lost 0.5+ pawns
                        mistakes.append(
                            {
                                "move_number": i + 1,
                                "move": move_str,
                                "type": "inaccuracy",
                                "eval_loss": abs(eval_change),
                            }
                        )

                    prev_eval = current_eval

                except (chess.InvalidMoveError, chess.IllegalMoveError) as e:
                    print(f"Invalid move {move_str} at position {i}: {e}")
                    break
                except Exception as e:
                    print(f"Error analyzing move {move_str}: {e}")
                    continue

            return {
                "evaluations": evaluations,
                "mistakes": mistakes,
                "total_moves_analyzed": len(evaluations),
                "new_evaluations": len(
                    [e for e in evaluations if e["source"] == "stockfish"]
                ),
            }

        except Exception as e:
            return {"error": f"Analysis failed: {str(e)}"}

    def analyze_accuracy_from_evaluations(
        self, evaluations: List[Dict], player_color: str
    ) -> float:
        """Calculate accuracy based on evaluation swings"""
        if len(evaluations) < 2:
            return 100.0

        total_inaccuracy = 0
        move_count = 0

        for i in range(1, len(evaluations)):
            # Skip if this isn't the player's move
            if (i % 2 == 1 and player_color == "white") or (
                i % 2 == 0 and player_color == "black"
            ):
                continue

            prev_eval = evaluations[i - 1]["eval"]
            curr_eval = evaluations[i]["eval"]

            # Calculate eval change (negative is bad for current player)
            if player_color == "black":
                eval_change = -curr_eval - (-prev_eval)  # Flip for black
            else:
                eval_change = curr_eval - prev_eval

            if eval_change < 0:  # Player made position worse
                inaccuracy = min(abs(eval_change), 500)  # Cap at 5 pawns
                total_inaccuracy += inaccuracy

            move_count += 1

        if move_count == 0:
            return 100.0

        # Convert to accuracy percentage (lower inaccuracy = higher accuracy)
        avg_inaccuracy = total_inaccuracy / move_count
        accuracy = max(0, 100 - (avg_inaccuracy / 10))  # Rough conversion

        return round(accuracy, 1)
