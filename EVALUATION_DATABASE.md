# PostgreSQL Chess Evaluations Database

## Overview

This project uses a PostgreSQL database containing approximately **300 million evaluated chess positions** (300GB+ of data) to provide precomputed Stockfish evaluations for rapid chess game analysis.

## Starting the Database

The PostgreSQL database runs locally using the `postgres_data` directory as the data directory.

### Check if Running
```bash
ps aux | grep postgres
```

### Start Database
```bash
# The database should auto-start, but if needed:
pg_ctl -D postgres_data start
```

### Stop Database
```bash
pg_ctl -D postgres_data stop
```

### Connect to Database
```bash
# Connect via Unix socket (configured in Django settings)
psql -h /home/lj/projects/website_learn_chess_like_a_computer/postgres_data -U chess_user -d chess_evaluations
```

## Database Schema

The database contains three main tables with the following structure:

### 1. `evaluations_position`
Stores unique chess positions in FEN notation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `fen` | text | FEN notation (indexed) - **truncated format** without halfmove/fullmove counters |

**Example FEN**: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -`

### 2. `evaluations_data`
Stores analysis metadata for each position evaluation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `position_id` | bigint | Foreign key → `evaluations_position.id` |
| `depth` | integer | Stockfish analysis depth |
| `knodes` | numeric | Thousands of nodes analyzed |

### 3. `evaluations_pv` (Principal Variation)
Stores the evaluation results and best move sequences.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `evaluation_id` | bigint | Foreign key → `evaluations_data.id` |
| `pv_index` | integer | Principal variation index (0 = best move, 1+ = alternatives) |
| `cp` | integer | Centipawn evaluation (+100 = +1.00 advantage for current player) |
| `mate` | integer | Mate in N moves (NULL if not mate) |
| `line` | text | Best move sequence in algebraic notation |

## Key Indexes

- **`evaluations_position.fen`** - Primary lookup index for position queries
- **`evaluations_pv(evaluation_id, pv_index)`** - Composite index for efficient PV lookups
- **`evaluations_pv.cp`** - Index on evaluation scores
- **`evaluations_pv.mate`** - Index on mate scores

## Sample Query

```sql
-- Get best evaluation for a specific position
SELECT
    p.fen,
    d.depth,
    d.knodes,
    pv.cp as evaluation,
    pv.mate,
    pv.line
FROM evaluations_position p
JOIN evaluations_data d ON p.id = d.position_id
JOIN evaluations_pv pv ON d.id = pv.evaluation_id
WHERE p.fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3'
  AND pv.pv_index = 0
ORDER BY d.depth DESC, d.knodes DESC
LIMIT 1;
```

## Sample Data

```
                             fen                              | depth | knodes | cp  | mate |                        line
--------------------------------------------------------------+-------+--------+-----+------+----------------------------------------------------
 r1bq1rk1/ppppnpbp/6p1/3PN1Bn/4P3/2P5/PP1N1PPP/R2QKB1R w KQ - |    22 |   1250 | 134 |      | e5d3 h7h6 g5h4 h5f6 f1e2 g6g5 h4g3 d7d6 e1h1 a7a5
 6k1/8/r1NR3p/4K1pP/6P1/6n1/8/8 b - -                         |    20 |    890 |  14 |      | g8h7 d6e6 a6a4 c6d4 h7g7 e6e7 g7f8 e7c7 f8g8 c7c6
 8/6p1/2k2p2/5p1p/1QK2P1P/8/6P1/8 b - -                       |    36 |   2100 |     |    6 | c6d7 c4d5 d7c7 b4d6 c7b7 d5c5 b7a7 c5c6 g7g5 d6c7
```

## FEN Format Notes

- Database FENs are **truncated** to 4 components: `position active_color castling en_passant`
- Halfmove and fullmove counters are **not stored**
- The `DatabaseEvaluator` class automatically handles this truncation for lookups

## Data Format for Analysis

The database returns evaluation data in this format:
```python
{
    'fen': 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3',
    'depth': 22,
    'knodes': 1250.5,
    'evaluation': 25,        # Centipawn score
    'mate': None,           # or integer for mate in N
    'line': 'c5 Nf3 d6 d4 cxd4 Nxd4 Nf6',  # Principal variation
    'best': 'c7c5',         # Best move in UCI format
    'variation': 'c5 Nf3 d6 d4 cxd4 Nxd4 Nf6',  # Same as line
    'source': 'database'
}
```

## Performance Considerations

- **300M positions**: Database queries use indexed lookups for O(log n) performance
- **Batch queries**: Limited to 100 positions per batch to avoid memory issues
- **Connection**: Uses Django's multi-database configuration with Unix socket connection
- **Query optimization**: Uses `DISTINCT ON` and `LIMIT` clauses to prevent large result sets

## Django Integration

The database is configured in `chess_analysis/settings.py` as the `evaluations` database:

```python
'evaluations': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': 'chess_evaluations',
    'USER': 'chess_user',
    'PASSWORD': 'chess_password',
    'HOST': BASE_DIR / 'postgres_data',  # Unix socket
    'PORT': '',  # Empty for Unix socket
}
```

Access via: `DatabaseEvaluator()` class in `analysis/chess_analysis/database_evaluator.py`