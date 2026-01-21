#!/usr/bin/env python3
"""
Generate opening-specific statistics from Lichess games database.

This script generates statistics for specific chess openings within ELO ranges.
It analyzes opening-phase errors (inaccuracies, mistakes, blunders) for each
canonical opening, organized by time control. For each opening, it also counts
the total number of times that opening was played in the database.

Usage:
    python generate_opening_stats.py <db_path> <elo_min> <elo_max> [options]

Examples:
    # Basic usage
    python generate_opening_stats.py /data/lichess_games.db 1200 1300

    # Custom output path
    python generate_opening_stats.py /data/lichess_games.db 1200 1300 --output static/data/opening_stats/1200-1300.json

    # Custom sample size per opening
    python generate_opening_stats.py /data/lichess_games.db 1200 1300 --sample-size 500

    # Set minimum games required for an opening
    python generate_opening_stats.py /data/lichess_games.db 1200 1300 --min-games 50
"""

import json
import sqlite3
import sys
import csv
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
from scipy import stats as scipy_stats

# Add parent directory to import dependencies
sys.path.insert(0, str(Path(__file__).parent.parent))
from analysis.chess_analysis.game_divider import GameDivider

# Import necessary functions from generate_elo_stats
from scripts.generate_elo_stats import (
    load_canonical_openings,
    calculate_stats,
    analyze_game
)


def count_opening_occurrences(cursor, elo_min: int, elo_max: int, speed: str,
                               opening_base_name: str) -> int:
    """
    Count total number of times an opening was played in the database
    for a specific ELO range and speed.

    Returns total count (white + black games).
    """
    count_query = """
        SELECT COUNT(*) FROM games
        WHERE ((white_elo >= ? AND white_elo < ?) OR (black_elo >= ? AND black_elo < ?))
          AND speed = ?
          AND opening_base_name = ?
    """

    cursor.execute(count_query, (elo_min, elo_max, elo_min, elo_max, speed, opening_base_name))
    result = cursor.fetchone()
    return result[0] if result else 0


def get_opening_games(cursor, elo_min: int, elo_max: int, speed: str,
                       opening_base_name: str, sample_size: int) -> Tuple[List, List]:
    """
    Query games for a specific opening, ELO range, and speed.

    Returns (white_games, black_games) tuples.
    """
    # Query white player games
    white_query = """
        SELECT
            id,
            white_elo,
            black_elo,
            speed,
            opening_name,
            winner,
            opening_eco,
            termination,
            game_data
        FROM games
        WHERE white_elo >= ?
          AND white_elo < ?
          AND speed = ?
          AND opening_base_name = ?
        ORDER BY RANDOM()
        LIMIT ?
    """

    cursor.execute(white_query, (elo_min, elo_max, speed, opening_base_name, sample_size))
    white_games = cursor.fetchall()

    # Query black player games
    black_query = """
        SELECT
            id,
            white_elo,
            black_elo,
            speed,
            opening_name,
            winner,
            opening_eco,
            termination,
            game_data
        FROM games
        WHERE black_elo >= ?
          AND black_elo < ?
          AND speed = ?
          AND opening_base_name = ?
        ORDER BY RANDOM()
        LIMIT ?
    """

    cursor.execute(black_query, (elo_min, elo_max, speed, opening_base_name, sample_size))
    black_games = cursor.fetchall()

    return white_games, black_games


def calculate_opening_statistics(cursor, elo_min: int, elo_max: int, speed: str,
                                   canonical_openings: Dict[str, str], min_games: int = 100,
                                   sample_size_per_opening: int = 500,
                                   elo_range_name: str = None) -> Dict:
    """
    Calculate opening-specific statistics for a given ELO range and speed.

    Returns dict mapping canonical opening names to their statistics.
    Only includes openings with at least min_games total data points.
    """
    # Use provided range name or construct one
    if elo_range_name is None:
        elo_range_name = f"{elo_min}-{elo_max}"

    # Load canonical openings to filter by
    canonical_normalized = set(canonical_openings.keys())

    # First, get all unique openings in this ELO range and speed that match canonical openings
    # Use GROUP BY to get one ECO code per opening (we'll use MIN to pick one arbitrarily)
    opening_query = """
        SELECT opening_base_name, MIN(opening_eco) as opening_eco
        FROM games
        WHERE ((white_elo >= ? AND white_elo < ?) OR (black_elo >= ? AND black_elo < ?))
          AND speed = ?
          AND opening_base_name IS NOT NULL
        GROUP BY opening_base_name
    """

    cursor.execute(opening_query, (elo_min, elo_max, elo_min, elo_max, speed))
    all_openings = cursor.fetchall()

    # Filter to only canonical openings
    openings = [(name, eco) for name, eco in all_openings if name in canonical_normalized]

    if not openings:
        return {}

    print(f"    Found {len(openings)} canonical openings for {speed} (out of {len(all_openings)} total)")

    opening_stats = {}

    for idx, (opening_base_name, opening_eco) in enumerate(openings):
        # Get canonical name for display
        canonical_name = canonical_openings.get(opening_base_name, opening_base_name)

        # Print progress every 10 openings
        if (idx + 1) % 10 == 0:
            print(f"      Processing opening {idx + 1}/{len(openings)}: {canonical_name}...")

        # Count total occurrences of this opening in the database
        total_times_played = count_opening_occurrences(
            cursor, elo_min, elo_max, speed, opening_base_name
        )

        # Get games for this opening
        white_games, black_games = get_opening_games(
            cursor, elo_min, elo_max, speed, opening_base_name, sample_size_per_opening
        )

        total_games = len(white_games) + len(black_games)

        if total_games < min_games:
            # Skip openings with insufficient data
            continue

        # Analyze games for this opening
        opening_data_points = []

        # Process white player games
        for row in white_games:
            game_id, white_elo, black_elo, game_speed, opening_name, winner, eco, termination, game_data_json = row

            try:
                game_data = json.loads(game_data_json)
            except:
                continue

            game_metadata = {
                'winner': winner,
                'id': game_id,
                'white_elo': white_elo,
                'black_elo': black_elo,
                'opening_eco': eco,
                'opening_name': opening_name,
                'termination': termination
            }

            stats = analyze_game(game_data, 'white', game_metadata, elo_range_name)
            if stats:
                opening_data_points.append(stats)

        # Process black player games
        for row in black_games:
            game_id, white_elo, black_elo, game_speed, opening_name, winner, eco, termination, game_data_json = row

            try:
                game_data = json.loads(game_data_json)
            except:
                continue

            game_metadata = {
                'winner': winner,
                'id': game_id,
                'white_elo': white_elo,
                'black_elo': black_elo,
                'opening_eco': eco,
                'opening_name': opening_name,
                'termination': termination
            }

            stats = analyze_game(game_data, 'black', game_metadata, elo_range_name)
            if stats:
                opening_data_points.append(stats)

        if len(opening_data_points) < min_games:
            print(f"      Skipping {canonical_name}: only {len(opening_data_points)} data points (need ≥{min_games})")
            continue

        # Calculate statistics for opening-phase metrics only
        opening_stats_result = {
            'eco': opening_eco,
            'sample_size': len(opening_data_points),
            'number_of_times_played': total_times_played
        }

        # Only include opening-phase errors for opening-specific stats
        opening_metrics = [
            'opening_inaccuracies',
            'opening_mistakes',
            'opening_blunders'
        ]

        for metric in opening_metrics:
            values = [stats[metric] for stats in opening_data_points if metric in stats]
            if values:
                opening_stats_result[f"{metric}_per_game"] = calculate_stats(values)

        opening_stats[canonical_name] = opening_stats_result
        print(f"      ✓ {canonical_name}: {len(opening_data_points)} data points")

    print(f"    Calculated stats for {len(opening_stats)} openings with ≥{min_games} games")

    return opening_stats


