"""
Puzzle Finder

Generates custom puzzle recommendations based on user's principle analysis.
Maps principle weaknesses to relevant puzzle themes and queries the database
for personalized training puzzles.
"""

from typing import Dict, List, Any, Optional
import random
from django.db.models import Q


class PuzzleFinder:
    """
    Finds and recommends puzzles based on user's principle analysis.

    Uses percentile scores from principle analysis to weight puzzle themes,
    ensuring users get more practice on their weaker skill areas.
    """

    # Mapping of principle areas to puzzle themes
    PRINCIPLE_THEME_MAPPING = {
        "opening_awareness": [
            "opening",
            "advancedPawn",
            "kingsideAttack",
            "queensideAttack",
            "attackingF2F7"
        ],
        "middlegame_planning": [
            "middlegame",
            "kingsideAttack",
            "queensideAttack",
            "clearance",
            "quietMove",
            "sacrifice"
        ],
        "endgame_technique": [
            "endgame",
            "pawnEndgame",
            "knightEndgame",
            "bishopEndgame",
            "rookEndgame",
            "queenEndgame",
            "queenRookEndgame",
            "promotion",
            "underPromotion"
        ],
        "king_safety": [
            "exposedKing",
            "backRankMate",
            "smotheredMate",
            "anastasiaMate",
            "arabianMate",
            "bodenMate",
            "doubleBishopMate",
            "dovetailMate",
            "cornerMate",
            "hookMate",
            "operaMate",
            "balestraMate",
            "blindSwineMate",
            "pillsburysMate",
            "morphysMate",
            "triangleMate",
            "vukovicMate",
            "killBoxMate"
        ],
        "checkmate_ability": [
            "mate",
            "mateIn1",
            "mateIn2",
            "mateIn3",
            "mateIn4",
            "mateIn5",
            "backRankMate",
            "smotheredMate",
            "anastasiaMate",
            "arabianMate",
            "bodenMate",
            "doubleBishopMate",
            "dovetailMate"
        ],
        "tactics_vision": [
            "fork",
            "pin",
            "skewer",
            "discoveredAttack",
            "discoveredCheck",
            "doubleCheck",
            "hangingPiece",
            "trappedPiece",
            "capturingDefender",
            "attraction",
            "deflection",
            "clearance",
            "interference",
            "xRayAttack"
        ],
        "defensive_skill": [
            "defensiveMove",
            "equality",
            "quietMove",
            "intermezzo",
            "zugzwang"
        ],
        "big_picture": [
            "hangingPiece",
            "trappedPiece",
            "capturingDefender",
            "advantage",
            "crushing"
        ],
        "precision_move_quality": [
            "quietMove",
            "advantage",
            "defensiveMove",
            "clearance",
            "intermezzo"
        ],
        "planning_calculating": [
            "quietMove",
            "long",
            "veryLong",
            "sacrifice",
            "clearance",
            "intermezzo"
        ],
        "time_management": [
            "short",
            "oneMove",
            "mateIn1",
            "mateIn2"
        ]
    }

    def __init__(self, principles_analysis: Dict[str, Any], target_puzzle_count: int = 1000):
        """
        Initialize the puzzle finder.

        Args:
            principles_analysis: Results from ChessPrinciplesAnalyzer.analyze_all_principles()
            target_puzzle_count: Total number of puzzles to recommend (default: 1000)
        """
        self.principles_analysis = principles_analysis
        self.target_puzzle_count = target_puzzle_count
        self.principles = principles_analysis.get("principles", {})

    def calculate_theme_weights(self) -> Dict[str, int]:
        """
        Calculate how many puzzles of each theme to recommend based on percentiles.

        Lower percentiles = more practice needed = more puzzles of that type.

        Returns:
            Dictionary mapping theme names to puzzle counts (sum = target_puzzle_count)
        """
        # Step 1: Calculate inverse percentile weights for each principle
        # (lower percentile = higher weight = more practice needed)
        principle_weights = {}

        for principle_name, principle_data in self.principles.items():
            eco_comparison = principle_data.get("eco_comparison", {})
            percentile = eco_comparison.get("percentile", 50.0)

            # Convert percentile to weight (inverse relationship)
            # percentile=0 (worst) -> weight=100, percentile=100 (best) -> weight=0
            weight = 100 - percentile

            # Add small minimum weight so all principles get some puzzles
            weight = max(weight, 5.0)

            principle_weights[principle_name] = weight

        # Step 2: Distribute weights to themes based on principle mappings
        theme_raw_weights = {}

        for principle_name, weight in principle_weights.items():
            themes = self.PRINCIPLE_THEME_MAPPING.get(principle_name, [])

            if not themes:
                continue

            # Distribute principle weight evenly across its themes
            weight_per_theme = weight / len(themes)

            for theme in themes:
                if theme not in theme_raw_weights:
                    theme_raw_weights[theme] = 0.0
                theme_raw_weights[theme] += weight_per_theme

        # Step 3: Normalize to target puzzle count
        total_weight = sum(theme_raw_weights.values())

        if total_weight == 0:
            # Fallback: equal distribution if no weights calculated
            themes_list = list(set(theme for themes in self.PRINCIPLE_THEME_MAPPING.values() for theme in themes))
            count_per_theme = self.target_puzzle_count // len(themes_list)
            return {theme: count_per_theme for theme in themes_list}

        theme_counts = {}
        total_assigned = 0

        # Sort themes by weight (descending) for better rounding distribution
        sorted_themes = sorted(theme_raw_weights.items(), key=lambda x: x[1], reverse=True)

        for theme, raw_weight in sorted_themes[:-1]:  # All but last theme
            count = round((raw_weight / total_weight) * self.target_puzzle_count)
            theme_counts[theme] = count
            total_assigned += count

        # Assign remaining puzzles to last theme to ensure exact target count
        if sorted_themes:
            last_theme = sorted_themes[-1][0]
            theme_counts[last_theme] = self.target_puzzle_count - total_assigned

        return theme_counts

    def get_puzzle_distribution_summary(self) -> Dict[str, Any]:
        """
        Get a summary of the recommended puzzle distribution.

        Returns:
            Dictionary with distribution statistics and recommendations
        """
        theme_counts = self.calculate_theme_weights()

        # Group themes by principle for reporting
        principle_summaries = {}

        for principle_name, themes in self.PRINCIPLE_THEME_MAPPING.items():
            principle_data = self.principles.get(principle_name, {})
            percentile = principle_data.get("eco_comparison", {}).get("percentile", 50.0)

            # Calculate total puzzles for this principle's themes
            total_puzzles = sum(theme_counts.get(theme, 0) for theme in themes)

            principle_summaries[principle_name] = {
                "percentile": percentile,
                "total_puzzles": total_puzzles,
                "themes": {theme: theme_counts.get(theme, 0) for theme in themes if theme_counts.get(theme, 0) > 0}
            }

        return {
            "total_puzzles": self.target_puzzle_count,
            "theme_counts": theme_counts,
            "principle_summaries": principle_summaries,
            "top_focus_areas": self._get_top_focus_areas(principle_summaries)
        }

    def _get_top_focus_areas(self, principle_summaries: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Identify the top 3 skill areas that need the most practice.

        Args:
            principle_summaries: Summary of principles and their puzzle counts

        Returns:
            List of top 3 focus areas with their percentiles and puzzle counts
        """
        focus_areas = []

        for principle_name, summary in principle_summaries.items():
            focus_areas.append({
                "principle": principle_name,
                "percentile": summary["percentile"],
                "total_puzzles": summary["total_puzzles"]
            })

        # Sort by percentile (ascending) to get weakest areas first
        focus_areas.sort(key=lambda x: x["percentile"])

        return focus_areas[:3]

    def generate_database_queries(self, rating_min: int, rating_max: int) -> List[Dict[str, Any]]:
        """
        Generate database query specifications for fetching puzzles.

        Args:
            rating_min: Minimum puzzle rating
            rating_max: Maximum puzzle rating

        Returns:
            List of query specifications with theme, count, and rating range
        """
        theme_counts = self.calculate_theme_weights()

        queries = []

        for theme, count in theme_counts.items():
            if count > 0:
                queries.append({
                    "theme": theme,
                    "count": count,
                    "rating_min": rating_min,
                    "rating_max": rating_max
                })

        return queries

    def fetch_puzzles_from_database(self, user_rating: int) -> List[Dict[str, Any]]:
        """
        Fetch puzzles from the database based on calculated theme weights.

        Args:
            user_rating: User's current puzzle rating or chess rating

        Returns:
            List of puzzle dictionaries with all puzzle data
        """
        from analysis.models import Puzzle

        # Rating range: 50 below to 400 above to challenge the user
        rating_min = max(600, user_rating - 50)
        rating_max = min(3000, user_rating + 400)

        theme_counts = self.calculate_theme_weights()
        all_puzzles = []

        for theme, target_count in theme_counts.items():
            if target_count <= 0:
                continue

            # Query puzzles with this theme in the rating range
            # themes field is space-separated, so we use __contains
            puzzles = Puzzle.objects.filter(
                Q(themes__contains=theme),
                rating__gte=rating_min,
                rating__lte=rating_max
            ).order_by('?')[:target_count * 2]  # Get 2x to ensure we have enough

            # Convert to list and shuffle
            puzzle_list = list(puzzles.values(
                'puzzle_id',
                'fen',
                'moves',
                'rating',
                'rating_deviation',
                'popularity',
                'nb_plays',
                'themes',
                'game_url',
                'opening_tags'
            ))

            # Take only what we need
            all_puzzles.extend(puzzle_list[:target_count])

        # Shuffle all puzzles to mix themes
        random.shuffle(all_puzzles)

        # Ensure we have exactly target_puzzle_count (or as close as possible)
        if len(all_puzzles) > self.target_puzzle_count:
            all_puzzles = all_puzzles[:self.target_puzzle_count]

        return all_puzzles

    def get_puzzle_recommendations(self, user_rating: int) -> Dict[str, Any]:
        """
        Get complete puzzle recommendations including distribution summary and puzzle data.

        Args:
            user_rating: User's current puzzle rating or chess rating

        Returns:
            Dictionary with puzzle distribution summary and actual puzzle data
        """
        distribution = self.get_puzzle_distribution_summary()
        puzzles = self.fetch_puzzles_from_database(user_rating)

        rating_min = max(600, user_rating - 50)
        rating_max = min(3000, user_rating + 400)

        return {
            "distribution": distribution,
            "puzzles": puzzles,
            "total_puzzles_found": len(puzzles),
            "user_rating": user_rating,
            "rating_range": [rating_min, rating_max]
        }
