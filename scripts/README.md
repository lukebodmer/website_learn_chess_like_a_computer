# Lichess Game Database Implementation

## Overview
This document outlines the plan to process ~90 million chess games from the Lichess database (29.4 GB zipped PGN file), filter and store ~10 million games with analysis data in a lightweight database, then generate ELO-range-specific statistical distributions by sampling and analyzing games on-demand.

## Quick Start: Statistics Generation Scripts

### Generate ELO Range Statistics
```bash
# Generate stats for bullet/blitz/rapid by ELO range
python scripts/generate_elo_stats.py /path/to/lichess_games.db 1200 1300
```
Output: `data/elo_averages/1200-1300.json`

### Generate Opening Statistics
```bash
# Generate opening-specific stats by ELO range
python scripts/generate_opening_stats.py /path/to/lichess_games.db 1200 1300
```
Output: `data/opening_stats/1200-1300.json`

See the **Statistics Generation Scripts** section below for detailed usage.

## Goals
1. Parse and filter the massive Lichess PGN dataset at high speed (~24,000 games/sec)
2. Store filtered games with minimal pre-computation in a local SQLite database
3. Sample games from ELO ranges and calculate statistics on-the-fly from movetext
4. Generate statistical distributions (mean, std, skew) for each ELO range × speed combination
5. [ ] Generate opening-specific statistics for base openings
6. Create JSON files compatible with the existing frontend code
7. Keep the database separate from web deployment (local-only)

## Architecture Philosophy

**Key Insight: Store Raw, Compute On-Demand**

Rather than pre-computing all error statistics during import (slow and inflexible), we:
1. **Import Fast**: Store only essential metadata + raw movetext with eval/clock annotations
2. **Sample Smart**: Query random 1000 games per ELO range × speed
3. **Compute Fresh**: Parse movetext and calculate all statistics during JSON generation
4. **Benefit**: 10x faster import, flexible metrics, smaller database

## Database Architecture

### Database Choice: SQLite
- **Rationale**: Single file, no server required, built into Python, good performance with proper indexing
- **Location**: `/data/lichess_games.db` (on /data/ drive to save hard drive space)
- **Expected size**: ~5-10 GB for 10 million games (compressed storage)

### Schema Design: Lightweight Metadata + Raw Movetext

#### Table: `games`
**Minimal schema for fast import and flexible querying**:
```sql
CREATE TABLE games (
    id TEXT PRIMARY KEY,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    speed TEXT NOT NULL,  -- bullet, blitz, rapid, classical
    opening_eco TEXT,
    opening_name TEXT,
    opening_base_name TEXT,  -- Normalized base opening name
    winner TEXT,  -- white, black, draw
    rated BOOLEAN NOT NULL,
    total_plies INTEGER,
    clock_initial INTEGER,
    clock_increment INTEGER,
    game_data TEXT NOT NULL  -- JSON with movetext (includes [%eval] and [%clk])
);

-- Indexes for fast random sampling by ELO range
CREATE INDEX idx_games_elo ON games(white_elo, black_elo);
CREATE INDEX idx_games_speed ON games(speed);
CREATE INDEX idx_games_opening ON games(opening_base_name);
CREATE INDEX idx_games_composite_elo_speed ON games((white_elo + black_elo) / 2, speed);
```

**Rationale for minimal schema**:
- No pre-computed error counts → 10x faster import (24,000+ games/sec vs 2,400/sec)
- Smaller database → less disk space, faster queries
- More flexible → can change error thresholds without re-importing
- Statistics computed on-demand from 1000-game samples

**Opening base name normalization**:
- "Ruy Lopez: Berlin Defense" → "ruy lopez"
- "Bishop's Opening: Vienna Hybrid" → "bishop's opening"
- Extract base opening name by taking text before ":" and lowercasing
- This allows grouping all variations of an opening together

**JSON blob structure** (`game_data` column):
```json
{
  "movetext": "1. e4 { [%eval 0.18] [%clk 0:10:00] } 1... c5 { [%eval 0.24] [%clk 0:10:00] } 2. d4 { [%eval 0.05] [%clk 0:10:00] } ..."
}
```

