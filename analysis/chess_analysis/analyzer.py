import re
from collections import Counter
from typing import Dict, List, Any
from .opening_analyzer import OpeningAnalyzer
from .accuracy_analyzer import AccuracyAnalyzer
from .game_enricher import GameEnricher


class ChessAnalyzer:
    """Main orchestrator for chess game analysis"""

    def __init__(self, ndjson_file_path: str):
        self.ndjson_file_path = ndjson_file_path
        self.games = []

    def parse_ndjson_file(self):
        """Parse the NDJSON file and extract game data"""
        import json

        with open(self.ndjson_file_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        game_json = json.loads(line)
                        game_data = self._parse_json_game(game_json)
                        if game_data:
                            self.games.append(game_data)
                    except json.JSONDecodeError:
                        continue

    def _parse_json_game(self, game_json: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a single JSON game"""
        players = game_json.get("players", {})

        return {
            "white_player": players.get("white", {})
            .get("user", {})
            .get("name", "Unknown"),
            "black_player": players.get("black", {})
            .get("user", {})
            .get("name", "Unknown"),
            "result": self._extract_result(game_json),
            "opening": game_json.get("opening", {}).get("name", "Unknown"),
            "termination": game_json.get("status", "Unknown"),
            "detailed_ending": self._extract_detailed_ending_from_json(game_json),
            "white_rating": players.get("white", {}).get("rating"),
            "black_rating": players.get("black", {}).get("rating"),
            "speed": game_json.get("speed", "Unknown"),
            "accuracy": game_json.get("analysis", {}),
            "clock": game_json.get("clock"),
            "division": game_json.get("division"),
            "raw_json": game_json,  # Keep full JSON for advanced analysis
        }

    def _extract_result(self, game_json: Dict[str, Any]) -> str:
        """Extract game result in standard format"""
        winner = game_json.get("winner")
        if winner == "white":
            return "1-0"
        elif winner == "black":
            return "0-1"
        elif game_json.get("status") == "draw":
            return "1/2-1/2"
        else:
            return "*"

    def _extract_detailed_ending_from_json(self, game_json: Dict[str, Any]) -> str:
        """Extract detailed ending from JSON status"""
        status = game_json.get("status", "unknown")
        winner = game_json.get("winner")

        # Map status to detailed descriptions
        if status == "mate":
            if winner == "white":
                return "White wins by checkmate"
            elif winner == "black":
                return "Black wins by checkmate"
            else:
                return "Checkmate"
        elif status == "resign":
            if winner == "white":
                return "Black resigns"
            elif winner == "black":
                return "White resigns"
            else:
                return "Resignation"
        elif status == "timeout":
            if winner == "white":
                return "Black wins on time"
            elif winner == "black":
                return "White wins on time"
            else:
                return "Time forfeit"
        elif status == "draw":
            return "The game is a draw"
        elif status == "stalemate":
            return "Draw by stalemate"
        elif status == "aborted":
            return "Game aborted"
        else:
            return status.title()

    def analyze_basic_stats(self, username: str) -> Dict[str, Any]:
        """Analyze basic game statistics"""
        total_games = 0
        white_games = 0
        black_games = 0

        for game in self.games:
            is_white = game["white_player"].lower() == username.lower()
            is_black = game["black_player"].lower() == username.lower()

            if is_white or is_black:
                total_games += 1
                if is_white:
                    white_games += 1
                else:
                    black_games += 1

        return {
            "total_games": total_games,
            "white_games": white_games,
            "black_games": black_games,
        }

    def analyze_terminations(self, username: str) -> Dict[str, Dict[str, Any]]:
        """Analyze how games ended with win/loss breakdown for each termination type"""
        termination_stats = {}

        for game in self.games:
            is_white = game["white_player"].lower() == username.lower()
            is_black = game["black_player"].lower() == username.lower()

            if not (is_white or is_black):
                continue

            detailed_ending = game["detailed_ending"]
            result = game["result"]

            # Initialize termination category if not exists
            if detailed_ending not in termination_stats:
                termination_stats[detailed_ending] = {
                    "total": 0,
                    "wins": 0,
                    "draws": 0,
                    "losses": 0,
                }

            termination_stats[detailed_ending]["total"] += 1

            # Determine if user won, lost, or drew
            user_won = (is_white and result == "1-0") or (is_black and result == "0-1")
            user_lost = (is_white and result == "0-1") or (is_black and result == "1-0")
            draw = result == "1/2-1/2"

            if user_won:
                termination_stats[detailed_ending]["wins"] += 1
            elif draw:
                termination_stats[detailed_ending]["draws"] += 1
            elif user_lost:
                termination_stats[detailed_ending]["losses"] += 1

        # Calculate percentages
        for ending in termination_stats:
            total = termination_stats[ending]["total"]
            if total > 0:
                wins = termination_stats[ending]["wins"]
                draws = termination_stats[ending]["draws"]
                losses = termination_stats[ending]["losses"]

                termination_stats[ending]["win_rate"] = round((wins / total) * 100, 1)
                termination_stats[ending]["draw_rate"] = round((draws / total) * 100, 1)
                termination_stats[ending]["loss_rate"] = round(
                    (losses / total) * 100, 1
                )

        # Sort by total count
        sorted_terminations = dict(
            sorted(termination_stats.items(), key=lambda x: x[1]["total"], reverse=True)
        )

        return sorted_terminations

    def run_analysis(self, username: str) -> Dict[str, Any]:
        """Run the complete analysis using modular components"""
        self.parse_ndjson_file()

        # Enrich games with Stockfish analysis first
        print("Starting Stockfish analysis for games without evaluation data...")
        enricher = GameEnricher(self.games)
        enrichment_results = enricher.enrich_games_with_stockfish(username)

        # Now run all analysis components
        opening_analyzer = OpeningAnalyzer(self.games)
        accuracy_analyzer = AccuracyAnalyzer(self.games)

        return {
            "username": username,
            "basic_stats": self.analyze_basic_stats(username),
            "terminations": self.analyze_terminations(username),
            "openings": opening_analyzer.analyze_openings(username),
            "accuracy_analysis": accuracy_analyzer.analyze_accuracy(username),
            "stockfish_analysis": enrichment_results,
        }
