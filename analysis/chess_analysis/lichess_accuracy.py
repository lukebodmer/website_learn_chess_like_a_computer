"""
Lichess-style Accuracy Calculator

Implements the same accuracy calculation system used by Lichess:
1. Convert centipawns to Win%
2. Calculate move accuracy from Win% changes
3. Calculate game accuracy using volatility-weighted sliding windows
"""

import math
import statistics
from typing import List, Optional, Tuple


class LichessAccuracyCalculator:
    """
    Calculator that implements Lichess's accuracy algorithm

    This class provides methods to calculate game accuracy and ACPL using the same
    sophisticated algorithm that Lichess uses, including volatility-weighted
    sliding windows and harmonic mean calculations.
    """

    def __init__(self):
        # Lichess formula constants
        self.win_percent_coeff = 0.00368208
        self.accuracy_base = 103.1668
        self.accuracy_coeff = -0.04354
        self.accuracy_offset = 3.1669

        # Volatility constraints
        self.min_volatility = 0.5
        self.max_volatility = 12.0

    def calculate_game_accuracy(self, evaluations: List[float], player_color: str) -> Optional[float]:
        """
        Calculate game accuracy using Lichess algorithm

        Args:
            evaluations: List of Stockfish evaluations in centipawns (from White's perspective)
            player_color: "white" or "black"

        Returns:
            Game accuracy percentage (0-100) or None if calculation fails
        """
        print(f"DEBUG LICHESS CALC: Starting accuracy calculation for {player_color}")
        print(f"DEBUG LICHESS CALC: Input evaluations: {evaluations[:10]}... (showing first 10)")

        if len(evaluations) < 2:  # Need at least 2 evaluations for meaningful calculation
            print(f"DEBUG LICHESS CALC: Too few evaluations ({len(evaluations)}), returning None")
            return None

        # Step 1: Convert all evaluations to Win%, prepending initial position (like Lichess)
        # Lichess does: val allWinPercents = (Cp.initial :: cps).map(WinPercent.fromCentiPawns)
        initial_eval = 0  # Starting position is equal
        all_evaluations = [initial_eval] + evaluations
        win_percents = [self._win_percent_from_centipawns(cp) for cp in all_evaluations]

        # Step 2: Determine window size based on game length
        window_size = max(2, min(8, len(evaluations) // 10))

        # Step 3: Create sliding windows
        windows = self._create_sliding_windows(win_percents, window_size)

        # Step 4: Calculate volatility weights for each window
        weights = self._calculate_volatility_weights(windows)

        # Step 5: Calculate move accuracies for player's moves only
        player_move_accuracies = []
        player_weighted_accuracies = []

        print(f"DEBUG LICHESS CALC: Processing {len(win_percents)} win percentages for {player_color}")
        print(f"DEBUG LICHESS CALC: Win percentages: {win_percents[:10]}... (first 10)")

        for i in range(len(win_percents) - 1):
            if not self._is_player_move(i + 1, player_color):
                continue

            # Determine which position to evaluate for this player
            if player_color == "white":
                # White: evaluate the position before and after White's move
                win_before = win_percents[i]      # Position before White moves
                win_after = win_percents[i + 1]   # Position after White moves
            else:
                # Black: flip perspective and evaluate position before/after Black's move
                # From Black's perspective: 100% - White's win% = Black's win%
                win_before = 100 - win_percents[i]      # Black's position before Black moves
                win_after = 100 - win_percents[i + 1]   # Black's position after Black moves

            # Calculate move accuracy
            move_acc = self._move_accuracy_from_win_percents(win_before, win_after)

            # DEBUG: Show a few move calculations
            if len(player_move_accuracies) < 5:
                win_loss = win_before - win_after
                print(f"DEBUG LICHESS CALC: Move {i+1} ({player_color}): {win_before:.1f}% → {win_after:.1f}% (loss: {win_loss:.1f}%) → accuracy: {move_acc:.1f}%")

            # Store for harmonic mean
            player_move_accuracies.append(move_acc)

            # Store with weight for weighted mean
            if i < len(weights):
                player_weighted_accuracies.append((move_acc, weights[i]))

        print(f"DEBUG LICHESS CALC: Found {len(player_move_accuracies)} moves for {player_color}")
        if player_move_accuracies:
            print(f"DEBUG LICHESS CALC: Move accuracies: {player_move_accuracies[:10]}... (first 10)")
            print(f"DEBUG LICHESS CALC: Average move accuracy: {sum(player_move_accuracies)/len(player_move_accuracies):.1f}%")

        if not player_move_accuracies:
            return None

        # Step 6: Calculate weighted mean and harmonic mean
        weighted_acc = self._weighted_mean(player_weighted_accuracies)
        harmonic_acc = self._harmonic_mean(player_move_accuracies)

        # Step 7: Final accuracy is average of weighted mean and harmonic mean
        if weighted_acc is not None and harmonic_acc is not None:
            final_accuracy = (weighted_acc + harmonic_acc) / 2
            return max(0, min(100, final_accuracy))

        return None

    def calculate_acpl(self, evaluations: List[float], player_color: str) -> float:
        """
        Calculate Average Centipawn Loss directly from evaluation changes

        Args:
            evaluations: List of Stockfish evaluations in centipawns (from White's perspective)
            player_color: "white" or "black"

        Returns:
            Average centipawn loss
        """
        if len(evaluations) < 2:
            return 0.0

        total_loss = 0.0
        move_count = 0

        # Calculate ACPL directly from centipawn differences (like mistake detection)
        for i in range(len(evaluations) - 1):
            move_number = i + 2  # Move numbers start at 1, but we're looking at position after move
            if not self._is_player_move(move_number, player_color):
                continue

            current_eval = evaluations[i + 1]
            prev_eval = evaluations[i]

            # Calculate centipawn loss from player's perspective (same logic as mistake detection)
            if player_color == "white":
                # White: eval loss = previous eval - current eval (eval going down = loss)
                cp_loss = max(0, prev_eval - current_eval)
            else:
                # Black: eval loss = current eval - previous eval (eval going up = loss for Black)
                cp_loss = max(0, current_eval - prev_eval)

            total_loss += cp_loss
            move_count += 1

        return round(total_loss / move_count) if move_count > 0 else 0

    def _win_percent_from_centipawns(self, centipawns: float) -> float:
        """
        Convert Stockfish centipawn evaluation to Win%

        Formula from Lichess:
        Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * centipawns)) - 1)
        """
        return 50 + 50 * (2 / (1 + math.exp(-self.win_percent_coeff * centipawns)) - 1)

    def _move_accuracy_from_win_percents(self, win_percent_before: float, win_percent_after: float) -> float:
        """
        Calculate move accuracy from Win% change

        Formula from Lichess (with uncertainty bonus):
        if after >= before: accuracy = 100% (no loss)
        else: accuracy = 103.1668 * exp(-0.04354 * (before - after)) - 3.1669 + 1
        """
        if win_percent_after >= win_percent_before:
            return 100.0  # No loss, perfect accuracy

        win_percent_loss = win_percent_before - win_percent_after
        accuracy = self.accuracy_base * math.exp(self.accuracy_coeff * win_percent_loss) + self.accuracy_offset + 1  # +1 uncertainty bonus
        return max(0, min(100, accuracy))

    def _create_sliding_windows(self, win_percents: List[float], window_size: int) -> List[List[float]]:
        """Create sliding windows with initial repeated windows (Lichess behavior)"""
        windows = []

        # Add initial windows (repeated first window to match Lichess behavior)
        initial_window_count = min(window_size - 2, len(win_percents) - 2)
        if initial_window_count > 0:
            initial_window = win_percents[:window_size]
            for _ in range(initial_window_count):
                windows.append(initial_window)

        # Add sliding windows
        for i in range(len(win_percents) - window_size + 1):
            windows.append(win_percents[i:i + window_size])

        return windows

    def _calculate_volatility_weights(self, windows: List[List[float]]) -> List[float]:
        """Calculate volatility (standard deviation) for each window"""
        weights = []
        for window in windows:
            volatility = self._standard_deviation(window)
            # Clamp volatility between min and max as per Lichess code
            weight = max(self.min_volatility, min(self.max_volatility, volatility))
            weights.append(weight)
        return weights

    def _is_player_move(self, move_number: int, player_color: str) -> bool:
        """Determine if a move number belongs to the specified player"""
        is_white_move = move_number % 2 == 1
        return (player_color == "white" and is_white_move) or (player_color == "black" and not is_white_move)

    def _get_player_perspective_wins(self, win_before: float, win_after: float, player_color: str) -> Tuple[float, float]:
        """Get win percentages from the player's perspective"""
        if player_color == "white":
            return win_before, win_after
        else:
            # For Black, flip the win percentages
            return 100 - win_before, 100 - win_after

    def _win_percent_to_centipawns(self, win_loss: float) -> float:
        """Convert win percentage loss back to approximate centipawn loss"""
        # This is an approximation since the relationship isn't perfectly linear
        if win_loss <= 0:
            return 0
        # Use inverse of the win% formula to estimate centipawn equivalent
        try:
            cp_loss = -math.log((2 / (1 + (win_loss / 50))) - 1) / self.win_percent_coeff
            return abs(cp_loss)
        except (ValueError, ZeroDivisionError):
            return 0

    def _standard_deviation(self, values: List[float]) -> float:
        """Calculate standard deviation of a list of values"""
        if len(values) < 2:
            return 0.0
        return statistics.stdev(values)

    def _weighted_mean(self, values_and_weights: List[Tuple[float, float]]) -> Optional[float]:
        """Calculate weighted mean from (value, weight) pairs"""
        if not values_and_weights:
            return None

        total_weighted_value = sum(value * weight for value, weight in values_and_weights)
        total_weight = sum(weight for _, weight in values_and_weights)

        if total_weight == 0:
            return None

        return total_weighted_value / total_weight

    def _harmonic_mean(self, values: List[float]) -> Optional[float]:
        """Calculate harmonic mean of values"""
        if not values or any(v <= 0 for v in values):
            return None

        return len(values) / sum(1/v for v in values)