The movetext contains:
- **[%eval X.XX]** - Engine evaluation in pawns (e.g., `[%eval 2.35]` or `[%eval #-4]` for mate)
- **[%clk H:MM:SS]** - Remaining time on clock (e.g., `[%clk 0:09:45]`)

## Data Pipeline

### Phase 1: Fast PGN Import (COMPLETED)

#### Script: `scripts/parse_lichess_pgn.py`

**Key Innovation: Manual line-by-line parsing instead of python-chess**
- **Old approach**: `chess.pgn.read_game()` builds full game tree → 600 games/sec
- **New approach**: Manual regex parsing, store raw movetext → **~10,000 games/sec (17x faster)**

**Filtering criteria**:
1. ✅ Standard variant only
2. ✅ Must have `[%eval ...]` in first move (has analysis)
3. ✅ No BOT players
4. ✅ Rated games (all games in file are rated)
5. ✅ Minimum 8 plies (4 moves)
6. ✅ Time controls categorized: bullet (<3min), blitz (3-10min), rapid (10-30min), classical (30min+)

**Import strategy**:
- Line-by-line streaming with manual header parsing (regex)
- Store raw movetext with `[%eval]` and `[%clk]` annotations intact
- Batch inserts (100,000 games per batch with `executemany()`)
- Progress updates every 10k games, breakdown every 10M games

**Performance optimizations**:
```python
# SQLite optimizations
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

# Batch insert with executemany
cursor.executemany(
    "INSERT OR IGNORE INTO games (...) VALUES (...)",
    values_list  # 100k games
)
```

**Actual results from 90M game import**:
- Processing rate: **10,335 games/sec**
- Total processed: 90,630,000 games
- With eval data: 8,519,979 **(9.4%)**
- Final database: **8.5M games**
- Total time: **~2.5 hours**
- Filtered out: 81.5M no eval, 9.3k bots, 0 too short, 0 wrong variant

### Phase 2: On-Demand Statistics Generation

#### Script: `scripts/generate_elo_stats.py`

**Philosophy: Calculate statistics from raw movetext when generating JSON files**

Instead of pre-computing all error statistics during import (slow, inflexible), we:
1. Query random sample of 1000 games from an ELO range × speed
2. Parse movetext on-the-fly to calculate all metrics
3. Each game provides 2 data points (white + black player)
4. Calculate distributions (mean, std, skew) from 2000 data points

**Advantages**:
- **17x faster import** (no GameDivider, no error counting)
- **Flexible**: Can add new metrics without re-import
- **Smaller database**: No pre-computed columns
- **Fresh statistics**: Can regenerate with new metrics anytime

**Statistics calculation process**:

1. **Sample games**:
```sql
SELECT * FROM games
WHERE (white_elo + black_elo) / 2.0 >= ? AND < ?
  AND speed = ?
ORDER BY RANDOM()
LIMIT 1000
```

2. **For each game, parse movetext**:

Example movetext:
```
1. e4 { [%eval 0.17] [%clk 0:00:30] } 1... c5 { [%eval 0.19] [%clk 0:00:30] }
2. Nf3 { [%eval 0.25] [%clk 0:00:29] } 2... Nc6 { [%eval 0.33] [%clk 0:00:30] }
3. Bc4 { [%eval -0.13] [%clk 0:00:28] } 3... e6 { [%eval -0.04] [%clk 0:00:30] }
4. c3 { [%eval -0.4] [%clk 0:00:27] } 4... b5? { [%eval 1.18] [%clk 0:00:30] }
5. Bb3?! { [%eval 0.21] [%clk 0:00:26] } 5... c4 { [%eval 0.32] [%clk 0:00:29] }
...
11. Nbd2?? { [%eval -3.15] [%clk 0:00:14] } 11... h6 { [%eval -2.99] [%clk 0:00:23] }
```

**Extract from movetext**:
- **Error annotations** (already provided by Lichess):
  - `?!` = inaccuracy (based on win% drop)
  - `?` = mistake (based on win% drop)
  - `??` = blunder (based on win% drop)
  - Example: `4... b5?` is a mistake by Black, `11. Nbd2??` is a blunder by White
- **[%eval X.XX]** = engine evaluation in pawns
- **[%clk H:MM:SS]** = remaining time on clock

