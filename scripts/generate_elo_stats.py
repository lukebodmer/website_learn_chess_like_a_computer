#!/usr/bin/env python3
"""
Generate ELO-range-specific statistics from Lichess games database.

This script:
1. Queries games where WHITE player is in ELO range (default: 1000 games)
2. Queries games where BLACK player is in ELO range (default: 1000 games)
3. Parses movetext on-the-fly using GameDivider and annotation parsing
4. Analyzes only the player in the ELO range for each game
5. Combines data points (up to 2000 total per ELO×speed)
6. Generates distributions (mean, std, skew) for all metrics
7. Organizes by time control (bullet, blitz, rapid)

Note: Opening-specific statistics are now generated separately using generate_opening_stats.py

Usage:
    python generate_elo_stats.py <db_path> <elo_min> <elo_max> [options]

Examples:
    # Basic usage with defaults
    python generate_elo_stats.py /data/lichess_games.db 1200 1300

    # Custom sample size and output path
    python generate_elo_stats.py /data/lichess_games.db 1200 1300 --sample-size 1000 --output static/data/elo_averages/1200-1300.json
"""

import json
import sqlite3
import sys
import io
import re
import csv
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
from scipy import stats as scipy_stats
import chess.pgn

# Add parent directory to import GameDivider
sys.path.insert(0, str(Path(__file__).parent.parent))
from analysis.chess_analysis.game_divider import GameDivider


def load_canonical_openings(tsv_path: str = None) -> Dict[str, str]:
    """
    Load canonical openings from TSV file.

    Returns a dict mapping normalized opening names to canonical names.
    Example: {"benko gambit accepted": "Benko Gambit Accepted"}
    """
    if tsv_path is None:
        # Default path relative to script location
        script_dir = Path(__file__).parent.parent
        tsv_path = script_dir / "static" / "data" / "openings" / "lichess_openings_canonical.tsv"

    canonical_map = {}

    with open(tsv_path, 'r') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            canonical_name = row['name']
            # Create normalized key (lowercase)
            normalized_key = canonical_name.lower()
            canonical_map[normalized_key] = canonical_name

    return canonical_map


def calculate_stats(values: List[float]) -> Dict[str, float]:
    """Calculate mean, std, and skew for a list of values."""
    if not values or len(values) < 2:
        return {"mean": 0.0, "std": 0.0, "skew": 0.0}

    arr = np.array(values)
    return {
        "mean": round(float(np.mean(arr)), 2),
        "std": round(float(np.std(arr)), 2),
        "skew": round(float(scipy_stats.skew(arr)), 2) if len(arr) > 2 else 0.0
    }


def extract_base_opening(opening_name: Optional[str]) -> Optional[str]:
    """Extract base opening name from full opening name."""
    if not opening_name:
        return None

    if ':' in opening_name:
        base = opening_name.split(':')[0]
    else:
        base = opening_name

    return base.strip().lower()


def parse_movetext_to_game(movetext: str) -> Optional[chess.pgn.Game]:
    """Parse movetext string into chess.pgn.Game object."""
    try:
        # Movetext needs to be in a file-like object
        pgn_io = io.StringIO(movetext)
        game = chess.pgn.read_game(pgn_io)
        return game
    except Exception as e:
        return None


def determine_game_status(game_pgn: chess.pgn.Game, winner: Optional[str], clocks: List[int], termination: Optional[str] = None) -> str:
    """
    Determine game termination status from final position, winner, clocks, and termination field.

    Returns one of: 'mate', 'timeout', 'resign', 'stalemate', 'repetition',
                    'fifty-move', 'insufficient', 'draw'
    """
    # Use termination field if available (most reliable)
    if termination:
        termination_lower = termination.lower()
        if 'time' in termination_lower or 'timeout' in termination_lower:
            return 'timeout'
        # Note: We'll still check board position for other terminations to be accurate

    # Get the final board position
    board = game_pgn.board()
    for move in game_pgn.mainline_moves():
        board.push(move)

    # Check definitive endings first
    if board.is_checkmate():
        return 'mate'

    if board.is_stalemate():
        return 'stalemate'

    # Check draw conditions
    if winner is None or winner == 'draw':
        if board.is_fifty_moves():
            return 'fifty-move'

        if board.is_repetition(3):
            return 'repetition'

        if board.is_insufficient_material():
            return 'insufficient'

        # Default draw (by agreement or other)
        return 'draw'

    # If there's a winner but no checkmate/timeout, assume resignation
    return 'resign'


