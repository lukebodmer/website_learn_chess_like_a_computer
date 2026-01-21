"""
Opening classification utilities for chess games.

This module provides functionality to classify chess openings using FEN-based
backward matching against the Lichess ECO database. It handles transpositions
and provides detailed opening information including ECO codes, names, and positions.
"""

import os
import csv
import re
import json
from django.conf import settings


# Global cache for opening database
_opening_database = None


def load_opening_database():
    """Load and parse the lichess ECO database with FEN positions"""
    global _opening_database

    if _opening_database is not None:
        return _opening_database

    try:
        # Path to the TSV file
        tsv_path = os.path.join(settings.BASE_DIR, 'static', 'data', 'openings', 'lichess_eco_database.tsv')

        _opening_database = []

        with open(tsv_path, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file, delimiter='\t')
            for row in reader:
                # Extract moves from PGN and convert to list
                pgn_moves = row['pgn'].strip()
                epd_fen = row['epd'].strip()

                if not pgn_moves or not epd_fen:
                    continue

                # Remove move numbers like "1. ", "2. " etc and split into moves
                # Handle patterns like "1. Nh3", "1. Nh3 d5 2. g3 e5 3. f4"
                moves_only = re.sub(r'\d+\.\s*', '', pgn_moves).strip()
                moves_list = moves_only.split() if moves_only else []

                _opening_database.append({
                    'eco': row['eco'].strip(),
                    'name': row['name'].strip(),
                    'moves': ' '.join(moves_list),  # Store as space-separated string
                    'ply_count': len(moves_list),
                    'fen': epd_fen
                })

        # Sort by ply count descending for backward matching (deepest positions first)
        _opening_database.sort(key=lambda x: x['ply_count'], reverse=True)

        print(f"Loaded {len(_opening_database)} openings from database")

        return _opening_database

    except Exception as e:
        print(f"Error loading opening database: {e}")
        return []


def normalize_fen(fen):
    """Normalize FEN by removing move counters and keeping only position data"""
    # FEN format: position castling en_passant halfmove fullmove
    # Database EPD format: position castling en_passant halfmove (no fullmove)
    # We want to match the database format
    parts = fen.split()
    if len(parts) >= 4:
        return ' '.join(parts[:4])  # Keep position, castling, en_passant, halfmove
    return fen


def moves_to_fen_positions(moves_string):
    """Convert a moves string to a list of normalized FEN positions at each move"""
    if not moves_string:
        return []

    try:
        import chess

        board = chess.Board()
        fen_positions = []

        moves_list = moves_string.strip().split()

        for move_str in moves_list:
            try:
                move = board.parse_san(move_str)
                board.push(move)
                # Normalize FEN to match database format
                normalized_fen = normalize_fen(board.fen())
                fen_positions.append(normalized_fen)
            except (chess.InvalidMoveError, chess.IllegalMoveError):
                # Stop at first invalid move
                break

        return fen_positions

    except Exception as e:
        print(f"Error converting moves to FEN: {e}")
        return []


def classify_opening_by_moves(moves_string):
    """
    Classify opening by FEN-based backward matching (handles transpositions)

    Args:
        moves_string: Space-separated moves like "Nf3 e6 e4 d5 e5 c5"

    Returns:
        dict with 'eco', 'name', 'ply', 'fen', and 'moves' keys (moves is a space-separated string)
    """
    if not moves_string:
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0, 'fen': '', 'moves': ''}

    try:
        database = load_opening_database()
        if not database:
            return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0, 'fen': '', 'moves': ''}

        # Convert moves to FEN positions
        fen_positions = moves_to_fen_positions(moves_string)
        if not fen_positions:
            return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0, 'fen': '', 'moves': ''}

        # Try backward matching - start from move 20 (40th ply) or end of game, whichever is shorter
        max_check_moves = min(40, len(fen_positions))

        # Go backwards through positions to find the deepest (most specific) match
        for check_ply in range(max_check_moves, 0, -1):
            game_fen = fen_positions[check_ply - 1]  # Convert to 0-based index

            # Look for exact FEN match in database
            for opening in database:
                if opening['ply_count'] == check_ply and opening['fen'] == game_fen:
                    return {
                        'eco': opening['eco'],
                        'name': opening['name'],
                        'ply': opening['ply_count'],
                        'fen': opening['fen'],
                        'moves': opening['moves']
                    }

        # No match found
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0, 'fen': '', 'moves': ''}

    except Exception as e:
        print(f"Error classifying opening: {e}")
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0, 'fen': '', 'moves': ''}


def lookup_opening_in_database(eco, name, ply):
    """
    Look up opening in database by ECO, name, and ply to get FEN and moves

    Args:
        eco: ECO code like "A00"
        name: Opening name like "Amar Opening"
        ply: Ply count

    Returns:
        dict with 'fen' and 'moves' keys (moves is a space-separated string), or empty strings if not found
    """
    try:
        database = load_opening_database()
        if not database:
            return {'fen': '', 'moves': ''}

        # Try exact match on all three fields
        for opening in database:
            if (opening['eco'] == eco and
                opening['name'] == name and
                opening['ply_count'] == ply):
                return {
                    'fen': opening['fen'],
                    'moves': opening['moves']
                }

        # If no exact match, try matching just ECO and ply
        for opening in database:
            if opening['eco'] == eco and opening['ply_count'] == ply:
                return {
                    'fen': opening['fen'],
                    'moves': opening['moves']
                }

        # No match found
        return {'fen': '', 'moves': ''}

    except Exception as e:
        print(f"Error looking up opening in database: {e}")
        return {'fen': '', 'moves': ''}