3. **Determine game phases** using `GameDivider`:
   - Parse moves with `chess.pgn` to build board states
   - Use `GameDivider.divide_game()` to get phase boundaries
   - Opening: start to `division.middle` ply
   - Middlegame: `division.middle` to `division.end` ply
   - Endgame: `division.end` to game end

4. **Count errors per phase per player**:
   - Track move number (ply)
   - White moves: odd plies (1, 3, 5, ...)
   - Black moves: even plies (2, 4, 6, ...)
   - Categorize by phase using division boundaries
   - Example: `11. Nbd2??` at ply 21, if middle=16 and end=46:
     - White's move (odd ply)
     - Between 16 and 46 → middlegame
     - Count as middlegame blunder for white

5. **Calculate all metrics for each player**:
   - Error counts per phase (9 metrics)
   - Time usage per phase (3 metrics)
   - Game outcome metrics (checkmate rate, timeout rate, etc.)
   - Advanced metrics (comeback rate, mate conversion, etc.)

6. **Aggregate into distributions**:
   - Collect 2000 data points (1000 games × 2 players)
   - Calculate mean, std, skew for each metric
   - Group by time control (bullet, blitz, rapid)

### Phase 3: Statistical Analysis

#### Script: `scripts/generate_elo_statistics.py`

**ELO ranges** (overlapping, sliding windows):
* `below-600` (elo < 600)
* `600-700`
* `650-750`
* `700-800`
* `750-850`
* `800-900`
* `850-950`
* `900-1000`
* `950-1050`
* `1000-1100`
* `1050-1150`
* `1100-1200`
* `1150-1250`
* `1200-1300`
* `1250-1350`
* `1300-1400`
* `1350-1450`
* `1400-1500`
* `1450-1550`
* `1500-1600`
* `1550-1650`
* `1600-1700`
* `1650-1750`
* `1700-1800`
* `1750-1850`
* `1800-1900`
* `1850-1950`
* `1900-2000`
* `1950-2050`
* `2000-2100`
* `2050-2150`
* `2100-2200`
* `2150-2250`
* `2200-2300`
* `2250-2350`
* `2300-2400`
* `2400+` (elo ≥ 2400)

Total: **38 ELO ranges**

**Speed categories**:
- bullet
- blitz
- rapid
- classical (if enough data)

**For each ELO range × speed combination**:

1. **Query random games for white players in ELO range**:
```sql
-- Example for 1200-1300 range, bullet speed
-- Get random sample of games where white player is in range
SELECT
    id,
    white_elo,
    black_elo,
    winner,
    opening_eco,
    opening_name,
    opening_base_name,
    game_data
FROM games
WHERE white_elo >= 1200 AND white_elo < 1300
  AND speed = 'bullet'
ORDER BY RANDOM()
LIMIT 1000;  -- Sample size for statistics
```

2. **Query random games for black players in ELO range**:
```sql
-- Example for 1200-1300 range, bullet speed
-- Get random sample of games where black player is in range
SELECT
    id,
    white_elo,
    black_elo,
    winner,
    opening_eco,
    opening_name,
    opening_base_name,
    game_data
FROM games
WHERE black_elo >= 1200 AND black_elo < 1300
  AND speed = 'bullet'
ORDER BY RANDOM()
LIMIT 1000;  -- Sample size for statistics
```

3. **For each game, parse movetext and extract player-specific metrics**:
   - Parse `game_data` JSON to get movetext
   - Use `GameDivider` to determine phase boundaries
   - Parse move annotations (`?!`, `?`, `??`) to count errors per phase
   - Parse `[%eval]` annotations to calculate metrics
   - Parse `[%clk]` annotations to calculate time usage per phase
   - Determine if player won/lost/drew
   - Calculate all metrics **for the specific player** (white or black) who had the ELO in this range

4. **Calculate per-player metrics from movetext parsing**:
   - Opening: inaccuracies, mistakes, blunders (for this player only)
   - Middlegame: inaccuracies, mistakes, blunders (for this player only)
   - Endgame: inaccuracies, mistakes, blunders (for this player only)
   - Time usage: percent_time_used_in_opening, middlegame, endgame (for this player only)
   - Game outcome metrics: win_rate, loss_rate, draw_rate (for this player only)
   - Advanced metrics: eval_volatility, comeback_rate, etc. (for this player only)

