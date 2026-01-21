#!/usr/bin/env python3
"""
Initialize the Lichess games SQLite database schema.

This script creates the database structure for storing millions of chess games
with analysis data, optimized for fast statistical queries.
"""

import sqlite3
import sys
from pathlib import Path


def create_database(db_path: str) -> None:
    """Create the SQLite database with optimized schema and indexes."""

    print(f"Creating database at: {db_path}")

    # Ensure parent directory exists
    db_file = Path(db_path)
    db_file.parent.mkdir(parents=True, exist_ok=True)

    # Connect to database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Set performance optimizations
    print("Setting PRAGMA optimizations...")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-2000000")  # 2GB cache
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.execute("PRAGMA mmap_size=30000000000")  # 30GB mmap

    # Create main games table
    print("Creating games table...")
    cursor.execute("""
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

    # Create indexes for fast queries
    print("Creating indexes...")

    indexes = [
        ("idx_speed", "speed"),
        ("idx_white_elo", "white_elo"),
        ("idx_black_elo", "black_elo"),
        ("idx_opening_base_name", "opening_base_name"),
        ("idx_composite_elo_speed", "white_elo, black_elo, speed"),
    ]

    for index_name, columns in indexes:
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS {index_name} ON games({columns})
        """)
        print(f"  - Created index: {index_name}")

    # Commit and close
    conn.commit()

    # Print database stats
    cursor.execute("SELECT COUNT(*) FROM games")
    count = cursor.fetchone()[0]
    print(f"\nDatabase initialized successfully!")
    print(f"Current game count: {count}")

    # Get database file size
    if db_file.exists():
        size_mb = db_file.stat().st_size / (1024 * 1024)
        print(f"Database size: {size_mb:.2f} MB")

    conn.close()


def main():
    """Main entry point."""
    # Default database path on /data/ drive
    default_path = "/data/lichess_games.db"

    # Allow custom path via command line
    db_path = sys.argv[1] if len(sys.argv) > 1 else default_path

    try:
        create_database(db_path)
        print(f"\n✓ Database ready at: {db_path}")
    except Exception as e:
        print(f"\n✗ Error creating database: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
