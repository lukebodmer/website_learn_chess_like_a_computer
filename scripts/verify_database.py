#!/usr/bin/env python3
"""
Verify the Lichess games database integrity and distribution.

This script checks the database for:
- Total game count
- Games per ELO range
- Games per speed category
- Opening distribution
- Data integrity
"""

import sqlite3
import sys
from pathlib import Path
from typing import Dict


class DatabaseVerifier:
    """Verify database integrity and statistics."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None
        self.cursor = None

    def connect_db(self):
        """Connect to the database."""
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()

    def close_db(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()

    def verify_total_count(self):
        """Verify total game count."""
        print("\n" + "="*60)
        print("TOTAL GAME COUNT")
        print("="*60)

        self.cursor.execute("SELECT COUNT(*) as count FROM games")
        total = self.cursor.fetchone()['count']

        print(f"Total games: {total:,}")

        # Get database file size
        db_file = Path(self.db_path)
        if db_file.exists():
            size_mb = db_file.stat().st_size / (1024 * 1024)
            size_gb = size_mb / 1024
            print(f"Database size: {size_gb:.2f} GB ({size_mb:.2f} MB)")

    def verify_elo_distribution(self):
        """Verify games per ELO range."""
        print("\n" + "="*60)
        print("ELO DISTRIBUTION")
        print("="*60)

        elo_ranges = [
            ("Below 600", 0, 600),
            ("600-800", 600, 800),
            ("800-1000", 800, 1000),
            ("1000-1200", 1000, 1200),
            ("1200-1400", 1200, 1400),
            ("1400-1600", 1400, 1600),
            ("1600-1800", 1600, 1800),
            ("1800-2000", 1800, 2000),
            ("2000-2200", 2000, 2200),
            ("2200-2400", 2200, 2400),
            ("2400+", 2400, 9999),
        ]

        for range_name, elo_min, elo_max in elo_ranges:
            self.cursor.execute(
                "SELECT COUNT(*) as count FROM games WHERE avg_elo >= ? AND avg_elo < ?",
                (elo_min, elo_max)
            )
            count = self.cursor.fetchone()['count']
            print(f"  {range_name:15s}: {count:>10,} games")

    def verify_speed_distribution(self):
        """Verify games per speed category."""
        print("\n" + "="*60)
        print("SPEED DISTRIBUTION")
        print("="*60)

        for speed in ['bullet', 'blitz', 'rapid', 'classical']:
            self.cursor.execute(
                "SELECT COUNT(*) as count FROM games WHERE speed = ?",
                (speed,)
            )
            count = self.cursor.fetchone()['count']
            print(f"  {speed.capitalize():12s}: {count:>10,} games")

    def verify_opening_distribution(self):
        """Verify opening distribution."""
        print("\n" + "="*60)
        print("OPENING DISTRIBUTION")
        print("="*60)

        # Count games with opening data
        self.cursor.execute(
            "SELECT COUNT(*) as count FROM games WHERE opening_base_name IS NOT NULL"
        )
        with_opening = self.cursor.fetchone()['count']

        self.cursor.execute("SELECT COUNT(*) as count FROM games")
        total = self.cursor.fetchone()['count']

        pct = (with_opening / total * 100) if total > 0 else 0
        print(f"Games with opening data: {with_opening:,} ({pct:.1f}%)")

        # Top 10 openings
        print("\nTop 10 base openings:")
        self.cursor.execute("""
            SELECT opening_base_name, COUNT(*) as count
            FROM games
            WHERE opening_base_name IS NOT NULL
            GROUP BY opening_base_name
            ORDER BY count DESC
            LIMIT 10
        """)

        for i, row in enumerate(self.cursor, 1):
            print(f"  {i:2d}. {row['opening_base_name']:30s}: {row['count']:>8,} games")

    def verify_error_counts(self):
        """Verify error count distribution."""
        print("\n" + "="*60)
        print("ERROR COUNT VERIFICATION")
        print("="*60)

        # Sample a few games and verify error counts are reasonable
        self.cursor.execute("""
            SELECT
                id,
                white_opening_inaccuracies,
                white_opening_mistakes,
                white_opening_blunders,
                black_opening_inaccuracies,
                black_opening_mistakes,
                black_opening_blunders,
                total_plies
            FROM games
            ORDER BY RANDOM()
            LIMIT 5
        """)

        print("\nSample games:")
        for row in self.cursor:
            total_errors = (
                row['white_opening_inaccuracies'] +
                row['white_opening_mistakes'] +
                row['white_opening_blunders'] +
                row['black_opening_inaccuracies'] +
                row['black_opening_mistakes'] +
                row['black_opening_blunders']
            )
            print(f"  Game {row['id']}: {total_errors} total errors in opening ({row['total_plies']} plies)")

        # Average errors per game
        self.cursor.execute("""
            SELECT
                AVG(white_opening_inaccuracies + black_opening_inaccuracies) as avg_opening_inaccuracies,
                AVG(white_opening_mistakes + black_opening_mistakes) as avg_opening_mistakes,
                AVG(white_opening_blunders + black_opening_blunders) as avg_opening_blunders,
                AVG(white_middlegame_inaccuracies + black_middlegame_inaccuracies) as avg_middlegame_inaccuracies,
                AVG(white_middlegame_mistakes + black_middlegame_mistakes) as avg_middlegame_mistakes,
                AVG(white_middlegame_blunders + black_middlegame_blunders) as avg_middlegame_blunders,
                AVG(white_endgame_inaccuracies + black_endgame_inaccuracies) as avg_endgame_inaccuracies,
                AVG(white_endgame_mistakes + black_endgame_mistakes) as avg_endgame_mistakes,
                AVG(white_endgame_blunders + black_endgame_blunders) as avg_endgame_blunders
            FROM games
        """)

        row = self.cursor.fetchone()
        print("\nAverage errors per game (all ELOs):")
        print(f"  Opening:    {row['avg_opening_inaccuracies']:.2f} inaccuracies, "
              f"{row['avg_opening_mistakes']:.2f} mistakes, "
              f"{row['avg_opening_blunders']:.2f} blunders")
        print(f"  Middlegame: {row['avg_middlegame_inaccuracies']:.2f} inaccuracies, "
              f"{row['avg_middlegame_mistakes']:.2f} mistakes, "
              f"{row['avg_middlegame_blunders']:.2f} blunders")
        print(f"  Endgame:    {row['avg_endgame_inaccuracies']:.2f} inaccuracies, "
              f"{row['avg_endgame_mistakes']:.2f} mistakes, "
              f"{row['avg_endgame_blunders']:.2f} blunders")

    def verify_phase_divisions(self):
        """Verify game phase divisions."""
        print("\n" + "="*60)
        print("PHASE DIVISION VERIFICATION")
        print("="*60)

        # Average phase sizes
        self.cursor.execute("""
            SELECT
                AVG(opening_end_ply) as avg_opening_end,
                AVG(middlegame_end_ply) as avg_middlegame_end,
                AVG(total_plies) as avg_total_plies
            FROM games
            WHERE opening_end_ply IS NOT NULL
        """)

        row = self.cursor.fetchone()
        print(f"Average opening ends at ply: {row['avg_opening_end']:.1f}")
        print(f"Average middlegame ends at ply: {row['avg_middlegame_end']:.1f}")
        print(f"Average total plies: {row['avg_total_plies']:.1f}")

        # Count games with null divisions
        self.cursor.execute(
            "SELECT COUNT(*) as count FROM games WHERE opening_end_ply IS NULL"
        )
        null_opening = self.cursor.fetchone()['count']

        self.cursor.execute(
            "SELECT COUNT(*) as count FROM games WHERE middlegame_end_ply IS NULL"
        )
        null_middlegame = self.cursor.fetchone()['count']

        print(f"\nGames with null opening_end_ply: {null_opening:,}")
        print(f"Games with null middlegame_end_ply: {null_middlegame:,}")

    def verify_all(self):
        """Run all verification checks."""
        print("Verifying database:", self.db_path)

        self.connect_db()

        self.verify_total_count()
        self.verify_elo_distribution()
        self.verify_speed_distribution()
        self.verify_opening_distribution()
        self.verify_error_counts()
        self.verify_phase_divisions()

        self.close_db()

        print("\n" + "="*60)
        print("VERIFICATION COMPLETE")
        print("="*60)


def main():
    """Main entry point."""
    db_path = sys.argv[1] if len(sys.argv) > 1 else "/data/lichess_games.db"

    verifier = DatabaseVerifier(db_path)
    verifier.verify_all()


if __name__ == "__main__":
    main()