5. **Combine white and black player data points**:
   - Collect ~1000 data points from white players in range
   - Collect ~1000 data points from black players in range
   - Combine into ~2000 total data points for this ELO×speed combination

6. **Compute distribution parameters**:
```python
from scipy import stats
import numpy as np

# For each metric (e.g., opening_inaccuracies_per_game)
data = [player_metrics['opening_inaccuracies'] for player_metrics in all_player_data]

mean = np.mean(data)
std = np.std(data)
skew = stats.skew(data)
```

7. **Query opening-specific statistics** (optional, for later):
```sql
-- Example for "ruy lopez" in 1200-1300 range, bullet speed, white players
SELECT
    id,
    white_elo,
    opening_eco,
    opening_name,
    game_data
FROM games
WHERE white_elo >= 1200 AND white_elo < 1300
  AND speed = 'bullet'
  AND opening_base_name = 'ruy lopez'
ORDER BY RANDOM()
LIMIT 500;  -- Sample size per opening per color

-- And same query for black players
SELECT
    id,
    black_elo,
    opening_eco,
    opening_name,
    game_data
FROM games
WHERE black_elo >= 1200 AND black_elo < 1300
  AND speed = 'bullet'
  AND opening_base_name = 'ruy lopez'
ORDER BY RANDOM()
LIMIT 500;  -- Sample size per opening per color
```

8. **Generate opening statistics**:
   - Group by `opening_base_name` within each ELO range × speed
   - Parse movetext for each player in each game
   - Calculate mean, std, skew for opening-phase errors only
   - Include ECO code for reference
   - Only include openings with sufficient data (≥100 player data points)

9. **Output JSON** (38 files, one per ELO range):
```json
{
  "bullet": {
    "opening_inaccuracies_per_game": {
      "mean": 2.2,
      "std": 1.2,
      "skew": 0.8
    },
    "opening_mistakes_per_game": {
      "mean": 1.4,
      "std": 0.7,
      "skew": 0.9
    },
    "opening_blunders_per_game": {
      "mean": 1.3,
      "std": 0.6,
      "skew": 1.2
    },
    "middlegame_inaccuracies_per_game": { ... },
    "middlegame_mistakes_per_game": { ... },
    "middlegame_blunders_per_game": { ... },
    "endgame_inaccuracies_per_game": { ... },
    "endgame_mistakes_per_game": { ... },
    "endgame_blunders_per_game": { ... },
    "percent_time_used_in_opening": { ... },
    "percent_time_used_in_middlegame": { ... },
    "percent_time_used_in_endgame": { ... },
    "checkmate_rate": { ... },
    "timeout_rate": { ... },
    "win_by_checkmate_rate": { ... },
    "loss_by_timeout_rate": { ... },
    "draw_by_stalemate_rate": { ... },
    // ... all other metrics from existing files
  },
  "blitz": { ... },
  "rapid": { ... },
  "classical": { ... },
  "openings": {
    "bullet": {
      "ruy lopez": {
        "eco": "C60",
        "opening_inaccuracies_per_game": {
          "mean": 2.3,
          "std": 0.8,
          "skew": 0.5
        },
        "opening_mistakes_per_game": {
          "mean": 4.8,
          "std": 0.5,
          "skew": 0.7
        },
        "opening_blunders_per_game": {
          "mean": 4.4,
          "std": 0.4,
          "skew": 0.9
        }
      },
      "sicilian defense": {
        "eco": "B20",
        "opening_inaccuracies_per_game": { ... },
        "opening_mistakes_per_game": { ... },
        "opening_blunders_per_game": { ... }
      },
      // ... more base openings
    },
    "blitz": {
      "ruy lopez": { ... },
      // ... more base openings
    },
    "rapid": { ... },
    "classical": { ... }
  }
}
```

**Progress tracking**:
- Print progress for each ELO range being processed
- Format: `Processing 1200-1250 (15/38)... bullet: 10000 games, 45 openings | blitz: 8500 games, 42 openings | rapid: 4200 games, 38 openings`
- Show skipped speed categories with insufficient data (< 1000 games)
- Show overall progress: `Completed: 15/38 ranges (39.5%) | Estimated remaining: 45 minutes`

