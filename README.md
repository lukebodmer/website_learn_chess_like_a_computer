# Learn Chess Like a Computer

An interactive chess analysis web application that enriches Lichess game data with precomputed evaluations from a massive PostgreSQL database containing 300 million chess positions.

## Database Architecture

### PostgreSQL Chess Evaluations Database

This project integrates with a PostgreSQL database containing approximately **300 million evaluated chess positions** (300GB+ of data). The database provides precomputed Stockfish evaluations to dramatically speed up chess game analysis.

#### Database Configuration

The Django project uses a multi-database setup:
- `default`: SQLite3 database for Django's standard tables (users, sessions, etc.)
- `evaluations`: PostgreSQL database containing the chess position evaluations

**Settings Configuration** (`chess_analysis/settings.py`):
```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    },
    "evaluations": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "chess_evaluations",
        "USER": "chess_user",
        "PASSWORD": "chess_password",
        "HOST": BASE_DIR / "postgres_data",  # Unix socket connection
        "PORT": "",  # Empty for Unix socket
        "OPTIONS": {
            "sslmode": "prefer",
        },
    }
}
```

#### Database Schema

The PostgreSQL evaluations database contains three main tables:

1. **`evaluations_position`**
   - `id`: Primary key
   - `fen`: FEN notation of the chess position (indexed for fast lookups)

2. **`evaluations_data`**
   - `id`: Primary key
   - `position_id`: Foreign key to `evaluations_position.id`
   - `depth`: Stockfish analysis depth
   - `knodes`: Thousands of nodes analyzed

3. **`evaluations_pv`** (Principal Variation)
   - `id`: Primary key
   - `evaluation_id`: Foreign key to `evaluations_data.id`
   - `pv_index`: Principal variation index (0 for best move)
   - `cp`: Centipawn evaluation (+100 = +1.00 advantage)
   - `mate`: Mate in N moves (if applicable)
   - `line`: Best move sequence

#### Database Integration Classes

**`DatabaseEvaluator`** (`analysis/chess_analysis/database_evaluator.py`)
- Handles efficient queries against the 300M position database
- Uses indexed FEN lookups with batch processing (max 100 positions per query)
- Provides methods for single position lookups and bulk position checking
- **Key Features:**
  - `get_position_evaluation(fen)`: Single position lookup
  - `get_multiple_position_evaluations(fens)`: Batch position lookup
  - `check_positions_exist(fens)`: Efficient existence checking
  - `get_game_positions_with_evaluations(moves)`: Full game analysis

**`StockfishAnalyzer`** (`analysis/chess_analysis/stockfish_analyzer.py`)
- Modified to check the database first before running Stockfish analysis
- Falls back to live Stockfish evaluation for positions not in database
- Tracks statistics on database vs fresh analysis usage

**`GameEnricher`** (`analysis/chess_analysis/game_enricher.py`)
- Identifies games lacking evaluation data
- Coordinates database lookups and Stockfish fallback analysis
- Injects calculated accuracy percentages back into game JSON
- **Hard limit set to 5 games** for debugging purposes

## Analysis Workflow

1. **Game Detection**: Identify games without existing accuracy data in `raw_json.players.{color}.analysis.accuracy`

2. **Database-First Lookup**: For each position in the game:
   - Query the PostgreSQL database using FEN notation
   - Retrieve precomputed evaluations if available
   - Track database hit rate

3. **Stockfish Fallback**: For positions not in database:
   - Use local Stockfish engine for live analysis
   - Analyze at specified depth (default: 20)
   - Cache results for potential future use

4. **Data Enrichment**:
   - Calculate player accuracy from evaluations
   - Inject accuracy percentage into original game JSON structure
   - Maintain data source statistics (database vs Stockfish vs existing)

## Performance Considerations

- **Indexed Queries**: All database lookups use indexed FEN columns for O(log n) performance
- **Batch Processing**: Multiple positions processed in batches of 100 to avoid memory issues
- **Connection Management**: Uses Django's multi-database routing for efficient connection handling
- **Query Optimization**: DISTINCT ON and LIMIT clauses prevent excessive result sets

## Usage Statistics Tracked

The system tracks detailed statistics during analysis:
- `database_evaluations_used`: Positions found in PostgreSQL database
- `stockfish_evaluations_used`: Positions requiring fresh Stockfish analysis
- `existing_evaluations_used`: Positions that already had evaluation data
- `total_mistakes_found`: Blunders, mistakes, and inaccuracies identified
- `games_with_new_analysis`: Games that received new evaluation data

## Example Database Query

```sql
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
WHERE p.fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
  AND pv.pv_index = 0
ORDER BY d.depth DESC, d.knodes DESC
LIMIT 1;
```

## Architecture Overview

### Main Application (Django + React)
- **Backend**: Django with PostgreSQL (300M chess evaluations) + SQLite (app data)
- **Frontend**: React with TypeScript and Vite
- **Deployment**: Digital Ocean App Platform

