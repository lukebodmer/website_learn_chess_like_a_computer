"""
Game phase divider implementation based on Lichess logic.
Determines opening, middlegame, and endgame transitions.
"""

import chess
from typing import List, Optional, Tuple, Dict


class GameDivision:
    """Represents the division of a game into opening, middle, and endgame phases"""

    def __init__(self, middle: Optional[int] = None, end: Optional[int] = None, total_plies: int = 0):
        self.middle = middle  # Ply where middlegame starts
        self.end = end       # Ply where endgame starts
        self.total_plies = total_plies

    def to_dict(self) -> Dict:
        """Convert to dictionary format matching Lichess structure"""
        result = {}
        if self.middle is not None:
            result["middle"] = self.middle
        if self.end is not None:
            result["end"] = self.end
        return result

    @property
    def opening_size(self) -> int:
        """Number of plies in the opening"""
        return self.middle if self.middle is not None else self.total_plies

    @property
    def middlegame_size(self) -> Optional[int]:
        """Number of plies in the middlegame"""
        if self.middle is None:
            return None
        end_ply = self.end if self.end is not None else self.total_plies
        return end_ply - self.middle

    @property
    def endgame_size(self) -> Optional[int]:
        """Number of plies in the endgame"""
        if self.end is None:
            return None
        return self.total_plies - self.end


class GameDivider:
    """Calculates game phase divisions based on board positions"""

    @staticmethod
    def divide_game(boards: List[chess.Board]) -> GameDivision:
        """
        Analyze a list of board positions and determine phase transitions.

        Args:
            boards: List of board positions throughout the game

        Returns:
            GameDivision object with middle and end game transition points
        """
        if not boards:
            return GameDivision()

        indexed_boards = list(enumerate(boards))

        # Find middlegame start
        middlegame_start = None
        for index, board in indexed_boards:
            if (GameDivider._count_majors_and_minors(board) <= 10 or
                GameDivider._is_backrank_sparse(board) or
                GameDivider._calculate_mixedness(board) > 150):
                middlegame_start = index
                break

        # Find endgame start (only if middlegame started)
        endgame_start = None
        if middlegame_start is not None:
            for index, board in indexed_boards:
                if index >= middlegame_start and GameDivider._count_majors_and_minors(board) <= 6:
                    endgame_start = index
                    break

        return GameDivision(
            middle=middlegame_start,
            end=endgame_start,
            total_plies=len(boards)
        )

    @staticmethod
    def _count_majors_and_minors(board: chess.Board) -> int:
        """Count major and minor pieces (excluding kings and pawns)"""
        # Get all occupied squares except kings and pawns
        majors_and_minors = board.occupied & ~(board.kings | board.pawns)
        return bin(majors_and_minors).count('1')

    @staticmethod
    def _is_backrank_sparse(board: chess.Board) -> bool:
        """Check if back ranks have been developed (fewer than 4 pieces)"""
        # First rank (white's back rank)
        first_rank = 0xFF  # Rank 1: a1-h1
        white_backrank_pieces = bin(first_rank & board.occupied_co[chess.WHITE]).count('1')

        # Eighth rank (black's back rank)
        eighth_rank = 0xFF << 56  # Rank 8: a8-h8
        black_backrank_pieces = bin(eighth_rank & board.occupied_co[chess.BLACK]).count('1')

        return white_backrank_pieces < 4 or black_backrank_pieces < 4

    @staticmethod
    def _calculate_mixedness(board: chess.Board) -> int:
        """
        Calculate mixedness score based on piece distribution.
        Higher scores indicate more developed/mixed positions.
        """
        total_score = 0

        # Check 2x2 regions across the board
        for y in range(7):  # 0-6 (7 possible positions for 2x2 square)
            for x in range(7):  # 0-6
                # Create 2x2 square mask
                square_mask = 0
                for dy in range(2):
                    for dx in range(2):
                        square = (y + dy) * 8 + (x + dx)
                        if 0 <= square < 64:
                            square_mask |= (1 << square)

                # Count white and black pieces in this region
                white_count = bin(square_mask & board.occupied_co[chess.WHITE]).count('1')
                black_count = bin(square_mask & board.occupied_co[chess.BLACK]).count('1')

                # Apply scoring function
                region_score = GameDivider._score_region(y + 1, white_count, black_count)
                total_score += region_score

        return total_score

    @staticmethod
    def _score_region(y: int, white_count: int, black_count: int) -> int:
        """
        Score a 2x2 region based on piece distribution.
        Based on the Lichess scoring function.
        """
        if white_count == 0 and black_count == 0:
            return 0

        # Single piece scenarios
        if white_count == 1 and black_count == 0:
            return 1 + (8 - y)
        if white_count == 0 and black_count == 1:
            return 1 + y

        # Two pieces scenarios
        if white_count == 2 and black_count == 0:
            return (2 + (y - 2)) if y > 2 else 0
        if white_count == 0 and black_count == 2:
            return (2 + (6 - y)) if y < 6 else 0
        if white_count == 1 and black_count == 1:
            return 5 + abs(4 - y)

        # Three pieces scenarios
        if white_count == 3 and black_count == 0:
            return (3 + (y - 1)) if y > 1 else 0
        if white_count == 0 and black_count == 3:
            return (3 + (7 - y)) if y < 7 else 0
        if white_count == 2 and black_count == 1:
            return 4 + (y - 1)
        if white_count == 1 and black_count == 2:
            return 4 + (7 - y)
        if white_count == 3 and black_count == 1:
            return 5 + (y - 1)
        if white_count == 1 and black_count == 3:
            return 5 + (7 - y)

        # Four pieces scenarios
        if white_count == 4 and black_count == 0:
            return (3 + (y - 1)) if y > 1 else 0  # Group of 4 on homerow = 0
        if white_count == 0 and black_count == 4:
            return (3 + (7 - y)) if y < 7 else 0
        if white_count == 2 and black_count == 2:
            return 7

        # Default case
        return 0


def divide_game_from_moves(moves: List[str], starting_fen: Optional[str] = None) -> GameDivision:
    """
    Convenience function to divide a game from a list of moves.

    Args:
        moves: List of moves in SAN notation
        starting_fen: Starting position FEN (if not standard)

    Returns:
        GameDivision object
    """
    # Create board from starting position
    board = chess.Board(starting_fen) if starting_fen else chess.Board()
    boards = [board.copy()]

    # Apply each move and capture board states
    for move_san in moves:
        try:
            move = board.parse_san(move_san)
            board.push(move)
            boards.append(board.copy())
        except ValueError:
            # Skip invalid moves
            continue

    return GameDivider.divide_game(boards)


def divide_game_from_pgn_moves(moves_string: str) -> GameDivision:
    """
    Divide a game from PGN-style moves string.

    Args:
        moves_string: String containing moves like "1.e4 e5 2.Nf3 Nc6..."

    Returns:
        GameDivision object
    """
    import re

    # Clean the moves string - remove move numbers and extra spaces
    moves_clean = re.sub(r'\d+\.+', '', moves_string)
    moves_clean = re.sub(r'\s+', ' ', moves_clean).strip()
    moves = moves_clean.split()

    # Filter out any remaining artifacts
    valid_moves = []
    for move in moves:
        if move and not move.isdigit() and '.' not in move:
            valid_moves.append(move)

    return divide_game_from_moves(valid_moves)