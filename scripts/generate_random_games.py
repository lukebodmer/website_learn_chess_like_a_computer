#!/usr/bin/env python3
"""
Generate random enriched games for each ELO range.

This script:
1. Queries 20 random games from each ELO range
2. Converts them to universal format (Lichess-compatible)
3. Enriches them with Stockfish analysis via GCP API
4. Saves them as JSON files in static/data/random_games/

Usage:
    python generate_random_games.py [db_path] [output_dir]

Example:
    python generate_random_games.py /data/lichess_games.db static/data/random_games
"""

import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Configure Django settings before importing Django-dependent modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
import django
django.setup()

import json
import sqlite3
from typing import Dict, List, Optional

from analysis.chess_analysis.game_enricher import GameEnricher
from analysis.chess_analysis.game_divider import GameDivider
from analysis.opening_classifier import lookup_opening_in_database

# ELO ranges from generate_all_elo_stats.py
ELO_RANGES = [
    ("below-600", 0, 600),
    ("600-700", 600, 700),
    ("700-800", 700, 800),
    ("800-900", 800, 900),
    ("900-1000", 900, 1000),
    ("1000-1100", 1000, 1100),
    ("1100-1200", 1100, 1200),
    ("1200-1300", 1200, 1300),
    ("1300-1400", 1300, 1400),
    ("1400-1500", 1400, 1500),
    ("1500-1600", 1500, 1600),
    ("1600-1700", 1600, 1700),
    ("1700-1800", 1700, 1800),
    ("1800-1900", 1800, 1900),
    ("1900-2000", 1900, 2000),
    ("2000-2100", 2000, 2100),
    ("2100-2200", 2100, 2200),
    ("2200-2300", 2200, 2300),
    ("2300-2400", 2300, 2400),
    ("2400+", 2400, 9999),
]


def convert_db_game_to_universal_format(game_row: tuple) -> Optional[Dict]:
    """
    Convert database game row to universal Lichess-compatible format.

    Args:
        game_row: Tuple from database with fields:
            (id, white_elo, black_elo, speed, opening_name, winner,
             opening_eco, termination, clock_initial, clock_increment, game_data_json)

    Returns:
        Dict in Lichess-compatible format with enriched opening data
    """
    try:
        (game_id, white_elo, black_elo, speed, opening_name,
         winner, opening_eco, termination, clock_initial, clock_increment, game_data_json) = game_row

        # Parse game_data JSON (contains movetext)
        game_data = json.loads(game_data_json)
        movetext = game_data.get('movetext', '')

        if not movetext:
            return None

        # Parse movetext to extract moves
        import chess.pgn
        import io

        pgn_io = io.StringIO(movetext)
        game_pgn = chess.pgn.read_game(pgn_io)

        if not game_pgn:
            return None

        # Extract moves list
        moves_list = []
        clocks = []
        node = game_pgn

        while node.variations:
            node = node.variation(0)
            move_san = node.san()
            moves_list.append(move_san)

            # Parse clock from comment if available
            comment = node.comment if node.comment else ""
            if '[%clk' in comment:
                import re
                match = re.search(r'\[%clk ([^\]]+)\]', comment)
                if match:
                    time_str = match.group(1).strip()
                    parts = time_str.split(':')

                    if len(parts) == 3:
                        hours = int(parts[0])
                        minutes = int(parts[1])
                        seconds = float(parts[2])
                        total_seconds = hours * 3600 + minutes * 60 + seconds
                    elif len(parts) == 2:
                        minutes = int(parts[0])
                        seconds = float(parts[1])
                        total_seconds = minutes * 60 + seconds
                    else:
                        total_seconds = 0

                    clocks.append(int(total_seconds * 100))

        moves_string = ' '.join(moves_list)

        # Use GameDivider to get phase boundaries
        divider = GameDivider()
        board = game_pgn.board()
        boards = [board.copy()]

        for move in game_pgn.mainline_moves():
            board.push(move)
            boards.append(board.copy())

        division = divider.divide_game(boards)

        # Look up opening in database to get FEN and moves
        opening_ply = len(moves_list) if len(moves_list) < 20 else 20
        opening_details = lookup_opening_in_database(opening_eco, opening_name, opening_ply)

        # Create universal format (Lichess-compatible)
        universal_game = {
            "id": game_id,
            "rated": True,
            "variant": "standard",
            "speed": speed,
            "perf": speed,
            "createdAt": 0,  # Not stored in our DB
            "lastMoveAt": 0,  # Not stored in our DB
            "status": termination or "unknown",
            "source": "database",
            "players": {
                "white": {
                    "user": {"name": "white_player", "id": "white_player"},
                    "rating": white_elo,
                    "ratingDiff": 0
                },
                "black": {
                    "user": {"name": "black_player", "id": "black_player"},
                    "rating": black_elo,
                    "ratingDiff": 0
                }
            },
            "winner": winner,
            "opening": {
                "eco": opening_eco or "Unknown",
                "name": opening_name or "Unknown",
                "ply": opening_ply,
                "fen": opening_details.get('fen', ''),
                "moves": opening_details.get('moves', '')
            },
            "moves": moves_string,
            "clocks": clocks,
            "division": {
                "middle": division.middle if division.middle is not None else 15,
                "end": division.end if division.end is not None else 40
            }
        }

        # Add clock metadata if available
        if clock_initial is not None and clock_increment is not None:
            total_time = clock_initial + clock_increment * 40
            universal_game["clock"] = {
                "initial": clock_initial,
                "increment": clock_increment,
                "totalTime": total_time
            }

        return universal_game

    except Exception as e:
        print(f"Error converting game {game_row[0] if game_row else 'unknown'}: {e}")
        return None


