from django.db import connections, transaction
from typing import Dict, List, Optional, Tuple
import chess
import logging


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

        print(f"🔍 DATABASE LOOKUP: Checking database for {len(fens)} positions...")

        results = {}

        # Process FENs in smaller batches to avoid memory issues
        for i in range(0, len(fens), self.max_batch_size):
            batch_fens = fens[i:i + self.max_batch_size]
            batch_results = self._get_batch_evaluations(batch_fens)
            results.update(batch_results)

        found_count = len(results)
        missing_count = len(fens) - found_count
        print(f"✅ DATABASE RETURNED: {found_count} already evaluated positions, {missing_count} need evaluation")

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

    def write_evaluation(self, fen: str, evaluation_data: Dict) -> bool:
        """
        Write a single evaluation to the database

        Args:
            fen: FEN string of the position
            evaluation_data: Dict from GCP Stockfish API containing:
                - evaluation: centipawn score
                - mate: mate in N moves (optional)
                - depth: search depth
                - knodes: kilonodes searched
                - best: best move in UCI format
                - variation: principal variation in SAN format

        Returns:
            True if successful, False otherwise
        """
        from analysis.models import PositionEvaluation, EvaluationData, PrincipalVariation

        logger = logging.getLogger(__name__)

        try:
            truncated_fen = self.truncate_fen(fen)

            with transaction.atomic(using=self.db_name):
                # Get or create position
                position, created = PositionEvaluation.objects.using(self.db_name).get_or_create(
                    fen=truncated_fen
                )

                # Create evaluation data
                knodes = evaluation_data.get('knodes', 0)
                if isinstance(knodes, float):
                    knodes = int(knodes * 1000)  # Convert from float kilonodes to integer
                else:
                    knodes = int(knodes)

                eval_data = EvaluationData.objects.using(self.db_name).create(
                    position=position,
                    knodes=knodes,
                    depth=evaluation_data.get('depth', 20),
                    pv_count=1  # Single PV from GCP API
                )

                # Create principal variation
                cp_score = evaluation_data.get('evaluation')
                mate_score = evaluation_data.get('mate')

                PrincipalVariation.objects.using(self.db_name).create(
                    evaluation=eval_data,
                    pv_index=0,
                    cp=cp_score if mate_score is None else None,
                    mate=mate_score,
                    line=evaluation_data.get('variation', '')
                )

            return True

        except Exception as e:
            logger.error(f"Error writing evaluation for {fen}: {e}")
            return False

    def write_evaluations_batch(self, evaluations: Dict[str, Dict]) -> int:
        """
        Write multiple evaluations to the database efficiently using bulk operations.

        IMPORTANT: This assumes the positions are NOT already in the database.
        The caller should have already checked the database before sending to GCP API.

        Args:
            evaluations: Dict mapping FEN to evaluation data from GCP API

        Returns:
            Number of successfully written evaluations
        """
        from analysis.models import PositionEvaluation, EvaluationData, PrincipalVariation

        if not evaluations:
            return 0

        logger = logging.getLogger(__name__)
        print(f"💾 DATABASE WRITE: Writing {len(evaluations)} position evaluations to database...")
        logger.debug(f"Starting batch write of {len(evaluations)} evaluations to database")

        # Filter out errors first
        valid_evaluations = {
            fen: eval_data
            for fen, eval_data in evaluations.items()
            if 'error' not in eval_data
        }

        error_count = len(evaluations) - len(valid_evaluations)
        if error_count > 0:
            logger.debug(f"Filtered out {error_count} evaluations with errors")

        if not valid_evaluations:
            print(f"⚠️  No valid evaluations to write (all had errors)")
            return 0

        try:
            import time
            overall_start = time.time()

            # Use a single transaction for all operations
            with transaction.atomic(using=self.db_name):
                # Step 1: Bulk create positions
                print(f"  [1/4] Preparing {len(valid_evaluations)} position records...")
                step_start = time.time()

                positions_to_create = []
                fen_to_truncated = {}

                for fen in valid_evaluations.keys():
                    truncated_fen = self.truncate_fen(fen)
                    fen_to_truncated[fen] = truncated_fen
                    positions_to_create.append(
                        PositionEvaluation(fen=truncated_fen)
                    )

                print(f"  [1/4] Bulk inserting {len(positions_to_create)} positions to database...")

                # Bulk insert positions (ignore conflicts in case of race conditions)
                created_positions = PositionEvaluation.objects.using(self.db_name).bulk_create(
                    positions_to_create,
                    ignore_conflicts=True  # Skip if position already exists (race condition)
                )

                step_time = time.time() - step_start
                print(f"  ✓ Step 1 complete in {step_time:.2f}s")

                # Step 2: Fetch all positions (including any that already existed)
                print(f"  [2/4] Fetching {len(fen_to_truncated)} positions from database...")
                step_start = time.time()

                truncated_fens = list(fen_to_truncated.values())
                position_lookup = {
                    pos.fen: pos
                    for pos in PositionEvaluation.objects.using(self.db_name).filter(
                        fen__in=truncated_fens
                    )
                }

                step_time = time.time() - step_start
                print(f"  ✓ Step 2 complete in {step_time:.2f}s - fetched {len(position_lookup)} positions")

                # Step 3: Bulk create evaluation data
                print(f"  [3/4] Preparing evaluation data records...")
                step_start = time.time()

                eval_data_to_create = []
                eval_data_map = {}  # Map index to original FEN for PV creation

                for idx, (fen, eval_data) in enumerate(valid_evaluations.items()):
                    truncated_fen = fen_to_truncated[fen]
                    position = position_lookup.get(truncated_fen)

                    if not position:
                        logger.warning(f"Position not found for {truncated_fen[:40]}... skipping")
                        continue

                    knodes = eval_data.get('knodes', 0)
                    if isinstance(knodes, float):
                        knodes = int(knodes * 1000)
                    else:
                        knodes = int(knodes)

                    depth = eval_data.get('depth', 20)

                    eval_data_obj = EvaluationData(
                        position=position,
                        knodes=knodes,
                        depth=depth,
                        pv_count=1
                    )
                    eval_data_to_create.append(eval_data_obj)
                    eval_data_map[idx] = (eval_data_obj, eval_data)

                print(f"  [3/4] Bulk inserting {len(eval_data_to_create)} evaluation data records...")

                # Bulk insert evaluation data
                created_eval_data = EvaluationData.objects.using(self.db_name).bulk_create(
                    eval_data_to_create
                )

                step_time = time.time() - step_start
                print(f"  ✓ Step 3 complete in {step_time:.2f}s")

                # Step 4: Bulk create principal variations
                print(f"  [4/4] Preparing principal variation records...")
                step_start = time.time()

                pv_to_create = []

                for eval_data_obj, source_data in eval_data_map.values():
                    cp_score = source_data.get('evaluation')
                    mate_score = source_data.get('mate')

                    pv_to_create.append(
                        PrincipalVariation(
                            evaluation=eval_data_obj,
                            pv_index=0,
                            cp=cp_score if mate_score is None else None,
                            mate=mate_score,
                            line=source_data.get('variation', '')
                        )
                    )

                print(f"  [4/4] Bulk inserting {len(pv_to_create)} principal variations...")

                # Bulk insert principal variations
                PrincipalVariation.objects.using(self.db_name).bulk_create(pv_to_create)

                step_time = time.time() - step_start
                print(f"  ✓ Step 4 complete in {step_time:.2f}s")

                success_count = len(created_eval_data)
                overall_time = time.time() - overall_start

                logger.info(f"Bulk write complete: {success_count} evaluations written in single transaction ({overall_time:.2f}s)")
                print(f"\n  ⚡ Total database write time: {overall_time:.2f}s ({success_count/overall_time:.0f} evals/sec)")

        except Exception as e:
            logger.error(f"Bulk write failed: {e}")
            print(f"❌ DATABASE WRITE FAILED: {e}")
            return 0

        # Summary logging
        if success_count > 0:
            print(f"✅ DATABASE WRITE SUCCESS: {success_count} position evaluations written in single transaction")
        if error_count > 0:
            print(f"⚠️  Skipped {error_count} evaluations with errors")

        return success_count