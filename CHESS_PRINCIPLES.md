## Overview

The Chess Principles Analysis System quantitatively measures 10 key chess skill areas to identify where players should focus their improvement efforts. After game enrichment completes, the system analyzes all user games and compares performance metrics against rating range averages to generate importance scores (0-100) for each principle.

## Implementation Status: ✅ Complete

**Backend**: All 10 principles implemented in `analysis/chess_analysis/principles_analyzer.py`
**Data Storage**: Results saved in `AnalysisReport.stockfish_analysis['principles']`
**Frontend**: Radar chart visualization in `src/components/principles-summary.tsx`
**Baseline Data**: ECO range averages stored in `data/eco_averages.json` (6 rating ranges: 800-1200, 1200-1400, 1400-1600, 1600-1800, 1800-2000, 2000+)

## How It Works

1. **Data Collection**: After Stockfish analysis enriches all games with evaluations and best moves
2. **Filtering**: System filters games where the user played (white or black) and determines their ECO rating range
3. **Analysis**: Each principle function extracts raw metrics (e.g., blunders per game, mate conversion rate)
4. **Comparison**: Raw metrics compared to ECO range baseline distributions from `eco_averages.json`
5. **Scoring**: Percentile-based importance scores (0-100):
   - Uses skew-normal distribution with mean, std, and skew parameters
   - Calculates user's percentile in the rating range population
   - **Importance score = 100 - percentile**
     - Percentile 100 (best) → Importance 0 (no need to improve)
     - Percentile 50 (average) → Importance 50 (moderate improvement needed)
     - Percentile 0 (worst) → Importance 100 (critical to improve)
   - For multi-metric principles (opening/middlegame/endgame): weighted average of percentiles
6. **Storage**: Results stored with both importance scores and raw metrics for visualization
7. **Display**: Radar chart shows all 10 principles with top 3 areas highlighted

## Architecture

- **Modular Design**: Each principle has its own clearly-named function (e.g., `calculate_opening_awareness()`)
- **Consistent Return Format**: All functions return `{"importance_score": float, "raw_metrics": dict}`
- **ECO Range Auto-Detection**: System automatically determines user's rating range from game data
- **Both Game-Level and Set-Level Analysis**: Some metrics analyzed per-game, others across entire game set
# 10 Key Areas (Implemented)

## 1. Opening Awareness
**Question**: How many mistakes are you making in the opening phase compared to others in your rating range?

**Implementation** (`calculate_opening_awareness()`):
- Counts inaccuracies, mistakes, and blunders during opening phase (moves 1-12)
- Breaks down by ECO opening code to identify strongest/weakest openings
- Compares totals to ECO range averages for opening errors

**Raw Metrics Collected**:
- `opening_inaccuracies_per_game`, `opening_mistakes_per_game`, `opening_blunders_per_game`
- `total_opening_errors`, `games_analyzed`
- Per-opening breakdowns

## 2. Middlegame Planning
**Question**: How many mistakes are you making in the middlegame compared to others?

**Implementation** (`calculate_middlegame_planning()`):
- Counts inaccuracies, mistakes, and blunders during middlegame phase (moves 13-30)
- Compares to ECO range averages for middlegame errors

**Raw Metrics Collected**:
- `middlegame_inaccuracies_per_game`, `middlegame_mistakes_per_game`, `middlegame_blunders_per_game`

## 3. Endgame Technique
**Question**: How many mistakes are you making in the endgame compared to others?

**Implementation** (`calculate_endgame_technique()`):
- Counts inaccuracies, mistakes, and blunders during endgame phase (moves 31+)
- Compares to ECO range averages for endgame errors

**Raw Metrics Collected**:
- `endgame_inaccuracies_per_game`, `endgame_mistakes_per_game`, `endgame_blunders_per_game`

## 4. King Safety
**Question**: How often are you getting checkmated compared to others in your rating range?

**Implementation** (`calculate_king_safety()`):
- Tracks games ending in checkmate (loss by `checkmated` termination)
- Calculates checkmate rate vs ECO range average

**Raw Metrics Collected**:
- `checkmate_losses`, `total_losses`, `checkmate_rate`

## 5. Checkmate Ability
**Question**: How often do you convert winning positions with mate-in-N into actual checkmates?

**Implementation** (`calculate_checkmate_ability()`):
- Detects positions where user had forced mate (eval shows `#N` where N > 0)
- Checks if game ended in checkmate victory
- Compares conversion rate to ECO range average

**Raw Metrics Collected**:
- `forced_mates_found`, `mates_converted`, `mate_conversion_rate`

## 6. Tactics Vision
**Question**: How often are you capitalizing on opponent blunders (300+ centipawn swings)?

**Implementation** (`calculate_tactics_vision()`):
- Detects opponent moves that lose 300+ centipawns
- Checks if user's next move maintains/increases advantage
- Compares capitalization rate to ECO range average

**Raw Metrics Collected**:
- `opponent_blunders`, `blunders_capitalized`, `capitalization_rate`

