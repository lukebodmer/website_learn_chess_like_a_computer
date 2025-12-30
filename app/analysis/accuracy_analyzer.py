from typing import Dict, List, Any


class AccuracyAnalyzer:
    """Analyzes chess accuracy data from games with analysis"""

    def __init__(self, games: List[Dict[str, Any]]):
        self.games = games

    def analyze_accuracy(self, username: str) -> Dict[str, Any]:
        """Analyze accuracy data from games with analysis"""
        accuracy_stats = {
            "total_games_with_analysis": 0,
            "average_accuracy": 0.0,
            "accuracy_by_color": {"white": [], "black": []},
            "accuracy_distribution": {
                "90_100": 0,
                "80_89": 0,
                "70_79": 0,
                "60_69": 0,
                "below_60": 0,
            },
            "best_accuracy": 0.0,
            "worst_accuracy": 100.0,
            "accuracy_trend": [],
            "games_by_accuracy": [],
        }

        user_accuracies = []

        for game in self.games:
            is_white = game["white_player"].lower() == username.lower()
            is_black = game["black_player"].lower() == username.lower()

            if not (is_white or is_black):
                continue

            # Get accuracy data from the game's raw JSON
            raw_json = game.get("raw_json", {})
            players_data = raw_json.get("players", {})

            # Extract user's accuracy
            user_accuracy = None
            if is_white and "white" in players_data:
                white_analysis = players_data["white"].get("analysis", {})
                user_accuracy = white_analysis.get("accuracy")
            elif is_black and "black" in players_data:
                black_analysis = players_data["black"].get("analysis", {})
                user_accuracy = black_analysis.get("accuracy")

            if user_accuracy is None:
                continue

            accuracy_stats["total_games_with_analysis"] += 1
            user_accuracies.append(user_accuracy)

            # Track by color
            color = "white" if is_white else "black"
            accuracy_stats["accuracy_by_color"][color].append(user_accuracy)

            # Categorize accuracy
            if user_accuracy >= 90:
                accuracy_stats["accuracy_distribution"]["90_100"] += 1
            elif user_accuracy >= 80:
                accuracy_stats["accuracy_distribution"]["80_89"] += 1
            elif user_accuracy >= 70:
                accuracy_stats["accuracy_distribution"]["70_79"] += 1
            elif user_accuracy >= 60:
                accuracy_stats["accuracy_distribution"]["60_69"] += 1
            else:
                accuracy_stats["accuracy_distribution"]["below_60"] += 1

            # Track extremes
            accuracy_stats["best_accuracy"] = max(
                accuracy_stats["best_accuracy"], user_accuracy
            )
            accuracy_stats["worst_accuracy"] = min(
                accuracy_stats["worst_accuracy"], user_accuracy
            )

            # Store game info for trend analysis
            accuracy_stats["games_by_accuracy"].append(
                {
                    "accuracy": user_accuracy,
                    "color": color,
                    "opening": game["opening"],
                    "speed": game["speed"],
                    "result": game["result"],
                }
            )

        # Calculate averages
        if user_accuracies:
            accuracy_stats["average_accuracy"] = round(
                sum(user_accuracies) / len(user_accuracies), 1
            )

        # Calculate color-specific averages
        for color in ["white", "black"]:
            color_accuracies = accuracy_stats["accuracy_by_color"][color]
            if color_accuracies:
                accuracy_stats["accuracy_by_color"][color] = {
                    "average": round(sum(color_accuracies) / len(color_accuracies), 1),
                    "games": len(color_accuracies),
                    "best": max(color_accuracies),
                    "worst": min(color_accuracies),
                }
            else:
                accuracy_stats["accuracy_by_color"][color] = {
                    "average": 0.0,
                    "games": 0,
                    "best": 0.0,
                    "worst": 0.0,
                }

        # Calculate percentage distributions
        total_analyzed = accuracy_stats["total_games_with_analysis"]
        if total_analyzed > 0:
            for category in accuracy_stats["accuracy_distribution"]:
                count = accuracy_stats["accuracy_distribution"][category]
                percentage = round((count / total_analyzed) * 100, 1)
                accuracy_stats["accuracy_distribution"][category] = {
                    "count": count,
                    "percentage": percentage,
                }

        return accuracy_stats
