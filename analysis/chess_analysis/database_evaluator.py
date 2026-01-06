from django.db import connections
from typing import Dict, List, Optional, Tuple
import chess


class DatabaseEvaluator:
    """Query precomputed evaluations from the PostgreSQL database efficiently"""

    def __init__(self):
        self.db_name = 'evaluations'  # Use the Django database alias
        self.max_batch_size = 100  # Limit batch queries to avoid memory issues

    def truncate_fen(self, fen: str) -> str:
        """
        Truncate FEN to match database format (remove halfmove and fullmove counters)
        Example: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        -> 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
        """
        fen_parts = fen.split()
        if len(fen_parts) >= 4:
            # Return first 4 parts: position, active_color, castling, en_passant
            return ' '.join(fen_parts[:4])
        return fen

    def get_position_evaluation(self, fen: str) -> Optional[Dict]:
        """
        Get evaluation for a single FEN position from database
        Uses indexed lookup for performance
        """
        truncated_fen = self.truncate_fen(fen)
        with connections[self.db_name].cursor() as cursor:
            # Use indexed lookup on FEN, limit to 1 result for performance
            cursor.execute("""
                SELECT
                    p.fen,
                    d.depth,
                    d.knodes,
                    pv.cp as evaluation,
                    pv.mate,
                    pv.line
                FROM evaluations_position p
                JOIN evaluations_data d ON p.id = d.position_id
                JOIN evaluations_pv pv ON d.id = pv.evaluation_id
                WHERE p.fen = %s AND pv.pv_index = 0
                ORDER BY d.depth DESC, d.knodes DESC
                LIMIT 1
            """, [truncated_fen])

            row = cursor.fetchone()
            if row:
                fen, depth, knodes, evaluation, mate, line = row
                result = {
                    'fen': fen,
                    'depth': depth,
                    'knodes': knodes,
                    'evaluation': evaluation,
                    'mate': mate,
                    'line': line,
                    'source': 'database'
                }

                # Extract best move and variation to match Lichess format
                if line:
                    moves = line.split()
                    if moves:
                        # Convert first move from algebraic to UCI format for 'best'
                        try:
                            board = chess.Board(fen)
                            best_move_san = moves[0]
                            best_move = board.parse_san(best_move_san)
                            result['best'] = best_move.uci()
                            result['variation'] = line  # Use full line as variation
                        except:
                            # If conversion fails, fallback to original format
                            result['best'] = moves[0]
                            result['variation'] = line

                return result

        return None

    def get_multiple_position_evaluations(self, fens: List[str]) -> Dict[str, Dict]:
        """
        Get evaluations for multiple FEN positions in smaller batches
        Processes in chunks to avoid overwhelming the database
        """
        if not fens:
            return {}

        results = {}

        # Process FENs in smaller batches to avoid memory issues
        for i in range(0, len(fens), self.max_batch_size):
            batch_fens = fens[i:i + self.max_batch_size]
            batch_results = self._get_batch_evaluations(batch_fens)
            results.update(batch_results)

        return results

    def _get_batch_evaluations(self, fens: List[str]) -> Dict[str, Dict]:
        """Process a small batch of FEN positions"""
        if not fens:
            return {}

        # Create mapping from original FEN to truncated FEN
        truncated_fens = [self.truncate_fen(fen) for fen in fens]
        fen_mapping = {truncated: original for original, truncated in zip(fens, truncated_fens)}

        results = {}

        with connections[self.db_name].cursor() as cursor:
            placeholders = ','.join(['%s'] * len(truncated_fens))

            # Query with explicit LIMIT to control result size
            cursor.execute(f"""
                SELECT DISTINCT ON (p.fen)
                    p.fen,
                    d.depth,
                    d.knodes,
                    pv.cp as evaluation,
                    pv.mate,
                    pv.line
                FROM evaluations_position p
                JOIN evaluations_data d ON p.id = d.position_id
                JOIN evaluations_pv pv ON d.id = pv.evaluation_id
                WHERE p.fen IN ({placeholders}) AND pv.pv_index = 0
                ORDER BY p.fen, d.depth DESC, d.knodes DESC
                LIMIT {len(truncated_fens)}
            """, truncated_fens)

            for row in cursor.fetchall():
                db_fen, depth, knodes, evaluation, mate, line = row
                # Map back to original FEN for the results
                original_fen = fen_mapping[db_fen]
                result = {
                    'fen': original_fen,
                    'depth': depth,
                    'knodes': knodes,
                    'evaluation': evaluation,
                    'mate': mate,
                    'line': line,
                    'source': 'database'
                }

                # Extract best move and variation to match Lichess format
                if line:
                    moves = line.split()
                    if moves:
                        # Convert first move from algebraic to UCI format for 'best'
                        try:
                            board = chess.Board(db_fen)
                            best_move_san = moves[0]
                            best_move = board.parse_san(best_move_san)
                            result['best'] = best_move.uci()
                            result['variation'] = line  # Use full line as variation
                        except:
                            # If conversion fails, fallback to original format
                            result['best'] = moves[0]
                            result['variation'] = line

                results[original_fen] = result

        return results

    def check_positions_exist(self, fens: List[str]) -> Dict[str, bool]:
        """
        Efficiently check which positions exist without fetching full data
        Returns dict mapping FEN -> exists (bool)
        """
        if not fens:
            return {}

        exists_map = {}

        # Process in batches
        for i in range(0, len(fens), self.max_batch_size):
            batch_fens = fens[i:i + self.max_batch_size]
            batch_truncated = [self.truncate_fen(fen) for fen in batch_fens]
            truncated_to_original = {truncated: original for original, truncated in zip(batch_fens, batch_truncated)}

            with connections[self.db_name].cursor() as cursor:
                placeholders = ','.join(['%s'] * len(batch_truncated))

                # Simple EXISTS query - very fast with index
                cursor.execute(f"""
                    SELECT fen
                    FROM evaluations_position
                    WHERE fen IN ({placeholders})
                """, batch_truncated)

                found_truncated_fens = {row[0] for row in cursor.fetchall()}

                # Mark all in this batch based on truncated matches
                for truncated_fen, original_fen in truncated_to_original.items():
                    exists_map[original_fen] = truncated_fen in found_truncated_fens

        return exists_map

    def get_position_from_moves(self, moves: List[str], starting_fen: str = None) -> str:
        """Convert a sequence of moves to a FEN position"""
        try:
            if starting_fen:
                board = chess.Board(starting_fen)
            else:
                board = chess.Board()

            for move_str in moves:
                try:
                    move = board.parse_san(move_str)
                    board.push(move)
                except (chess.InvalidMoveError, chess.IllegalMoveError):
                    # Try UCI format as backup
                    try:
                        move = chess.Move.from_uci(move_str)
                        if move in board.legal_moves:
                            board.push(move)
                        else:
                            break
                    except:
                        break

            return board.fen()
        except Exception as e:
            print(f"Error converting moves to FEN: {e}")
            return chess.STARTING_FEN

    def get_game_positions_with_evaluations(self, moves: List[str]) -> Tuple[List[str], List[Optional[Dict]]]:
        """
        Get all positions from a game and their evaluations if available
        Returns tuple of (fens, evaluations) where evaluations may be None
        """
        # Generate FEN positions
        board = chess.Board()
        fens = [board.fen()]  # Starting position

        for move_str in moves:
            try:
                move = board.parse_san(move_str)
                board.push(move)
                fens.append(board.fen())
            except (chess.InvalidMoveError, chess.IllegalMoveError):
                try:
                    move = chess.Move.from_uci(move_str)
                    if move in board.legal_moves:
                        board.push(move)
                        fens.append(board.fen())
                    else:
                        break
                except:
                    break

        # Get evaluations for available positions
        evaluation_dict = self.get_multiple_position_evaluations(fens)

        # Create ordered list with None for missing evaluations
        evaluations = []
        for fen in fens:
            evaluations.append(evaluation_dict.get(fen))

        return fens, evaluations

    def get_database_connection_info(self) -> Dict:
        """Get basic info about database connectivity without heavy queries"""
        with connections[self.db_name].cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM evaluations_position LIMIT 1")
            # This will error if tables don't exist, success means connection works
            return {
                'connected': True,
                'database': self.db_name
            }