def fetch_random_games_for_elo_range(db_path: str, elo_min: int, elo_max: int,
                                      count: int = 20) -> List[Dict]:
    """
    Fetch random games from the database for a specific ELO range.

    Args:
        db_path: Path to SQLite database
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        count: Number of games to fetch (default 20)

    Returns:
        List of games in universal format
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Query random games where average ELO is in range
    # We'll get games from all time controls mixed together
    query = """
        SELECT
            id,
            white_elo,
            black_elo,
            speed,
            opening_name,
            winner,
            opening_eco,
            termination,
            clock_initial,
            clock_increment,
            game_data
        FROM games
        WHERE ((white_elo + black_elo) / 2) >= ?
          AND ((white_elo + black_elo) / 2) < ?
          AND speed IN ('bullet', 'blitz', 'rapid')
        ORDER BY RANDOM()
        LIMIT ?
    """

    cursor.execute(query, (elo_min, elo_max, count))
    rows = cursor.fetchall()

    conn.close()

    # Convert to universal format
    games = []
    for row in rows:
        game = convert_db_game_to_universal_format(row)
        if game:
            games.append(game)

    return games


def enrich_games_with_stockfish(games: List[Dict], elo_range_name: str) -> List[Dict]:
    """
    Enrich games with Stockfish analysis using GameEnricher.

    Args:
        games: List of games in universal format
        elo_range_name: Name of the ELO range (for logging)

    Returns:
        List of enriched games
    """
    print(f"  Enriching {len(games)} games with Stockfish analysis...")

    # Convert games to the format expected by GameEnricher
    # GameEnricher expects: {white_player, black_player, opening, raw_json}
    formatted_games = []
    for game in games:
        players = game.get("players", {})
        formatted_game = {
            "white_player": players.get("white", {}).get("user", {}).get("name", "white_player"),
            "black_player": players.get("black", {}).get("user", {}).get("name", "black_player"),
            "opening": game.get("opening", {}).get("name", "Unknown"),
            "raw_json": game,
        }
        formatted_games.append(formatted_game)

    # Create GameEnricher instance with formatted games
    enricher = GameEnricher(formatted_games)

    try:
        # Collect enriched games from the streaming generator
        completed_enriched_games = []
        total_positions = 0

        # Use "white_player" as username since we set all games to use this player name
        # This ensures the enricher finds all the games we want to analyze
        for update in enricher.enrich_games_with_stockfish_streaming(username="white_player"):
            if update.get('type') == 'init':
                total_positions = update.get('total_positions', 0)
                print(f"    Found {total_positions} unique positions to evaluate")

            elif update.get('type') == 'api_progress':
                completed_calls = update.get('completed_calls', 0)
                total_calls = update.get('total_calls', 1)
                if completed_calls % 10 == 0 or completed_calls == total_calls:
                    print(f"    API Progress: {completed_calls}/{total_calls} ({int(completed_calls/total_calls*100)}%)")

            elif update.get('type') == 'game_complete':
                # Individual game completed
                game_analysis = update.get('game_analysis', {})

                if game_analysis and 'game' in game_analysis:
                    game_json = game_analysis['game'].get('raw_json', {})
                    completed_enriched_games.append(game_json)
                    print(f"    Completed game {len(completed_enriched_games)}/{len(games)}: {game_json.get('id', 'unknown')}")

            elif update.get('type') == 'complete':
                print(f"    Enrichment complete!")
                break

        print(f"  Successfully enriched {len(completed_enriched_games)}/{len(games)} games")
        return completed_enriched_games

    except Exception as e:
        print(f"  ERROR enriching games: {e}")
        import traceback
        traceback.print_exc()
        return []


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "/data/lichess_games.db"
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "static/data/random_games"

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("GENERATE RANDOM ENRICHED GAMES FOR ALL ELO RANGES")
    print("=" * 80)
    print(f"Database: {db_path}")
    print(f"Output directory: {output_dir}")
    print(f"Total ELO ranges: {len(ELO_RANGES)}")
    print(f"Games per range: 20")
    print()

    total_ranges = len(ELO_RANGES)

    for idx, (range_name, elo_min, elo_max) in enumerate(ELO_RANGES, 1):
        print(f"\n[{idx}/{total_ranges}] Processing {range_name}...")
        print("-" * 80)

        try:
            # Fetch random games
            print(f"  Fetching 20 random games from database...")
            games = fetch_random_games_for_elo_range(db_path, elo_min, elo_max, count=20)

            if not games:
                print(f"  WARNING: No games found for {range_name}")
                # Write empty array to prevent errors
                output_file = output_path / f"{range_name}.json"
                with open(output_file, 'w') as f:
                    json.dump([], f)
                continue

            print(f"  ✓ Fetched {len(games)} games")

            # Enrich games with Stockfish
            enriched_games = enrich_games_with_stockfish(games, range_name)

            if not enriched_games:
                print(f"  WARNING: No games enriched for {range_name}")
                # Write empty array
                output_file = output_path / f"{range_name}.json"
                with open(output_file, 'w') as f:
                    json.dump([], f)
                continue

            # Write to file
            output_file = output_path / f"{range_name}.json"
            with open(output_file, 'w') as f:
                json.dump(enriched_games, f, indent=2)

            print(f"  ✓ Written {len(enriched_games)} enriched games to {output_file}")
            print(f"  Progress: {idx}/{total_ranges} ({idx/total_ranges*100:.1f}%)")

        except Exception as e:
            print(f"  ERROR processing {range_name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    print()
    print("=" * 80)
    print("GENERATION COMPLETE")
    print("=" * 80)
    print(f"Output files: {output_dir}/*.json")


if __name__ == "__main__":
    main()
