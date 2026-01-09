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

**`HybridStockfishAnalyzer`** (`analysis/chess_analysis/hybrid_analyzer.py`)
- Combines database lookups with GCP Stockfish API for optimal performance
- First checks database for existing evaluations (fast)
- Sends remaining positions to GCP API for evaluation (scalable)
- Tracks statistics on database vs GCP API analysis usage

**`GameEnricher`** (`analysis/chess_analysis/game_enricher.py`)
- Identifies games lacking evaluation data
- Coordinates database lookups and GCP Stockfish API analysis
- Injects calculated accuracy percentages back into game JSON
- **Hard limit set to 5 games** for debugging purposes

## Analysis Workflow

1. **Game Detection**: Identify games without existing accuracy data in `raw_json.players.{color}.analysis.accuracy`

2. **Database-First Lookup**: For each position in the game:
   - Query the PostgreSQL database using FEN notation
   - Retrieve precomputed evaluations if available
   - Track database hit rate

3. **GCP Stockfish API**: For positions not in database:
   - Send positions to GCP Stockfish API for evaluation
   - High-performance cloud analysis with configurable depth
   - Scalable processing of multiple positions

4. **Data Enrichment**:
   - Calculate player accuracy from evaluations
   - Inject accuracy percentage into original game JSON structure
   - Maintain data source statistics (database vs GCP API vs existing)

## Performance Considerations

- **Indexed Queries**: All database lookups use indexed FEN columns for O(log n) performance
- **Batch Processing**: Multiple positions processed in batches of 100 to avoid memory issues
- **Connection Management**: Uses Django's multi-database routing for efficient connection handling
- **Query Optimization**: DISTINCT ON and LIMIT clauses prevent excessive result sets

## Usage Statistics Tracked

The system tracks detailed statistics during analysis:
- `database_evaluations_used`: Positions found in PostgreSQL database
- `stockfish_evaluations_used`: Positions evaluated using GCP Stockfish API
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
4. Configure GCP Stockfish API credentials (see `gcp-stockfish-api/` directory)
5. Test database connectivity: `python manage.py shell -c "from analysis.chess_analysis.database_evaluator import DatabaseEvaluator; print(DatabaseEvaluator().get_database_connection_info())"`

### GCP Stockfish API
See `gcp-stockfish-api/README.md` for deployment instructions.

The integration provides a powerful foundation for rapid chess analysis by leveraging precomputed evaluations while maintaining the flexibility to analyze new positions using the scalable GCP Stockfish API.

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
      * [ ] "status": "resign",
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

