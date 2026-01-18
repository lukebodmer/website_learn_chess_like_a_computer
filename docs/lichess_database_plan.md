# Lichess Game Database Implementation Plan

## Overview
This document outlines the plan to process ~90 million chess games from the Lichess database (29.4 GB zipped PGN file), filter and store ~10 million games with analysis data, and generate ELO-range-specific statistical distributions for opening, middlegame, and endgame performance metrics.

## Goals
1. Parse and filter the massive Lichess PGN dataset
2. Store filtered games efficiently in a local SQLite database
3. Generate statistical distributions (mean, std, skew) for each ELO range
4. Generate opening-specific statistics for base openings
5. Create JSON files compatible with the existing frontend code
6. Keep the database separate from web deployment (local-only)

## Database Architecture

### Database Choice: SQLite
- **Rationale**: Single file, no server required, built into Python, good performance with proper indexing
- **Location**: `/data/lichess_games.db` (on /data/ drive to save hard drive space)
- **Expected size**: ~5-10 GB for 10 million games (compressed storage)

### Schema Design: Hybrid Approach

#### Table 1: `games` (main table)
**Indexed columns** (for fast queries):
```sql
CREATE TABLE games (
    id TEXT PRIMARY KEY,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    avg_elo INTEGER GENERATED ALWAYS AS ((white_elo + black_elo) / 2) STORED,
    speed TEXT NOT NULL,  -- bullet, blitz, rapid, classical
    opening_eco TEXT,
    opening_name TEXT,
    opening_base_name TEXT,  -- Normalized base opening name (e.g., "bishop's opening")
    winner TEXT,  -- white, black, draw
    rated BOOLEAN NOT NULL,
    white_accuracy REAL,
    black_accuracy REAL,
    white_acpl INTEGER,
    black_acpl INTEGER,

    -- Game phase divisions (from GameDivider)
    opening_end_ply INTEGER,
    middlegame_end_ply INTEGER,
    total_plies INTEGER,

    -- Per-phase error counts for WHITE
    white_opening_inaccuracies INTEGER DEFAULT 0,
    white_opening_mistakes INTEGER DEFAULT 0,
    white_opening_blunders INTEGER DEFAULT 0,
    white_middlegame_inaccuracies INTEGER DEFAULT 0,
    white_middlegame_mistakes INTEGER DEFAULT 0,
    white_middlegame_blunders INTEGER DEFAULT 0,
    white_endgame_inaccuracies INTEGER DEFAULT 0,
    white_endgame_mistakes INTEGER DEFAULT 0,
    white_endgame_blunders INTEGER DEFAULT 0,

    -- Per-phase error counts for BLACK
    black_opening_inaccuracies INTEGER DEFAULT 0,
    black_opening_mistakes INTEGER DEFAULT 0,
    black_opening_blunders INTEGER DEFAULT 0,
    black_middlegame_inaccuracies INTEGER DEFAULT 0,
    black_middlegame_mistakes INTEGER DEFAULT 0,
    black_middlegame_blunders INTEGER DEFAULT 0,
    black_endgame_inaccuracies INTEGER DEFAULT 0,
    black_endgame_mistakes INTEGER DEFAULT 0,
    black_endgame_blunders INTEGER DEFAULT 0,

    clock_initial INTEGER,
    clock_increment INTEGER,
    created_at INTEGER,

    -- JSON blob for detailed data (moves, clocks, full analysis)
    game_data JSON NOT NULL
);

-- Critical indexes for query performance
CREATE INDEX idx_avg_elo ON games(avg_elo);
CREATE INDEX idx_speed ON games(speed);
CREATE INDEX idx_white_elo ON games(white_elo);
CREATE INDEX idx_black_elo ON games(black_elo);
CREATE INDEX idx_opening_eco ON games(opening_eco);
CREATE INDEX idx_opening_base_name ON games(opening_base_name);
CREATE INDEX idx_composite_elo_speed ON games(avg_elo, speed);
CREATE INDEX idx_composite_opening_elo_speed ON games(opening_base_name, avg_elo, speed);
```

