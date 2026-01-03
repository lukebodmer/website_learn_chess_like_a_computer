import json
import zstandard as zstd
from pathlib import Path
from django.core.management.base import BaseCommand
from django.db import transaction, connection
from analysis.models import PositionEvaluation, EvaluationData, PrincipalVariation


class Command(BaseCommand):
    help = 'Import chess position evaluations from Lichess JSONL.zst file'

    def add_arguments(self, parser):
        parser.add_argument(
            '--file',
            type=str,
            default='data/lichess_evals/lichess_db_eval.jsonl.zst',
            help='Path to the zst file (default: data/lichess_evals/lichess_db_eval.jsonl.zst)'
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=10000,
            help='Number of positions to process in each batch (default: 10000)'
        )
        parser.add_argument(
            '--limit',
            type=int,
            help='Limit number of positions to import (for testing)'
        )
        parser.add_argument(
            '--resume-from',
            type=str,
            help='Resume import from a specific FEN position'
        )

    def handle(self, *args, **options):
        file_path = Path(options['file'])
        batch_size = options['batch_size']
        limit = options['limit']
        resume_from = options['resume_from']

        if not file_path.exists():
            self.stdout.write(
                self.style.ERROR(f'File not found: {file_path}')
            )
            return

        self.stdout.write(f'Starting import from {file_path}')
        self.stdout.write(f'Batch size: {batch_size}')
        if limit:
            self.stdout.write(f'Limit: {limit} positions')

        # Set up decompressor
        dctx = zstd.ZstdDecompressor()

        processed_count = 0
        batch_positions = []
        batch_evaluations = []
        batch_pvs = []

        resuming = bool(resume_from)

        with open(file_path, 'rb') as f:
            with dctx.stream_reader(f) as reader:
                # Stream processing - read line by line instead of loading entire file
                buffer = ""
                line_num = 0
                should_break = False

                while not should_break:
                    chunk = reader.read(8192)  # Read 8KB chunks
                    if not chunk:
                        # Process any remaining data in buffer
                        if buffer.strip():
                            try:
                                should_break = self._process_line(buffer, line_num, batch_positions,
                                                                batch_evaluations, batch_pvs, resuming,
                                                                resume_from, processed_count, limit)
                            except Exception as e:
                                self.stdout.write(
                                    self.style.ERROR(f'Error processing final line: {e}')
                                )
                        break

                    chunk_str = chunk.decode('utf-8', errors='ignore')
                    buffer += chunk_str

                    # Process complete lines
                    while '\n' in buffer and not should_break:
                        line, buffer = buffer.split('\n', 1)
                        line_num += 1

                        if not line.strip():
                            continue

                        try:
                            result = self._process_line(line, line_num, batch_positions,
                                                     batch_evaluations, batch_pvs, resuming,
                                                     resume_from, processed_count, limit)
                            if result[0]:  # should_break
                                should_break = True
                                break
                            resuming = result[1]
                            processed_count = result[2]

                            # Process batch when full
                            if len(batch_positions) >= batch_size:
                                self._process_batch(batch_positions, batch_evaluations, batch_pvs)
                                batch_positions.clear()
                                batch_evaluations.clear()
                                batch_pvs.clear()

                                # Clear Django ORM query cache to prevent memory buildup
                                connection.close()

                                self.stdout.write(f'Processed {processed_count} positions')

                        except json.JSONDecodeError as e:
                            self.stdout.write(
                                self.style.WARNING(f'JSON decode error on line {line_num}: {e}')
                            )
                            continue
                        except Exception as e:
                            self.stdout.write(
                                self.style.ERROR(f'Error processing line {line_num}: {e}')
                            )
                            continue

        # Process remaining batch
        if batch_positions:
            self._process_batch(batch_positions, batch_evaluations, batch_pvs)

        self.stdout.write(
            self.style.SUCCESS(f'Import completed! Processed {processed_count} positions')
        )

    def _process_line(self, line, line_num, batch_positions, batch_evaluations, batch_pvs,
                     resuming, resume_from, processed_count, limit):
        """Process a single line and return (should_break, resuming, processed_count)"""
        data = json.loads(line)
        fen = data['fen']

        # Resume logic
        if resuming:
            if fen == resume_from:
                resuming = False
                self.stdout.write(f'Resuming from position: {fen}')
            return (False, resuming, processed_count)

        # Skip if position already exists
        if PositionEvaluation.objects.using('evaluations').filter(fen=fen).exists():
            return (False, resuming, processed_count)

        # Add position to batch
        position = PositionEvaluation(fen=fen)
        batch_positions.append(position)

        # Process evaluations
        for eval_data in data['evals']:
            evaluation = EvaluationData(
                knodes=eval_data['knodes'],
                depth=eval_data['depth'],
                pv_count=len(eval_data['pvs'])
            )
            batch_evaluations.append((len(batch_positions) - 1, evaluation))

            # Process principal variations
            for pv_index, pv_data in enumerate(eval_data['pvs']):
                pv = PrincipalVariation(
                    pv_index=pv_index,
                    cp=pv_data.get('cp'),
                    mate=pv_data.get('mate'),
                    line=pv_data['line']
                )
                batch_pvs.append((len(batch_evaluations) - 1, pv))

        processed_count += 1

        # Check limit
        should_break = limit and processed_count >= limit
        return (should_break, resuming, processed_count)

    def _process_batch(self, positions, evaluations, pvs):
        """Process a batch of positions, evaluations, and PVs with proper foreign key handling"""
        try:
            with transaction.atomic(using='evaluations'):
                # Bulk create positions and get created IDs
                created_positions = PositionEvaluation.objects.using('evaluations').bulk_create(
                    positions, ignore_conflicts=True
                )

                # Create mapping from batch index to actual position using bulk query
                position_map = {}
                fen_list = [pos.fen for pos in positions]
                db_positions = PositionEvaluation.objects.using('evaluations').filter(fen__in=fen_list)

                # Create lookup dict by FEN
                fen_to_position = {pos.fen: pos for pos in db_positions}

                for i, pos in enumerate(positions):
                    position_map[i] = fen_to_position[pos.fen]

                # Assign foreign keys and bulk create evaluations
                eval_objects = []
                eval_map = {}
                for batch_pos_idx, evaluation in evaluations:
                    evaluation.position = position_map[batch_pos_idx]
                    eval_objects.append(evaluation)

                created_evaluations = EvaluationData.objects.using('evaluations').bulk_create(eval_objects)

                # Create evaluation mapping
                for i, eval_obj in enumerate(created_evaluations):
                    eval_map[i] = eval_obj

                # Assign foreign keys and bulk create PVs
                pv_objects = []
                for batch_eval_idx, pv in pvs:
                    pv.evaluation = eval_map[batch_eval_idx]
                    pv_objects.append(pv)

                PrincipalVariation.objects.using('evaluations').bulk_create(pv_objects)

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Error processing batch: {e}')
            )
            raise