def generate_opening_stats(db_path: str, elo_min: int, elo_max: int,
                            sample_size_per_opening: int = 500,
                            min_games: int = 100,
                            elo_range_name: str = None) -> Dict:
    """
    Generate opening-specific statistics for a specific ELO range.

    Args:
        db_path: Path to SQLite database
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        sample_size_per_opening: Games to sample per color per opening (default: 500)
        min_games: Minimum games required to include an opening (default: 100)
        elo_range_name: Optional name for the ELO range (e.g., "below-600", "2400+")

    Returns:
        Dict organized by time control -> opening name -> statistics
    """
    # Use provided range name or construct one
    if elo_range_name is None:
        elo_range_name = f"{elo_min}-{elo_max}"

    print(f"Generating opening statistics for ELO {elo_range_name}...")
    print(f"Sampling up to {sample_size_per_opening} games per color per opening...")
    print(f"Minimum {min_games} games required to include an opening")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Load canonical openings
    canonical_openings = load_canonical_openings()
    print(f"Loaded {len(canonical_openings)} canonical openings")

    result = {}

    for speed in ['bullet', 'blitz', 'rapid']:
        print(f"\nProcessing {speed} openings...")
        opening_stats = calculate_opening_statistics(
            cursor, elo_min, elo_max, speed, canonical_openings,
            min_games=min_games,
            sample_size_per_opening=sample_size_per_opening,
            elo_range_name=elo_range_name
        )
        if opening_stats:
            result[speed] = opening_stats

    conn.close()
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Generate opening-specific statistics from Lichess games database.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate opening stats for ELO 1200-1300
  python generate_opening_stats.py /data/lichess_games.db 1200 1300

  # Custom output path
  python generate_opening_stats.py /data/lichess_games.db 1200 1300 --output static/data/opening_stats/1200-1300.json

  # Custom sample size and minimum games
  python generate_opening_stats.py /data/lichess_games.db 1200 1300 --sample-size 500 --min-games 50
        """
    )

    parser.add_argument('db_path', help='Path to the SQLite database file')
    parser.add_argument('elo_min', type=int, help='Minimum ELO rating (inclusive)')
    parser.add_argument('elo_max', type=int, help='Maximum ELO rating (exclusive)')
    parser.add_argument('--sample-size', '-s', type=int, default=500,
                        help='Number of games to sample per color per opening (default: 500)')
    parser.add_argument('--min-games', '-m', type=int, default=100,
                        help='Minimum games required to include an opening (default: 100)')
    parser.add_argument('--output', '-o', type=str, default=None,
                        help='Output file path (default: static/data/opening_stats/{elo_min}-{elo_max}.json)')
    parser.add_argument('--elo-range-name', type=str, default=None,
                        help='Custom name for ELO range (e.g., "below-600", "2400+")')

    args = parser.parse_args()

    # Set default output path if not provided
    if args.output is None:
        args.output = f"static/data/opening_stats/{args.elo_min}-{args.elo_max}.json"

    # Generate opening statistics
    stats = generate_opening_stats(
        args.db_path,
        args.elo_min,
        args.elo_max,
        sample_size_per_opening=args.sample_size,
        min_games=args.min_games,
        elo_range_name=args.elo_range_name
    )

    if not stats:
        print("ERROR: No opening statistics generated")
        sys.exit(1)

    # Write output
    output_file = Path(args.output)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"\n✓ Written to {args.output}")


if __name__ == "__main__":
    main()
