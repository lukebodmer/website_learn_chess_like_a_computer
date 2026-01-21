#!/usr/bin/env python3
"""
Generate statistics for all ELO ranges.

This script runs generate_elo_stats.py for all 38 ELO ranges defined
in the README and outputs JSON files to static/data/elo_averages/.

Usage:
    python generate_all_elo_stats.py [db_path] [output_dir]

Example:
    python generate_all_elo_stats.py /data/lichess_games.db static/data/elo_averages
"""

import sys
import time
import json
from pathlib import Path
from generate_elo_stats import generate_elo_stats

# ELO ranges from README (38 ranges)
ELO_RANGES = [
    ("below-600", 0, 600),
    ("600-700", 600, 700),
    #("650-750", 650, 750),
    ("700-800", 700, 800),
    #("750-850", 750, 850),
    ("800-900", 800, 900),
    #("850-950", 850, 950),
    ("900-1000", 900, 1000),
    #("950-1050", 950, 1050),
    ("1000-1100", 1000, 1100),
    #("1050-1150", 1050, 1150),
    ("1100-1200", 1100, 1200),
    #("1150-1250", 1150, 1250),
    ("1200-1300", 1200, 1300),
    #("1250-1350", 1250, 1350),
    ("1300-1400", 1300, 1400),
    #("1350-1450", 1350, 1450),
    ("1400-1500", 1400, 1500),
    #("1450-1550", 1450, 1550),
    ("1500-1600", 1500, 1600),
    #("1550-1650", 1550, 1650),
    ("1600-1700", 1600, 1700),
    #("1650-1750", 1650, 1750),
    ("1700-1800", 1700, 1800),
    #("1750-1850", 1750, 1850),
    ("1800-1900", 1800, 1900),
    #("1850-1950", 1850, 1950),
    ("1900-2000", 1900, 2000),
    #("1950-2050", 1950, 2050),
    ("2000-2100", 2000, 2100),
    #("2050-2150", 2050, 2150),
    ("2100-2200", 2100, 2200),
    #("2150-2250", 2150, 2250),
    ("2200-2300", 2200, 2300),
    #("2250-2350", 2250, 2350),
    ("2300-2400", 2300, 2400),
    ("2400+", 2400, 9999),
]


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "/data/lichess_games.db"
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "static/data/elo_averages"

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("GENERATE ALL ELO STATISTICS")
    print("=" * 80)
    print(f"Database: {db_path}")
    print(f"Output directory: {output_dir}")
    print(f"Total ELO ranges: {len(ELO_RANGES)}")
    print()

    # Create placeholder files for all ranges to prevent warnings during generation
    print("Creating placeholder files...")
    placeholder_structure = {
        "bullet": {},
        "blitz": {},
        "rapid": {}
    }
    for range_name, _, _ in ELO_RANGES:
        output_file = output_path / f"{range_name}.json"
        # Always create/overwrite to ensure correct structure
        with open(output_file, 'w') as f:
            json.dump(placeholder_structure, f)
    print("✓ Placeholder files created")
    print()

    total_ranges = len(ELO_RANGES)
    start_time = time.time()

    for idx, (range_name, elo_min, elo_max) in enumerate(ELO_RANGES, 1):
        print(f"\n[{idx}/{total_ranges}] Processing {range_name}...")
        print("-" * 80)

        try:
            # Generate statistics for this range
            stats = generate_elo_stats(db_path, elo_min, elo_max, sample_size=2500, elo_range_name=range_name)

            if not stats:
                print(f"  WARNING: No statistics generated for {range_name}")
                continue

            # Write to file
            output_file = output_path / f"{range_name}.json"
            with open(output_file, 'w') as f:
                json.dump(stats, f, indent=2)

            print(f"  ✓ Written to {output_file}")

            # Calculate progress
            elapsed = time.time() - start_time
            avg_time_per_range = elapsed / idx
            remaining_ranges = total_ranges - idx
            eta_seconds = avg_time_per_range * remaining_ranges
            eta_minutes = eta_seconds / 60

            print(f"  Progress: {idx}/{total_ranges} ({idx/total_ranges*100:.1f}%)")
            print(f"  Estimated remaining: {eta_minutes:.1f} minutes")

        except Exception as e:
            print(f"  ERROR processing {range_name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    total_time = time.time() - start_time
    print()
    print("=" * 80)
    print("GENERATION COMPLETE")
    print("=" * 80)
    print(f"Total time: {total_time/3600:.2f} hours")
    print(f"Processed: {total_ranges} ELO ranges")
    print(f"Output files: {output_dir}/*.json")


if __name__ == "__main__":
    main()