**Rationale for per-phase error columns**:
- These columns allow fast statistical queries without parsing JSON
- Can query: `SELECT AVG(white_opening_blunders + black_opening_blunders) FROM games WHERE avg_elo >= 1200 AND avg_elo < 1250`
- JSON blob still contains full move-by-move details for reference

**Opening base name normalization**:
- "Ruy Lopez: Berlin Defense" → "ruy lopez"
- "Bishop's Opening: Vienna Hybrid" → "bishop's opening"
- Extract base opening name by taking text before ":" and lowercasing
- This allows grouping all variations of an opening together

**JSON blob structure** (`game_data` column):
```json
{
  "moves": "e4 e5 Nf3 Nc6 Bb5",
  "clocks": [30, 30, 29, 30, 28, ...],
  "division": {"middle": 16, "end": 46},
  "analysis": [
    {
      "eval": 17,
      "best": "c4",
      "variation": "c4 e5 g3...",
      "judgment": "inaccuracy"
    },
    ...
  ]
}
```

## Data Pipeline

### Phase 1: PGN Parsing & Filtering

#### Script: `scripts/parse_lichess_pgn.py`

**Filtering criteria** (based on PGN headers and comments):
1. ✅ `[Variant "standard"]` or no Variant tag (exclude variants)
2. ✅ Must have `[%eval ...]` comments (has analysis data)
3. ✅ No `[WhiteTitle "BOT"]` or `[BlackTitle "BOT"]` (exclude bots)
4. ✅ `[Rated "true"]` (rated games only)
5. ✅ Time controls: `speed IN ('bullet', 'blitz', 'rapid', 'classical')` (exclude daily/correspondence)
   - Based on Lichess PGN, this is in the `[TimeControl "..."]` tag
   - Filter: base time ≤ 30 minutes (1800 seconds)
6. ✅ Minimum game length: 4 moves (8 plies) - allows Scholar's mate and similar short games

