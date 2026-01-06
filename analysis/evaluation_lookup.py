"""
Utilities for looking up position evaluations and enriching game data
"""

from django.db.models import Prefetch
from .models import PositionEvaluation, EvaluationData, PrincipalVariation
import chess
import chess.pgn
from io import StringIO
from typing import List, Dict, Optional, Tuple


class EvaluationLookup:
    """Utility class for looking up position evaluations"""

    @staticmethod
    def get_position_evaluation(fen: str, max_pvs: int = 3) -> Optional[Dict]:
        """
        Get evaluation data for a specific position

        Args:
            fen: The FEN string of the position
            max_pvs: Maximum number of principal variations to return

        Returns:
            Dictionary with evaluation data or None if not found
        """
        try:
            position = PositionEvaluation.objects.using('evaluations').prefetch_related(
                Prefetch(
                    'evals',
                    queryset=EvaluationData.objects.prefetch_related(
                        Prefetch(
                            'pvs',
                            queryset=PrincipalVariation.objects.order_by('pv_index')[:max_pvs]
                        )
                    ).order_by('-pv_count', '-knodes')
                )
            ).get(fen=fen)

            return {
                'fen': position.fen,
                'evaluations': [
                    {
                        'knodes': eval_data.knodes,
                        'depth': eval_data.depth,
                        'pv_count': eval_data.pv_count,
                        'pvs': [
                            {
                                'pv_index': pv.pv_index,
                                'cp': pv.cp,
                                'mate': pv.mate,
                                'line': pv.line
                            }
                            for pv in eval_data.pvs.all()
                        ]
                    }
                    for eval_data in position.evals.all()
                ]
            }
        except PositionEvaluation.DoesNotExist:
            return None

    @staticmethod
    def get_best_evaluation(fen: str) -> Optional[Dict]:
        """
        Get the best evaluation for a position (highest PV count, then highest knodes)

        Args:
            fen: The FEN string of the position

        Returns:
            Dictionary with the best evaluation or None if not found
        """
        try:
            position = PositionEvaluation.objects.using('evaluations').get(fen=fen)
            best_eval = position.evals.prefetch_related('pvs').order_by('-pv_count', '-knodes').first()

            if not best_eval:
                return None

            return {
                'fen': fen,
                'knodes': best_eval.knodes,
                'depth': best_eval.depth,
                'pv_count': best_eval.pv_count,
                'best_move': best_eval.pvs.first().line.split()[0] if best_eval.pvs.exists() else None,
                'evaluation': best_eval.pvs.first().cp if best_eval.pvs.exists() and best_eval.pvs.first().cp is not None else None,
                'mate': best_eval.pvs.first().mate if best_eval.pvs.exists() and best_eval.pvs.first().mate is not None else None,
                'pvs': [
                    {
                        'cp': pv.cp,
                        'mate': pv.mate,
                        'line': pv.line
                    }
                    for pv in best_eval.pvs.all()
                ]
            }
        except PositionEvaluation.DoesNotExist:
            return None

    @staticmethod
    def bulk_lookup_positions(fens: List[str]) -> Dict[str, Dict]:
        """
        Look up multiple positions efficiently

        Args:
            fens: List of FEN strings

        Returns:
            Dictionary mapping FEN to evaluation data
        """
        positions = PositionEvaluation.objects.using('evaluations').filter(
            fen__in=fens
        ).prefetch_related(
            Prefetch(
                'evals',
                queryset=EvaluationData.objects.prefetch_related('pvs').order_by('-pv_count', '-knodes')
            )
        )

        result = {}
        for position in positions:
            best_eval = position.evals.first()
            if best_eval:
                result[position.fen] = {
                    'knodes': best_eval.knodes,
                    'depth': best_eval.depth,
                    'evaluation': best_eval.pvs.first().cp if best_eval.pvs.exists() and best_eval.pvs.first().cp is not None else None,
                    'mate': best_eval.pvs.first().mate if best_eval.pvs.exists() and best_eval.pvs.first().mate is not None else None,
                    'best_move': best_eval.pvs.first().line.split()[0] if best_eval.pvs.exists() else None
                }

        return result