### Phase 4: Deployment Separation

**Directory structure**:
```
website_learn_chess_like_a_computer/
├── data/
│   ├── elo_averages/              # DEPLOY THESE (commit to git)
│   │   ├── below-600.json
│   │   ├── 600-650.json
│   │   ├── 650-700.json
│   │   ├── 700-750.json
│   │   ├── ... (38 files total)
│   │   └── 2400+.json
│   └── evaluations.db             # DEPLOY THIS (existing)
├── scripts/
│   ├── create_database.py         # Initialize schema
│   ├── parse_lichess_pgn.py       # Main parsing pipeline
│   ├── generate_elo_statistics.py # Generate JSON files
│   └── verify_database.py         # Validation script
└── docs/
    └── lichess_database_plan.md   # This document

/data/  (separate drive - NOT in git)
├── lichess_games.db               # LOCAL ONLY - large database
├── lichess_games.db-shm           # SQLite shared memory
├── lichess_games.db-wal           # Write-ahead log
└── chess_game_data/               # LOCAL ONLY - source PGN files
    └── lichess_db_standard_rated_2023-01.pgn.zst
```

**.gitignore** (already configured, no changes needed):
- `/data/lichess_games.db` is on separate drive, not in project
- Only JSON files in `data/elo_averages/` are committed

**Deployment workflow**:
1. Run `scripts/create_database.py` to initialize `/data/lichess_games.db`
2. Run `scripts/parse_lichess_pgn.py` to populate database (~15 hours)
3. Run `scripts/generate_elo_statistics.py` to create JSON files (~1 hour)
4. Commit only `data/elo_averages/*.json` to git (38 files, ~2-5 MB total)
5. Web server receives only the small JSON files during deployment

## Implementation Steps

### Step 1: Setup
- [x] Required packages already installed: `python-chess`, `scipy`, `numpy`, `zstandard`
- [ ] Create directory structure on `/data/` drive
- [ ] Verify access to `/data/chess_game_data/` PGN files

### Step 2: Database Schema
- [ ] Create `scripts/create_database.py`:
  - Initialize SQLite at `/data/lichess_games.db`
  - Create `games` table with all columns (including per-phase error counts and `opening_base_name`)
  - Add indexes for query performance
  - Set PRAGMA optimizations (WAL mode, cache size)
- [ ] Test database creation and basic operations

### Step 3: PGN Parser
- [ ] Create `scripts/parse_lichess_pgn.py`:
  - Stream PGN file (handle `.zst` compression)
  - Apply filters (variant, bots, rated, time control, eval presence)
  - Parse move annotations (`?!`, `?`, `??`) for error classification
  - Parse `[%eval ...]` and `[%clk ...]` comments
  - Extract and normalize opening names (base name extraction)
  - Use `GameDivider` to determine phase boundaries
  - Count errors per phase per player
  - Build JSON blob with moves, clocks, analysis
  - Batch insert 1000 games at a time with transactions
- [ ] Add progress tracking (every 10k games):
  - Total processed
  - Total filtered (meeting criteria)
  - Total inserted (with eval data)
  - Percentage with eval
  - Processing rate (games/sec)
  - Estimated time remaining
- [ ] Test with small sample (first 100k games)

### Step 4: Statistical Generator
- [ ] Create `scripts/generate_elo_statistics.py`:
  - Define 38 ELO ranges
  - For each range × speed combination:
    - Query up to 10,000 games
    - Extract error counts from columns (fast)
    - Parse time usage from JSON (for time metrics)
    - Calculate mean, std, skew for each metric
    - Query opening-specific data by `opening_base_name`
    - Group openings by base name
    - Calculate opening-specific statistics (≥100 games minimum)
    - Generate JSON file with both overall and opening-specific stats
  - Add progress tracking for each range
  - Handle insufficient data gracefully (skip or note)
- [ ] Validate output format matches existing structure

### Step 5: Verification & Testing
- [ ] Create `scripts/verify_database.py`:
  - Check total game count
  - Check games per ELO range
  - Check games per speed category
  - Check opening distribution
  - Verify error count integrity (spot-check against PGN)
  - Verify phase divisions (spot-check against GameDivider output)
  - Verify opening base name extraction