**PGN parsing strategy**:
- Use `python-chess` library for robust PGN parsing
- Stream processing (don't load entire 29.4 GB into memory)
- Batch inserts (1000 games at a time) for SQLite performance
- **Progress tracking**: Print updates every 10,000 games processed
  - Format: `Processed: 1,230,000 | Filtered: 890,000 | Inserted: 110,000 (9.0% with eval) | Rate: 1,250 games/sec | ETA: 18h 23m`
  - Include percentage of games with eval data
  - Show current processing rate (games/second)
  - Estimated time remaining based on current rate

**Expected output**:
- ~9% of 90M games = ~8.1M games with analysis
- Further filtering for bots, variants, time controls → **~5-7M games**

#### Performance optimizations:
```python
# Use WAL mode for concurrent reads during writes
PRAGMA journal_mode=WAL;

# Bulk insert optimization
BEGIN TRANSACTION;
INSERT INTO games VALUES (...);  # x1000
COMMIT;

# Memory optimization
PRAGMA cache_size=-2000000;  # 2GB cache
```

### Phase 2: Data Transformation (Embedded in Parsing)

**Transform PGN data to universal format during parsing**:

1. **Parse move annotations for judgments**:
   - `?!` → inaccuracy
   - `?` → mistake
   - `??` → blunder
   - Example: `4... b5?` indicates a mistake on move 4 by Black
   - Example: `11. Nbd2??` indicates a blunder on move 11 by White

2. **Parse evaluations**: Convert `[%eval 2.35]` and `[%eval #-4]` to integers
   - Centipawn: `235` (multiply by 100)
   - Mate: `10000 - mate_in * 100` (e.g., mate in 4 = `9600`)
   - Store in analysis array per move

3. **Parse clock times**: Extract `[%clk 0:00:30]` format
   - Convert to seconds: `30`
   - Store in clocks array

4. **Extract and normalize opening names**:
   - Parse `[Opening "Ruy Lopez: Berlin Defense"]` header
   - Extract base opening: text before ":" or full name if no ":"
   - Normalize: lowercase, trim whitespace
   - Store both full name and base name
   - Example: "Ruy Lopez: Berlin Defense" → base: "ruy lopez"
   - Example: "Sicilian Defense" → base: "sicilian defense"

5. **Categorize by game phase using GameDivider**:
   - Import `GameDivider` from `analysis/chess_analysis/game_divider.py`
   - Parse moves and build board positions
   - Call `GameDivider.divide_game(boards)` to get phase transitions
   - **Opening**: Moves from start to `division.middle` ply
   - **Middlegame**: From `division.middle` to `division.end` ply
   - **Endgame**: From `division.end` to end of game
   - GameDivider uses sophisticated heuristics:
     - Piece count (≤10 majors/minors → middlegame, ≤6 → endgame)
     - Back rank development (sparse back ranks)
     - Position mixedness (piece distribution across board)

6. **Count errors per phase per player**:
   - Iterate through moves with annotations
   - Track which ply number the error occurred
   - Use division boundaries to categorize into opening/middlegame/endgame
   - Increment appropriate counter:
     - White moves: odd ply numbers (1, 3, 5, ...)
     - Black moves: even ply numbers (2, 4, 6, ...)
   - Example: If move `11. Nbd2??` occurred at ply 21, and `division.middle=16`, `division.end=46`:
     - This is White's move (odd ply)
     - Ply 21 is between 16 and 46 → middlegame
     - Increment `white_middlegame_blunders`

7. **Store per-phase counts in columns for fast queries**:
   - `white_opening_inaccuracies`, `white_opening_mistakes`, `white_opening_blunders`
   - `white_middlegame_inaccuracies`, `white_middlegame_mistakes`, `white_middlegame_blunders`
   - `white_endgame_inaccuracies`, `white_endgame_mistakes`, `white_endgame_blunders`
   - Same for Black

### Phase 3: Statistical Analysis

#### Script: `scripts/generate_elo_statistics.py`

**ELO ranges** (comprehensive coverage):
- `below-600` (avg_elo < 600)
- `600-650` (600 ≤ avg_elo < 650)
- `650-700`
- `700-750`
- `750-800`
- `800-850`
- `850-900`
- `900-950`
- `950-1000`
- `1000-1050`
- `1050-1100`
- `1100-1150`
- `1150-1200`
- `1200-1250`
- `1250-1300`
- `1300-1350`
- `1350-1400`
- `1400-1450`
- `1450-1500`
- `1500-1550`
- `1550-1600`
- `1600-1650`
- `1650-1700`
- `1700-1750`
- `1750-1800`
- `1800-1850`
- `1850-1900`
- `1900-1950`
- `1950-2000`
- `2000-2050`
- `2050-2100`
- `2100-2150`
- `2150-2200`
- `2200-2250`
- `2250-2300`
- `2300-2350`
- `2350-2400`
- `2400+` (avg_elo ≥ 2400)

Total: **38 ELO ranges**

**Speed categories**:
- bullet
- blitz
- rapid
- classical (if enough data)

**For each ELO range × speed combination**:

1. **Query games** (fast because error counts are in columns):
```sql
-- Example for 1200-1250 range, bullet speed
SELECT
    (white_opening_inaccuracies + black_opening_inaccuracies) as opening_inaccuracies,
    (white_opening_mistakes + black_opening_mistakes) as opening_mistakes,
    (white_opening_blunders + black_opening_blunders) as opening_blunders,
    (white_middlegame_inaccuracies + black_middlegame_inaccuracies) as middlegame_inaccuracies,
    (white_middlegame_mistakes + black_middlegame_mistakes) as middlegame_mistakes,
    (white_middlegame_blunders + black_middlegame_blunders) as middlegame_blunders,
    (white_endgame_inaccuracies + black_endgame_inaccuracies) as endgame_inaccuracies,
    (white_endgame_mistakes + black_endgame_mistakes) as endgame_mistakes,
    (white_endgame_blunders + black_endgame_blunders) as endgame_blunders,
    game_data,
    winner,
    opening_end_ply,
    total_plies
FROM games
WHERE avg_elo >= 1200 AND avg_elo < 1250
  AND speed = 'bullet'
LIMIT 10000;  -- Sample size for statistics
```

2. **Calculate per-game metrics from query results**:
   - Opening: inaccuracies, mistakes, blunders (already summed white + black)
   - Middlegame: inaccuracies, mistakes, blunders
   - Endgame: inaccuracies, mistakes, blunders
   - Time usage: parse clocks from JSON to calculate percent_time_used_in_opening, middlegame, endgame
   - Game outcome metrics: checkmate_rate, timeout_rate, resignation_rate, etc.
   - Advanced metrics: eval_volatility, comeback_rate, mate_conversion_rate, etc.

3. **Compute distribution parameters**:
```python
from scipy import stats
import numpy as np

# For each metric (e.g., opening_inaccuracies_per_game)
data = [row['opening_inaccuracies'] for row in results]

mean = np.mean(data)
std = np.std(data)
skew = stats.skew(data)
```

4. **Query opening-specific statistics**:
```sql
-- Example for "ruy lopez" in 1200-1250 range, bullet speed
SELECT
    (white_opening_inaccuracies + black_opening_inaccuracies) as opening_inaccuracies,
    (white_opening_mistakes + black_opening_mistakes) as opening_mistakes,
    (white_opening_blunders + black_opening_blunders) as opening_blunders,
    opening_eco
FROM games
WHERE avg_elo >= 1200 AND avg_elo < 1250
  AND speed = 'bullet'
  AND opening_base_name = 'ruy lopez'
LIMIT 1000;  -- Sample size per opening
```

5. **Generate opening statistics**:
   - Group by `opening_base_name` within each ELO range × speed
   - Calculate mean, std, skew for opening-phase errors only
   - Include ECO code for reference
   - Only include openings with sufficient data (≥100 games)

6. **Output JSON** (38 files, one per ELO range):
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
- **PGN parsing + transformation**: ~12-18 hours for 90M games
  - Stream processing with `python-chess`
  - GameDivider adds ~5-10ms per game
  - Opening name normalization adds ~1ms per game
  - Progress updates every 10k games
- **Statistical generation**: ~1-2 hours
  - 38 ranges × 4 speeds = 152 query batches
  - Error counts in columns make queries very fast
  - Opening-specific queries add ~30 minutes
  - Most time spent parsing JSON for time metrics
- **Total**: ~14-20 hours one-time processing

### Storage requirements:
- **Source PGN**: 29.4 GB (compressed) - on `/data/` drive
- **SQLite database**: ~8-10 GB (for 7M games) - on `/data/` drive
  - Extra columns add ~50 bytes per row
  - JSON blob compressed by SQLite
- **JSON output**: ~3-7 MB total (38 files with opening data)

### Query performance (with indexes):
- Single ELO range query: <0.5 seconds for 10k games (error counts in columns)
- Opening-specific query: <0.2 seconds for 1k games per opening
- Full statistics generation: <2 hours for all 152 combinations + openings
- Index overhead: ~600 MB (worth it for query speed)

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

- Error counts in columns enable fast statistical queries without JSON parsing
- Opening base name column enables efficient grouping of opening variations
- JSON blob retained for detailed analysis and future features
- GameDivider integration ensures consistent phase detection
- Move annotations (`?!`, `?`, `??`) already provided by Lichess
- 38 ELO ranges (50-point increments) provide fine-grained accuracy
- Opening-specific stats use same error metrics, just filtered by opening
- Database on `/data/` drive keeps project directory small
- Only ~3-7 MB of JSON files deployed to web server
- Re-running statistics is fast (~2 hours) for iterating on parameters
- Opening stats provide insights into opening-specific error patterns at each skill level
