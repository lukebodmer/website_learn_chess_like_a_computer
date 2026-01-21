# Opening Statistics by ELO Range

This directory contains opening-specific statistics organized by ELO ranges.

## File Format

Each file is named `{elo_min}-{elo_max}.json` and contains statistics for canonical chess openings within that ELO range.

Example: `1200-1300.json` contains opening statistics for players rated 1200-1299.

## Structure

```json
{
  "bullet": {
    "Opening Name": {
      "eco": "ECO code",
      "sample_size": 1000,
      "number_of_times_played": 15234,
      "opening_inaccuracies_per_game": { "mean": 0.89, "std": 1.0, "skew": 1.21 },
      "opening_mistakes_per_game": { "mean": 0.96, "std": 1.19, "skew": 1.44 },
      "opening_blunders_per_game": { "mean": 0.33, "std": 0.69, "skew": 2.9 }
    }
  },
  "blitz": { /* same structure */ },
  "rapid": { /* same structure */ }
}
```

## Statistics Included

For each opening within each time control:
- **eco**: ECO code for the opening
- **sample_size**: Number of games analyzed for statistics
- **number_of_times_played**: Total times this opening was played in the database for this ELO range and time control
- **opening_inaccuracies_per_game**: Distribution of inaccuracies during opening phase
- **opening_mistakes_per_game**: Distribution of mistakes during opening phase
- **opening_blunders_per_game**: Distribution of blunders during opening phase

Each distribution metric includes:
- **mean**: Average value
- **std**: Standard deviation
- **skew**: Skewness (distribution shape)

## Generation

These files are generated using `scripts/generate_opening_stats.py`:

```bash
python scripts/generate_opening_stats.py /path/to/lichess_games.db 1200 1300
```

See `scripts/README.md` for detailed usage instructions.
