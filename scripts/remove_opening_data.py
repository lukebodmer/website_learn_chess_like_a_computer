#!/usr/bin/env python3
"""
Remove opening data from existing ELO average JSON files.

This script removes the 'openings' key from all ELO average JSON files
in data/elo_averages/, keeping only the bullet/blitz/rapid statistics.

Usage:
    python remove_opening_data.py
"""

import json
from pathlib import Path


def remove_opening_data_from_file(file_path: Path) -> bool:
    """
    Remove opening data from a single JSON file.

    Returns True if file was modified, False otherwise.
    """
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)

        # Check if openings key exists
        if 'openings' not in data:
            print(f"  Skipping {file_path.name}: no opening data found")
            return False

        # Remove openings key
        del data['openings']

        # Write back to file
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"  ✓ Removed opening data from {file_path.name}")
        return True

    except Exception as e:
        print(f"  ERROR processing {file_path.name}: {e}")
        return False


def main():
    # Get all JSON files in data/elo_averages/
    elo_averages_dir = Path(__file__).parent.parent / 'data' / 'elo_averages'

    if not elo_averages_dir.exists():
        print(f"ERROR: Directory {elo_averages_dir} does not exist")
        return

    json_files = list(elo_averages_dir.glob('*.json'))

    if not json_files:
        print(f"No JSON files found in {elo_averages_dir}")
        return

    print(f"Found {len(json_files)} JSON files in {elo_averages_dir}")
    print("Processing files...")

    modified_count = 0
    for json_file in sorted(json_files):
        if remove_opening_data_from_file(json_file):
            modified_count += 1

    print(f"\nDone! Modified {modified_count} files.")


if __name__ == "__main__":
    main()