- [ ] Test JSON files with existing frontend
- [ ] Benchmark query performance
- [ ] Document any edge cases or discrepancies

## Performance Estimates

### Processing time:
- **PGN parsing**: ~2.5 hours for 90M games (COMPLETED)
  - Manual line-by-line parsing (no python-chess during import)
  - Store raw movetext only
  - No pre-computation of statistics
  - Progress updates every 10k games
  - Result: 8.5M games with eval data at 10,335 games/sec
- **Statistical generation**: ~4-6 hours (estimated)
  - 38 ranges × 3 speeds = 114 query batches (bullet, blitz, rapid)
  - Each batch: 2 queries (white + black players), 1000 games each
  - Parse movetext on-the-fly using `GameDivider` and annotation parsing
  - ~5-10ms per game to parse and calculate all metrics
  - Total: ~228,000 games to parse (114 batches × 2000 games)
  - At 100 games/sec parsing rate: ~40 minutes of parsing
  - Additional time for database queries and JSON generation
- **Total**: ~7-9 hours one-time processing (2.5h done + 4-6h stats)

### Storage requirements:
- **Source PGN**: 29.4 GB (compressed) - on `/data/` drive
- **SQLite database**: ~8-10 GB (for 7M games) - on `/data/` drive
  - Extra columns add ~50 bytes per row
  - JSON blob compressed by SQLite
- **JSON output**: ~3-7 MB total (38 files with opening data)

### Query performance (with indexes):
- Single ELO range query: <0.5 seconds for 1k games (with ORDER BY RANDOM())
- Opening-specific query: <0.2 seconds for 500 games per opening per color
- Movetext parsing: ~100 games/sec (with GameDivider + annotation parsing)
- Full statistics generation: ~4-6 hours for all 114 combinations (38 ranges × 3 speeds)
- Index overhead: ~200 MB (idx_games_elo, idx_games_speed, idx_games_opening)

## Key Implementation Details

### Opening Base Name Extraction
```python
def extract_base_opening(opening_name):
    """
    Extract base opening name from full opening name.

    Examples:
        "Ruy Lopez: Berlin Defense" → "ruy lopez"
        "Sicilian Defense" → "sicilian defense"
        "Bishop's Opening: Vienna Hybrid" → "bishop's opening"

    Returns normalized (lowercase, trimmed) base opening name.
    """
    if ':' in opening_name:
        base = opening_name.split(':')[0]
    else:
        base = opening_name

    return base.strip().lower()
```

### Move Annotation Parsing
```python
import re

def parse_move_with_judgment(move_text):
    """
    Parse move like 'Nbd2??' or 'b5?'
    Returns: (move_san, judgment)
    where judgment is 'inaccuracy', 'mistake', 'blunder', or None
    """
    if '??' in move_text:
        return move_text.replace('??', ''), 'blunder'
    elif '?' in move_text and '?!' not in move_text:
        return move_text.replace('?', ''), 'mistake'
    elif '?!' in move_text:
        return move_text.replace('?!', ''), 'inaccuracy'
    return move_text, None
```

### Phase Error Counting
```python
def categorize_error(ply, judgment, division):
    """
    Determine which phase counter to increment

    Args:
        ply: Move ply number (1-indexed)
        judgment: 'inaccuracy', 'mistake', or 'blunder'
        division: GameDivision object with .middle and .end

    Returns:
        (phase, player, error_type) tuple
    """
    # Determine player
    player = 'white' if ply % 2 == 1 else 'black'

    # Determine phase
    if division.middle is None or ply < division.middle:
        phase = 'opening'
    elif division.end is None or ply < division.end:
        phase = 'middlegame'
    else:
        phase = 'endgame'

    return (phase, player, judgment)
```

