"""
Chess Principles Analyzer

Analyzes player performance across 10 key chess skill areas and generates
quantitative percentile scores by comparing to ECO range averages.

Each principle is calculated by a dedicated function that:
1. Extracts raw metrics (x values) from enriched game data
2. Compares to ECO range averages (xbar values)
3. Calculates a percentile score (0-100)
4. Returns structured data for storage and future visualization
"""

from typing import Dict, List, Any, Optional
import json
import os
from scipy import stats
import numpy as np


class ChessPrinciplesAnalyzer:
    """
    Analyzes chess games to evaluate player performance across 10 key skill areas.

    Each skill area receives:
    - Raw metrics: Player's actual performance data
    - ECO comparison: How player compares to peers in their rating range
    - Percentile: 0-100 value indicating performance relative to peers
    """

    def __init__(self, enriched_games: List[Dict[str, Any]], username: str, eco_range: Optional[str] = None):
        """
        Initialize the principles analyzer.

        Args:
            enriched_games: List of games with complete analysis data
            username: Username of the player being analyzed
            eco_range: ECO rating range (e.g., "1200-1400"). If None, will be auto-detected.
        """
        self.enriched_games = enriched_games
        self.username = username.lower()
        self.eco_range = eco_range
        self.eco_averages = self._load_eco_averages()

        # Filter to only user's games
        self.user_games = self._filter_user_games()

    def _filter_user_games(self) -> List[Dict[str, Any]]:
        """Filter games to only those where the user participated"""
        user_games = []
        for game in self.enriched_games:
            # Handle both formats: game object with raw_json, or raw_json directly
            if "raw_json" in game:
                raw_json = self._get_raw_json(game)
            else:
                # Game IS the raw_json
                raw_json = game

            players = raw_json.get("players", {})

            white_user = players.get("white", {}).get("user", {}).get("name", "").lower()
            black_user = players.get("black", {}).get("user", {}).get("name", "").lower()

            if white_user == self.username or black_user == self.username:
                # Store in consistent format with raw_json wrapper
                if "raw_json" in game:
                    user_games.append(game)
                else:
                    user_games.append({"raw_json": raw_json})

        return user_games

    def _load_eco_averages(self) -> Dict[str, Any]:
        """
        Load ECO range average data from JSON file.

        Returns:
            Dictionary with ECO ranges as keys and average metrics as values
        """
        eco_file_path = os.path.join(
            os.path.dirname(__file__),
            '..', '..', 'data', 'eco_averages.json'
        )

        try:
            with open(eco_file_path, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Warning: ECO averages file not found at {eco_file_path}")
            return {}
        except json.JSONDecodeError:
            print(f"Warning: ECO averages file is not valid JSON")
            return {}

    def _detect_eco_range(self) -> str:
        """
        Auto-detect the user's ECO rating range from their games.

        Returns:
            ECO range string (e.g., "1200-1400")
        """
        if not self.user_games:
            return "1200-1400"  # Default

        # Get user's ratings from games
        ratings = []
        for game in self.user_games:
            raw_json = self._get_raw_json(game)
            players = raw_json.get("players", {})

            white_user = players.get("white", {}).get("user", {}).get("name", "").lower()
            black_user = players.get("black", {}).get("user", {}).get("name", "").lower()

            if white_user == self.username:
                rating = players.get("white", {}).get("rating")
                if rating:
                    ratings.append(rating)
            elif black_user == self.username:
                rating = players.get("black", {}).get("rating")
                if rating:
                    ratings.append(rating)

        if not ratings:
            return "1200-1400"  # Default

        # Calculate average rating
        avg_rating = sum(ratings) / len(ratings)

        # Map to ECO ranges (200-point buckets)
        if avg_rating < 1200:
            return "800-1200"
        elif avg_rating < 1400:
            return "1200-1400"
        elif avg_rating < 1600:
            return "1400-1600"
        elif avg_rating < 1800:
            return "1600-1800"
        elif avg_rating < 2000:
            return "1800-2000"
        else:
            return "2000+"

    def _get_raw_json(self, game: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract raw_json from game object, handling both formats.

        Args:
            game: Game dictionary (either wrapped with raw_json or raw_json itself)

        Returns:
            The raw_json dictionary
        """
        if "raw_json" in game:
            return game.get("raw_json", {})
        else:
            # Game IS the raw_json
            return game

    def _get_user_color_in_game(self, game: Dict[str, Any]) -> Optional[str]:
        """
        Determine what color the user played in a game.

        Args:
            game: Game dictionary

        Returns:
            "white" or "black", or None if user not found
        """
        raw_json = self._get_raw_json(game)
        players = raw_json.get("players", {})

        white_user = players.get("white", {}).get("user", {}).get("name", "").lower()
        black_user = players.get("black", {}).get("user", {}).get("name", "").lower()

        if white_user == self.username:
            return "white"
        elif black_user == self.username:
            return "black"
        else:
            return None

    def _calculate_percentile_score(self, user_value: float, metric_key: str, lower_is_better: bool = True) -> float:
        """
        Calculate user's percentile (0-100) based on skew-normal distribution.

        Args:
            user_value: User's actual metric value
            metric_key: Key to look up in eco_averages (e.g., "opening_inaccuracies_per_game")
            lower_is_better: If True, lower values get higher percentiles (e.g., fewer blunders is better)
                           If False, higher values get higher percentiles (e.g., higher mate conversion is better)

        Returns:
            Percentile score from 0-100, where 100 is best performance
        """
        eco_data = self.eco_averages.get(self.eco_range, {})
        distribution_params = eco_data.get(metric_key)

        if not distribution_params or not isinstance(distribution_params, dict):
            # Fallback: no distribution data, return 50 (average)
            return 50.0

        mean = distribution_params.get("mean", 0)
        std = distribution_params.get("std", 1)
        skew = distribution_params.get("skew", 0)

        # Prevent division by zero
        if std == 0:
            return 50.0

        # Calculate z-score
        z = (user_value - mean) / std

        # Use skew-normal distribution CDF to get percentile
        # scipy.stats.skewnorm(a, loc, scale) where a is shape parameter (skew)
        percentile = stats.skewnorm.cdf(user_value, skew, loc=mean, scale=std) * 100

        # If lower is better, invert the percentile
        if lower_is_better:
            percentile = 100 - percentile

        # Clamp to [0, 100]
        return max(0.0, min(100.0, percentile))

    def _calculate_percentile_from_single_metric(self, user_value: float, metric_key: str, lower_is_better: bool = True) -> Dict[str, Any]:
        """
        Calculate comparison data for a single metric.

        Args:
            user_value: User's metric value
            metric_key: Key in eco_averages (e.g., "checkmate_rate")
            lower_is_better: Whether lower values are better performance

        Returns:
            Dictionary with percentile, eco_average, and difference
        """
        overall_percentile = self._calculate_percentile_score(user_value, metric_key, lower_is_better)

        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_mean = eco_data.get(metric_key, {}).get("mean", 0)
        difference = user_value - eco_mean

        return {
            "percentile": round(overall_percentile, 1),
            "eco_average": eco_mean,
            "difference": difference
        }

    def _calculate_percentile_from_multiple_metrics(self, metrics: List[tuple], weights: Optional[List[float]] = None) -> Dict[str, Any]:
        """
        Calculate weighted percentile from multiple metrics.

        Args:
            metrics: List of tuples (user_value, metric_key, lower_is_better)
            weights: Optional list of weights (must sum to 1.0). If None, uses equal weights.

        Returns:
            Dictionary with percentile
        """
        if not metrics:
            return {"percentile": 50.0}

        if weights is None:
            weights = [1.0 / len(metrics)] * len(metrics)

        if len(weights) != len(metrics):
            raise ValueError("Number of weights must match number of metrics")

        # Calculate percentile for each metric
        percentiles = []
        for (user_value, metric_key, lower_is_better) in metrics:
            percentile = self._calculate_percentile_score(user_value, metric_key, lower_is_better)
            percentiles.append(percentile)

        # Weighted average
        overall_percentile = sum(p * w for p, w in zip(percentiles, weights))

        return {
            "percentile": round(overall_percentile, 1)
        }

    def analyze_all_principles(self) -> Dict[str, Any]:
        """
        Run analysis for all 10 chess principles.

        Returns:
            Dictionary with analysis results for all principles
        """
        if self.eco_range is None:
            self.eco_range = self._detect_eco_range()

        results = {
            "eco_range": self.eco_range,
            "total_games_analyzed": len(self.user_games),
            "username": self.username,
            "principles": {}
        }

        # Calculate each principle
        results["principles"]["opening_awareness"] = self.calculate_opening_awareness()
        results["principles"]["middlegame_planning"] = self.calculate_middlegame_planning()
        results["principles"]["endgame_technique"] = self.calculate_endgame_technique()
        results["principles"]["king_safety"] = self.calculate_king_safety()
        results["principles"]["checkmate_ability"] = self.calculate_checkmate_ability()
        results["principles"]["tactics_vision"] = self.calculate_tactics_vision()
        results["principles"]["defensive_skill"] = self.calculate_defensive_skill()
        results["principles"]["big_picture"] = self.calculate_big_picture()
        results["principles"]["precision_move_quality"] = self.calculate_precision_move_quality()
        results["principles"]["planning_calculating"] = self.calculate_planning_calculating()
        results["principles"]["time_management"] = self.calculate_time_management()

        return results

    # =============================================================================
    # PRINCIPLE 1: OPENING AWARENESS
    # =============================================================================

    def calculate_opening_awareness(self) -> Dict[str, Any]:
        """
        Analyze opening phase mistakes compared to ECO range average.

        Evaluates:
        - Inaccuracies, mistakes, and blunders in opening phase
        - Performance by specific opening (ECO code)

        Returns:
            {
                "raw_metrics": {
                    "avg_opening_inaccuracies": float,
                    "avg_opening_mistakes": float,
                    "avg_opening_blunders": float,
                    "total_opening_errors": float,
                    "by_opening": {
                        "C00": {"games": int, "avg_errors": float},
                        ...
                    }
                },
                "eco_comparison": {
                    "user_total_errors": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        # Accumulate mistakes by opening phase
        total_opening_inaccuracies = 0
        total_opening_mistakes = 0
        total_opening_blunders = 0
        games_analyzed = 0
        by_opening = {}  # ECO code -> {"games": int, "errors": int}

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get game division (opening/middlegame/endgame boundaries)
            division = raw_json.get("division", {})
            middle_start = division.get("middle", 15)  # Default to move 15

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            # Get opening info
            opening = raw_json.get("opening", {})
            eco_code = opening.get("eco", "Unknown")

            # Count mistakes in opening phase for this user
            opening_inaccuracies = 0
            opening_mistakes = 0
            opening_blunders = 0

            for move_index, analysis_entry in enumerate(analysis):
                # Move numbers are 1-indexed (move 1, 2, 3...)
                move_number = move_index + 1

                # Check if this move is in the opening phase
                if move_number >= middle_start:
                    break  # Past opening phase

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                # Check for mistakes
                judgment = analysis_entry.get("judgment", {})
                judgment_name = judgment.get("name", "")

                if judgment_name == "Inaccuracy":
                    opening_inaccuracies += 1
                elif judgment_name == "Mistake":
                    opening_mistakes += 1
                elif judgment_name == "Blunder":
                    opening_blunders += 1

            # Accumulate totals
            total_opening_inaccuracies += opening_inaccuracies
            total_opening_mistakes += opening_mistakes
            total_opening_blunders += opening_blunders
            games_analyzed += 1

            # Track by opening
            if eco_code not in by_opening:
                by_opening[eco_code] = {"games": 0, "total_errors": 0}
            by_opening[eco_code]["games"] += 1
            by_opening[eco_code]["total_errors"] += (opening_inaccuracies + opening_mistakes + opening_blunders)

        # Calculate averages
        if games_analyzed == 0:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        avg_opening_inaccuracies = total_opening_inaccuracies / games_analyzed
        avg_opening_mistakes = total_opening_mistakes / games_analyzed
        avg_opening_blunders = total_opening_blunders / games_analyzed
        user_total_errors = avg_opening_inaccuracies + avg_opening_mistakes + avg_opening_blunders

        # Calculate per-opening averages
        by_opening_formatted = {}
        for eco_code, data in by_opening.items():
            avg_errors = data["total_errors"] / data["games"] if data["games"] > 0 else 0
            by_opening_formatted[eco_code] = {
                "games": data["games"],
                "avg_errors": round(avg_errors, 2)
            }

        # Calculate weighted percentile across error types
        # Weight: blunders (50%), mistakes (30%), inaccuracies (20%)
        metrics = [
            (avg_opening_blunders, "opening_blunders_per_game", True),
            (avg_opening_mistakes, "opening_mistakes_per_game", True),
            (avg_opening_inaccuracies, "opening_inaccuracies_per_game", True)
        ]
        weights = [0.5, 0.3, 0.2]
        score_data = self._calculate_percentile_from_multiple_metrics(metrics, weights)

        # Get ECO means for comparison
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_avg_inaccuracies = eco_data.get("opening_inaccuracies_per_game", {}).get("mean", 0)
        eco_avg_mistakes = eco_data.get("opening_mistakes_per_game", {}).get("mean", 0)
        eco_avg_blunders = eco_data.get("opening_blunders_per_game", {}).get("mean", 0)
        eco_total_errors = eco_avg_inaccuracies + eco_avg_mistakes + eco_avg_blunders
        difference = user_total_errors - eco_total_errors

        return {
            "raw_metrics": {
                "games_analyzed": games_analyzed,
                "avg_opening_inaccuracies": round(avg_opening_inaccuracies, 2),
                "avg_opening_mistakes": round(avg_opening_mistakes, 2),
                "avg_opening_blunders": round(avg_opening_blunders, 2),
                "total_opening_errors": round(user_total_errors, 2),
                "by_opening": by_opening_formatted
            },
            "eco_comparison": {
                "user_total_errors": round(user_total_errors, 2),
                "eco_average": round(eco_total_errors, 2),
                "difference": round(difference, 2),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 2: MIDDLEGAME PLANNING
    # =============================================================================

    def calculate_middlegame_planning(self) -> Dict[str, Any]:
        """
        Analyze middlegame phase mistakes compared to ECO range average.

        Evaluates:
        - Inaccuracies, mistakes, and blunders in middlegame phase

        Returns:
            Similar structure to opening_awareness
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        # Accumulate mistakes by middlegame phase
        total_middlegame_inaccuracies = 0
        total_middlegame_mistakes = 0
        total_middlegame_blunders = 0
        games_analyzed = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get game division (opening/middlegame/endgame boundaries)
            division = raw_json.get("division", {})
            middle_start = division.get("middle", 15)  # Default to move 15
            end_start = division.get("end", 40)  # Default to move 40

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            # Count mistakes in middlegame phase for this user
            middlegame_inaccuracies = 0
            middlegame_mistakes = 0
            middlegame_blunders = 0

            for move_index, analysis_entry in enumerate(analysis):
                # Move numbers are 1-indexed (move 1, 2, 3...)
                move_number = move_index + 1

                # Check if this move is in the middlegame phase
                if move_number < middle_start or move_number >= end_start:
                    continue  # Not in middlegame

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                # Check for mistakes
                judgment = analysis_entry.get("judgment", {})
                judgment_name = judgment.get("name", "")

                if judgment_name == "Inaccuracy":
                    middlegame_inaccuracies += 1
                elif judgment_name == "Mistake":
                    middlegame_mistakes += 1
                elif judgment_name == "Blunder":
                    middlegame_blunders += 1

            # Accumulate totals
            total_middlegame_inaccuracies += middlegame_inaccuracies
            total_middlegame_mistakes += middlegame_mistakes
            total_middlegame_blunders += middlegame_blunders
            games_analyzed += 1

        # Calculate averages
        if games_analyzed == 0:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        avg_middlegame_inaccuracies = total_middlegame_inaccuracies / games_analyzed
        avg_middlegame_mistakes = total_middlegame_mistakes / games_analyzed
        avg_middlegame_blunders = total_middlegame_blunders / games_analyzed
        user_total_errors = avg_middlegame_inaccuracies + avg_middlegame_mistakes + avg_middlegame_blunders

        # Calculate weighted percentile
        metrics = [
            (avg_middlegame_blunders, "middlegame_blunders_per_game", True),
            (avg_middlegame_mistakes, "middlegame_mistakes_per_game", True),
            (avg_middlegame_inaccuracies, "middlegame_inaccuracies_per_game", True)
        ]
        weights = [0.5, 0.3, 0.2]
        score_data = self._calculate_percentile_from_multiple_metrics(metrics, weights)

        # Get ECO means for comparison
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_avg_inaccuracies = eco_data.get("middlegame_inaccuracies_per_game", {}).get("mean", 0)
        eco_avg_mistakes = eco_data.get("middlegame_mistakes_per_game", {}).get("mean", 0)
        eco_avg_blunders = eco_data.get("middlegame_blunders_per_game", {}).get("mean", 0)
        eco_total_errors = eco_avg_inaccuracies + eco_avg_mistakes + eco_avg_blunders
        difference = user_total_errors - eco_total_errors

        return {
            "raw_metrics": {
                "games_analyzed": games_analyzed,
                "avg_middlegame_inaccuracies": round(avg_middlegame_inaccuracies, 2),
                "avg_middlegame_mistakes": round(avg_middlegame_mistakes, 2),
                "avg_middlegame_blunders": round(avg_middlegame_blunders, 2),
                "total_middlegame_errors": round(user_total_errors, 2)
            },
            "eco_comparison": {
                "user_total_errors": round(user_total_errors, 2),
                "eco_average": round(eco_total_errors, 2),
                "difference": round(difference, 2),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 3: ENDGAME TECHNIQUE
    # =============================================================================

    def calculate_endgame_technique(self) -> Dict[str, Any]:
        """
        Analyze endgame phase mistakes compared to ECO range average.

        Evaluates:
        - Inaccuracies, mistakes, and blunders in endgame phase

        Returns:
            Similar structure to opening_awareness
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        # Accumulate mistakes by endgame phase
        total_endgame_inaccuracies = 0
        total_endgame_mistakes = 0
        total_endgame_blunders = 0
        games_analyzed = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get game division (opening/middlegame/endgame boundaries)
            division = raw_json.get("division", {})
            end_start = division.get("end", 40)  # Default to move 40

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            # Count mistakes in endgame phase for this user
            endgame_inaccuracies = 0
            endgame_mistakes = 0
            endgame_blunders = 0

            for move_index, analysis_entry in enumerate(analysis):
                # Move numbers are 1-indexed (move 1, 2, 3...)
                move_number = move_index + 1

                # Check if this move is in the endgame phase
                if move_number < end_start:
                    continue  # Not in endgame yet

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                # Check for mistakes
                judgment = analysis_entry.get("judgment", {})
                judgment_name = judgment.get("name", "")

                if judgment_name == "Inaccuracy":
                    endgame_inaccuracies += 1
                elif judgment_name == "Mistake":
                    endgame_mistakes += 1
                elif judgment_name == "Blunder":
                    endgame_blunders += 1

            # Accumulate totals
            total_endgame_inaccuracies += endgame_inaccuracies
            total_endgame_mistakes += endgame_mistakes
            total_endgame_blunders += endgame_blunders
            games_analyzed += 1

        # Calculate averages
        if games_analyzed == 0:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        avg_endgame_inaccuracies = total_endgame_inaccuracies / games_analyzed
        avg_endgame_mistakes = total_endgame_mistakes / games_analyzed
        avg_endgame_blunders = total_endgame_blunders / games_analyzed
        user_total_errors = avg_endgame_inaccuracies + avg_endgame_mistakes + avg_endgame_blunders

        # Calculate weighted percentile
        metrics = [
            (avg_endgame_blunders, "endgame_blunders_per_game", True),
            (avg_endgame_mistakes, "endgame_mistakes_per_game", True),
            (avg_endgame_inaccuracies, "endgame_inaccuracies_per_game", True)
        ]
        weights = [0.5, 0.3, 0.2]
        score_data = self._calculate_percentile_from_multiple_metrics(metrics, weights)

        # Get ECO means for comparison
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_avg_inaccuracies = eco_data.get("endgame_inaccuracies_per_game", {}).get("mean", 0)
        eco_avg_mistakes = eco_data.get("endgame_mistakes_per_game", {}).get("mean", 0)
        eco_avg_blunders = eco_data.get("endgame_blunders_per_game", {}).get("mean", 0)
        eco_total_errors = eco_avg_inaccuracies + eco_avg_mistakes + eco_avg_blunders
        difference = user_total_errors - eco_total_errors

        return {
            "raw_metrics": {
                "games_analyzed": games_analyzed,
                "avg_endgame_inaccuracies": round(avg_endgame_inaccuracies, 2),
                "avg_endgame_mistakes": round(avg_endgame_mistakes, 2),
                "avg_endgame_blunders": round(avg_endgame_blunders, 2),
                "total_endgame_errors": round(user_total_errors, 2)
            },
            "eco_comparison": {
                "user_total_errors": round(user_total_errors, 2),
                "eco_average": round(eco_total_errors, 2),
                "difference": round(difference, 2),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 4: KING SAFETY
    # =============================================================================

    def calculate_king_safety(self) -> Dict[str, Any]:
        """
        Analyze how often user gets checkmated or loses with mate threats.

        Evaluates:
        - Games ending in checkmate (user got mated)
        - Games lost when opponent had mate-in-X evaluation

        Returns:
            {
                "raw_metrics": {
                    "total_games": int,
                    "checkmated_count": int,
                    "checkmated_rate": float,
                    "lost_with_mate_threat": int
                },
                "eco_comparison": {
                    "user_checkmate_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        total_games = len(self.user_games)
        checkmated_count = 0
        lost_with_mate_threat_count = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Check if user was checkmated
            status = raw_json.get("status", "")
            winner = raw_json.get("winner")

            # User was checkmated if game ended in "mate" and user didn't win
            if status == "mate" and winner != user_color:
                checkmated_count += 1

            # Check if user lost when opponent had mate threat
            # Look through analysis for positions where opponent had mate-in-X
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            had_mate_threat = False
            for move_index, analysis_entry in enumerate(analysis):
                move_number = move_index + 1

                # Check if opponent had mate advantage
                mate_value = analysis_entry.get("mate")
                if mate_value is not None:
                    # Determine if mate was in opponent's favor
                    is_white_position = move_number % 2 == 0  # After black moved

                    # Mate > 0 means white has mate, mate < 0 means black has mate
                    opponent_has_mate = (
                        (user_color == "white" and mate_value < 0) or
                        (user_color == "black" and mate_value > 0)
                    )

                    if opponent_has_mate:
                        had_mate_threat = True
                        break

            # If opponent had mate threat and user lost
            if had_mate_threat and winner != user_color:
                lost_with_mate_threat_count += 1

        # Calculate rates
        checkmated_rate = checkmated_count / total_games if total_games > 0 else 0.0
        lost_with_threat_rate = lost_with_mate_threat_count / total_games if total_games > 0 else 0.0

        # Calculate percentile using helper
        score_data = self._calculate_percentile_from_single_metric(checkmated_rate, "checkmate_rate", lower_is_better=True)

        return {
            "raw_metrics": {
                "total_games": total_games,
                "checkmated_count": checkmated_count,
                "checkmated_rate": round(checkmated_rate, 3),
                "lost_with_mate_threat": lost_with_mate_threat_count,
                "lost_with_threat_rate": round(lost_with_threat_rate, 3)
            },
            "eco_comparison": {
                "user_checkmate_rate": round(checkmated_rate, 3),
                "eco_average": round(score_data["eco_average"], 3),
                "difference": round(score_data["difference"], 3),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 5: CHECKMATE ABILITY
    # =============================================================================

    def calculate_checkmate_ability(self) -> Dict[str, Any]:
        """
        Analyze how often user converts winning mate sequences.

        Evaluates:
        - Positions where user had forced mate (mate > 0)
        - How often mate was successfully delivered vs lost

        Returns:
            {
                "raw_metrics": {
                    "forced_mate_positions": int,
                    "mates_converted": int,
                    "mates_lost": int,
                    "conversion_rate": float
                },
                "eco_comparison": {
                    "user_conversion_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        forced_mate_positions = 0
        mates_converted = 0
        mates_lost = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get game result
            status = raw_json.get("status", "")
            winner = raw_json.get("winner")

            # Look for positions where user had mate
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            user_had_mate = False
            for move_index, analysis_entry in enumerate(analysis):
                move_number = move_index + 1

                # Check if user had mate advantage
                mate_value = analysis_entry.get("mate")
                if mate_value is not None:
                    # Mate > 0 means white has mate, mate < 0 means black has mate
                    user_has_mate = (
                        (user_color == "white" and mate_value > 0) or
                        (user_color == "black" and mate_value < 0)
                    )

                    if user_has_mate:
                        user_had_mate = True
                        forced_mate_positions += 1
                        break  # Only count once per game

            # If user had mate, check if they converted
            if user_had_mate:
                if status == "mate" and winner == user_color:
                    mates_converted += 1
                else:
                    mates_lost += 1

        # Calculate conversion rate
        conversion_rate = mates_converted / forced_mate_positions if forced_mate_positions > 0 else 0.0

        # Calculate percentile (higher conversion is better)
        score_data = self._calculate_percentile_from_single_metric(conversion_rate, "mate_conversion_rate", lower_is_better=False)

        return {
            "raw_metrics": {
                "forced_mate_positions": forced_mate_positions,
                "mates_converted": mates_converted,
                "mates_lost": mates_lost,
                "conversion_rate": round(conversion_rate, 3)
            },
            "eco_comparison": {
                "user_conversion_rate": round(conversion_rate, 3),
                "eco_average": round(score_data["eco_average"], 3),
                "difference": round(score_data["difference"], 3),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 6: TACTICS VISION
    # =============================================================================

    def calculate_tactics_vision(self) -> Dict[str, Any]:
        """
        Analyze how often user capitalizes on opponent's blunders.

        Evaluates:
        - Opponent blunders (big eval swings in user's favor)
        - Whether user took advantage on next move

        Returns:
            {
                "raw_metrics": {
                    "opponent_blunders": int,
                    "opportunities_taken": int,
                    "opportunities_missed": int,
                    "capitalization_rate": float
                },
                "eco_comparison": {
                    "user_capitalization_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        opponent_blunders = 0
        opportunities_taken = 0
        opportunities_missed = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis or len(analysis) < 2:
                continue

            # Look for opponent blunders (eval swings in user's favor)
            for move_index in range(len(analysis) - 1):
                move_number = move_index + 1

                # Determine who moved
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                # We're looking for OPPONENT blunders
                if is_user_move:
                    continue

                # Check if opponent blundered
                prev_eval = analysis[move_index].get("eval")
                curr_eval = analysis[move_index + 1].get("eval") if move_index + 1 < len(analysis) else None

                if prev_eval is None or curr_eval is None:
                    continue

                # Calculate eval swing (from user's perspective)
                # If user is white, positive swing is good; if black, negative swing is good
                eval_swing = curr_eval - prev_eval
                if user_color == "black":
                    eval_swing = -eval_swing

                # Opponent blundered if eval swung >= 300 centipawns in user's favor
                if eval_swing >= 300:
                    opponent_blunders += 1

                    # Check if user capitalized on next move
                    # Look at the next eval change
                    if move_index + 2 < len(analysis):
                        next_eval = analysis[move_index + 2].get("eval")
                        if next_eval is not None:
                            # User capitalized if they maintained or improved the advantage
                            next_swing = next_eval - curr_eval
                            if user_color == "black":
                                next_swing = -next_swing

                            if next_swing >= -100:  # Allow small drop (100 cp tolerance)
                                opportunities_taken += 1
                            else:
                                opportunities_missed += 1

        # Calculate capitalization rate
        capitalization_rate = opportunities_taken / opponent_blunders if opponent_blunders > 0 else 0.0

        # Calculate percentile (higher capitalization is better)
        score_data = self._calculate_percentile_from_single_metric(capitalization_rate, "tactics_capitalization_rate", lower_is_better=False)

        return {
            "raw_metrics": {
                "opponent_blunders": opponent_blunders,
                "opportunities_taken": opportunities_taken,
                "opportunities_missed": opportunities_missed,
                "capitalization_rate": round(capitalization_rate, 3)
            },
            "eco_comparison": {
                "user_capitalization_rate": round(capitalization_rate, 3),
                "eco_average": round(score_data["eco_average"], 3),
                "difference": round(score_data["difference"], 3),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 7: DEFENSIVE SKILL / STICKING WITH IT
    # =============================================================================

    def calculate_defensive_skill(self) -> Dict[str, Any]:
        """
        Analyze how often user makes comebacks from losing positions.

        Evaluates:
        - Games where user was down significantly (eval < -500)
        - Comebacks (winning or drawing from losing position)

        Returns:
            {
                "raw_metrics": {
                    "losing_positions": int,
                    "comebacks_won": int,
                    "comebacks_drawn": int,
                    "total_comebacks": int,
                    "comeback_rate": float
                },
                "eco_comparison": {
                    "user_comeback_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        losing_positions_count = 0
        comebacks_won = 0
        comebacks_drawn = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get game result
            winner = raw_json.get("winner")
            status = raw_json.get("status", "")

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis:
                continue

            # Check if user was ever down by >= 500 centipawns
            was_losing = False
            for move_index, analysis_entry in enumerate(analysis):
                eval_value = analysis_entry.get("eval")
                if eval_value is None:
                    continue

                # From user's perspective
                if user_color == "black":
                    eval_value = -eval_value

                # User is losing if eval <= -500
                if eval_value <= -500:
                    was_losing = True
                    break

            if was_losing:
                losing_positions_count += 1

                # Check if user made a comeback
                if winner == user_color:
                    comebacks_won += 1
                elif winner is None or status == "draw" or status == "stalemate":
                    comebacks_drawn += 1

        # Calculate comeback rate
        total_comebacks = comebacks_won + comebacks_drawn
        comeback_rate = total_comebacks / losing_positions_count if losing_positions_count > 0 else 0.0

        # Calculate percentile (higher comeback rate is better)
        score_data = self._calculate_percentile_from_single_metric(comeback_rate, "comeback_rate", lower_is_better=False)

        return {
            "raw_metrics": {
                "losing_positions": losing_positions_count,
                "comebacks_won": comebacks_won,
                "comebacks_drawn": comebacks_drawn,
                "total_comebacks": total_comebacks,
                "comeback_rate": round(comeback_rate, 3)
            },
            "eco_comparison": {
                "user_comeback_rate": round(comeback_rate, 3),
                "eco_average": round(score_data["eco_average"], 3),
                "difference": round(score_data["difference"], 3),
                "percentile": score_data["percentile"]
            }
        }

    # =============================================================================
    # PRINCIPLE 8: BIG PICTURE
    # =============================================================================

    def calculate_big_picture(self) -> Dict[str, Any]:
        """
        Analyze material awareness and hanging pieces.

        Evaluates:
        - Moves leading to piece captures (with eval drop)
        - Positions where best move was capture but user didn't take

        Returns:
            {
                "raw_metrics": {
                    "total_moves": int,
                    "hanging_piece_moves": int,
                    "missed_captures": int,
                    "material_awareness_rate": float
                },
                "eco_comparison": {
                    "user_awareness_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        total_user_moves = 0
        hanging_piece_moves = 0
        missed_captures = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis or len(analysis) < 2:
                continue

            # Analyze user's moves
            for move_index in range(len(analysis) - 1):
                move_number = move_index + 1

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                total_user_moves += 1

                # Check if user hung a piece (eval dropped significantly after their move)
                prev_eval = analysis[move_index].get("eval")
                curr_eval = analysis[move_index + 1].get("eval") if move_index + 1 < len(analysis) else None

                if prev_eval is not None and curr_eval is not None:
                    # Calculate eval change from user's perspective
                    eval_change = curr_eval - prev_eval
                    if user_color == "black":
                        eval_change = -eval_change

                    # User hung a piece if eval dropped by >= 200 cp
                    if eval_change <= -200:
                        hanging_piece_moves += 1

                # Check if user missed a capture (best move contains 'x' and eval would improve)
                best_move = analysis[move_index].get("best", "")
                if best_move and 'x' in best_move:
                    # Best move is a capture
                    # Check if it would have improved position significantly
                    if prev_eval is not None and curr_eval is not None:
                        # If not taking lost advantage, count as missed capture
                        if eval_change <= -100:
                            missed_captures += 1

        # Calculate material awareness rate (inverse of error rate)
        material_errors = hanging_piece_moves + missed_captures
        material_awareness_rate = 1.0 - (material_errors / total_user_moves) if total_user_moves > 0 else 0.0

        # Get ECO average
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_awareness_rate = eco_data.get("material_awareness_rate", {}).get("mean", 0)

        # Calculate difference
        difference = material_awareness_rate - eco_awareness_rate

        # Calculate percentile
        if eco_awareness_rate > 0:
            percentile = max(0, min(100, 50 + (difference / eco_awareness_rate) * 50))
        else:
            percentile = 50

        return {
            "raw_metrics": {
                "total_moves": total_user_moves,
                "hanging_piece_moves": hanging_piece_moves,
                "missed_captures": missed_captures,
                "material_awareness_rate": round(material_awareness_rate, 3)
            },
            "eco_comparison": {
                "user_awareness_rate": round(material_awareness_rate, 3),
                "eco_average": round(eco_awareness_rate, 3),
                "difference": round(difference, 3),
                "percentile": round(percentile, 1)
            }
        }

    # =============================================================================
    # PRINCIPLE 9: PRECISION AND MOVE QUALITY
    # =============================================================================

    def calculate_precision_move_quality(self) -> Dict[str, Any]:
        """
        Analyze evaluation volatility and move precision.

        Evaluates:
        - Standard deviation of eval changes
        - "Smooth" play vs "volatile" play

        Returns:
            {
                "raw_metrics": {
                    "avg_eval_volatility": float,
                    "smooth_games": int,
                    "volatile_games": int
                },
                "eco_comparison": {
                    "user_volatility": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        game_volatilities = []
        smooth_games = 0
        volatile_games = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis or len(analysis) < 3:
                continue

            # Collect eval changes for user's moves
            eval_changes = []
            for move_index in range(len(analysis) - 1):
                move_number = move_index + 1

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                prev_eval = analysis[move_index].get("eval")
                curr_eval = analysis[move_index + 1].get("eval") if move_index + 1 < len(analysis) else None

                if prev_eval is not None and curr_eval is not None:
                    # Calculate eval change from user's perspective
                    eval_change = abs(curr_eval - prev_eval)
                    eval_changes.append(eval_change)

            # Calculate standard deviation of eval changes
            if len(eval_changes) >= 2:
                mean_change = sum(eval_changes) / len(eval_changes)
                variance = sum((x - mean_change) ** 2 for x in eval_changes) / len(eval_changes)
                std_dev = variance ** 0.5
                game_volatilities.append(std_dev)

                # Classify game as smooth or volatile
                if std_dev < 100:  # Less than 100 cp std dev = smooth
                    smooth_games += 1
                elif std_dev > 200:  # More than 200 cp std dev = volatile
                    volatile_games += 1

        # Calculate average volatility
        avg_volatility = sum(game_volatilities) / len(game_volatilities) if game_volatilities else 0.0

        # Get ECO average
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_volatility = eco_data.get("eval_volatility", {}).get("mean", 0)

        # Calculate difference
        difference = avg_volatility - eco_volatility

        # Calculate percentile (lower volatility is better)
        if eco_volatility > 0:
            percentile = max(0, min(100, 50 - (difference / eco_volatility) * 50))
        else:
            percentile = 50

        return {
            "raw_metrics": {
                "games_analyzed": len(game_volatilities),
                "avg_eval_volatility": round(avg_volatility, 2),
                "smooth_games": smooth_games,
                "volatile_games": volatile_games
            },
            "eco_comparison": {
                "user_volatility": round(avg_volatility, 2),
                "eco_average": round(eco_volatility, 2),
                "difference": round(difference, 2),
                "percentile": round(percentile, 1)
            }
        }

    # =============================================================================
    # PRINCIPLE 10: PLANNING / CALCULATING
    # =============================================================================

    def calculate_planning_calculating(self) -> Dict[str, Any]:
        """
        Analyze quality of quiet (non-tactical) moves.

        Evaluates:
        - Moves that are not check, not capture, not immediate threat
        - Evaluation change on quiet moves

        Returns:
            {
                "raw_metrics": {
                    "total_quiet_moves": int,
                    "avg_quiet_move_eval_change": float,
                    "good_quiet_moves": int,
                    "bad_quiet_moves": int
                },
                "eco_comparison": {
                    "user_quiet_move_quality": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        total_quiet_moves = 0
        quiet_move_eval_changes = []
        good_quiet_moves = 0
        bad_quiet_moves = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Get analysis array
            analysis = raw_json.get("analysis", [])
            if not analysis or len(analysis) < 2:
                continue

            # Get moves string to analyze move notation
            moves_string = raw_json.get("moves", "")
            moves = moves_string.split() if moves_string else []

            # Analyze user's quiet moves
            for move_index in range(len(analysis) - 1):
                move_number = move_index + 1

                # Determine if this is user's move
                is_white_move = move_number % 2 == 1
                is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                if not is_user_move:
                    continue

                # Get the actual move notation
                if move_index < len(moves):
                    move_notation = moves[move_index]
                else:
                    continue

                # Check if move is "quiet" (not check, not capture, not promotion)
                is_quiet = (
                    '+' not in move_notation and  # Not check
                    '#' not in move_notation and  # Not checkmate
                    'x' not in move_notation and  # Not capture
                    '=' not in move_notation      # Not promotion
                )

                if not is_quiet:
                    continue

                total_quiet_moves += 1

                # Evaluate quality of quiet move
                prev_eval = analysis[move_index].get("eval")
                curr_eval = analysis[move_index + 1].get("eval") if move_index + 1 < len(analysis) else None

                if prev_eval is not None and curr_eval is not None:
                    # Calculate eval change from user's perspective
                    eval_change = curr_eval - prev_eval
                    if user_color == "black":
                        eval_change = -eval_change

                    quiet_move_eval_changes.append(eval_change)

                    # Classify move
                    if eval_change >= -10:  # Lost less than 10 cp
                        good_quiet_moves += 1
                    else:
                        bad_quiet_moves += 1

        # Calculate average quiet move quality
        avg_quiet_move_quality = (
            sum(quiet_move_eval_changes) / len(quiet_move_eval_changes)
            if quiet_move_eval_changes else 0.0
        )

        # Get ECO average
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_quiet_move_quality = eco_data.get("quiet_move_quality", {}).get("mean", 0)

        # Calculate difference
        difference = avg_quiet_move_quality - eco_quiet_move_quality

        # Calculate percentile (higher quality is better)
        if eco_quiet_move_quality != 0:
            percentile = max(0, min(100, 50 + (difference / abs(eco_quiet_move_quality)) * 50))
        else:
            percentile = 50

        return {
            "raw_metrics": {
                "total_quiet_moves": total_quiet_moves,
                "avg_quiet_move_eval_change": round(avg_quiet_move_quality, 2),
                "good_quiet_moves": good_quiet_moves,
                "bad_quiet_moves": bad_quiet_moves
            },
            "eco_comparison": {
                "user_quiet_move_quality": round(avg_quiet_move_quality, 2),
                "eco_average": round(eco_quiet_move_quality, 2),
                "difference": round(difference, 2),
                "percentile": round(percentile, 1)
            }
        }

    # =============================================================================
    # PRINCIPLE 11: TIME MANAGEMENT
    # =============================================================================

    def calculate_time_management(self) -> Dict[str, Any]:
        """
        Analyze time usage and time pressure mistakes.

        Evaluates:
        - Games lost on time
        - Blunders made in time pressure (< 10 seconds)
        - Games lost with significant time remaining (poor time usage)

        Returns:
            {
                "raw_metrics": {
                    "total_games": int,
                    "timeouts": int,
                    "timeout_rate": float,
                    "time_pressure_blunders": int,
                    "lost_with_time_remaining": int
                },
                "eco_comparison": {
                    "user_timeout_rate": float,
                    "eco_average": float,
                    "difference": float,
                    "percentile": float
                }
            }
        """
        if not self.user_games:
            return {
                "raw_metrics": {},
                "eco_comparison": {}
            }

        total_games = len(self.user_games)
        timeouts = 0
        time_pressure_blunders = 0
        lost_with_time_remaining = 0

        for game in self.user_games:
            raw_json = self._get_raw_json(game)

            # Get user's color
            user_color = self._get_user_color_in_game(game)
            if not user_color:
                continue

            # Check if user lost on time
            status = raw_json.get("status", "")
            winner = raw_json.get("winner")

            if status in ["outoftime", "timeout"] and winner != user_color:
                timeouts += 1

            # Get clocks array to analyze time pressure
            clocks = raw_json.get("clocks", [])
            analysis = raw_json.get("analysis", [])

            if clocks and analysis:
                # Analyze blunders made under time pressure
                for move_index, analysis_entry in enumerate(analysis):
                    move_number = move_index + 1

                    # Determine if this is user's move
                    is_white_move = move_number % 2 == 1
                    is_user_move = (user_color == "white" and is_white_move) or (user_color == "black" and not is_white_move)

                    if not is_user_move:
                        continue

                    # Check if user had < 10 seconds when making this move
                    if move_index < len(clocks):
                        time_remaining_ms = clocks[move_index]
                        time_remaining_seconds = time_remaining_ms / 1000

                        if time_remaining_seconds < 10:
                            # Check if this move was a blunder
                            judgment = analysis_entry.get("judgment", {})
                            if judgment.get("name") == "Blunder":
                                time_pressure_blunders += 1

            # Check if user lost with significant time remaining (> 60 seconds)
            if winner != user_color and winner is not None and clocks:
                # Get user's final time
                # Clocks array alternates between white and black
                # For white: indices 0, 2, 4, ...
                # For black: indices 1, 3, 5, ...
                user_clock_indices = []
                for i, _ in enumerate(clocks):
                    move_num = i + 1
                    is_white_clock = move_num % 2 == 1
                    if (user_color == "white" and is_white_clock) or (user_color == "black" and not is_white_clock):
                        user_clock_indices.append(i)

                if user_clock_indices:
                    final_time_ms = clocks[user_clock_indices[-1]]
                    final_time_seconds = final_time_ms / 1000

                    if final_time_seconds > 60:
                        lost_with_time_remaining += 1

        # Calculate rates
        timeout_rate = timeouts / total_games if total_games > 0 else 0.0
        time_pressure_blunder_rate = time_pressure_blunders / total_games if total_games > 0 else 0.0

        # Get ECO average
        eco_data = self.eco_averages.get(self.eco_range, {})
        eco_timeout_rate = eco_data.get("timeout_rate", {}).get("mean", 0)

        # Calculate difference
        difference = timeout_rate - eco_timeout_rate

        # Calculate percentile
        if eco_timeout_rate > 0:
            percentile = max(0, min(100, 50 - (difference / eco_timeout_rate) * 50))
        else:
            percentile = 50

        return {
            "raw_metrics": {
                "total_games": total_games,
                "timeouts": timeouts,
                "timeout_rate": round(timeout_rate, 3),
                "time_pressure_blunders": time_pressure_blunders,
                "time_pressure_blunder_rate": round(time_pressure_blunder_rate, 3),
                "lost_with_time_remaining": lost_with_time_remaining
            },
            "eco_comparison": {
                "user_timeout_rate": round(timeout_rate, 3),
                "eco_average": round(eco_timeout_rate, 3),
                "difference": round(difference, 3),
                "percentile": round(percentile, 1)
            }
        }