## 7. Defensive Skill
**Question**: How often do you make comebacks from losing positions (-500cp or worse)?

**Implementation** (`calculate_defensive_skill()`):
- Detects when user is down 500+ centipawns
- Tracks if position improved to win or draw
- Compares comeback rate to ECO range average

**Raw Metrics Collected**:
- `comeback_opportunities`, `successful_comebacks`, `comeback_rate`

## 8. Big Picture (Material Awareness)
**Question**: How often are you hanging pieces or missing obvious captures?

**Implementation** (`calculate_big_picture()`):
- **Hanging pieces**: Counts moves where eval drops 300+ cp and opponent's best move is a capture
- **Missed captures**: Counts positions where best move is a capture but user played something else
- Compares combined rate to ECO range average

**Raw Metrics Collected**:
- `hanging_pieces`, `missed_captures`, `big_picture_errors`, `error_rate`

## 9. Precision and Move Quality
**Question**: How volatile is your play (wild eval swings vs steady improvement)?

**Implementation** (`calculate_precision_move_quality()`):
- Calculates standard deviation of centipawn changes across all user moves
- Higher volatility = less precise play
- Compares to ECO range average

**Raw Metrics Collected**:
- `eval_volatility` (standard deviation), `total_moves`, `average_cp_change`

## 10. Planning / Calculating
**Question**: When you make quiet moves (non-tactical), how good are they compared to others?

**Implementation** (`calculate_planning_calculating()`):
- Filters for "quiet" moves: not check, not capture, not opponent-capture-threatened
- Measures average evaluation change on these moves
- Compares to ECO range average for quiet move quality

**Raw Metrics Collected**:
- `quiet_moves_played`, `average_quiet_move_eval_change`, `good_quiet_moves`, `bad_quiet_moves`

## 11. Time Management
**Question**: Are you losing on time or blundering in time pressure?

**Implementation** (`calculate_time_management()`):
- Tracks timeout losses
- Detects time pressure blunders (blunder with <10% of initial time remaining)
- Compares combined rate to ECO range average

**Raw Metrics Collected**:
- `timeout_losses`, `time_pressure_blunders`, `games_analyzed`, `time_management_issues_rate`

# Data Flow

## 1. Game Enrichment (`analysis/chess_analysis/game_enricher.py`)
- **Lichess games**: Always re-analyzed with Stockfish even if they have existing analysis data (to get complete best/variation data for all moves, not just mistakes)
- **Original Lichess analysis**: Preserved in `raw_json.lichess_analysis` field
- **Stockfish analysis**: Full position-by-position evaluation added to each game

## 2. Principles Analysis (`analysis/chess_analysis/principles_analyzer.py`)
```python
class ChessPrinciplesAnalyzer:
    def __init__(self, enriched_games: List[Dict], username: str, eco_range: Optional[str] = None)
    def analyze_all_principles() -> Dict[str, Any]
```

**Process**:
- Filters enriched games to find user's games (white or black)
- Auto-detects ECO rating range from game data
- Runs all 11 principle calculation functions
- Returns complete analysis with importance scores and raw metrics

## 3. Integration (`analysis/task_processor.py`)
- After enrichment completes, runs `ChessPrinciplesAnalyzer`
- Stores results in `report.stockfish_analysis['principles']`
- Results available for both streaming updates and completed reports

## 4. Frontend Display
- **Template**: `templates/analysis/report.html` - adds containers and hidden data elements
- **Component**: `src/components/principles-summary.tsx` - radar chart with Recharts
- **Mounting**: `src/main.tsx` - auto-mounts component and loads data from `#stockfish-analysis` element
- **Streaming**: JavaScript `updatePrinciplesSummary()` function handles real-time updates

## 5. Baseline Data (`data/eco_averages.json`)
```json
{
  "800-1200": {
    "opening_inaccuracies_per_game": {"mean": 3.2, "std": 1.2, "skew": 0.8},
    "opening_mistakes_per_game": {"mean": 1.8, "std": 0.7, "skew": 0.9},
    // ... 18 total metrics per rating range
    // Each metric has: mean (average value), std (standard deviation), skew (distribution skewness)
  },
  // 5 more ranges: 1200-1400, 1400-1600, 1600-1800, 1800-2000, 2000+
}
```

**Distribution Parameters**:
- `mean`: Average value for players in this rating range
- `std`: Standard deviation (spread of values)
- `skew`: Distribution skewness
  - Positive skew: Most players cluster below mean with long tail above (e.g., blunders)
  - Negative skew: Most players cluster above mean with long tail below (e.g., conversion rates)
  - Uses scipy.stats.skewnorm for percentile calculations

# Testing

Run principles analysis on existing report:
```bash
python test_principles.py
```

This script:
- Loads most recent `AnalysisReport` from database
- Creates `ChessPrinciplesAnalyzer` with report's enriched games
- Tests individual principle calculations
- Verifies data format and scoring
