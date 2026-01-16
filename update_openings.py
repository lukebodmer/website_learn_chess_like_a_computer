#!/usr/bin/env python3
import json
import random

# Set seed for reproducibility
random.seed(42)

# Read the TSV file to get opening names and ECO codes
openings = []
with open('static/data/openings/lichess_openings_canonical.tsv', 'r') as f:
    lines = f.readlines()
    # Skip header line
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t')
        if len(parts) >= 2:
            eco = parts[0]
            name = parts[1].lower()  # Convert to lowercase for JSON key
            openings.append({'eco': eco, 'name': name})

print(f"Found {len(openings)} openings")

# Read the JSON file
with open('data/elo_averages/800-1200.json', 'r') as f:
    data = json.load(f)

# Create the openings section with correct names and random values
data["openings"] = {}

for time_control in ["bullet", "blitz", "rapid"]:
    data["openings"][time_control] = {}
    for opening in openings:
        # Generate random mean values between 0 and 5 with one decimal place
        inaccuracies_mean = round(random.uniform(0, 5), 1)
        mistakes_mean = round(random.uniform(0, 5), 1)
        blunders_mean = round(random.uniform(0, 5), 1)

        data["openings"][time_control][opening['name']] = {
            "eco": opening['eco'],
            "opening_inaccuracies_per_game": {"mean": inaccuracies_mean, "std": 0.8, "skew": 0.5},
            "opening_mistakes_per_game": {"mean": mistakes_mean, "std": 0.5, "skew": 0.7},
            "opening_blunders_per_game": {"mean": blunders_mean, "std": 0.4, "skew": 0.9}
        }

# Write back to JSON file
with open('data/elo_averages/800-1200.json', 'w') as f:
    json.dump(data, f, indent=2)

print(f"Updated JSON file with {len(openings)} openings for each time control (bullet, blitz, rapid)")
print("Each opening has random mean values between 0 and 5 with one decimal place")