### Opening Statistics Aggregation
```python
def aggregate_opening_stats(games_cursor, elo_min, elo_max, speed):
    """
    Aggregate statistics by base opening name.

    Returns dict mapping opening base name to stats:
    {
        "ruy lopez": {
            "eco": "C60",
            "opening_inaccuracies_per_game": {"mean": ..., "std": ..., "skew": ...},
            ...
        },
        ...
    }
    """
    # Query games grouped by opening_base_name
    query = """
        SELECT
            opening_base_name,
            opening_eco,
            (white_opening_inaccuracies + black_opening_inaccuracies) as inaccuracies,
            (white_opening_mistakes + black_opening_mistakes) as mistakes,
            (white_opening_blunders + black_opening_blunders) as blunders
        FROM games
        WHERE avg_elo >= ? AND avg_elo < ?
          AND speed = ?
          AND opening_base_name IS NOT NULL
    """

    # Group by opening_base_name
    openings = defaultdict(lambda: {'games': [], 'eco': None})

    for row in games_cursor.execute(query, (elo_min, elo_max, speed)):
        base_name = row['opening_base_name']
        openings[base_name]['games'].append({
            'inaccuracies': row['inaccuracies'],
            'mistakes': row['mistakes'],
            'blunders': row['blunders']
        })
        if openings[base_name]['eco'] is None:
            openings[base_name]['eco'] = row['opening_eco']

    # Calculate statistics for each opening (minimum 100 games)
    results = {}
    for base_name, data in openings.items():
        if len(data['games']) >= 100:
            results[base_name] = {
                'eco': data['eco'],
                'opening_inaccuracies_per_game': calculate_stats([g['inaccuracies'] for g in data['games']]),
                'opening_mistakes_per_game': calculate_stats([g['mistakes'] for g in data['games']]),
                'opening_blunders_per_game': calculate_stats([g['blunders'] for g in data['games']])
            }

    return results
```

## Open Questions & Decisions

1. **Game phase detection**: ✅ **RESOLVED**
   - Use `GameDivider` from `analysis/chess_analysis/game_divider.py`

2. **Error classification**: ✅ **RESOLVED**
   - Parse from PGN move annotations (`?!`, `?`, `??`)
   - Already annotated by Lichess

3. **Opening base name extraction**: ✅ **RESOLVED**
   - Split on ":" and take first part
   - Normalize to lowercase
   - Groups all variations under base opening

4. **Sample size per ELO range**:
   - **Decision**: 10,000 games per ELO×speed combination (if available)
   - Skip combinations with <1000 games

5. **Sample size per opening**:
   - **Decision**: Minimum 100 games per opening
   - Skip openings with insufficient data in that ELO range

