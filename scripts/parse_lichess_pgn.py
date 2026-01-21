#!/usr/bin/env python3
"""
Parse Lichess PGN database and populate SQLite database.

This script streams through a massive PGN file (potentially 90M games),
filters for games with analysis, and stores them in a structured database.
"""

import json
import re
import sqlite3
import sys
import time
import zstandard as zstd
from pathlib import Path
from typing import Optional, Dict, Tuple, List


class PGNParser:
    """Parse and filter Lichess PGN games."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None
        self.cursor = None

        # Statistics
        self.stats = {
            'processed': 0,
            'filtered': 0,
            'inserted': 0,
            'no_eval': 0,
            'has_bot': 0,
            'not_rated': 0,
            'wrong_variant': 0,
            'wrong_time_control': 0,
            'too_short': 0,
            'errors': 0
        }

        self.start_time = time.time()
        self.last_progress_time = time.time()

        # Batch for bulk inserts
        self.batch = []
        self.batch_size = 100000  # Larger batches for better performance

    def connect_db(self):
        """Connect to the database."""
        self.conn = sqlite3.connect(self.db_path)
        self.cursor = self.conn.cursor()

        # Set pragmas for performance
        self.cursor.execute("PRAGMA journal_mode=WAL")
        self.cursor.execute("PRAGMA synchronous=NORMAL")

        # Create table if it doesn't exist
        self._create_tables()

    def _create_tables(self):
        """Create games table if it doesn't exist."""
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                white_elo INTEGER NOT NULL,
                black_elo INTEGER NOT NULL,
                speed TEXT NOT NULL,
                opening_eco TEXT,
                opening_name TEXT,
                opening_base_name TEXT,
                winner TEXT,
                rated BOOLEAN NOT NULL,
                total_plies INTEGER,
                clock_initial INTEGER,
                clock_increment INTEGER,
                termination TEXT,
                game_data TEXT NOT NULL
            )
        """)

        # Create indexes for common queries
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_games_white_elo
            ON games(white_elo)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_games_black_elo
            ON games(black_elo)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_games_speed
            ON games(speed)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_games_opening
            ON games(opening_base_name)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_games_composite_elo_speed
            ON games(white_elo, black_elo, speed)
        """)

        self.conn.commit()

    def close_db(self):
        """Close database connection."""
        if self.batch:
            self._flush_batch()
        if self.conn:
            self.conn.close()

    def extract_base_opening(self, opening_name: Optional[str]) -> Optional[str]:
        """
        Extract base opening name from full opening name.

        Examples:
            "Ruy Lopez: Berlin Defense" → "ruy lopez"
            "Sicilian Defense" → "sicilian defense"
        """
        if not opening_name:
            return None

        if ':' in opening_name:
            base = opening_name.split(':')[0]
        else:
            base = opening_name

        return base.strip().lower()

    def parse_move_annotation(self, move_san: str) -> Tuple[str, Optional[str]]:
        """
        Parse move annotation for judgment.

        Returns: (clean_move, judgment)
        where judgment is 'inaccuracy', 'mistake', 'blunder', or None
        """
        if '??' in move_san:
            return move_san.replace('??', ''), 'blunder'
        elif '?!' in move_san:
            return move_san.replace('?!', ''), 'inaccuracy'
        elif '?' in move_san:
            return move_san.replace('?', ''), 'mistake'
        return move_san, None

    def categorize_speed(self, base_time_seconds: int) -> str:
        """
        Categorize game speed based on base time.

        Rules:
        - < 3 minutes (180s): bullet
        - 3 to < 10 minutes (180-599s): blitz
        - 10 to < 30 minutes (600-1799s): rapid
        - >= 30 minutes (1800s+): classical
        """
        if base_time_seconds < 180:
            return 'bullet'
        elif base_time_seconds < 600:
            return 'blitz'
        elif base_time_seconds < 1800:
            return 'rapid'
        else:
            return 'classical'

    def parse_pgn_headers(self, header_text: str) -> Dict[str, str]:
        """Extract headers from PGN header text using regex."""
        headers = {}
        header_pattern = re.compile(r'\[(\w+)\s+"([^"]*)"\]')

        for line in header_text.split('\n'):
            line = line.strip()
            if line.startswith('['):
                match = header_pattern.match(line)
                if match:
                    headers[match.group(1)] = match.group(2)

        return headers

    def parse_game_from_text(self, game_text: str) -> Optional[Dict]:
        """Parse a game from raw PGN text without using chess.pgn library."""

        # Split into header and moves sections
        sections = game_text.split('\n\n', 1)
        if len(sections) < 2:
            return None

        header_text, movetext = sections[0], sections[1]
        headers = self.parse_pgn_headers(header_text)

        # Quick eval check - most important filter
        if '[%eval' not in movetext:
            self.stats['filtered'] += 1
            self.stats['no_eval'] += 1
            return None

        # Check variant
        variant = headers.get('Variant', 'standard').lower()
        if variant != 'standard':
            self.stats['filtered'] += 1
            self.stats['wrong_variant'] += 1
            return None

        # Check for bots
        if headers.get('WhiteTitle') == 'BOT' or headers.get('BlackTitle') == 'BOT':
            self.stats['filtered'] += 1
            self.stats['has_bot'] += 1
            return None

        # Quick ply count check
        ply_count_str = headers.get('PlyCount')
        if ply_count_str:
            try:
                ply_count = int(ply_count_str)
                if ply_count < 8:
                    self.stats['filtered'] += 1
                    self.stats['too_short'] += 1
                    return None
            except ValueError:
                pass

        # Extract game metadata
        game_id = headers.get('Site', '').split('/')[-1] if headers.get('Site') else None
        if not game_id:
            return None

        white_elo = int(headers.get('WhiteElo', 1500))
        black_elo = int(headers.get('BlackElo', 1500))

        opening_name = headers.get('Opening')
        opening_eco = headers.get('ECO')
        opening_base_name = self.extract_base_opening(opening_name)

        termination = headers.get('Termination')

        result = headers.get('Result', '*')
        if result == '1-0':
            winner = 'white'
        elif result == '0-1':
            winner = 'black'
        elif result == '1/2-1/2':
            winner = 'draw'
        else:
            winner = None

        # Parse time control and determine speed
        time_control = headers.get('TimeControl', '')
        clock_initial = None
        clock_increment = None
        speed = 'blitz'  # default

        if time_control and time_control != '-':
            parts = time_control.split('+')
            if len(parts) >= 1:
                try:
                    clock_initial = int(parts[0])
                    if len(parts) >= 2:
                        clock_increment = int(parts[1])

                    # Categorize speed based on base time
                    speed = self.categorize_speed(clock_initial)
                except ValueError:
                    pass

        # Count plies from movetext if not in headers
        if not ply_count_str:
            # Quick approximation: count move numbers
            move_numbers = re.findall(r'\d+\.', movetext)
            ply_count = len(move_numbers) * 2  # rough estimate
        else:
            ply_count = int(ply_count_str)

        # Store just the movetext - much smaller and faster
        game_data = {
            'movetext': movetext
        }

        # Build record with minimal columns
        record = {
            'id': game_id,
            'white_elo': white_elo,
            'black_elo': black_elo,
            'speed': speed,
            'opening_eco': opening_eco,
            'opening_name': opening_name,
            'opening_base_name': opening_base_name,
            'winner': winner,
            'rated': True,
            'total_plies': ply_count,
            'clock_initial': clock_initial,
            'clock_increment': clock_increment,
            'termination': termination,
            'game_data': json.dumps(game_data),
        }

        return record

    def _flush_batch(self):
        """Insert batch of games into database using executemany."""
        if not self.batch:
            return

        try:
            # Get column names from first record
            columns = ', '.join(self.batch[0].keys())
            placeholders = ', '.join(['?' for _ in self.batch[0]])

            # Prepare all values as tuples
            values_list = [tuple(record.values()) for record in self.batch]

            # Use executemany for batch insert - much faster
            self.cursor.executemany(
                f"INSERT OR IGNORE INTO games ({columns}) VALUES ({placeholders})",
                values_list
            )

            self.conn.commit()
            self.stats['inserted'] += len(self.batch)
            self.batch = []

        except Exception as e:
            self.conn.rollback()
            print(f"\nError inserting batch: {e}", file=sys.stderr)
            self.stats['errors'] += len(self.batch)
            self.batch = []

    def add_to_batch(self, record: Dict):
        """Add record to batch and flush if batch is full."""
        self.batch.append(record)

        if len(self.batch) >= self.batch_size:
            self._flush_batch()

    def print_progress(self):
        """Print progress update."""
        elapsed = time.time() - self.start_time
        rate = self.stats['processed'] / elapsed if elapsed > 0 else 0

        # Calculate ETA
        if rate > 0 and self.stats['processed'] > 0:
            # Estimate total games (this is rough)
            estimated_total = 90_000_000
            remaining = estimated_total - self.stats['processed']
            eta_seconds = remaining / rate
            eta_hours = eta_seconds / 3600
            eta_str = f"{eta_hours:.1f}h"
        else:
            eta_str = "calculating..."

        # Calculate games with eval (inserted + pending batch)
        total_with_eval = self.stats['inserted'] + len(self.batch)
        eval_pct = (total_with_eval / self.stats['processed'] * 100) if self.stats['processed'] > 0 else 0

        # Show filtering breakdown every 10M games
        if self.stats['processed'] % 10000000 == 0:
            print(f"\n\n--- Filtering Breakdown at {self.stats['processed']:,} games ---")
            print(f"  ✓ With eval data: {total_with_eval:,} ({eval_pct:.1f}%)")
            print(f"  ✗ No eval: {self.stats['no_eval']:,}")
            print(f"  ✗ Too short: {self.stats['too_short']:,}")
            print(f"  ✗ Has bot: {self.stats['has_bot']:,}")
            print(f"  ✗ Wrong variant: {self.stats['wrong_variant']:,}")
            print(f"  ✗ Errors: {self.stats['errors']:,}")
            print(f"  Database: {self.stats['inserted']:,} committed, {len(self.batch):,} pending")

        print(f"\rProcessed: {self.stats['processed']:,} | "
              f"With eval: {total_with_eval:,} ({eval_pct:.1f}%) | "
              f"Committed: {self.stats['inserted']:,} | "
              f"Rate: {rate:.0f} games/sec | "
              f"ETA: {eta_str}", end='', flush=True)

    def parse_pgn_file(self, pgn_path: str):
        """Parse PGN file and populate database."""

        print(f"Parsing PGN file: {pgn_path}")
        print(f"Database: {self.db_path}\n")

        self.connect_db()

        # Open file (handle .zst compression)
        if pgn_path.endswith('.zst'):
            print("Decompressing .zst file...")
            with open(pgn_path, 'rb') as compressed:
                dctx = zstd.ZstdDecompressor()
                with dctx.stream_reader(compressed) as reader:
                    self._parse_stream(reader)
        else:
            with open(pgn_path, 'r') as f:
                self._parse_stream(f)

        # Flush any remaining batch
        self._flush_batch()

        self.close_db()

        # Print final statistics
        print("\n\n" + "="*60)
        print("PARSING COMPLETE")
        print("="*60)
        elapsed = time.time() - self.start_time
        print(f"Total time: {elapsed/3600:.2f} hours")
        print(f"Processed: {self.stats['processed']:,}")
        print(f"Inserted: {self.stats['inserted']:,}")
        print(f"Filtered: {self.stats['filtered']:,}")
        print(f"  - No eval data: {self.stats['no_eval']:,}")
        print(f"  - Has bot: {self.stats['has_bot']:,}")
        print(f"  - Not rated: {self.stats['not_rated']:,}")
        print(f"  - Wrong variant: {self.stats['wrong_variant']:,}")
        print(f"  - Wrong time control: {self.stats['wrong_time_control']:,}")
        print(f"  - Too short: {self.stats['too_short']:,}")
        print(f"Errors: {self.stats['errors']:,}")

    def _parse_stream(self, stream):
        """Parse games from a stream using line-by-line parsing."""
        # Wrap binary streams for readline iteration
        if hasattr(stream, 'read1'):
            text_stream = TextIOWrapper(stream)
        else:
            text_stream = stream

        current_game = []

        # Read lines using readline for compatibility with both wrappers and files
        while True:
            if hasattr(stream, 'read1'):
                # Use readline for our custom wrapper
                line = text_stream.readline()
                if not line:
                    break
            else:
                # Use iteration for regular files
                try:
                    line = next(text_stream)
                except StopIteration:
                    break

            line = line.rstrip('\n\r')

            # New game starting
            if line.startswith('[Event "'):
                # Process previous game if exists
                if current_game:
                    self.stats['processed'] += 1

                    try:
                        game_text = '\n'.join(current_game)
                        record = self.parse_game_from_text(game_text)
                        if record:
                            self.add_to_batch(record)
                    except Exception as e:
                        self.stats['errors'] += 1
                        # Continue on errors

                    # Print progress every 10k games
                    if self.stats['processed'] % 10000 == 0:
                        self.print_progress()

                # Start new game
                current_game = [line]
            else:
                # Continue current game
                if current_game:  # Only append if we're in a game
                    current_game.append(line)

        # Process final game
        if current_game:
            self.stats['processed'] += 1

            try:
                game_text = '\n'.join(current_game)
                record = self.parse_game_from_text(game_text)
                if record:
                    self.add_to_batch(record)
            except Exception as e:
                self.stats['errors'] += 1


