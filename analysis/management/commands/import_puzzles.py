"""
Django management command to import Lichess puzzles from CSV into PostgreSQL.

Usage:
    python manage.py import_puzzles [--batch-size 10000] [--skip-existing]

This command efficiently imports puzzle data using PostgreSQL's COPY command
for optimal performance when dealing with millions of rows.
"""

import csv
import subprocess
import sys
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from analysis.models import Puzzle


class Command(BaseCommand):
    help = 'Import Lichess puzzle data from compressed CSV file into PostgreSQL'

    def add_arguments(self, parser):
        parser.add_argument(
            '--csv-file',
            type=str,
            default='data/puzzles/lichess_db_puzzle.csv.zst',
            help='Path to the compressed puzzle CSV file (default: data/puzzles/lichess_db_puzzle.csv.zst)'
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=10000,
            help='Number of records to process in each batch (default: 10000)'
        )
        parser.add_argument(
            '--skip-existing',
            action='store_true',
            help='Skip import if puzzles already exist in database'
        )
        parser.add_argument(
            '--use-copy',
            action='store_true',
            help='Use PostgreSQL COPY command for faster import (recommended for large datasets)'
        )

    def handle(self, *args, **options):
        csv_file = Path(options['csv_file'])
        batch_size = options['batch_size']
        skip_existing = options['skip_existing']
        use_copy = options['use_copy']

        # Validate file exists
        if not csv_file.exists():
            raise CommandError(f'CSV file not found: {csv_file}')

        # Check if puzzles already exist
        existing_count = Puzzle.objects.count()
        if existing_count > 0:
            if skip_existing:
                self.stdout.write(
                    self.style.WARNING(
                        f'Database already contains {existing_count} puzzles. Skipping import.'
                    )
                )
                return
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f'Warning: Database already contains {existing_count} puzzles.'
                    )
                )
                response = input('Continue and add more? (yes/no): ')
                if response.lower() != 'yes':
                    self.stdout.write('Import cancelled.')
                    return

        self.stdout.write(f'Starting import from {csv_file}...')

        if use_copy:
            self._import_with_copy(csv_file)
        else:
            self._import_with_bulk_create(csv_file, batch_size)

    def _import_with_copy(self, csv_file):
        """
        Use PostgreSQL's COPY command for fastest import.
        This bypasses Django ORM for maximum speed.
        """
        self.stdout.write(self.style.SUCCESS('Using PostgreSQL COPY command for import...'))

        # Decompress and pipe directly to PostgreSQL COPY
        with connection.cursor() as cursor:
            # Create a temporary CSV file or use a pipe
            self.stdout.write('Decompressing and importing data...')

            # Use zstd to decompress and pipe to psql COPY
            decompress_cmd = ['zstd', '-dc', str(csv_file)]

            # Get database connection details from settings
            db_settings = connection.settings_dict

            # Build the COPY SQL command
            copy_sql = """
                COPY puzzles (
                    puzzle_id, fen, moves, rating, rating_deviation,
                    popularity, nb_plays, themes, game_url, opening_tags
                )
                FROM STDIN
                WITH (FORMAT CSV, HEADER true, DELIMITER ',', QUOTE '"')
            """

            try:
                # Run decompression
                decompress_process = subprocess.Popen(
                    decompress_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )

                # Use Django's cursor to execute COPY
                # Note: This requires raw database access
                with connection.cursor() as cursor:
                    # Skip header line
                    header = decompress_process.stdout.readline()

                    # Use cursor.copy_expert for COPY command
                    cursor.copy_expert(
                        sql=copy_sql.replace('STDIN', 'STDIN'),
                        file=decompress_process.stdout
                    )

                decompress_process.wait()

                if decompress_process.returncode != 0:
                    error_msg = decompress_process.stderr.read().decode()
                    raise CommandError(f'Decompression failed: {error_msg}')

                # Get count
                total_count = Puzzle.objects.count()
                self.stdout.write(
                    self.style.SUCCESS(f'Successfully imported {total_count} puzzles using COPY!')
                )

            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'COPY import failed: {e}')
                )
                self.stdout.write('Falling back to bulk_create method...')
                self._import_with_bulk_create(csv_file, 10000)

    def _import_with_bulk_create(self, csv_file, batch_size):
        """
        Import using Django ORM's bulk_create method.
        Slower than COPY but more reliable and works with any database backend.
        """
        self.stdout.write(self.style.SUCCESS('Using bulk_create method for import...'))

        # Decompress the file
        self.stdout.write('Decompressing file...')
        decompress_cmd = ['zstd', '-dc', str(csv_file)]

        try:
            process = subprocess.Popen(
                decompress_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            # Read CSV from the decompressed stream
            reader = csv.DictReader(process.stdout)

            puzzles_batch = []
            total_imported = 0
            skipped = 0

            for row in reader:
                try:
                    puzzle = Puzzle(
                        puzzle_id=row['PuzzleId'],
                        fen=row['FEN'],
                        moves=row['Moves'],
                        rating=int(row['Rating']),
                        rating_deviation=int(row['RatingDeviation']),
                        popularity=int(row['Popularity']),
                        nb_plays=int(row['NbPlays']),
                        themes=row['Themes'],
                        game_url=row['GameUrl'],
                        opening_tags=row['OpeningTags']
                    )
                    puzzles_batch.append(puzzle)

                    if len(puzzles_batch) >= batch_size:
                        # Bulk insert
                        Puzzle.objects.bulk_create(
                            puzzles_batch,
                            ignore_conflicts=True
                        )
                        total_imported += len(puzzles_batch)
                        self.stdout.write(f'Imported {total_imported} puzzles...', ending='\r')
                        self.stdout.flush()
                        puzzles_batch = []

                except Exception as e:
                    skipped += 1
                    if skipped < 10:  # Only show first 10 errors
                        self.stderr.write(f'Error processing row: {e}')

            # Import remaining puzzles
            if puzzles_batch:
                Puzzle.objects.bulk_create(
                    puzzles_batch,
                    ignore_conflicts=True
                )
                total_imported += len(puzzles_batch)

            process.wait()

            if process.returncode != 0:
                error_msg = process.stderr.read()
                raise CommandError(f'Decompression failed: {error_msg}')

            self.stdout.write('\n')  # New line after progress updates
            self.stdout.write(
                self.style.SUCCESS(
                    f'Successfully imported {total_imported} puzzles! (Skipped: {skipped})'
                )
            )

            # Display some statistics
            from django.db.models import Avg
            total_count = Puzzle.objects.count()
            avg_rating = Puzzle.objects.aggregate(avg_rating=Avg('rating'))

            self.stdout.write(f'Total puzzles in database: {total_count}')
            if avg_rating.get('avg_rating'):
                self.stdout.write(f'Average rating: {avg_rating["avg_rating"]:.0f}')

        except Exception as e:
            raise CommandError(f'Import failed: {e}')