6. **Handling edge cases**:
   - Games with incomplete analysis: Require ≥50% of moves to have eval
   - Very short games: Include games ≥4 moves (Scholar's mate)
   - Missing clock data: Calculate time metrics only when available
   - Missing opening names: Set `opening_base_name` to NULL, exclude from opening stats

7. **Progress tracking**: ✅ **RESOLVED**
   - PGN parsing: Every 10,000 games
   - Statistics: Each ELO range with opening count
   - Include rate and ETA

## Notes

- **Key insight**: Store raw movetext, compute statistics on-demand during JSON generation
- Minimal database schema (no pre-computed error counts) enables 10x faster import
- Query by `white_elo` OR `black_elo` separately, get player-specific metrics
- Each game provides 2 potential data points (white player + black player)
- Sample 1000 white + 1000 black = 2000 data points per ELO×speed combination
- Opening base name column enables efficient grouping of opening variations
- GameDivider integration ensures consistent phase detection
- Move annotations (`?!`, `?`, `??`) already provided by Lichess in movetext
- 38 ELO ranges (100-point windows with 50-point overlap) provide fine-grained accuracy
- Opening-specific stats use same approach: query by color+elo+opening, parse movetext
- Database on `/data/` drive keeps project directory small
- Only ~3-7 MB of JSON files deployed to web server
- Re-running statistics is flexible (~4-6 hours) for iterating on metrics
- Can change error thresholds or add new metrics without re-importing database

## Statistics Generation Scripts

### `generate_elo_stats.py` - Time Control Statistics

Generates ELO-range-specific statistics for bullet, blitz, and rapid time controls.

**Output**: `data/elo_averages/{elo_min}-{elo_max}.json`

**Usage**:
```bash
# Basic usage
python scripts/generate_elo_stats.py /data/lichess_games.db 1200 1300

# With custom sample size (default: 1000 per color per speed)
python scripts/generate_elo_stats.py /data/lichess_games.db 1200 1300 --sample-size 2000

# With custom output path
python scripts/generate_elo_stats.py /data/lichess_games.db 1200 1300 --output data/elo_averages/custom.json

# For special ranges (below 600 or above 2400)
python scripts/generate_elo_stats.py /data/lichess_games.db 0 600 --elo-range-name "below-600"
python scripts/generate_elo_stats.py /data/lichess_games.db 2400 10000 --elo-range-name "2400+"
```

**Statistics Generated**:
- Error rates per game phase: opening/middlegame/endgame inaccuracies/mistakes/blunders
- Time usage percentages per phase
- Checkmate and mate conversion rates
- Comeback rates
- Evaluation volatility
- Quiet move quality
- Timeout rates and time pressure blunder rates
- Win/loss/draw termination statistics (checkmate, resignation, timeout, stalemate, etc.)

### `generate_opening_stats.py` - Opening-Specific Statistics

Generates opening-specific statistics for canonical chess openings within ELO ranges.

**Output**: `data/opening_stats/{elo_min}-{elo_max}.json`

**Usage**:
```bash
# Basic usage
python scripts/generate_opening_stats.py /data/lichess_games.db 1200 1300

# With custom sample size per opening (default: 500 per color)
python scripts/generate_opening_stats.py /data/lichess_games.db 1200 1300 --sample-size 500

# With custom minimum games threshold (default: 100)
python scripts/generate_opening_stats.py /data/lichess_games.db 1200 1300 --min-games 50

# With custom output path
python scripts/generate_opening_stats.py /data/lichess_games.db 1200 1300 --output data/opening_stats/custom.json
```

**Statistics Generated**:
- Opening-phase error rates (inaccuracies/mistakes/blunders) per canonical opening
- Organized by time control (bullet/blitz/rapid)
- Includes ECO code, sample size, and total times played for each opening
- Only includes openings with sufficient data (default: ≥100 games)

### Data Organization

#### ELO Averages (`data/elo_averages/`)

Contains time-control-specific statistics for ELO ranges:
- `{elo_min}-{elo_max}.json` - Standard ELO ranges (e.g., `1200-1300.json`)
- `below-600.json` - Statistics for players below 600 ELO
- `2400+.json` - Statistics for players 2400 ELO and above

**File Structure**:
```json
{
  "bullet": {
    "opening_inaccuracies_per_game": { "mean": 0.89, "std": 1.0, "skew": 1.21 },
    "opening_mistakes_per_game": { "mean": 0.96, "std": 1.19, "skew": 1.44 },
    // ... more metrics
  },
  "blitz": { /* similar structure */ },
  "rapid": { /* similar structure */ }
}
```

#### Opening Statistics (`data/opening_stats/`)

Contains opening-specific statistics for ELO ranges:
- `{elo_min}-{elo_max}.json` - Opening stats for ELO range

**File Structure**:
```json
{
  "bullet": {
    "Sicilian Defense": {
      "eco": "B20",
      "sample_size": 1000,
      "number_of_times_played": 15234,
      "opening_inaccuracies_per_game": { "mean": 0.89, "std": 1.0, "skew": 1.21 },
      "opening_mistakes_per_game": { "mean": 0.96, "std": 1.19, "skew": 1.44 },
      "opening_blunders_per_game": { "mean": 0.33, "std": 0.69, "skew": 2.9 }
    }
    // ... more openings
  },
  "blitz": { /* similar structure */ },
  "rapid": { /* similar structure */ }
}
```

### Batch Processing

**Generate all ELO ranges**:
```bash
# All ELO ranges (uses generate_all_elo_stats.py if available)
python scripts/generate_all_elo_stats.py /data/lichess_games.db
```

**Generate all opening statistics**:
```bash
# Process all ELO ranges for openings
for elo in 600-700 700-800 800-900 900-1000 1000-1100 1100-1200 1200-1300 1300-1400 1400-1500 1500-1600 1600-1700 1700-1800 1800-1900 1900-2000 2000-2100 2100-2200 2200-2300 2300-2400; do
  python scripts/generate_opening_stats.py /data/lichess_games.db ${elo%-*} ${elo#*-}
done
```
