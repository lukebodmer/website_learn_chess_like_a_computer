#!/usr/bin/env python3
"""
Generate statistics for the top 100 most common openings from Lichess games database.

This script finds the 100 most frequently played openings (with variations) in an
ELO range, then generates detailed statistics including:
- Opening-phase errors (inaccuracies, mistakes, blunders)
- Top 3 most common blunders made
- Top 3 most common mistakes made
- Sample size and total times played

Usage:
    python generate_top_100_opening_stats.py <db_path> <elo_min> <elo_max> [options]

Examples:
    # Basic usage
    python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300

    # Custom output path
    python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --output static/data/top_100_opening_stats/1200-1300.json

    # Custom sample size per opening
    python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --sample-size 1000

    # Set minimum games required for an opening
    python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --min-games 50
"""

import json
import sqlite3
import sys
import argparse
import io
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import Counter
import numpy as np
from scipy import stats as scipy_stats
import chess.pgn

# Add parent directory to import dependencies
sys.path.insert(0, str(Path(__file__).parent.parent))
from analysis.chess_analysis.game_divider import GameDivider

# Import necessary functions from generate_elo_stats
from scripts.generate_elo_stats import (
    calculate_stats,
    analyze_game,
    parse_movetext_to_game
)


def get_top_openings(cursor, elo_min: int, elo_max: int, speed: str, limit: int = 100) -> List[Tuple[str, str]]:
    """
    Get the top N most common openings for a specific ELO range and speed.

    Args:
        cursor: SQLite database cursor
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        speed: Speed category ('bullet', 'blitz', 'rapid')
        limit: Number of top openings to return (default: 100)

    Returns:
        List of (opening_name, opening_eco) tuples, ordered by frequency
    """
    query = """
        SELECT
            opening_name,
            opening_eco,
            COUNT(*) as occurrence_count
        FROM games
        WHERE ((white_elo >= ? AND white_elo < ?) OR (black_elo >= ? AND black_elo < ?))
          AND speed = ?
          AND opening_name IS NOT NULL
        GROUP BY opening_name, opening_eco
        ORDER BY occurrence_count DESC
        LIMIT ?
    """

    cursor.execute(query, (elo_min, elo_max, elo_min, elo_max, speed, limit))
    return [(name, eco) for name, eco, _ in cursor.fetchall()]


def count_opening_occurrences(cursor, elo_min: int, elo_max: int, speed: str,
                               opening_name: str) -> int:
    """
    Count total number of times an opening was played in the database
    for a specific ELO range and speed.

    Returns total count (white + black games).
    """
    count_query = """
        SELECT COUNT(*) FROM games
        WHERE ((white_elo >= ? AND white_elo < ?) OR (black_elo >= ? AND black_elo < ?))
          AND speed = ?
          AND opening_name = ?
    """

    cursor.execute(count_query, (elo_min, elo_max, elo_min, elo_max, speed, opening_name))
    result = cursor.fetchone()
    return result[0] if result else 0


def get_opening_games(cursor, elo_min: int, elo_max: int, speed: str,
                       opening_name: str, sample_size: int) -> Tuple[List, List]:
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
          AND opening_name = ?
        ORDER BY RANDOM()
        LIMIT ?
    """

    cursor.execute(white_query, (elo_min, elo_max, speed, opening_name, sample_size))
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
          AND opening_name = ?
        ORDER BY RANDOM()
        LIMIT ?
    """

    cursor.execute(black_query, (elo_min, elo_max, speed, opening_name, sample_size))
    black_games = cursor.fetchall()

    return white_games, black_games


def normalize_fen(fen: str) -> str:
    """
    Normalize FEN by removing halfmove clock and fullmove number.

    This keeps only the meaningful board position (pieces, castling rights, en passant)
    and removes counters that make identical positions look different.

    Args:
        fen: Full FEN string

    Returns:
        Normalized FEN (first 4 fields only)
    """
    parts = fen.split(' ')
    # Keep: position, active color, castling, en passant
    # Remove: halfmove clock, fullmove number
    return ' '.join(parts[:4])


