from typing import Dict, List, Any


class OpeningAnalyzer:
    """Analyzes chess opening patterns and success rates"""

    def __init__(self, games: List[Dict[str, Any]]):
        self.games = games

    def _extract_main_opening(self, full_opening: str) -> str:
        """Extract the main opening name from a full opening string"""
        if not full_opening or full_opening == "Unknown":
            return "Unknown Opening"

        # Split by colon and take the first part as the main opening
        main_opening = full_opening.split(":")[0].strip()
        return main_opening

    def analyze_openings(self, username: str) -> Dict[str, Dict[str, Any]]:
        """Analyze opening usage and success rates, grouped by main opening"""
        opening_stats = {}
        total_user_games = 0
        games_with_openings = 0

        for game in self.games:
            is_white = game["white_player"].lower() == username.lower()
            is_black = game["black_player"].lower() == username.lower()

            if not (is_white or is_black):
                continue

            total_user_games += 1
            full_opening = game["opening"]
            result = game["result"]

            # Debug: Check for empty or missing openings
            if (
                not full_opening
                or full_opening.strip() == ""
                or full_opening == "Unknown"
            ):
                full_opening = "Unknown Opening"

            games_with_openings += 1

            # Extract main opening and variation
            main_opening = self._extract_main_opening(full_opening)
            variation = full_opening if ":" in full_opening else "Main line"

            if main_opening not in opening_stats:
                opening_stats[main_opening] = {
                    "total": 0,
                    "wins": 0,
                    "draws": 0,
                    "losses": 0,
                    "variations": {},
                }

            # Track main opening stats
            opening_stats[main_opening]["total"] += 1

            # Track variation stats
            if variation not in opening_stats[main_opening]["variations"]:
                opening_stats[main_opening]["variations"][variation] = {
                    "total": 0,
                    "wins": 0,
                    "draws": 0,
                    "losses": 0,
                }

            opening_stats[main_opening]["variations"][variation]["total"] += 1

            # Determine if user won, lost, or drew
            user_won = (is_white and result == "1-0") or (is_black and result == "0-1")
            user_lost = (is_white and result == "0-1") or (is_black and result == "1-0")
            draw = result == "1/2-1/2"

            # Update main opening stats
            if user_won:
                opening_stats[main_opening]["wins"] += 1
                opening_stats[main_opening]["variations"][variation]["wins"] += 1
            elif draw:
                opening_stats[main_opening]["draws"] += 1
                opening_stats[main_opening]["variations"][variation]["draws"] += 1
            elif user_lost:
                opening_stats[main_opening]["losses"] += 1
                opening_stats[main_opening]["variations"][variation]["losses"] += 1

        # Calculate success percentages for main openings and variations
        for main_opening in opening_stats:
            # Main opening stats
            total = opening_stats[main_opening]["total"]
            if total > 0:
                wins = opening_stats[main_opening]["wins"]
                draws = opening_stats[main_opening]["draws"]
                opening_stats[main_opening]["win_rate"] = round((wins / total) * 100, 1)
                opening_stats[main_opening]["success_rate"] = round(
                    ((wins + draws * 0.5) / total) * 100, 1
                )

            # Variation stats
            for variation in opening_stats[main_opening]["variations"]:
                var_stats = opening_stats[main_opening]["variations"][variation]
                var_total = var_stats["total"]
                if var_total > 0:
                    var_wins = var_stats["wins"]
                    var_draws = var_stats["draws"]
                    var_stats["win_rate"] = round((var_wins / var_total) * 100, 1)
                    var_stats["success_rate"] = round(
                        ((var_wins + var_draws * 0.5) / var_total) * 100, 1
                    )

        # Sort by total games played
        sorted_openings = dict(
            sorted(opening_stats.items(), key=lambda x: x[1]["total"], reverse=True)
        )

        # Add debug info
        print(f"Debug: Total user games: {total_user_games}")
        print(f"Debug: Games with openings: {games_with_openings}")
        print(
            f"Debug: Sum of opening totals: {sum(stats['total'] for stats in opening_stats.values())}"
        )

        return sorted_openings