### GCP Stockfish API
- **Location**: `gcp-stockfish-api/` directory
- **Purpose**: High-performance position evaluation for positions not in database
- **Deployment**: Google Cloud Run with authentication
- **API**: REST endpoints for batch position evaluation

## Development Setup

### Main Application
1. Ensure PostgreSQL database is running with the chess evaluations data
2. Update database credentials in `chess_analysis/settings.py`
3. Run Django migrations: `python manage.py migrate`
4. Install Stockfish engine for fallback analysis
5. Test database connectivity: `python manage.py shell -c "from analysis.chess_analysis.database_evaluator import DatabaseEvaluator; print(DatabaseEvaluator().get_database_connection_info())"`

### GCP Stockfish API
See `gcp-stockfish-api/README.md` for deployment instructions.

The integration provides a powerful foundation for rapid chess analysis by leveraging precomputed evaluations while maintaining the flexibility to analyze new positions on-demand.

## Example lichess data
below are two examples of data fetched from lichess to be used to generate reports. The first has evaluation and the second doesn't (and will need to be enriched with evaluation data from the database and stockfish_api):

  {
    "id": "aTz9APKg",
    "rated": true,
    "variant": "standard",
    "speed": "blitz",
    "perf": "blitz",
    "createdAt": 1766853633692,
    "lastMoveAt": 1766854323925,
    "status": "resign",
    "source": "pool",
    "players": {
      "white": {
        "user": {
          "name": "megaloblasto",
          "id": "megaloblasto"
        },
        "rating": 1255,
        "ratingDiff": -14,
        "analysis": {
          "inaccuracy": 1,
          "mistake": 1,
          "blunder": 1,
          "acpl": 51,
          "accuracy": 82
        }
      },
      "black": {
        "user": {
          "name": "kerchiano_true",
          "id": "kerchiano_true"
        },
        "rating": 1332,
        "ratingDiff": 10,
        "analysis": {
          "inaccuracy": 1,
          "mistake": 0,
          "blunder": 0,
          "acpl": 22,
          "accuracy": 97
        }
      }
    },
    "fullId": "aTz9APKgnq72",
    "winner": "black",
    "opening": {
      "eco": "C60",
      "name": "Ruy Lopez",
      "ply": 5
    },
    "moves": "e4 e5 Nf3 Nc6 Bb5 Bd6 Bxc6 dxc6 d4 Bg4 Qd3 Bxf3 gxf3 exd4 Qxd4 Nf6 Bg5 Be7 Nc3 Qxd4 O-O h6 Rad1 Qe5 f4 Qa5 Bh4 O-O e5 Nd5 Nxd5 cxd5 Bxe7 Rfe8 Ba3 c6 Rfe1 Qa4 c3 Qxf4 Rd4 Qf5 f4 Qg4+ Kh1 Rad8 Rg1 Qf3+ Rg2 b6 b4 Rc8 Bb2 c5 Rd2 Qxf4 Rdf2 Qxe5 Bc1 Qe1+ Rg1 Qxf2 Bxh6 Re1 Rxe1 Qxe1+ Kg2 gxh6",
    "clocks": [
      30003,
      30003,
      30139,
      29851,
      30307,
      29651,
      29363,
      29819,
      29563,
      28667,
      27883,
      27715,
      27467,
      27587,
      27499,
      27667,
      27467,
      27867,
      27571,
      27875,
      27203,
      27723,
      27331,
      27227,
      26707,
      26267,
      24851,
      23467,
      24723,
      20571,
      22579,
      20115,
      22683,
      20035,
      21099,
      19939,
      19043,
      19619,
      18763,
      19395,
      16771,
      18739,
      15835,
      18115,
      15787,
      16059,
      15755,
      15291,
      15283,
      14219,
      14635,
      12443,
      14507,
      11995,
      12691,
      11763,
      8339,
      9899,
      8187,
      9491,
      8123,
      8715,
      8043,
      8443,
      3843,
      8595,
      4051,
      8775,
      3259
    ],
    "analysis": [
      {
        "eval": 18
      },
      {
        "eval": 22
      },
      {
        "eval": 18
      },
      {
        "eval": 21
      },
      {
        "eval": 15
      },
      {
        "eval": 53
      },
      {
        "eval": -9,
        "best": "c2c3",
        "variation": "c3 Nf6 O-O a6 Ba4 O-O Re1 Re8 d4 h6",
        "judgment": {
          "name": "Inaccuracy",
          "comment": "Inaccuracy. c3 was best."
        }
      },
      {
        "eval": 0
      },
      {
        "eval": 0
      },
      {
        "eval": 12
      },
      {
        "eval": -42
      },
      {
        "eval": -40
      },
      {
        "eval": -39
      },
      {
        "eval": -24
      },
      {
        "eval": -13
      },
      {
        "eval": -10
      },
      {
        "eval": -50
      },
      {
        "eval": 1
      },
      {
        "eval": -656,
        "best": "d4c3",
        "variation": "Qc3",
        "judgment": {
          "name": "Blunder",
          "comment": "Blunder. Qc3 was best."
        }
      },
      {
        "eval": -654
      },
      {
        "eval": -700
      },
      {
        "eval": -714
      },
      {
        "eval": -751
      },
      {
        "eval": -675
      },
      {
        "eval": -667
      },
      {
        "eval": -656
      },
      {
        "eval": -697
      },
      {
        "eval": -664
      },
      {
        "eval": -672
      },
      {
        "eval": -655
      },
      {
        "eval": -663
      },
      {
        "eval": -640
      },
      {
        "eval": -612
      },
      {
        "eval": -638
      },
      {
        "eval": -672
      },
      {
        "eval": -606
      },
      {
        "eval": -627
      },
      {
        "eval": -605
      },
      {
        "eval": -713
      },
      {
        "eval": -688
      },
      {
        "eval": -722
      },
      {
        "eval": -665
      },
      {
        "eval": -698
      },
      {
        "eval": -698
      },
      {
        "eval": -766
      },
      {
        "eval": -573,
        "best": "g4f3",
        "variation": "Qf3+ Kg1 Re6 f5 Qxf5 Rd2 h5 Rg2 Rg6 Rxg6 Qxg6+ Kf1",
        "judgment": {
          "name": "Inaccuracy",
          "comment": "Inaccuracy. Qf3+ was best."
        }
      },
      {
        "eval": -725
      },
      {
        "eval": -723
      },
      {
        "eval": -693
      },
      {
        "eval": -712
      },
      {
        "eval": -737
      },
      {
        "eval": -661
      },
      {
        "eval": -659
      },
      {
        "eval": -736
      },
      {
        "eval": -702
      },
      {
        "eval": -706
      },
      {
        "eval": -723
      },
      {
        "eval": -716
      },
      {
        "mate": -5,
        "best": "f2f1",
        "variation": "Rf1 Qe4 c4 d4 Bc1 Re6 Kg1 Rg6 Rg3 Rxg3+ hxg3 Kh8",
        "judgment": {
          "name": "Mistake",
          "comment": "Checkmate is now unavoidable. Rf1 was best."
        }
      },
      {
        "mate": -4
      },
      {
        "mate": -4
      },
      {
        "mate": -3
      },
      {
        "mate": -2
      },
      {
        "mate": -6
      },
      {
        "mate": -6
      },
      {
        "mate": -5
      },
      {
        "mate": -5
      },
      {
        "mate": -4
      }
    ],
    "clock": {
      "initial": 300,
      "increment": 3,
      "totalTime": 420
    },
    "division": {
      "middle": 13,
      "end": 33
    }
  },
  {
    "id": "kjGbvYGc",
    "rated": true,
    "variant": "standard",
    "speed": "blitz",
    "perf": "blitz",
    "createdAt": 1766689400482,
    "lastMoveAt": 1766689870520,
    "status": "resign",
    "source": "pool",
    "players": {
      "white": {
        "user": {
          "name": "megaloblasto",
          "id": "megaloblasto"
        },
        "rating": 1238,
        "ratingDiff": 17
      },
      "black": {
        "user": {
          "name": "Ricjame",
          "id": "ricjame"
        },
        "rating": 1218,
        "ratingDiff": -5
      }
    },
    "fullId": "kjGbvYGcbndX",
    "winner": "white",
    "opening": {
      "eco": "B40",
      "name": "Sicilian Defense: Delayed Alapin Variation, with e6",
      "ply": 5
    },
    "moves": "e4 c5 Nf3 e6 c3 a6 Bc4 Nc6 O-O Qc7 d4 Nf6 Qd3 Ne7 Bg5 d5 exd5 exd5 Bxd5 Nexd5 Re1+ Be7 Bxf6 gxf6 Nbd2 Nf4 Qe3 Rg8 g3 Nh3+ Kg2 Bd7 dxc5 O-O-O Qxe7 Rde8 Qxf7 Rxe1 Qxg8+ Qd8 Qxd8+ Kxd8 Rxe1",
    "clocks": [
      30003,
      30003,
      29699,
      30171,
      29491,
      29819,
      28643,
      29699,
      28539,
      28059,
      28603,
      26283,
      27747,
      25035,
      26915,
      24475,
      22995,
      22107,
      18475,
      21779,
      17931,
      21331,
      17179,
      21331,
      16099,
      20643,
      14715,
      20443,
      14379,
      19531,
      12859,
      17315,
      12923,
      16835,
      12219,
      16939,
      11219,
      16771,
      10899,
      15299,
      10931,
      15459,
      11130,
      14997
    ],
    "clock": {
      "initial": 300,
      "increment": 3,
      "totalTime": 420
    },
    "division": {
      "middle": 25,
      "end": 42
    }
  },