def extract_move_errors_from_game(game_data: Dict, player_color: str) -> Dict[str, List[Tuple[str, str]]]:
    """
    Extract all blunder, mistake, and inaccuracy moves from a game for a specific player.

    Args:
        game_data: Dict with 'movetext' key
        player_color: 'white' or 'black'

    Returns:
        Dict with 'blunders', 'mistakes', and 'inaccuracies' keys, each containing a list of (normalized_fen, move) tuples
    """
    movetext = game_data.get('movetext', '')
    if not movetext:
        return {'blunders': [], 'mistakes': [], 'inaccuracies': []}

    game = parse_movetext_to_game(movetext)
    if not game:
        return {'blunders': [], 'mistakes': [], 'inaccuracies': []}

    # Use GameDivider to get phase boundaries
    divider = GameDivider()

    # Build boards list for divider
    boards = []
    board = game.board()
    boards.append(board.copy())
    for move in game.mainline_moves():
        board.push(move)
        boards.append(board.copy())

    division = divider.divide_game(boards)

    # Handle cases where division boundaries are None
    middle_start = division.middle if division.middle is not None else 15

    blunders = []
    mistakes = []
    inaccuracies = []

    move_num = 0
    node = game
    # Track board position
    current_board = game.board()

    while node.variations:
        next_node = node.variation(0)
        move_num += 1

        # Determine if this is the player's move
        is_white_move = (move_num % 2 == 1)
        is_player_move = (player_color == 'white' and is_white_move) or (player_color == 'black' and not is_white_move)

        # Get FEN before the move and normalize it
        fen_before_move = current_board.fen()
        normalized_fen = normalize_fen(fen_before_move)

        # Make the move
        current_board.push(next_node.move)

        if not is_player_move:
            node = next_node
            continue

        # Only track errors in the opening phase
        if move_num >= middle_start:
            node = next_node
            continue

        move_san = next_node.san()
        if not move_san:
            node = next_node
            continue

        # Clean the move SAN (remove check/checkmate symbols)
        clean_move = move_san.replace('+', '').replace('#', '')

        # Check for blunders, mistakes, and inaccuracies in NAGs
        if 4 in next_node.nags:  # Blunder (??)
            blunders.append((normalized_fen, clean_move))
        elif 2 in next_node.nags:  # Mistake (?)
            mistakes.append((normalized_fen, clean_move))
        elif 6 in next_node.nags:  # Inaccuracy (?!)
            inaccuracies.append((normalized_fen, clean_move))

        node = next_node

    return {'blunders': blunders, 'mistakes': mistakes, 'inaccuracies': inaccuracies}


