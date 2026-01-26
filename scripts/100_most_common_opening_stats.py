#!/usr/bin/env python3
"""
Query and display the 100 most common openings from Lichess games database.

This script queries the database to find the most frequently played openings
(including variations) within an ELO range, and prints them to the terminal
ordered from most used to least used.

Usage:
    python 100_most_common_opening_stats.py <db_path> <elo_min> <elo_max> [options]

Examples:
    # Query most common openings for ELO 1200-1300
    python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300

    # Limit to top 50 openings
    python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300 --limit 50

    # Filter by speed category
    python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300 --speed blitz
"""

import sqlite3
import argparse
from pathlib import Path
from typing import List, Tuple, Optional


def get_most_common_openings(
    cursor,
    elo_min: int,
    elo_max: int,
    limit: int = 100,
    speed: Optional[str] = None
) -> List[Tuple[str, str, int, int, int]]:
    """
    Query the most common openings in the database for a given ELO range.

    Args:
        cursor: SQLite database cursor
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        limit: Maximum number of openings to return (default: 100)
        speed: Optional speed filter ('bullet', 'blitz', 'rapid')

    Returns:
        List of tuples: (opening_name, opening_eco, total_count, white_count, black_count)
        Ordered from most to least common
    """
    # Build query to count opening occurrences
    # Count games where either white or black player is in the ELO range
    query = """
        SELECT
            opening_name,
            opening_eco,
            COUNT(*) as total_count,
            SUM(CASE WHEN white_elo >= ? AND white_elo < ? THEN 1 ELSE 0 END) as white_count,
            SUM(CASE WHEN black_elo >= ? AND black_elo < ? THEN 1 ELSE 0 END) as black_count
        FROM games
        WHERE ((white_elo >= ? AND white_elo < ?) OR (black_elo >= ? AND black_elo < ?))
          AND opening_name IS NOT NULL
    """

    params = [elo_min, elo_max, elo_min, elo_max, elo_min, elo_max, elo_min, elo_max]

    # Add speed filter if specified
    if speed:
        query += " AND speed = ?"
        params.append(speed)

    query += """
        GROUP BY opening_name, opening_eco
        ORDER BY total_count DESC
        LIMIT ?
    """
    params.append(limit)

    cursor.execute(query, params)
    return cursor.fetchall()


def print_opening_stats(
    openings: List[Tuple[str, str, int, int, int]],
    elo_min: int,
    elo_max: int,
    speed: Optional[str] = None
) -> None:
    """
    Print opening statistics to the terminal in a formatted table.

    Args:
        openings: List of (opening_name, opening_eco, total_count, white_count, black_count) tuples
        elo_min: Minimum ELO
        elo_max: Maximum ELO
        speed: Optional speed category
    """
    # Print header
    speed_text = f" ({speed})" if speed else " (all speeds)"
    print(f"\n{'='*100}")
    print(f"Top {len(openings)} Most Common Openings")
    print(f"ELO Range: {elo_min}-{elo_max}{speed_text}")
    print(f"{'='*100}\n")

    # Print column headers
    print(f"{'Rank':<6} {'ECO':<6} {'Total':<8} {'White':<8} {'Black':<8} {'Opening Name'}")
    print(f"{'-'*6} {'-'*6} {'-'*8} {'-'*8} {'-'*8} {'-'*50}")

    # Print each opening
    for idx, (opening_name, opening_eco, total_count, white_count, black_count) in enumerate(openings, 1):
        eco = opening_eco or 'N/A'
        print(f"{idx:<6} {eco:<6} {total_count:<8} {white_count:<8} {black_count:<8} {opening_name}")

    # Print summary
    total_games = sum(total_count for _, _, total_count, _, _ in openings)
    total_white = sum(white_count for _, _, _, white_count, _ in openings)
    total_black = sum(black_count for _, _, _, _, black_count in openings)
    print(f"\n{'-'*100}")
    print(f"Total games in top {len(openings)} openings: {total_games:,} (White: {total_white:,}, Black: {total_black:,})")
    print(f"{'='*100}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Query and display the most common openings from Lichess games database.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Query top 100 openings for ELO 1200-1300
  python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300

  # Limit to top 50 openings
  python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300 --limit 50

  # Filter by speed category
  python 100_most_common_opening_stats.py /data/lichess_games.db 1200 1300 --speed blitz

  # Combine limit and speed
  python 100_most_common_opening_stats.py /data/lichess_games.db 800 900 --limit 25 --speed rapid
        """
    )

    parser.add_argument('db_path', help='Path to the SQLite database file')
    parser.add_argument('elo_min', type=int, help='Minimum ELO rating (inclusive)')
    parser.add_argument('elo_max', type=int, help='Maximum ELO rating (exclusive)')
    parser.add_argument('--limit', '-l', type=int, default=100,
                        help='Number of openings to display (default: 100)')
    parser.add_argument('--speed', '-s', type=str, choices=['bullet', 'blitz', 'rapid'],
                        help='Filter by speed category (optional)')

    args = parser.parse_args()

    # Validate ELO range
    if args.elo_max <= args.elo_min:
        print("ERROR: elo_max must be greater than elo_min")
        return 1

    # Connect to database
    try:
        conn = sqlite3.connect(args.db_path)
        cursor = conn.cursor()
    except sqlite3.Error as e:
        print(f"ERROR: Could not connect to database: {e}")
        return 1

    # Query most common openings
    print(f"Querying database for most common openings...")
    openings = get_most_common_openings(
        cursor,
        args.elo_min,
        args.elo_max,
        limit=args.limit,
        speed=args.speed
    )

    if not openings:
        print("No openings found in the specified ELO range.")
        conn.close()
        return 1

    # Print results
    print_opening_stats(openings, args.elo_min, args.elo_max, args.speed)

    conn.close()
    return 0


if __name__ == "__main__":
    exit(main())