def parse_clock_string(clk_str: str) -> int:
    """
    Parse clock string to centiseconds.

    Format: [%clk H:MM:SS] or [%clk M:SS]
    Returns: centiseconds (int)
    """
    try:
        # Extract clock value using regex
        match = re.search(r'\[%clk ([^\]]+)\]', clk_str)
        if not match:
            return 0

        time_str = match.group(1).strip()
        parts = time_str.split(':')

        if len(parts) == 3:
            # H:MM:SS format
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            total_seconds = hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:
            # M:SS format
            minutes = int(parts[0])
            seconds = float(parts[1])
            total_seconds = minutes * 60 + seconds
        else:
            return 0

        return int(total_seconds * 100)  # Convert to centiseconds
    except:
        return 0


def parse_eval_string(eval_str: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Parse eval string to eval/mate values.

    Format: [%eval 1.45] or [%eval #3] or [%eval #-2]
    Returns: (eval_centipawns, mate_in_moves) tuple
    """
    try:
        # Extract eval value using regex
        match = re.search(r'\[%eval ([^\]]+)\]', eval_str)
        if not match:
            return None, None

        eval_content = match.group(1).strip()

        if '#' in eval_content:
            # Mate in X moves
            mate_value = int(eval_content.replace('#', ''))
            return None, mate_value
        else:
            # Centipawn evaluation
            eval_pawns = float(eval_content)
            eval_centipawns = int(eval_pawns * 100)
            return eval_centipawns, None
    except:
        return None, None


def extract_minimal_enriched_data(movetext: str, game_id: str, white_elo: int, black_elo: int,
                                   winner: str, opening_eco: str, opening_name: str) -> Optional[Dict]:
    """
    Extract minimal enriched data from movetext for principles analysis.

    This creates a structure compatible with principles_analyzer.py but computed
    efficiently from raw movetext.

    Returns dict compatible with principles_analyzer's expected format.
    """
    game = parse_movetext_to_game(movetext)
    if not game:
        return None

    # Use GameDivider to get phase boundaries
    divider = GameDivider()
    division = divider.divide_game(game)

    # Build analysis array by parsing move annotations and comments
    analysis = []
    clocks = []
    moves_list = []

    move_num = 0
    node = game

    # Parse each move
    while node.variations:
        node = node.variation(0)
        move_num += 1

        move_san = node.san()
        moves_list.append(move_san)
        comment = node.comment if node.comment else ""

        # Parse judgment from NAGs (Numeric Annotation Glyphs)
        # NAG 6 = ?! (Inaccuracy), NAG 2 = ? (Mistake), NAG 4 = ?? (Blunder)
        judgment_name = None
        if 4 in node.nags:  # Blunder (??)
            judgment_name = 'Blunder'
        elif 2 in node.nags:  # Mistake (?)
            judgment_name = 'Mistake'
        elif 6 in node.nags:  # Inaccuracy (?!)
            judgment_name = 'Inaccuracy'

        # Parse eval and clock from comment
        eval_cp = None
        mate_val = None
        clock_cs = None

        if '[%eval' in comment:
            eval_cp, mate_val = parse_eval_string(comment)

        if '[%clk' in comment:
            clock_cs = parse_clock_string(comment)
            clocks.append(clock_cs)

        # Build analysis entry
        analysis_entry = {
            'judgment': {'name': judgment_name} if judgment_name else {},
            'eval': eval_cp,
            'mate': mate_val
        }

        analysis.append(analysis_entry)

    # Build minimal enriched format
    return {
        'id': game_id,
        'players': {
            'white': {'rating': white_elo},
            'black': {'rating': black_elo}
        },
        'division': {
            'middle': division.middlegame_start_ply,
            'end': division.endgame_start_ply
        },
        'analysis': analysis,
        'clocks': clocks,
        'opening': {
            'eco': opening_eco,
            'name': opening_name
        },
        'winner': winner,
        'moves': ' '.join(moves_list)
    }



def count_errors_from_movetext(movetext: str, player_color: str, division: Dict[str, int]) -> Dict[str, int]:
    """
    Count inaccuracies/mistakes/blunders per phase from movetext.

    Returns dict with keys like 'opening_inaccuracies', 'middlegame_mistakes', etc.
    """
    game = parse_movetext_to_game(movetext)
    if not game:
        return {}

    middle_start = division.get('middle', 15)
    end_start = division.get('end', 40)

    errors = {
        'opening_inaccuracies': 0,
        'opening_mistakes': 0,
        'opening_blunders': 0,
        'middlegame_inaccuracies': 0,
        'middlegame_mistakes': 0,
        'middlegame_blunders': 0,
        'endgame_inaccuracies': 0,
        'endgame_mistakes': 0,
        'endgame_blunders': 0,
    }

    move_num = 0
    node = game
    while node.variations:
        node = node.variation(0)
        move_num += 1

        # Determine if this is the player's move
        is_white_move = (move_num % 2 == 1)
        is_player_move = (player_color == 'white' and is_white_move) or (player_color == 'black' and not is_white_move)

        if not is_player_move:
            continue

        # Parse judgment from the move SAN (e.g., "Nbd2??", "b5?", "Bb3?!")
        # The annotation is part of the move string, not the comment
        move_san = node.san()
        if not move_san:
            continue

        # Look for ?? (blunder), ?! (inaccuracy), ? (mistake)
        # Order matters: check ?? before ?, check ?! before ?
        judgment = None
        if '??' in move_san:
            judgment = 'blunder'
        elif '?!' in move_san:
            judgment = 'inaccuracy'
        elif '?' in move_san:
            judgment = 'mistake'

        if not judgment:
            continue

        # Determine phase
        if move_num < middle_start:
            phase = 'opening'
        elif move_num < end_start:
            phase = 'middlegame'
        else:
            phase = 'endgame'

        # Increment counter
        key = f"{phase}_{judgment}s"
        if key in errors:
            errors[key] += 1

    return errors


def calculate_time_usage_per_phase(clocks: List[int], division_dict: Dict[str, int],
                                     player_color: str, total_moves: int) -> Dict[str, float]:
    """
    Calculate percentage of time used in each phase.

    Args:
        clocks: List of clock times in centiseconds
        division_dict: {'middle': X, 'end': Y}
        player_color: 'white' or 'black'
        total_moves: Total number of moves in the game

    Returns:
        Dict with percent_time_used_in_opening, middlegame, endgame
    """
    if not clocks or len(clocks) < 2:
        return {
            'percent_time_used_in_opening': 0.0,
            'percent_time_used_in_middlegame': 0.0,
            'percent_time_used_in_endgame': 0.0
        }

    middle_start = division_dict.get('middle', 15)
    end_start = division_dict.get('end', 40)

    # Player's clock indices (white: 0, 2, 4...; black: 1, 3, 5...)
    start_idx = 0 if player_color == 'white' else 1
    player_clocks = []

    for i in range(start_idx, len(clocks), 2):
        if i < len(clocks):
            player_clocks.append(clocks[i])

    if len(player_clocks) < 2:
        return {
            'percent_time_used_in_opening': 0.0,
            'percent_time_used_in_middlegame': 0.0,
            'percent_time_used_in_endgame': 0.0
        }

    # Calculate time spent in each phase
    initial_time = player_clocks[0]
    opening_time = 0
    middlegame_time = 0
    endgame_time = 0

    for i in range(len(player_clocks) - 1):
        move_ply = (i * 2) + (1 if player_color == 'white' else 2)
        time_spent = player_clocks[i] - player_clocks[i + 1]

        if move_ply < middle_start:
            opening_time += time_spent
        elif move_ply < end_start:
            middlegame_time += time_spent
        else:
            endgame_time += time_spent

    total_time_spent = opening_time + middlegame_time + endgame_time

    if total_time_spent == 0:
        return {
            'percent_time_used_in_opening': 0.0,
            'percent_time_used_in_middlegame': 0.0,
            'percent_time_used_in_endgame': 0.0
        }

    return {
        'percent_time_used_in_opening': opening_time / total_time_spent,
        'percent_time_used_in_middlegame': middlegame_time / total_time_spent,
        'percent_time_used_in_endgame': endgame_time / total_time_spent
    }


def build_enriched_game_for_player(game_data: Dict, game_metadata: Dict) -> Optional[Dict]:
    """
    Build enriched game data in the format expected by principles_analyzer.py.

    This creates the minimal structure needed for principles analysis.

    Args:
        game_data: Dict with 'movetext' key
        game_metadata: Dict with 'winner', 'id', 'white_elo', 'black_elo', 'opening_eco', 'opening_name'

    Returns:
        Dict in format compatible with ChessPrinciplesAnalyzer
    """
    movetext = game_data.get('movetext', '')
    if not movetext:
        return None

    # Parse game
    game_pgn = parse_movetext_to_game(movetext)
    if not game_pgn:
        return None

    # Convert game to list of board positions for GameDivider
    boards = []
    board = game_pgn.board()
    boards.append(board.copy())

    for move in game_pgn.mainline_moves():
        board.push(move)
        boards.append(board.copy())

    # Use GameDivider to get phase boundaries
    divider = GameDivider()
    division = divider.divide_game(boards)

    # Handle cases where division boundaries are None (very short games)
    # Principles analyzer requires non-None values, so set defaults
    if division.middle is None:
        division.middle = min(15, len(boards) - 1)
    if division.end is None:
        division.end = min(40, len(boards) - 1)

    # Build analysis array by parsing move annotations and comments
    analysis = []
    clocks = []
    moves_list = []

    node = game_pgn
    while node.variations:
        node = node.variation(0)

        move_san = node.san()
        moves_list.append(move_san)
        comment = node.comment if node.comment else ""

        # Parse judgment from NAGs (Numeric Annotation Glyphs)
        # NAG 6 = ?! (Inaccuracy), NAG 2 = ? (Mistake), NAG 4 = ?? (Blunder)
        judgment_name = None
        if 4 in node.nags:  # Blunder (??)
            judgment_name = 'Blunder'
        elif 2 in node.nags:  # Mistake (?)
            judgment_name = 'Mistake'
        elif 6 in node.nags:  # Inaccuracy (?!)
            judgment_name = 'Inaccuracy'

        # Parse eval and clock from comment
        eval_cp = None
        mate_val = None

        if '[%eval' in comment:
            eval_cp, mate_val = parse_eval_string(comment)

        if '[%clk' in comment:
            clock_cs = parse_clock_string(comment)
            clocks.append(clock_cs)

        # Build analysis entry
        analysis_entry = {
            'judgment': {'name': judgment_name} if judgment_name else {},
            'eval': eval_cp,
            'mate': mate_val
        }

        analysis.append(analysis_entry)

    # Build enriched format compatible with principles_analyzer
    winner = game_metadata.get('winner')
    termination = game_metadata.get('termination')

    # Determine game status from final position, winner, clocks, and termination
    status = determine_game_status(game_pgn, winner, clocks, termination)

    return {
        'raw_json': {
            'id': game_metadata.get('id', 'unknown'),
            'players': {
                'white': {
                    'user': {'name': 'white_player'},
                    'rating': game_metadata.get('white_elo', 1500)
                },
                'black': {
                    'user': {'name': 'black_player'},
                    'rating': game_metadata.get('black_elo', 1500)
                }
            },
            'division': {
                'middle': division.middle,
                'end': division.end
            },
            'analysis': analysis,
            'clocks': clocks,
            'opening': {
                'eco': game_metadata.get('opening_eco', 'Unknown'),
                'name': game_metadata.get('opening_name', 'Unknown')
            },
            'status': status,
            'winner': winner,
            'moves': ' '.join(moves_list)
        }
    }


def analyze_game(game_data: Dict, player_color: str, game_metadata: Dict, elo_range: str = None) -> Optional[Dict]:
    """
    Analyze a single player's performance in a game using principles_analyzer logic.

    Args:
        game_data: Dict with 'movetext' key
        player_color: 'white' or 'black'
        game_metadata: Dict with 'winner', 'id', 'white_elo', 'black_elo', 'opening_eco', 'opening_name'
        elo_range: ELO range string (e.g., "800-900") to prevent file not found warnings

    Returns dict with all metrics for this player.
    """
    from analysis.chess_analysis.principles_analyzer import ChessPrinciplesAnalyzer

    # Build enriched game format
    enriched_game = build_enriched_game_for_player(game_data, game_metadata)
    if not enriched_game:
        return None

    # Create a minimal ChessPrinciplesAnalyzer instance
    # We'll use a fake username that matches the player color
    fake_username = 'white_player' if player_color == 'white' else 'black_player'

    # Set the user's name in the enriched game
    enriched_game['raw_json']['players'][player_color]['user']['name'] = fake_username

    # Create analyzer with this single game
    try:
        analyzer = ChessPrinciplesAnalyzer(
            enriched_games=[enriched_game],
            username=fake_username,
            elo_range=elo_range  # Pass through the ELO range to prevent warnings
        )

        # Extract metrics using principles analyzer methods
        metrics = {}

        # Opening awareness (errors per phase)
        opening_result = analyzer.calculate_opening_awareness()
        if opening_result and 'raw_metrics' in opening_result:
            raw = opening_result['raw_metrics']
            metrics['opening_inaccuracies'] = raw.get('avg_opening_inaccuracies', 0)
            metrics['opening_mistakes'] = raw.get('avg_opening_mistakes', 0)
            metrics['opening_blunders'] = raw.get('avg_opening_blunders', 0)

        # Middlegame planning
        middlegame_result = analyzer.calculate_middlegame_planning()
        if middlegame_result and 'raw_metrics' in middlegame_result:
            raw = middlegame_result['raw_metrics']
            metrics['middlegame_inaccuracies'] = raw.get('avg_middlegame_inaccuracies', 0)
            metrics['middlegame_mistakes'] = raw.get('avg_middlegame_mistakes', 0)
            metrics['middlegame_blunders'] = raw.get('avg_middlegame_blunders', 0)

        # Endgame technique
        endgame_result = analyzer.calculate_endgame_technique()
        if endgame_result and 'raw_metrics' in endgame_result:
            raw = endgame_result['raw_metrics']
            metrics['endgame_inaccuracies'] = raw.get('avg_endgame_inaccuracies', 0)
            metrics['endgame_mistakes'] = raw.get('avg_endgame_mistakes', 0)
            metrics['endgame_blunders'] = raw.get('avg_endgame_blunders', 0)

        # Time management
        time_result = analyzer.calculate_time_management()
        if time_result and 'raw_metrics' in time_result:
            raw = time_result['raw_metrics']
            # Don't use timeout_rate from principles_analyzer - we calculate it from termination data
            metrics['time_pressure_blunder_rate'] = raw.get('time_pressure_blunder_rate', 0)

        # King safety
        king_safety_result = analyzer.calculate_king_safety()
        if king_safety_result and 'raw_metrics' in king_safety_result:
            raw = king_safety_result['raw_metrics']
            metrics['checkmate_rate'] = raw.get('checkmated_rate', 0)

        # Checkmate ability
        checkmate_ability_result = analyzer.calculate_checkmate_ability()
        if checkmate_ability_result and 'raw_metrics' in checkmate_ability_result:
            raw = checkmate_ability_result['raw_metrics']
            metrics['mate_conversion_rate'] = raw.get('conversion_rate', 0)

        # Defensive skill
        defensive_result = analyzer.calculate_defensive_skill()
        if defensive_result and 'raw_metrics' in defensive_result:
            raw = defensive_result['raw_metrics']
            metrics['comeback_rate'] = raw.get('comeback_rate', 0)

        # Precision and move quality
        precision_result = analyzer.calculate_precision_move_quality()
        if precision_result and 'raw_metrics' in precision_result:
            raw = precision_result['raw_metrics']
            metrics['eval_volatility'] = raw.get('avg_eval_volatility', 0)

        # Planning/calculating
        planning_result = analyzer.calculate_planning_calculating()
        if planning_result and 'raw_metrics' in planning_result:
            raw = planning_result['raw_metrics']
            metrics['quiet_move_quality'] = raw.get('avg_quiet_move_eval_change', 0)

        # Calculate time usage per phase manually (not in principles_analyzer)
        division_dict = {
            'middle': enriched_game['raw_json']['division']['middle'],
            'end': enriched_game['raw_json']['division']['end']
        }
        clocks = enriched_game['raw_json']['clocks']
        total_moves = len(enriched_game['raw_json']['analysis'])

        time_metrics = calculate_time_usage_per_phase(clocks, division_dict, player_color, total_moves)
        metrics.update(time_metrics)

        # Calculate termination statistics from game status and winner
        status = enriched_game['raw_json'].get('status', '')
        winner = game_metadata.get('winner')

        # Determine if player won, lost, or drew
        player_won = winner == player_color
        player_lost = (player_color == 'white' and winner == 'black') or (player_color == 'black' and winner == 'white')
        is_draw = winner is None or winner == 'draw'

        # Initialize all termination metrics to 0
        metrics['win_by_checkmate'] = 0
        metrics['win_by_resignation'] = 0
        metrics['win_by_timeout'] = 0
        metrics['loss_by_checkmate'] = 0
        metrics['loss_by_resignation'] = 0
        metrics['loss_by_timeout'] = 0
        metrics['draw_by_stalemate'] = 0
        metrics['draw_by_agreement'] = 0
        metrics['draw_by_repetition'] = 0
        metrics['draw_by_50move'] = 0
        metrics['draw_by_insufficient_material'] = 0

        # Set the appropriate termination flag to 1
        if player_won:
            if status == 'mate':
                metrics['win_by_checkmate'] = 1
            elif status == 'resign':
                metrics['win_by_resignation'] = 1
            elif status == 'timeout':
                metrics['win_by_timeout'] = 1
        elif player_lost:
            if status == 'mate':
                metrics['loss_by_checkmate'] = 1
            elif status == 'resign':
                metrics['loss_by_resignation'] = 1
            elif status == 'timeout':
                metrics['loss_by_timeout'] = 1
        elif is_draw:
            if status == 'stalemate':
                metrics['draw_by_stalemate'] = 1
            elif status == 'draw':
                # Need to determine the type of draw from the ending
                # The status is determined by determine_game_status function
                # which returns 'draw', 'repetition', 'fifty-move', 'insufficient'
                # But we're getting it from the enriched game status field
                # Let's check the actual game ending
                if status == 'draw':
                    metrics['draw_by_agreement'] = 1
            elif status == 'repetition':
                metrics['draw_by_repetition'] = 1
            elif status == 'fifty-move':
                metrics['draw_by_50move'] = 1
            elif status == 'insufficient':
                metrics['draw_by_insufficient_material'] = 1

        # Calculate timeout_rate - percentage of games that end in timeout (win or lose)
        metrics['timeout_rate'] = 1 if status == 'timeout' else 0

        return metrics

    except Exception as e:
        print(f"Error analyzing game with principles_analyzer: {e}")
        return None




def generate_elo_stats(db_path: str, elo_min: int, elo_max: int, sample_size: int = 1000, elo_range_name: str = None):
    """
    Generate statistics for a specific ELO range.

    Queries white and black players separately, analyzes only the player
    in the ELO range for each game.

    sample_size is per speed category (bullet, blitz, rapid).
    elo_range_name: Optional name for the ELO range (e.g., "below-600", "2400+"). If not provided, will be generated as "{elo_min}-{elo_max}".

    Returns nested dict organized by time control (bullet, blitz, rapid).
    """
    # Use provided range name or construct one
    if elo_range_name is None:
        elo_range_name = f"{elo_min}-{elo_max}"

    print(f"Generating stats for ELO {elo_range_name}...")
    print(f"Sampling {sample_size} games per color per speed from database...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Collect games for each speed category
    white_games = []
    black_games = []

    for speed in ['bullet', 'blitz', 'rapid']:
        # Query random sample of games where WHITE player is in this ELO range and speed
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
            ORDER BY RANDOM()
            LIMIT ?
        """

        cursor.execute(white_query, (elo_min, elo_max, speed, sample_size))
        white_speed_games = cursor.fetchall()
        white_games.extend(white_speed_games)
        print(f"  Retrieved {len(white_speed_games)} {speed} games with white players in range")

        # Query random sample of games where BLACK player is in this ELO range and speed
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
            ORDER BY RANDOM()
            LIMIT ?
        """

        cursor.execute(black_query, (elo_min, elo_max, speed, sample_size))
        black_speed_games = cursor.fetchall()
        black_games.extend(black_speed_games)
        print(f"  Retrieved {len(black_speed_games)} {speed} games with black players in range")

    if not white_games and not black_games:
        print("  No games found in this ELO range!")
        conn.close()
        return {}

    # Organize data by speed
    speed_data = {
        'bullet': [],
        'blitz': [],
        'rapid': []
    }

    # Process white player games
    print(f"  Analyzing white players...")
    for idx, row in enumerate(white_games):
        if (idx + 1) % 100 == 0:
            print(f"    Processing white game {idx + 1}/{len(white_games)}...")

        game_id, white_elo, black_elo, speed, opening_name, winner, opening_eco, termination, game_data_json = row

        if speed not in speed_data:
            continue

        # Parse game_data JSON
        try:
            game_data = json.loads(game_data_json)
        except:
            continue

        # Analyze ONLY the white player (who is in the ELO range)
        game_metadata = {
            'winner': winner,
            'id': game_id,
            'white_elo': white_elo,
            'black_elo': black_elo,
            'opening_eco': opening_eco,
            'opening_name': opening_name,
            'termination': termination
        }
        white_stats = analyze_game(game_data, 'white', game_metadata, elo_range_name)
        if white_stats:
            speed_data[speed].append(white_stats)

    # Process black player games
    print(f"  Analyzing black players...")
    for idx, row in enumerate(black_games):
        if (idx + 1) % 100 == 0:
            print(f"    Processing black game {idx + 1}/{len(black_games)}...")

        game_id, white_elo, black_elo, speed, opening_name, winner, opening_eco, termination, game_data_json = row

        if speed not in speed_data:
            continue

        # Parse game_data JSON
        try:
            game_data = json.loads(game_data_json)
        except:
            continue

        # Analyze ONLY the black player (who is in the ELO range)
        game_metadata = {
            'winner': winner,
            'id': game_id,
            'white_elo': white_elo,
            'black_elo': black_elo,
            'opening_eco': opening_eco,
            'opening_name': opening_name,
            'termination': termination
        }
        black_stats = analyze_game(game_data, 'black', game_metadata, elo_range_name)
        if black_stats:
            speed_data[speed].append(black_stats)

    # Calculate distributions for each speed
    result = {}

    for speed, player_stats_list in speed_data.items():
        if not player_stats_list:
            print(f"  Skipping {speed} (no data)")
            continue

        print(f"  Calculating distributions for {speed}: {len(player_stats_list)} data points")

        speed_result = {}

        # Error metrics per phase
        error_metrics = [
            'opening_inaccuracies', 'opening_mistakes', 'opening_blunders',
            'middlegame_inaccuracies', 'middlegame_mistakes', 'middlegame_blunders',
            'endgame_inaccuracies', 'endgame_mistakes', 'endgame_blunders'
        ]

        for metric in error_metrics:
            values = [stats[metric] for stats in player_stats_list if metric in stats]
            speed_result[f"{metric}_per_game"] = calculate_stats(values)

        # Time usage metrics (now calculated from movetext)
        time_metrics = [
            'percent_time_used_in_opening',
            'percent_time_used_in_middlegame',
            'percent_time_used_in_endgame'
        ]

        for metric in time_metrics:
            values = [stats[metric] for stats in player_stats_list if metric in stats and stats[metric] > 0]
            if values:
                speed_result[metric] = calculate_stats(values)
            else:
                speed_result[metric] = {"mean": 0.0, "std": 0.0, "skew": 0.0}

        # Extract metrics from principles_analyzer
        principles_metrics = [
            'checkmate_rate',
            'mate_conversion_rate',
            'comeback_rate',
            'eval_volatility',
            'quiet_move_quality',
            'timeout_rate',
            'time_pressure_blunder_rate',
        ]

        for metric in principles_metrics:
            values = [stats[metric] for stats in player_stats_list if metric in stats]
            if values:
                speed_result[metric] = calculate_stats(values)
            else:
                speed_result[metric] = {"mean": 0.0, "std": 0.0, "skew": 0.0}

        # Termination statistics (as conditional rates)
        # Calculate rates conditional on outcome type (win/loss/draw)

        # Separate games by outcome
        wins = [stats for stats in player_stats_list if stats.get('win_by_checkmate', 0) + stats.get('win_by_resignation', 0) + stats.get('win_by_timeout', 0) > 0]
        losses = [stats for stats in player_stats_list if stats.get('loss_by_checkmate', 0) + stats.get('loss_by_resignation', 0) + stats.get('loss_by_timeout', 0) > 0]
        draws = [stats for stats in player_stats_list if stats.get('draw_by_stalemate', 0) + stats.get('draw_by_agreement', 0) + stats.get('draw_by_repetition', 0) + stats.get('draw_by_50move', 0) + stats.get('draw_by_insufficient_material', 0) > 0]

        # Win termination rates (conditional on winning)
        if wins:
            total_wins = len(wins)
            wins_by_checkmate = sum(1 for stats in wins if stats.get('win_by_checkmate', 0) > 0)
            wins_by_resignation = sum(1 for stats in wins if stats.get('win_by_resignation', 0) > 0)
            wins_by_timeout = sum(1 for stats in wins if stats.get('win_by_timeout', 0) > 0)

            speed_result['win_by_checkmate_rate'] = round(wins_by_checkmate / total_wins, 3)
            speed_result['win_by_resignation_rate'] = round(wins_by_resignation / total_wins, 3)
            speed_result['win_by_timeout_rate'] = round(wins_by_timeout / total_wins, 3)
        else:
            speed_result['win_by_checkmate_rate'] = 0.0
            speed_result['win_by_resignation_rate'] = 0.0
            speed_result['win_by_timeout_rate'] = 0.0

        # Loss termination rates (conditional on losing)
        if losses:
            total_losses = len(losses)
            losses_by_checkmate = sum(1 for stats in losses if stats.get('loss_by_checkmate', 0) > 0)
            losses_by_resignation = sum(1 for stats in losses if stats.get('loss_by_resignation', 0) > 0)
            losses_by_timeout = sum(1 for stats in losses if stats.get('loss_by_timeout', 0) > 0)

            speed_result['loss_by_checkmate_rate'] = round(losses_by_checkmate / total_losses, 3)
            speed_result['loss_by_resignation_rate'] = round(losses_by_resignation / total_losses, 3)
            speed_result['loss_by_timeout_rate'] = round(losses_by_timeout / total_losses, 3)
        else:
            speed_result['loss_by_checkmate_rate'] = 0.0
            speed_result['loss_by_resignation_rate'] = 0.0
            speed_result['loss_by_timeout_rate'] = 0.0

        # Draw termination rates (conditional on drawing)
        if draws:
            total_draws = len(draws)
            draws_by_stalemate = sum(1 for stats in draws if stats.get('draw_by_stalemate', 0) > 0)
            draws_by_agreement = sum(1 for stats in draws if stats.get('draw_by_agreement', 0) > 0)
            draws_by_repetition = sum(1 for stats in draws if stats.get('draw_by_repetition', 0) > 0)
            draws_by_50move = sum(1 for stats in draws if stats.get('draw_by_50move', 0) > 0)
            draws_by_insufficient = sum(1 for stats in draws if stats.get('draw_by_insufficient_material', 0) > 0)

            speed_result['draw_by_stalemate_rate'] = round(draws_by_stalemate / total_draws, 3)
            speed_result['draw_by_agreement_rate'] = round(draws_by_agreement / total_draws, 3)
            speed_result['draw_by_repetition_rate'] = round(draws_by_repetition / total_draws, 3)
            speed_result['draw_by_50move_rate'] = round(draws_by_50move / total_draws, 3)
            speed_result['draw_by_insufficient_material_rate'] = round(draws_by_insufficient / total_draws, 3)
        else:
            speed_result['draw_by_stalemate_rate'] = 0.0
            speed_result['draw_by_agreement_rate'] = 0.0
            speed_result['draw_by_repetition_rate'] = 0.0
            speed_result['draw_by_50move_rate'] = 0.0
            speed_result['draw_by_insufficient_material_rate'] = 0.0

        result[speed] = speed_result

    conn.close()
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Generate ELO-range-specific statistics from Lichess games database.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate stats for ELO 800-900 with default settings
  python generate_elo_stats.py /data/lichess_games.db 800 900

  # Generate stats with custom sample size and output path
  python generate_elo_stats.py /data/lichess_games.db 800 900 --sample-size 1000 --output static/data/elo_averages/800-900.json

Note: Opening-specific statistics are now generated separately using generate_opening_stats.py
        """
    )

    parser.add_argument('db_path', help='Path to the SQLite database file')
    parser.add_argument('elo_min', type=int, help='Minimum ELO rating (inclusive)')
    parser.add_argument('elo_max', type=int, help='Maximum ELO rating (exclusive)')
    parser.add_argument('--sample-size', '-s', type=int, default=1000,
                        help='Number of games to sample per color per speed (default: 1000)')
    parser.add_argument('--output', '-o', type=str, default=None,
                        help='Output file path (default: static/data/elo_averages/{elo_min}-{elo_max}.json)')
    parser.add_argument('--elo-range-name', type=str, default=None,
                        help='Custom name for ELO range (e.g., "below-600", "2400+")')

    args = parser.parse_args()

    # Set default output path if not provided
    if args.output is None:
        args.output = f"static/data/elo_averages/{args.elo_min}-{args.elo_max}.json"

    # Generate stats
    stats = generate_elo_stats(
        args.db_path,
        args.elo_min,
        args.elo_max,
        args.sample_size,
        elo_range_name=args.elo_range_name
    )

    if not stats:
        print("ERROR: No statistics generated")
        sys.exit(1)

    # Write output
    output_file = Path(args.output)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"\n✓ Written to {args.output}")


if __name__ == "__main__":
    main()