def calculate_opening_statistics(cursor, elo_min: int, elo_max: int, speed: str,
                                   min_games: int = 100,
                                   sample_size_per_opening: int = 500,
                                   top_n: int = 100,
                                   elo_range_name: str = None,
                                   output_file: Path = None) -> Dict:
    """
    Calculate statistics for the top N most common openings.

    Args:
        cursor: Database cursor
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        speed: Speed category ('bullet', 'blitz', 'rapid')
        min_games: Minimum games required to include an opening (default: 100)
        sample_size_per_opening: Games to sample per color per opening (default: 500)
        top_n: Number of top openings to analyze (default: 100)
        elo_range_name: Optional name for the ELO range
        output_file: Path to output file for incremental writing (optional)

    Returns:
        Dict mapping opening names to their statistics
    """
    if elo_range_name is None:
        elo_range_name = f"{elo_min}-{elo_max}"

    # Get top N openings for this speed
    print(f"  Finding top {top_n} openings for {speed}...")
    top_openings = get_top_openings(cursor, elo_min, elo_max, speed, limit=top_n)

    if not top_openings:
        return {}

    print(f"  Found {len(top_openings)} openings for {speed}")

    opening_stats = {}

    for idx, (opening_name, opening_eco) in enumerate(top_openings):
        # Print progress every 10 openings
        if (idx + 1) % 10 == 0:
            print(f"    Processing opening {idx + 1}/{len(top_openings)}: {opening_name}...")

        # Count total occurrences of this opening in the database
        total_times_played = count_opening_occurrences(
            cursor, elo_min, elo_max, speed, opening_name
        )

        # Get games for this opening
        white_games, black_games = get_opening_games(
            cursor, elo_min, elo_max, speed, opening_name, sample_size_per_opening
        )

        total_games = len(white_games) + len(black_games)

        if total_games < min_games:
            # Skip openings with insufficient data
            continue

        # Analyze games for this opening
        opening_data_points = []

        # Track all blunders, mistakes, and inaccuracies for this opening
        all_blunders = []
        all_mistakes = []
        all_inaccuracies = []

        # Process white player games
        for row in white_games:
            game_id, white_elo, black_elo, game_speed, opening_name_db, winner, eco, termination, game_data_json = row

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
                'opening_name': opening_name_db,
                'termination': termination
            }

            stats = analyze_game(game_data, 'white', game_metadata, elo_range_name)
            if stats:
                opening_data_points.append(stats)

            # Extract move errors
            move_errors = extract_move_errors_from_game(game_data, 'white')
            all_blunders.extend(move_errors['blunders'])
            all_mistakes.extend(move_errors['mistakes'])
            all_inaccuracies.extend(move_errors['inaccuracies'])

        # Process black player games
        for row in black_games:
            game_id, white_elo, black_elo, game_speed, opening_name_db, winner, eco, termination, game_data_json = row

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
                'opening_name': opening_name_db,
                'termination': termination
            }

            stats = analyze_game(game_data, 'black', game_metadata, elo_range_name)
            if stats:
                opening_data_points.append(stats)

            # Extract move errors
            move_errors = extract_move_errors_from_game(game_data, 'black')
            all_blunders.extend(move_errors['blunders'])
            all_mistakes.extend(move_errors['mistakes'])
            all_inaccuracies.extend(move_errors['inaccuracies'])

        if len(opening_data_points) < min_games:
            print(f"      Skipping {opening_name}: only {len(opening_data_points)} data points (need ≥{min_games})")
            continue

        # Count most common blunders, mistakes, and inaccuracies (fen, move) tuples
        blunder_counter = Counter(all_blunders)
        mistake_counter = Counter(all_mistakes)
        inaccuracy_counter = Counter(all_inaccuracies)

        top_3_blunders = [{'fen': fen, 'move': move, 'count': count} for (fen, move), count in blunder_counter.most_common(3)]
        top_3_mistakes = [{'fen': fen, 'move': move, 'count': count} for (fen, move), count in mistake_counter.most_common(3)]
        top_3_inaccuracies = [{'fen': fen, 'move': move, 'count': count} for (fen, move), count in inaccuracy_counter.most_common(3)]

        # Calculate statistics for opening-phase metrics only
        opening_stats_result = {
            'eco': opening_eco,
            'sample_size': len(opening_data_points),
            'number_of_times_played': total_times_played,
            'top_3_blunders': top_3_blunders,
            'top_3_mistakes': top_3_mistakes,
            'top_3_inaccuracies': top_3_inaccuracies
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

        opening_stats[opening_name] = opening_stats_result
        print(f"      ✓ {opening_name}: {len(opening_data_points)} data points, "
              f"{len(top_3_blunders)} unique blunders, {len(top_3_mistakes)} unique mistakes, "
              f"{len(top_3_inaccuracies)} unique inaccuracies")

        # Write incrementally to file if output_file is provided
        if output_file:
            # Read existing data
            if output_file.exists():
                with open(output_file, 'r') as f:
                    try:
                        all_data = json.load(f)
                    except json.JSONDecodeError:
                        all_data = {}
            else:
                all_data = {}

            # Update with current speed's data
            if speed not in all_data:
                all_data[speed] = {}
            all_data[speed][opening_name] = opening_stats_result

            # Write back to file
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with open(output_file, 'w') as f:
                json.dump(all_data, f, indent=2)

    print(f"  Calculated stats for {len(opening_stats)} openings with ≥{min_games} games")

    return opening_stats


def generate_top_100_opening_stats(db_path: str, elo_min: int, elo_max: int,
                                     sample_size_per_opening: int = 500,
                                     min_games: int = 100,
                                     top_n: int = 100,
                                     elo_range_name: str = None,
                                     output_file: Path = None) -> Dict:
    """
    Generate statistics for the top N most common openings in an ELO range.

    Args:
        db_path: Path to SQLite database
        elo_min: Minimum ELO (inclusive)
        elo_max: Maximum ELO (exclusive)
        sample_size_per_opening: Games to sample per color per opening (default: 500)
        min_games: Minimum games required to include an opening (default: 100)
        top_n: Number of top openings to analyze (default: 100)
        elo_range_name: Optional name for the ELO range (e.g., "below-600", "2400+")
        output_file: Path to output file for incremental writing (optional)

    Returns:
        Dict organized by time control -> opening name -> statistics
    """
    if elo_range_name is None:
        elo_range_name = f"{elo_min}-{elo_max}"

    print(f"Generating top {top_n} opening statistics for ELO {elo_range_name}...")
    print(f"Sampling up to {sample_size_per_opening} games per color per opening...")
    print(f"Minimum {min_games} games required to include an opening")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    result = {}

    for speed in ['bullet', 'blitz', 'rapid']:
        print(f"\nProcessing {speed} openings...")
        opening_stats = calculate_opening_statistics(
            cursor, elo_min, elo_max, speed,
            min_games=min_games,
            sample_size_per_opening=sample_size_per_opening,
            top_n=top_n,
            elo_range_name=elo_range_name,
            output_file=output_file
        )
        if opening_stats:
            result[speed] = opening_stats

    conn.close()
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Generate statistics for the top 100 most common openings from Lichess games database.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate stats for top 100 openings in ELO 1200-1300
  python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300

  # Custom output path
  python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --output static/data/top_100_opening_stats/1200-1300.json

  # Custom sample size and minimum games
  python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --sample-size 1000 --min-games 50

  # Analyze top 50 openings instead of 100
  python generate_top_100_opening_stats.py /data/lichess_games.db 1200 1300 --top-n 50
        """
    )

    parser.add_argument('db_path', help='Path to the SQLite database file')
    parser.add_argument('elo_min', type=int, help='Minimum ELO rating (inclusive)')
    parser.add_argument('elo_max', type=int, help='Maximum ELO rating (exclusive)')
    parser.add_argument('--sample-size', '-s', type=int, default=500,
                        help='Number of games to sample per color per opening (default: 500)')
    parser.add_argument('--min-games', '-m', type=int, default=100,
                        help='Minimum games required to include an opening (default: 100)')
    parser.add_argument('--top-n', '-n', type=int, default=100,
                        help='Number of top openings to analyze (default: 100)')
    parser.add_argument('--output', '-o', type=str, default=None,
                        help='Output file path (default: static/data/top_100_opening_stats/{elo_min}-{elo_max}.json)')
    parser.add_argument('--elo-range-name', type=str, default=None,
                        help='Custom name for ELO range (e.g., "below-600", "2400+")')

    args = parser.parse_args()

    # Set default output path if not provided
    if args.output is None:
        args.output = f"static/data/top_100_opening_stats/{args.elo_min}-{args.elo_max}.json"

    output_file = Path(args.output)

    # Generate opening statistics (writes incrementally to file)
    stats = generate_top_100_opening_stats(
        args.db_path,
        args.elo_min,
        args.elo_max,
        sample_size_per_opening=args.sample_size,
        min_games=args.min_games,
        top_n=args.top_n,
        elo_range_name=args.elo_range_name,
        output_file=output_file
    )

    if not stats:
        print("ERROR: No opening statistics generated")
        sys.exit(1)

    print(f"\n✓ Written to {args.output}")


if __name__ == "__main__":
    main()
