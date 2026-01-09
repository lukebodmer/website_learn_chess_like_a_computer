"""
Streaming Game Processor for incremental chess game analysis

This module handles processing games as soon as their required evaluations
are available, rather than waiting for all evaluations to complete.
"""

from typing import Dict, List, Any, Optional, Tuple
import threading
from collections import defaultdict


class StreamingGameProcessor:
    """
    Tracks game completion status and processes games as evaluations become available

    This class maintains thread-safe state for tracking which games can be completed
    based on currently available position evaluations.
    """

    def __init__(self, game_data_list: List[Dict], initial_evaluations: Dict[str, Dict]):
        """
        Initialize the streaming processor

        Args:
            game_data_list: List of game data from GameEnricher.collect_all_game_data()
            initial_evaluations: Database evaluation results to start with
        """
        self.game_data_list = game_data_list
        self.available_evaluations = dict(initial_evaluations)

        # Track completion status
        self.completed_game_indices = set()
        self.pending_game_indices = set(range(len(game_data_list)))

        # Thread safety
        self._lock = threading.Lock()

        # Pre-calculate position requirements for each game
        self.game_position_requirements = {}
        for i, game_data in enumerate(game_data_list):
            if "error" not in game_data and "skipped" not in game_data:
                positions = game_data.get("positions", [])
                # Skip starting position (index 0), only need positions after moves
                required_positions = positions[1:] if len(positions) > 1 else []
                self.game_position_requirements[i] = required_positions
            else:
                # Games with errors have no position requirements
                self.game_position_requirements[i] = []

    def add_evaluation(self, position: str, evaluation: Dict) -> List[Tuple[int, Dict]]:
        """
        Add a new position evaluation and check for newly completable games

        Args:
            position: FEN string of the evaluated position
            evaluation: Evaluation result dictionary

        Returns:
            List of tuples: (game_index, completed_analysis_result)
        """
        with self._lock:
            # Add the evaluation
            self.available_evaluations[position] = evaluation

            # Check which pending games can now be completed
            newly_completed = []
            still_pending = set()

            for game_idx in self.pending_game_indices:
                if self._can_complete_game(game_idx):
                    # Process this game
                    analysis_result = self._complete_game(game_idx)
                    if analysis_result:
                        newly_completed.append((game_idx, analysis_result))
                        self.completed_game_indices.add(game_idx)
                    else:
                        # Game had error during processing
                        still_pending.add(game_idx)
                else:
                    # Game still needs more evaluations
                    still_pending.add(game_idx)

            # Update pending list
            self.pending_game_indices = still_pending

            return newly_completed

    def _can_complete_game(self, game_idx: int) -> bool:
        """Check if a game has all required evaluations available"""
        required_positions = self.game_position_requirements.get(game_idx, [])

        # Empty requirements means game can be completed (error games or games with no moves)
        if not required_positions:
            return True

        # Check if all required positions are available
        for position in required_positions:
            if position not in self.available_evaluations:
                return False

        return True

    def _complete_game(self, game_idx: int) -> Optional[Dict[str, Any]]:
        """
        Complete analysis for a single game using available evaluations

        Args:
            game_idx: Index of the game in game_data_list

        Returns:
            Completed analysis result or None if error occurred
        """
        game_data = self.game_data_list[game_idx]

        # Handle error/skipped games immediately
        if "error" in game_data or "skipped" in game_data:
            return game_data

        # Import here to avoid circular imports
        from .game_enricher import GameEnricher

        # Create a temporary enricher instance for single game processing
        enricher = GameEnricher([])  # Empty list since we're only using utility methods

        try:
            # Use existing build_single_game_analysis method with available evaluations
            analysis_result = enricher.build_single_game_analysis(
                game_data,
                self.available_evaluations
            )

            return analysis_result

        except Exception as e:
            print(f"Error completing game {game_idx}: {e}")
            return {
                "error": f"Game completion failed: {str(e)}",
                "game": game_data.get("game", {})
            }

    def get_completion_stats(self) -> Dict[str, int]:
        """Get current completion statistics"""
        with self._lock:
            return {
                "total_games": len(self.game_data_list),
                "completed_games": len(self.completed_game_indices),
                "pending_games": len(self.pending_game_indices),
                "available_evaluations": len(self.available_evaluations)
            }

    def get_completed_game_indices(self) -> set:
        """Get set of completed game indices (thread-safe)"""
        with self._lock:
            return self.completed_game_indices.copy()

    def get_pending_game_indices(self) -> set:
        """Get set of pending game indices (thread-safe)"""
        with self._lock:
            return self.pending_game_indices.copy()