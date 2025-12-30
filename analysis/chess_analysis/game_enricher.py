from typing import Dict, List, Any
from .stockfish_analyzer import StockfishAnalyzer


class GameEnricher:
    """Enriches game data with Stockfish analysis for games lacking evaluation data"""

    def __init__(self, games: List[Dict[str, Any]]):
        self.games = games

    def enrich_games_with_stockfish(self, username: str) -> Dict[str, Any]:
        """Find games needing analysis and enrich them with Stockfish evaluation data"""
        enrichment_results = {
            "total_games_analyzed": 0,
            "games_with_new_analysis": 0,
            "total_mistakes_found": 0,
            "mistake_breakdown": {"blunders": 0, "mistakes": 0, "inaccuracies": 0},
            "analysis_errors": 0,
            "games_skipped": 0,
        }

        games_needing_analysis = []

        # Find games without comprehensive analysis
        for game in self.games:
            is_user = (
                game["white_player"].lower() == username.lower()
                or game["black_player"].lower() == username.lower()
            )

            if not is_user:
                continue

            raw_json = game.get("raw_json", {})

            # Check if user already has accuracy data
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

            # If user doesn't have accuracy data, add to analysis queue
            if not user_has_accuracy:
                games_needing_analysis.append(game)

        print(f"Found {len(games_needing_analysis)} games needing analysis")

        # Analyze games with Stockfish and inject results back into game data
        try:
            with StockfishAnalyzer() as analyzer:
                if not analyzer:
                    return {**enrichment_results, "error": "Stockfish not available"}

                hard_limit_for_debugging = 1
                for i, game in enumerate(
                    games_needing_analysis[:hard_limit_for_debugging]
                ):
                    print(
                        f"Analyzing game {i+1}/{min(hard_limit_for_debugging, len(games_needing_analysis))}"
                    )

                    enrichment_results["total_games_analyzed"] += 1

                    raw_json = game.get("raw_json", {})
                    analysis_result = analyzer.analyze_game(raw_json)

                    if "error" in analysis_result:
                        enrichment_results["analysis_errors"] += 1
                        print(f"Analysis error: {analysis_result['error']}")
                        continue

                    if "skipped" in analysis_result:
                        enrichment_results["games_skipped"] += 1
                        continue

                    # Count new analysis
                    if analysis_result.get("new_evaluations", 0) > 0:
                        enrichment_results["games_with_new_analysis"] += 1

                        # Inject Stockfish accuracy back into the game's JSON structure
                        self._inject_accuracy_into_game(
                            game, analysis_result, username, analyzer
                        )

                    # Count mistakes
                    mistakes = analysis_result.get("mistakes", [])
                    enrichment_results["total_mistakes_found"] += len(mistakes)

                    for mistake in mistakes:
                        mistake_type = mistake["type"]
                        if mistake_type in enrichment_results["mistake_breakdown"]:
                            enrichment_results["mistake_breakdown"][mistake_type] += 1

                    # Store detailed analysis for debugging
                    game["stockfish_analysis"] = analysis_result

        except Exception as e:
            enrichment_results["error"] = f"Stockfish analysis failed: {str(e)}"

        return enrichment_results

    def _inject_accuracy_into_game(
        self,
        game: Dict[str, Any],
        analysis_result: Dict[str, Any],
        username: str,
        analyzer: StockfishAnalyzer,
    ) -> None:
        """Inject Stockfish-calculated accuracy back into game's JSON structure"""
        if (
            "evaluations" not in analysis_result
            or len(analysis_result["evaluations"]) == 0
        ):
            return

        # Determine user's color
        is_white_player = game["white_player"].lower() == username.lower()
        color = "white" if is_white_player else "black"

        # Calculate accuracy from Stockfish evaluations
        stockfish_accuracy = analyzer.analyze_accuracy_from_evaluations(
            analysis_result["evaluations"], color
        )

        # Update the raw_json with Stockfish accuracy data
        raw_json = game.get("raw_json", {})
        if "players" not in raw_json:
            raw_json["players"] = {}
        if color not in raw_json["players"]:
            raw_json["players"][color] = {}
        if "analysis" not in raw_json["players"][color]:
            raw_json["players"][color]["analysis"] = {}

        # Add Stockfish-calculated accuracy
        raw_json["players"][color]["analysis"]["accuracy"] = stockfish_accuracy
        game["raw_json"] = raw_json

        print(f"Injected {color} accuracy {stockfish_accuracy}% into game")