class GameEnricher:
    """Utility class for enriching game data with evaluations"""

    def __init__(self):
        self.lookup = EvaluationLookup()

    def analyze_game_pgn(self, pgn_text: str, max_positions: int = 50) -> Dict:
        """
        Analyze a game from PGN text and enrich with evaluations

        Args:
            pgn_text: PGN string of the game
            max_positions: Maximum number of positions to analyze

        Returns:
            Dictionary with enriched game analysis
        """
        try:
            # Parse PGN
            pgn_io = StringIO(pgn_text)
            game = chess.pgn.read_game(pgn_io)

            if not game:
                return {'error': 'Could not parse PGN'}

            board = game.board()
            positions = []
            moves = []

            # Extract positions from the game
            positions.append(board.fen())

            for i, move in enumerate(game.mainline_moves()):
                if i >= max_positions:
                    break

                board.push(move)
                positions.append(board.fen())
                moves.append(move.uci())

            # Bulk lookup evaluations
            evaluations = self.lookup.bulk_lookup_positions(positions)

            # Build analysis
            analysis = {
                'game_info': {
                    'white': game.headers.get('White', 'Unknown'),
                    'black': game.headers.get('Black', 'Unknown'),
                    'result': game.headers.get('Result', '*'),
                    'date': game.headers.get('Date', 'Unknown'),
                },
                'positions_analyzed': len(positions),
                'positions_with_evaluations': len(evaluations),
                'moves': []
            }

            # Analyze each move
            board = game.board()
            for i, move in enumerate(moves):
                position_before = positions[i]
                position_after = positions[i + 1]

                eval_before = evaluations.get(position_before)
                eval_after = evaluations.get(position_after)

                move_analysis = {
                    'move_number': (i // 2) + 1,
                    'color': 'white' if i % 2 == 0 else 'black',
                    'move': move,
                    'san': board.san(chess.Move.from_uci(move)),
                    'position_before': position_before,
                    'position_after': position_after,
                    'evaluation_before': eval_before,
                    'evaluation_after': eval_after
                }

                # Calculate move evaluation if both positions have evaluations
                if eval_before and eval_after:
                    move_analysis['move_evaluation'] = self._calculate_move_evaluation(
                        eval_before, eval_after, move_analysis['color']
                    )

                analysis['moves'].append(move_analysis)
                board.push(chess.Move.from_uci(move))

            return analysis

        except Exception as e:
            return {'error': str(e)}

    def _calculate_move_evaluation(self, eval_before: Dict, eval_after: Dict, color: str) -> Dict:
        """Calculate the quality of a move based on evaluation changes"""

        # Extract centipawn values (handle mate scores)
        def get_cp_value(evaluation):
            if evaluation.get('mate') is not None:
                mate_score = evaluation['mate']
                # Convert mate scores to large centipawn values
                if mate_score > 0:
                    return 10000 - mate_score * 10
                else:
                    return -10000 - mate_score * 10
            return evaluation.get('evaluation', 0)

        cp_before = get_cp_value(eval_before)
        cp_after = get_cp_value(eval_after)

        # NO PERSPECTIVE CONVERSION - keep raw Stockfish evaluations
        # Calculate centipawn loss based on player perspective without flipping evals
        if color == 'black':
            # For Black: losing evaluation = eval increases (since evals are from White's perspective)
            cp_loss = cp_after - cp_before
        else:
            # For White: losing evaluation = eval decreases
            cp_loss = cp_before - cp_after

        # Classify move quality
        if cp_loss <= 10:
            quality = 'excellent'
        elif cp_loss <= 25:
            quality = 'good'
        elif cp_loss <= 50:
            quality = 'inaccuracy'
        elif cp_loss <= 100:
            quality = 'mistake'
        else:
            quality = 'blunder'

        return {
            'centipawn_loss': cp_loss,
            'quality': quality,
            'evaluation_before': cp_before,
            'evaluation_after': cp_after
        }

    def enrich_chess_game(self, chess_game_obj) -> Dict:
        """
        Enrich a ChessGame model instance with evaluations

        Args:
            chess_game_obj: ChessGame model instance

        Returns:
            Dictionary with enriched analysis
        """
        raw_data = chess_game_obj.raw_game_data

        if 'pgn' in raw_data:
            return self.analyze_game_pgn(raw_data['pgn'])
        elif 'moves' in raw_data:
            # Convert moves to PGN if available
            # This is a simplified conversion - you might need more sophisticated logic
            pgn_text = f'[White "{chess_game_obj.white_player}"]\\n[Black "{chess_game_obj.black_player}"]\\n\\n'
            if isinstance(raw_data['moves'], str):
                pgn_text += raw_data['moves']
            else:
                pgn_text += ' '.join(raw_data['moves'])

            return self.analyze_game_pgn(pgn_text)
        else:
            return {'error': 'No PGN or moves data found in game'}