class TextIOWrapper:
    """Wrapper to make binary stream text-readable for python-chess."""

    def __init__(self, binary_stream):
        self.stream = binary_stream
        self.buffer = b''
        self.chunk_size = 8192

    def read(self, size=-1):
        """Read and decode bytes."""
        data = self.stream.read(size)
        return data.decode('utf-8', errors='ignore')

    def readline(self):
        """Read a line from the binary stream."""
        while b'\n' not in self.buffer:
            chunk = self.stream.read(self.chunk_size)
            if not chunk:
                # End of stream
                if self.buffer:
                    line = self.buffer
                    self.buffer = b''
                    return line.decode('utf-8', errors='ignore')
                return ''
            self.buffer += chunk

        # Found a newline
        line, self.buffer = self.buffer.split(b'\n', 1)
        return (line + b'\n').decode('utf-8', errors='ignore')


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python parse_lichess_pgn.py <pgn_file> [db_path]")
        print("\nExample:")
        print("  python parse_lichess_pgn.py /data/chess_game_data/lichess_db.pgn.zst")
        sys.exit(1)

    pgn_path = sys.argv[1]
    db_path = sys.argv[2] if len(sys.argv) > 2 else "/data/lichess_games.db"

    parser = PGNParser(db_path)
    parser.parse_pgn_file(pgn_path)


if __name__ == "__main__":
    main()