# Example Chess.com data
  {
    "url": "https://www.chess.com/game/live/81965445927",
    "pgn": "[Event \"Live Chess\"]\n[Site \"Chess.com\"]\n[Date \"2023.07.01\"]\n[Round \"-\"]\n[White \"benakabeen00\"]\n[Black \"megaloblasto\"]\n[Result \"1/2-1/2\"]\n[CurrentPosition \"2QQ4/6K1/8/4k3/Q7/P7/1P6/8 b - -\"]\n[Timezone \"UTC\"]\n[ECO \"C47\"]\n[ECOUrl \"https://www.chess.com/openings/Four-Knights-Game-Scotch-Variation\"]\n[UTCDate \"2023.07.01\"]\n[UTCTime \"15:47:07\"]\n[WhiteElo \"834\"]\n[BlackElo \"846\"]\n[TimeControl \"180+2\"]\n[Termination \"Game drawn by stalemate\"]\n[StartTime \"15:47:07\"]\n[EndDate \"2023.07.01\"]\n[EndTime \"15:55:01\"]\n[Link \"https://www.chess.com/game/live/81965445927\"]\n\n1. e4 {[%clk 0:03:02]} 1... e5 {[%clk 0:03:01.9]} 2. Nc3 {[%clk 0:03:01.2]} 2... Nf6 {[%clk 0:02:59.6]} 3. Nf3 {[%clk 0:03:02.2]} 3... Nc6 {[%clk 0:02:58.7]} 4. d4 {[%clk 0:03:00.4]} 4... Bd6 {[%clk 0:02:56.1]} 5. dxe5 {[%clk 0:02:58.2]} 5... Bxe5 {[%clk 0:02:54.6]} 6. Nd5 {[%clk 0:02:54.9]} 6... O-O {[%clk 0:02:46]} 7. Bg5 {[%clk 0:02:54.9]} 7... h6 {[%clk 0:02:32.6]} 8. Nxe5 {[%clk 0:02:55.4]} 8... Nxe5 {[%clk 0:02:31.6]} 9. Bxf6 {[%clk 0:02:53.9]} 9... gxf6 {[%clk 0:02:32]} 10. f4 {[%clk 0:02:45.6]} 10... c6 {[%clk 0:02:30.9]} 11. fxe5 {[%clk 0:02:41.8]} 11... cxd5 {[%clk 0:02:31.5]} 12. exf6 {[%clk 0:02:39.3]} 12... Qa5+ {[%clk 0:02:26.2]} 13. c3 {[%clk 0:02:34.5]} 13... Qb6 {[%clk 0:02:26.3]} 14. exd5 {[%clk 0:02:33.7]} 14... Qxf6 {[%clk 0:02:24.3]} 15. Qg4+ {[%clk 0:02:25.2]} 15... Kh8 {[%clk 0:02:16.3]} 16. O-O-O {[%clk 0:02:24.6]} 16... Qg5+ {[%clk 0:02:12]} 17. Qxg5 {[%clk 0:02:18.8]} 17... hxg5 {[%clk 0:02:13.9]} 18. Bd3 {[%clk 0:02:18.7]} 18... d6 {[%clk 0:02:09.4]} 19. Rhf1 {[%clk 0:02:18]} 19... Bg4 {[%clk 0:02:06.4]} 20. Rde1 {[%clk 0:02:14.3]} 20... f6 {[%clk 0:02:01.2]} 21. h3 {[%clk 0:02:12.3]} 21... Bd7 {[%clk 0:01:57.3]} 22. Re7 {[%clk 0:02:10.1]} 22... Rad8 {[%clk 0:01:25.8]} 23. Rh7+ {[%clk 0:02:10.2]} 23... Kg8 {[%clk 0:01:26.7]} 24. Rh1 {[%clk 0:02:06.2]} 24... Bb5 {[%clk 0:01:22.6]} 25. Be4 {[%clk 0:01:56.6]} 25... f5 {[%clk 0:01:16.1]} 26. Rxb7 {[%clk 0:01:49.4]} 26... fxe4 {[%clk 0:01:13.5]} 27. Rxb5 {[%clk 0:01:49.9]} 27... e3 {[%clk 0:01:12.1]} 28. Re1 {[%clk 0:01:51.1]} 28... Rde8 {[%clk 0:01:10.7]} 29. Rb4 {[%clk 0:01:51]} 29... e2 {[%clk 0:01:10.2]} 30. Rd4 {[%clk 0:01:51.7]} 30... Rf1 {[%clk 0:01:09]} 31. Kd2 {[%clk 0:01:38.7]} 31... Rxe1 {[%clk 0:01:06.4]} 32. Kxe1 {[%clk 0:01:40.6]} 32... a5 {[%clk 0:00:57.4]} 33. Rd2 {[%clk 0:01:40.5]} 33... Kf7 {[%clk 0:00:55.2]} 34. Rxe2 {[%clk 0:01:41.7]} 34... Rxe2+ {[%clk 0:00:55.8]} 35. Kxe2 {[%clk 0:01:43.6]} 35... Kf6 {[%clk 0:00:57]} 36. Ke3 {[%clk 0:01:43.6]} 36... Ke5 {[%clk 0:00:58.3]} 37. c4 {[%clk 0:01:43.1]} 37... a4 {[%clk 0:00:57.3]} 38. g3 {[%clk 0:01:41.3]} 38... Kf5 {[%clk 0:00:57.4]} 39. a3 {[%clk 0:01:38.3]} 39... Ke5 {[%clk 0:00:58.1]} 40. g4 {[%clk 0:01:35.1]} 40... Kf6 {[%clk 0:00:57.3]} 41. Ke4 {[%clk 0:01:35.1]} 41... Ke7 {[%clk 0:00:52.2]} 42. Kf5 {[%clk 0:01:35.6]} 42... Kf7 {[%clk 0:00:50.6]} 43. Kxg5 {[%clk 0:01:36.3]} 43... Ke7 {[%clk 0:00:51.6]} 44. Kf5 {[%clk 0:01:37.5]} 44... Kd7 {[%clk 0:00:52.6]} 45. h4 {[%clk 0:01:38.9]} 45... Ke7 {[%clk 0:00:54]} 46. h5 {[%clk 0:01:40.4]} 46... Kf7 {[%clk 0:00:55.5]} 47. h6 {[%clk 0:01:41.5]} 47... Kg8 {[%clk 0:00:56]} 48. g5 {[%clk 0:01:42.8]} 48... Kh7 {[%clk 0:00:57.1]} 49. Kf6 {[%clk 0:01:43.3]} 49... Kh8 {[%clk 0:00:55.7]} 50. g6 {[%clk 0:01:43.5]} 50... Kg8 {[%clk 0:00:56.4]} 51. h7+ {[%clk 0:01:39.9]} 51... Kh8 {[%clk 0:00:57.4]} 52. g7+ {[%clk 0:01:40.9]} 52... Kxh7 {[%clk 0:00:58.2]} 53. Kf7 {[%clk 0:01:42.2]} 53... Kh6 {[%clk 0:00:57.4]} 54. g8=Q {[%clk 0:01:44.1]} 54... Kh5 {[%clk 0:00:58.5]} 55. Kg7 {[%clk 0:01:44.6]} 55... Kg5 {[%clk 0:00:59.2]} 56. Qe6 {[%clk 0:01:44.2]} 56... Kf4 {[%clk 0:01:00.2]} 57. Qxd6+ {[%clk 0:01:44.2]} 57... Ke4 {[%clk 0:01:01.2]} 58. Qb4 {[%clk 0:01:45.2]} 58... Kd4 {[%clk 0:01:02.3]} 59. Qxa4 {[%clk 0:01:46.3]} 59... Kd3 {[%clk 0:01:03.1]} 60. d6 {[%clk 0:01:46]} 60... Kd2 {[%clk 0:01:03.4]} 61. d7 {[%clk 0:01:47.9]} 61... Kd3 {[%clk 0:01:04.9]} 62. d8=Q+ {[%clk 0:01:48.9]} 62... Ke4 {[%clk 0:01:05.7]} 63. c5+ {[%clk 0:01:49.8]} 63... Ke5 {[%clk 0:01:06.3]} 64. c6 {[%clk 0:01:51.7]} 64... Ke6 {[%clk 0:01:05.4]} 65. c7 {[%clk 0:01:53.6]} 65... Ke5 {[%clk 0:01:06.6]} 66. c8=Q {[%clk 0:01:54.9]} 1/2-1/2\n",
    "time_control": "180+2",
    "end_time": 1688226901,
    "rated": true,
    "uuid": "8366f326-1826-11ee-81e3-6cfe544c0428",
    "initial_setup": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "fen": "2QQ4/6K1/8/4k3/Q7/P7/1P6/8 b - -",
    "time_class": "blitz",
    "rules": "chess",
    "white": {
      "rating": 834,
      "result": "stalemate",
      "username": "benakabeen00",
      "uuid": "46201d66-78a4-11ed-b03a-93d1d2a29d8b"
    },

# Example formatted chess.com data to match lichess
  {
    "id": "8366f326-1826-11ee-81e3-6cfe544c0428",
    "rated": true,
    "variant": "standard",
    "speed": "blitz",
    "perf": "blitz",
    "createdAt": 1688226901000,
    "lastMoveAt": 1688226901000,
    "status": "resign",
    "source": "pool",
    "players": {
      "white": {
        "user": {
          "name": "benakabeen00",
          "id": "benakabeen00"
        },
        "rating": 834,
        "ratingDiff": 0
      },
      "black": {
        "user": {
          "name": "megaloblasto",
          "id": "megaloblasto"
        },
        "rating": 846,
        "ratingDiff": 0
      }
    },
    "winner": null,
    "opening": {
      "eco": "Unknown",
      "name": "Four Knights Game Scotch Variation",
      "ply": 0
    },
    "moves": "e4 e5 Nc3 Nf6 Nf3 Nc6 d4 Bd6 dxe5 Bxe5 Nd5 O-O Bg5 h6 Nxe5 Nxe5 Bxf6 gxf6 f4 c6 fxe5 cxd5 exf6 Qa5+ c3 Qb6 exd5 Qxf6 Qg4+ Kh8 O-O Qg5+ Qxg5 hxg5 Bd3 d6 Rhf1 Bg4 Rde1 f6 h3 Bd7 Re7 Rad8 Rh7+ Kg8 Rh1 Bb5 Be4 f5 Rxb7 fxe4 Rxb5 e3 Re1 Rde8 Rb4 e2 Rd4 Rf1 Kd2 Rxe1 Kxe1 a5 Rd2 Kf7 Rxe2 Rxe2+ Kxe2 Kf6 Ke3 Ke5 c4 a4 g3 Kf5 a3 Ke5 g4 Kf6 Ke4 Ke7 Kf5 Kf7 Kxg5 Ke7 Kf5 Kd7 h4 Ke7 h5 Kf7 h6 Kg8 g5 Kh7 Kf6 Kh8 g6 Kg8 h7+ Kh8 g7+ Kxh7 Kf7 Kh6 g8=Q Kh5 Kg7 Kg5 Qe6 Kf4 Qxd6+ Ke4 Qb4 Kd4 Qxa4 Kd3 d6 Kd2 d7 Kd3 d8=Q+ Ke4 c5+ Ke5 c6 Ke6 c7 Ke5 c8=Q",
    "clocks": [
      18200,
      18190,
      18120,
      17960,
      18220,
      17870,
      18040,
      17610,
      17820,
      17460,
      17490,
      16600,
      17490,
      15260,
      17540,
      15160,
      17390,
      15200,
      16560,
      15090,
      16180,
      15150,
      15930,
      14619,
      15450,
      14630,
      15369,
      14430,
      14519,
      13630,
      14460,
      13200,
      13880,
      13390,
      13869,
      12940,
      13800,
      12640,
      13430,
      12120,
      13230,
      11730,
      13010,
      8580,
      13019,
      8670,
      12620,
      8260,
      11660,
      7609,
      10940,
      7350,
      10990,
      7209,
      11110,
      7070,
      11100,
      7020,
      11170,
      6900,
      9870,
      6640,
      10060,
      5740,
      10050,
      5520,
      10170,
      5580,
      10360,
      5700,
      10360,
      5830,
      10310,
      5730,
      10130,
      5740,
      9830,
      5810,
      9510,
      5730,
      9510,
      5220,
      9560,
      5060,
      9630,
      5160,
      9750,
      5260,
      9890,
      5400,
      10040,
      5550,
      10150,
      5600,
      10280,
      5710,
      10330,
      5570,
      10350,
      5640,
      9990,
      5740,
      10090,
      5820,
      10220,
      5740,
      10410,
      5850,
      10460,
      5920,
      10420,
      6020,
      10420,
      6120,
      10520,
      6230,
      10630,
      6310,
      10600,
      6340,
      10790,
      6490,
      10890,
      6570,
      10980,
      6630,
      11170,
      6540,
      11360,
      6659,
      11490
    ],
    "clock": {
      "initial": 180,
      "increment": 2,
      "totalTime": 182
    },
    "chess_com_data": {
      "url": "https://www.chess.com/game/live/81965445927",
      "pgn": "[Event \"Live Chess\"]\n[Site \"Chess.com\"]\n[Date \"2023.07.01\"]\n[Round \"-\"]\n[White \"benakabeen00\"]\n[Black \"megaloblasto\"]\n[Result \"1/2-1/2\"]\n[CurrentPosition \"2QQ4/6K1/8/4k3/Q7/P7/1P6/8 b - -\"]\n[Timezone \"UTC\"]\n[ECO \"C47\"]\n[ECOUrl \"https://www.chess.com/openings/Four-Knights-Game-Scotch-Variation\"]\n[UTCDate \"2023.07.01\"]\n[UTCTime \"15:47:07\"]\n[WhiteElo \"834\"]\n[BlackElo \"846\"]\n[TimeControl \"180+2\"]\n[Termination \"Game drawn by stalemate\"]\n[StartTime \"15:47:07\"]\n[EndDate \"2023.07.01\"]\n[EndTime \"15:55:01\"]\n[Link \"https://www.chess.com/game/live/81965445927\"]\n\n1. e4 {[%clk 0:03:02]} 1... e5 {[%clk 0:03:01.9]} 2. Nc3 {[%clk 0:03:01.2]} 2... Nf6 {[%clk 0:02:59.6]} 3. Nf3 {[%clk 0:03:02.2]} 3... Nc6 {[%clk 0:02:58.7]} 4. d4 {[%clk 0:03:00.4]} 4... Bd6 {[%clk 0:02:56.1]} 5. dxe5 {[%clk 0:02:58.2]} 5... Bxe5 {[%clk 0:02:54.6]} 6. Nd5 {[%clk 0:02:54.9]} 6... O-O {[%clk 0:02:46]} 7. Bg5 {[%clk 0:02:54.9]} 7... h6 {[%clk 0:02:32.6]} 8. Nxe5 {[%clk 0:02:55.4]} 8... Nxe5 {[%clk 0:02:31.6]} 9. Bxf6 {[%clk 0:02:53.9]} 9... gxf6 {[%clk 0:02:32]} 10. f4 {[%clk 0:02:45.6]} 10... c6 {[%clk 0:02:30.9]} 11. fxe5 {[%clk 0:02:41.8]} 11... cxd5 {[%clk 0:02:31.5]} 12. exf6 {[%clk 0:02:39.3]} 12... Qa5+ {[%clk 0:02:26.2]} 13. c3 {[%clk 0:02:34.5]} 13... Qb6 {[%clk 0:02:26.3]} 14. exd5 {[%clk 0:02:33.7]} 14... Qxf6 {[%clk 0:02:24.3]} 15. Qg4+ {[%clk 0:02:25.2]} 15... Kh8 {[%clk 0:02:16.3]} 16. O-O-O {[%clk 0:02:24.6]} 16... Qg5+ {[%clk 0:02:12]} 17. Qxg5 {[%clk 0:02:18.8]} 17... hxg5 {[%clk 0:02:13.9]} 18. Bd3 {[%clk 0:02:18.7]} 18... d6 {[%clk 0:02:09.4]} 19. Rhf1 {[%clk 0:02:18]} 19... Bg4 {[%clk 0:02:06.4]} 20. Rde1 {[%clk 0:02:14.3]} 20... f6 {[%clk 0:02:01.2]} 21. h3 {[%clk 0:02:12.3]} 21... Bd7 {[%clk 0:01:57.3]} 22. Re7 {[%clk 0:02:10.1]} 22... Rad8 {[%clk 0:01:25.8]} 23. Rh7+ {[%clk 0:02:10.2]} 23... Kg8 {[%clk 0:01:26.7]} 24. Rh1 {[%clk 0:02:06.2]} 24... Bb5 {[%clk 0:01:22.6]} 25. Be4 {[%clk 0:01:56.6]} 25... f5 {[%clk 0:01:16.1]} 26. Rxb7 {[%clk 0:01:49.4]} 26... fxe4 {[%clk 0:01:13.5]} 27. Rxb5 {[%clk 0:01:49.9]} 27... e3 {[%clk 0:01:12.1]} 28. Re1 {[%clk 0:01:51.1]} 28... Rde8 {[%clk 0:01:10.7]} 29. Rb4 {[%clk 0:01:51]} 29... e2 {[%clk 0:01:10.2]} 30. Rd4 {[%clk 0:01:51.7]} 30... Rf1 {[%clk 0:01:09]} 31. Kd2 {[%clk 0:01:38.7]} 31... Rxe1 {[%clk 0:01:06.4]} 32. Kxe1 {[%clk 0:01:40.6]} 32... a5 {[%clk 0:00:57.4]} 33. Rd2 {[%clk 0:01:40.5]} 33... Kf7 {[%clk 0:00:55.2]} 34. Rxe2 {[%clk 0:01:41.7]} 34... Rxe2+ {[%clk 0:00:55.8]} 35. Kxe2 {[%clk 0:01:43.6]} 35... Kf6 {[%clk 0:00:57]} 36. Ke3 {[%clk 0:01:43.6]} 36... Ke5 {[%clk 0:00:58.3]} 37. c4 {[%clk 0:01:43.1]} 37... a4 {[%clk 0:00:57.3]} 38. g3 {[%clk 0:01:41.3]} 38... Kf5 {[%clk 0:00:57.4]} 39. a3 {[%clk 0:01:38.3]} 39... Ke5 {[%clk 0:00:58.1]} 40. g4 {[%clk 0:01:35.1]} 40... Kf6 {[%clk 0:00:57.3]} 41. Ke4 {[%clk 0:01:35.1]} 41... Ke7 {[%clk 0:00:52.2]} 42. Kf5 {[%clk 0:01:35.6]} 42... Kf7 {[%clk 0:00:50.6]} 43. Kxg5 {[%clk 0:01:36.3]} 43... Ke7 {[%clk 0:00:51.6]} 44. Kf5 {[%clk 0:01:37.5]} 44... Kd7 {[%clk 0:00:52.6]} 45. h4 {[%clk 0:01:38.9]} 45... Ke7 {[%clk 0:00:54]} 46. h5 {[%clk 0:01:40.4]} 46... Kf7 {[%clk 0:00:55.5]} 47. h6 {[%clk 0:01:41.5]} 47... Kg8 {[%clk 0:00:56]} 48. g5 {[%clk 0:01:42.8]} 48... Kh7 {[%clk 0:00:57.1]} 49. Kf6 {[%clk 0:01:43.3]} 49... Kh8 {[%clk 0:00:55.7]} 50. g6 {[%clk 0:01:43.5]} 50... Kg8 {[%clk 0:00:56.4]} 51. h7+ {[%clk 0:01:39.9]} 51... Kh8 {[%clk 0:00:57.4]} 52. g7+ {[%clk 0:01:40.9]} 52... Kxh7 {[%clk 0:00:58.2]} 53. Kf7 {[%clk 0:01:42.2]} 53... Kh6 {[%clk 0:00:57.4]} 54. g8=Q {[%clk 0:01:44.1]} 54... Kh5 {[%clk 0:00:58.5]} 55. Kg7 {[%clk 0:01:44.6]} 55... Kg5 {[%clk 0:00:59.2]} 56. Qe6 {[%clk 0:01:44.2]} 56... Kf4 {[%clk 0:01:00.2]} 57. Qxd6+ {[%clk 0:01:44.2]} 57... Ke4 {[%clk 0:01:01.2]} 58. Qb4 {[%clk 0:01:45.2]} 58... Kd4 {[%clk 0:01:02.3]} 59. Qxa4 {[%clk 0:01:46.3]} 59... Kd3 {[%clk 0:01:03.1]} 60. d6 {[%clk 0:01:46]} 60... Kd2 {[%clk 0:01:03.4]} 61. d7 {[%clk 0:01:47.9]} 61... Kd3 {[%clk 0:01:04.9]} 62. d8=Q+ {[%clk 0:01:48.9]} 62... Ke4 {[%clk 0:01:05.7]} 63. c5+ {[%clk 0:01:49.8]} 63... Ke5 {[%clk 0:01:06.3]} 64. c6 {[%clk 0:01:51.7]} 64... Ke6 {[%clk 0:01:05.4]} 65. c7 {[%clk 0:01:53.6]} 65... Ke5 {[%clk 0:01:06.6]} 66. c8=Q {[%clk 0:01:54.9]} 1/2-1/2\n",
      "time_control": "180+2",
      "end_time": 1688226901,
      "uuid": "8366f326-1826-11ee-81e3-6cfe544c0428",
      "initial_setup": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "fen": "2QQ4/6K1/8/4k3/Q7/P7/1P6/8 b - -",
      "time_class": "blitz",
      "rules": "chess",
      "eco_url": "https://www.chess.com/openings/Four-Knights-Game-Scotch-Variation",
      "accuracies": {}
    }
  },
