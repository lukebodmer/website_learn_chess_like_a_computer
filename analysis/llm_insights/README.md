# LLM Insights Module

A modular, object-oriented system for generating AI-powered insights from chess game data using Large Language Models.

## Overview

This module provides a clean, extensible architecture for generating human-readable summaries and insights from chess analysis data. It uses DeepSeek's API (or other LLM providers) to create concise, actionable insights that help players understand their strengths and weaknesses.

## Architecture

The system is designed with clear separation of concerns:

```
analysis/llm_insights/
├── __init__.py                  # Module exports
├── llm_client.py                # Abstract base class for LLM clients
├── deepseek_client.py           # DeepSeek implementation
├── game_results_analyzer.py     # Game results data extraction
├── insights_generator.py        # Orchestrates insight generation
└── README.md                    # This file
```

### Key Components

#### 1. LLM Client Layer (`llm_client.py`, `deepseek_client.py`)

**Purpose**: Abstracts LLM API interactions behind a consistent interface

**Key Classes**:
- `LLMClient`: Abstract base class defining the interface
- `LLMResponse`: Standardized response format
- `DeepSeekClient`: Concrete implementation for DeepSeek's API

**Benefits**:
- Easy to swap LLM providers (OpenAI, Anthropic, etc.)
- Consistent error handling
- Token usage tracking
- Cost estimation

**Example Usage**:
```python
from analysis.llm_insights import DeepSeekClient

client = DeepSeekClient(api_key="your_api_key")
response = client.generate(
    prompt="Analyze this chess position...",
    temperature=0.7,
    max_tokens=300
)

if response.success:
    print(response.content)
    print(f"Tokens used: {response.tokens_used}")
```

#### 2. Data Analyzer Layer (`game_results_analyzer.py`)

**Purpose**: Extracts and structures raw game data for LLM consumption

**Key Class**: `GameResultsAnalyzer`

**Features**:
- Calculates win/loss/draw statistics by method (checkmate, resignation, timeout, etc.)
- Breaks down performance by time control
- Analyzes ELO trends over time
- Compares user stats with population averages
- Identifies notable differences (>10 percentage points)

**Data Structures**:
- `WinLossDrawStats`: Detailed breakdown of game outcomes
- `TimeControlStats`: Performance by time control (bullet, blitz, rapid)
- `EloTrendData`: Rating progression analysis
- `PopulationComparison`: Comparison with similar-rated players
- `GameResultsData`: Complete structured analysis

**Example Usage**:
```python
from analysis.llm_insights import GameResultsAnalyzer

analyzer = GameResultsAnalyzer(username="player123")
data = analyzer.analyze(
    enriched_games=games_list,
    elo_averages_data=population_data,
    elo_chart_data=historical_elo
)

print(f"Win rate: {data.win_loss_draw.win_percentage}%")
print(f"Wins by checkmate: {data.win_loss_draw.wins_by_checkmate_pct}%")
```

#### 3. Insights Generator Layer (`insights_generator.py`)

**Purpose**: Orchestrates the entire insight generation process

**Key Class**: `InsightsGenerator`

**Workflow**:
1. Analyzes game data using appropriate analyzer
2. Constructs specialized prompts with structured data
3. Calls LLM client with optimized parameters
4. Returns formatted insights ready for display

**Features**:
- Crafted system prompts for chess-specific analysis
- Structured data prompts with key statistics
- Temperature and token limit optimization
- Cost estimation before generation

**Example Usage**:
```python
from analysis.llm_insights import InsightsGenerator, DeepSeekClient

llm_client = DeepSeekClient(api_key="your_key")
generator = InsightsGenerator(llm_client)

result = generator.generate_game_results_insights(
    username="player123",
    enriched_games=games,
    elo_averages_data=population_data,
    elo_chart_data=elo_history
)

if result['success']:
    print(result['insights'])  # Human-readable summary
    print(f"Cost: ${generator.estimate_cost(...)}")
```

## Integration with Django

### Report Generation Flow

**Insights are now generated automatically during report creation** (not on-demand via API):
  * [ ] 
1. **Server-Side Generation** (`analysis/task_processor.py`):
   - After stockfish analysis and principles analysis complete
   - Progress updates to "Generating AI insights from your games..." (98%)
   - Insights are saved to `AnalysisReport.llm_insights` before task completes
   - Handles errors gracefully and continues even if LLM generation fails

2. **Real-Time Streaming** (`analysis/views.py` - `stream_analysis_progress`):
   - Completion event includes `llm_insights` field
   - Frontend receives insights via Server-Sent Events (SSE)
   - No page refresh needed to see insights

3. **Client-Side Display** (`templates/analysis/report.html`):
   - Receives insights from streaming completion event
   - Stores in `window.llmInsights` global variable
   - Dispatches `llmInsightsReady` custom event to notify React components

### Example stockfish analysis data that can be used for the llm:

{"total_games_analyzed": 20, "games_with_new_analysis": 0, "total_mistakes_found": 266, "mistake_breakdown": {"blunders": 75, "mistakes": 61, "inaccuracies": 130}, "database_evaluations_used": 0, "stockfish_evaluations_used": 0, "existing_evaluations_used": 0, "principles": {"username": "megaloblasto", "total_games_analyzed": 20, "by_time_control": {"bullet": {"elo_range": "1300-1400", "time_control": "bullet", "games_analyzed": 2, "principles": {"opening_awareness": {"raw_metrics": {"games_analyzed": 2, "avg_opening_inaccuracies": 2.0, "avg_opening_mistakes": 0.0, "avg_opening_blunders": 0.0, "total_opening_errors": 2.0, "by_opening": {"C64": {"games": 1, "avg_errors": 0.0}, "B01": {"games": 1, "avg_errors": 4.0}}}, "elo_comparison": {"user_total_errors": 2.0, "elo_average": 2.03, "difference": -0.03, "percentile": 83.7}}, "middlegame_planning": {"raw_metrics": {"games_analyzed": 2, "avg_middlegame_inaccuracies": 1.5, "avg_middlegame_mistakes": 0.5, "avg_middlegame_blunders": 1.5, "total_middlegame_errors": 3.5}, "elo_comparison": {"user_total_errors": 3.5, "elo_average": 3.07, "difference": 0.43, "percentile": 59.6}}, "endgame_technique": {"raw_metrics": {"games_analyzed": 2, "avg_endgame_inaccuracies": 0.0, "avg_endgame_mistakes": 0.0, "avg_endgame_blunders": 0.0, "total_endgame_errors": 0.0}, "elo_comparison": {"user_total_errors": 0.0, "elo_average": 1.81, "difference": -1.81, "percentile": 99.1}}, "king_safety": {"raw_metrics": {"total_games": 2, "checkmated_count": 0, "checkmated_rate": 0.0, "lost_with_mate_threat": 0, "lost_with_threat_rate": 0.0}, "elo_comparison": {"user_checkmate_rate": 0.0, "elo_average": 0.16, "difference": -0.16, "percentile": 96.2}}, "checkmate_ability": {"raw_metrics": {"forced_mate_positions": 0, "mates_converted": 0, "mates_lost": 0, "conversion_rate": 0.0}, "elo_comparison": {"user_conversion_rate": 0.0, "elo_average": 0.16, "difference": -0.16, "percentile": 3.9}}, "defensive_skill": {"raw_metrics": {"losing_positions": 2, "comebacks_won": 0, "comebacks_drawn": 0, "total_comebacks": 0, "comeback_rate": 0.0}, "elo_comparison": {"user_comeback_rate": 0.0, "elo_average": 0.12, "difference": -0.12, "percentile": 2.7}}, "precision_move_quality": {"raw_metrics": {"games_analyzed": 2, "avg_eval_volatility": 77.1, "smooth_games": 2, "volatile_games": 0}, "elo_comparison": {"user_volatility": 77.1, "elo_average": 128.43, "difference": -51.33, "percentile": 70.0}}, "planning_calculating": {"raw_metrics": {"total_quiet_moves": 42, "avg_quiet_move_eval_change": 51.17, "good_quiet_moves": 39, "bad_quiet_moves": 3}, "elo_comparison": {"user_quiet_move_quality": 51.17, "elo_average": 66.29, "difference": -15.13, "percentile": 38.6}}, "time_management": {"raw_metrics": {"total_games": 2, "timeouts": 1, "timeout_rate": 0.5, "time_pressure_blunders": 1, "time_pressure_blunder_rate": 0.5, "lost_with_time_remaining": 0}, "elo_comparison": {"user_timeout_rate": 0.5, "elo_average": 0.277, "difference": 0.223, "percentile": 52.7}}}}, "blitz": {"elo_range": "1200-1300", "time_control": "blitz", "games_analyzed": 18, "principles": {"opening_awareness": {"raw_metrics": {"games_analyzed": 18, "avg_opening_inaccuracies": 0.89, "avg_opening_mistakes": 0.61, "avg_opening_blunders": 0.44, "total_opening_errors": 1.94, "by_opening": {"B40": {"games": 1, "avg_errors": 5.0}, "D06": {"games": 1, "avg_errors": 2.0}, "D00": {"games": 2, "avg_errors": 1.0}, "A04": {"games": 1, "avg_errors": 2.0}, "D02": {"games": 3, "avg_errors": 0.0}, "C47": {"games": 1, "avg_errors": 3.0}, "A46": {"games": 1, "avg_errors": 1.0}, "B00": {"games": 1, "avg_errors": 4.0}, "C60": {"games": 1, "avg_errors": 1.0}, "A45": {"games": 1, "avg_errors": 2.0}, "C55": {"games": 1, "avg_errors": 2.0}, "C80": {"games": 1, "avg_errors": 1.0}, "C24": {"games": 1, "avg_errors": 5.0}, "C64": {"games": 1, "avg_errors": 3.0}, "B01": {"games": 1, "avg_errors": 2.0}}}, "elo_comparison": {"user_total_errors": 1.94, "elo_average": 2.09, "difference": -0.15, "percentile": 80.1}}, "middlegame_planning": {"raw_metrics": {"games_analyzed": 18, "avg_middlegame_inaccuracies": 1.17, "avg_middlegame_mistakes": 0.56, "avg_middlegame_blunders": 1.39, "total_middlegame_errors": 3.11}, "elo_comparison": {"user_total_errors": 3.11, "elo_average": 3.04, "difference": 0.07, "percentile": 67.9}}, "endgame_technique": {"raw_metrics": {"games_analyzed": 18, "avg_endgame_inaccuracies": 1.0, "avg_endgame_mistakes": 0.56, "avg_endgame_blunders": 0.44, "total_endgame_errors": 2.0}, "elo_comparison": {"user_total_errors": 2.0, "elo_average": 1.74, "difference": 0.26, "percentile": 80.3}}, "king_safety": {"raw_metrics": {"total_games": 18, "checkmated_count": 6, "checkmated_rate": 0.333, "lost_with_mate_threat": 8, "lost_with_threat_rate": 0.444}, "elo_comparison": {"user_checkmate_rate": 0.333, "elo_average": 0.167, "difference": 0.167, "percentile": 61.2}}, "checkmate_ability": {"raw_metrics": {"forced_mate_positions": 3, "mates_converted": 2, "mates_lost": 1, "conversion_rate": 0.667}, "elo_comparison": {"user_conversion_rate": 0.667, "elo_average": 0.177, "difference": 0.49, "percentile": 80.7}}, "defensive_skill": {"raw_metrics": {"losing_positions": 12, "comebacks_won": 1, "comebacks_drawn": 2, "total_comebacks": 3, "comeback_rate": 0.25}, "elo_comparison": {"user_comeback_rate": 0.25, "elo_average": 0.13, "difference": 0.12, "percentile": 31.7}}, "precision_move_quality": {"raw_metrics": {"games_analyzed": 18, "avg_eval_volatility": 191.91, "smooth_games": 8, "volatile_games": 5}, "elo_comparison": {"user_volatility": 191.91, "elo_average": 133.07, "difference": 58.84, "percentile": 27.9}}, "planning_calculating": {"raw_metrics": {"total_quiet_moves": 441, "avg_quiet_move_eval_change": 54.57, "good_quiet_moves": 356, "bad_quiet_moves": 39}, "elo_comparison": {"user_quiet_move_quality": 54.57, "elo_average": 69.35, "difference": -14.78, "percentile": 39.3}}, "time_management": {"raw_metrics": {"total_games": 18, "timeouts": 0, "timeout_rate": 0.0, "time_pressure_blunders": 11, "time_pressure_blunder_rate": 0.611, "lost_with_time_remaining": 0}, "elo_comparison": {"user_timeout_rate": 0.0, "elo_average": 0.287, "difference": -0.287, "percentile": 97.3}}}}}, "aggregated": {"elo_range": "1200-1300", "games_analyzed": 20, "principles": {"opening_awareness": {"raw_metrics": {"games_analyzed": 20, "avg_opening_inaccuracies": 1.0, "avg_opening_mistakes": 0.55, "avg_opening_blunders": 0.4, "total_opening_errors": 1.95, "by_opening": {"B40": {"games": 1, "avg_errors": 5.0}, "D06": {"games": 1, "avg_errors": 2.0}, "D00": {"games": 2, "avg_errors": 1.0}, "A04": {"games": 1, "avg_errors": 2.0}, "D02": {"games": 3, "avg_errors": 0.0}, "C64": {"games": 2, "avg_errors": 1.5}, "C47": {"games": 1, "avg_errors": 3.0}, "A46": {"games": 1, "avg_errors": 1.0}, "B00": {"games": 1, "avg_errors": 4.0}, "B01": {"games": 2, "avg_errors": 3.0}, "C60": {"games": 1, "avg_errors": 1.0}, "A45": {"games": 1, "avg_errors": 2.0}, "C55": {"games": 1, "avg_errors": 2.0}, "C80": {"games": 1, "avg_errors": 1.0}, "C24": {"games": 1, "avg_errors": 5.0}}}, "elo_comparison": {"user_total_errors": 1.95, "elo_average": 2.09, "difference": -0.14, "percentile": 81.6}}, "middlegame_planning": {"raw_metrics": {"games_analyzed": 20, "avg_middlegame_inaccuracies": 1.2, "avg_middlegame_mistakes": 0.55, "avg_middlegame_blunders": 1.4, "total_middlegame_errors": 3.15}, "elo_comparison": {"user_total_errors": 3.15, "elo_average": 3.04, "difference": 0.11, "percentile": 67.3}}, "endgame_technique": {"raw_metrics": {"games_analyzed": 20, "avg_endgame_inaccuracies": 0.9, "avg_endgame_mistakes": 0.5, "avg_endgame_blunders": 0.4, "total_endgame_errors": 1.8}, "elo_comparison": {"user_total_errors": 1.8, "elo_average": 1.74, "difference": 0.06, "percentile": 82.5}}, "king_safety": {"raw_metrics": {"total_games": 20, "checkmated_count": 6, "checkmated_rate": 0.3, "lost_with_mate_threat": 8, "lost_with_threat_rate": 0.4}, "elo_comparison": {"user_checkmate_rate": 0.3, "elo_average": 0.167, "difference": 0.133, "percentile": 66.3}}, "checkmate_ability": {"raw_metrics": {"forced_mate_positions": 3, "mates_converted": 2, "mates_lost": 1, "conversion_rate": 0.667}, "elo_comparison": {"user_conversion_rate": 0.667, "elo_average": 0.177, "difference": 0.49, "percentile": 80.7}}, "defensive_skill": {"raw_metrics": {"losing_positions": 14, "comebacks_won": 1, "comebacks_drawn": 2, "total_comebacks": 3, "comeback_rate": 0.214}, "elo_comparison": {"user_comeback_rate": 0.214, "elo_average": 0.13, "difference": 0.084, "percentile": 25.6}}, "precision_move_quality": {"raw_metrics": {"games_analyzed": 20, "avg_eval_volatility": 180.43, "smooth_games": 10, "volatile_games": 5}, "elo_comparison": {"user_volatility": 180.43, "elo_average": 133.07, "difference": 47.36, "percentile": 32.2}}, "planning_calculating": {"raw_metrics": {"total_quiet_moves": 483, "avg_quiet_move_eval_change": 54.25, "good_quiet_moves": 395, "bad_quiet_moves": 42}, "elo_comparison": {"user_quiet_move_quality": 54.25, "elo_average": 69.35, "difference": -15.11, "percentile": 39.1}}, "time_management": {"raw_metrics": {"total_games": 20, "timeouts": 1, "timeout_rate": 0.05, "time_pressure_blunders": 12, "time_pressure_blunder_rate": 0.6, "lost_with_time_remaining": 0}, "elo_comparison": {"user_timeout_rate": 0.05, "elo_average": 0.287, "difference": -0.237, "percentile": 95.8}}}}}}

### Example elo averages data
in static/data/elo_averages/1200-1300.json

### Example enriched games data set
in docs/enriched_game_data_example.md 

### Backend API Endpoint (For Existing Reports)

**URL**: `/api/generate-insights/<report_id>/`

**Method**: POST

**Request Body**:
```json
{
  "component": "game_results",
  "force_regenerate": false
}
```

**Response**:
```json
{
  "success": true,
  "insights": "Based on your recent games...",
  "cached": true,
  "tokens_used": 450,
  "metadata": {
    "has_population_comparison": true,
    "has_elo_trends": true,
    "time_controls_analyzed": 3
  }
}
```

**Features**:
- Returns cached insights from database (generated during report creation)
- Supports `force_regenerate` to bypass cache
- Tracks token usage and generation metadata
- Handles authentication and authorization
- Used when viewing existing reports or if streaming data unavailable

### Database Schema

**Model**: `AnalysisReport`

**New Field**:
```python
llm_insights = models.JSONField(default=dict, blank=True)
```

**Structure**:
```json
{
  "game_results": {
    "insights": "Your detailed insights text...",
    "generated_at": "2026-01-23T10:30:00Z",
    "tokens_used": 450,
    "metadata": {}
  },
  "blunder_analysis": { ... },
  "opening_analysis": { ... }
}
```

### Frontend Integration

The frontend React component automatically receives and displays insights:

**File**: `src/components/game-results-chart.tsx`

**Features**:
- **Real-time updates**: Receives insights via streaming events (no API polling)
- **Collapsible UI**: Insights collapsed by default with preview
- **Event-driven**: Listens for `llmInsightsReady` custom event
- **Dual-mode**: Checks streaming data first, falls back to API for existing reports
- **Loading states**: Shows "Waiting...", "Generating...", then actual insights
- **Error handling**: User-friendly error messages
- **Smooth animations**: Expand/collapse transitions

**UI Flow (New Reports)**:
1. Component mounts and renders existing charts
2. Waits for analysis to complete (streaming updates)
3. Shows "Waiting for game analysis to complete..."
4. When insights arrive via SSE, shows "Generating insights..."
5. Receives `llmInsightsReady` event with insights
6. Displays insights in collapsible container (collapsed by default)
7. **No page refresh needed!**

**UI Flow (Existing Reports)**:
1. Component mounts with enriched games from template
2. Calls API to fetch cached insights from database
3. Displays insights immediately in collapsible container

**Collapsible Design**:
- Shows first ~2 lines of text when collapsed
- Fade gradient at bottom-right to indicate more content
- Chevron icon (▼) next to title, rotates when expanded
- Click anywhere on the entire container to expand/collapse
- Smooth height transition animation

## Configuration

### Environment Variables

Add your DeepSeek API key to your environment:

```bash
export DEEPSEEK_API_KEY="your_api_key_here"
```

Or add to your `.env` file:

```
DEEPSEEK_API_KEY=your_api_key_here
```

### Django Settings

The API key is configured in `chess_analysis/settings.py`:

```python
# DeepSeek API settings for LLM insights
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
```

### Getting a DeepSeek API Key

1. Visit https://platform.deepseek.com/
2. Sign up for an account
3. Navigate to API Keys section
4. Create a new API key
5. Add it to your environment variables

## Extending the System

### Adding a New LLM Provider

1. Create a new client class:

```python
# analysis/llm_insights/openai_client.py
from .llm_client import LLMClient, LLMResponse, LLMProvider

class OpenAIClient(LLMClient):
    @property
    def provider(self) -> LLMProvider:
        return LLMProvider.OPENAI

    def generate(self, prompt, **kwargs) -> LLMResponse:
        # Implement OpenAI API calls
        pass

    def validate_connection(self) -> bool:
        # Implement connection validation
        pass
```

2. Update `__init__.py`:

```python
from .openai_client import OpenAIClient

__all__ = [..., 'OpenAIClient']
```

3. Use in views:

```python
from .llm_insights import OpenAIClient

llm_client = OpenAIClient(api_key=settings.OPENAI_API_KEY)
```

### Adding Insights for New Components

1. Create a new analyzer (if needed):

```python
# analysis/llm_insights/opening_analyzer.py
class OpeningAnalyzer:
    def analyze(self, games, opening_stats):
        # Extract opening-specific data
        pass
```

2. Add a prompt builder in `InsightsGenerator`:

```python
def generate_opening_insights(self, username, games, opening_stats):
    analyzer = OpeningAnalyzer(username)
    data = analyzer.analyze(games, opening_stats)

    prompt = self._build_opening_prompt(username, data)
    response = self.llm_client.generate(prompt, ...)

    return response
```

3. Update the view to handle the new component:

```python
elif component == 'opening_analysis':
    result = generator.generate_opening_insights(...)
```

4. Update frontend to fetch insights:

```typescript
// In your component
fetchLlmInsights('opening_analysis')
```

## Cost Considerations

### DeepSeek Pricing (as of implementation)

- **deepseek-chat**:
  - Input: $0.14 per 1M tokens
  - Output: $0.28 per 1M tokens

- **deepseek-reasoner**:
  - Input: $0.55 per 1M tokens
  - Output: $2.19 per 1M tokens

### Typical Usage

For game results insights:
- Input tokens: ~400-800 (depending on game count and population data)
- Output tokens: ~250-300 (limited by max_tokens=300)
- **Cost per request: ~$0.0001 - $0.0003 (less than a cent)**

### Optimization Strategies

1. **Caching**: Insights are cached in the database
2. **Max tokens**: Limited to 300 to keep responses concise
3. **Selective generation**: Only generate when user views the report
4. **Efficient prompts**: Structured data minimizes token usage

## Testing

### Unit Tests

```python
# tests/test_llm_insights.py
def test_game_results_analyzer():
    analyzer = GameResultsAnalyzer("testuser")
    data = analyzer.analyze(mock_games)
    assert data.total_games == len(mock_games)
    assert data.win_loss_draw.total_wins > 0

def test_deepseek_client():
    client = DeepSeekClient(api_key="test_key")
    # Use mock API responses
    response = client.generate("test prompt")
    assert response.success
```

### Integration Tests

```python
def test_insights_generation_endpoint(client):
    # Create test report
    report = AnalysisReport.objects.create(...)

    # Call API
    response = client.post(
        f'/api/generate-insights/{report.id}/',
        {'component': 'game_results'}
    )

    assert response.status_code == 200
    assert 'insights' in response.json()
```

## Troubleshooting

### Common Issues

1. **"DeepSeek API key not configured"**
   - Ensure `DEEPSEEK_API_KEY` is set in environment
   - Check settings.py is reading the variable correctly

2. **"Request timed out"**
   - Increase timeout in client initialization
   - Check network connectivity
   - Verify DeepSeek API status

3. **"Insights not displaying"**
   - Check browser console for errors
   - Verify report ID exists in DOM
   - Check CSRF token is present

4. **"Unexpected response format"**
   - Update client to handle new API response structure
   - Check API version compatibility

### Debug Mode

Enable detailed logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger('analysis.llm_insights')
```

## TODO: Add Insights to Additional Components

Currently, LLM insights are only implemented for the **Game Results Chart**. The following components need insights added:

### 1. Mistakes Analysis Chart

**Component**: `src/components/mistakes-analysis-chart.tsx`

**Steps**:
1. **Create Analyzer** (`analysis/llm_insights/mistakes_analyzer.py`):
   - Extract mistake frequency by type (blunders, mistakes, inaccuracies)
   - Analyze mistake patterns by game phase (opening, middlegame, endgame)
   - Compare with population averages for similar ELO

2. **Add Prompt Method** in `InsightsGenerator`:
   - `generate_mistakes_insights(username, enriched_games, elo_averages_data)`
   - Build structured prompt with mistake statistics
   - Focus on actionable advice for reducing mistakes

3. **Update Task Processor** (`analysis/task_processor.py`):
   - Generate mistakes insights after game results insights
   - Store in `llm_insights['mistakes_analysis']`

4. **Update React Component**:
   - Add collapsible insights section
   - Listen for `llmInsightsReady` event
   - Check `window.llmInsights.mistakes_analysis`

### 2. Blunder Analysis

**Component**: `src/components/blunder-analysis.tsx`

**Steps**:
1. **Create Analyzer** (`analysis/llm_insights/blunder_analyzer.py`):
   - Use game phase data from stockfish anaylsis like avg_opening_blunders, avg_middlegame_blunders, avg_endgame_blunders
   - Get time_pressure_blunder_rate from stockfish_analysis data
   - get the "mistake_breakdown": {"blunders": 75, "mistakes": 61, "inaccuracies": 130} information

2. **Add Prompt Method** in `InsightsGenerator`:
   - `generate_blunder_insights(username, enriched_games, blunder_puzzles)`
   - Highlight patterns and suggest targeted practice

3. **Update Task Processor**:
   - Generate after mistakes insights
   - Store in `llm_insights['blunder_analysis']`

4. **Update React Component**:
   - Add collapsible insights section
   - Coordinate with puzzle recommendations UI

### 3. Time Analysis

**Component**: `src/components/time-analysis.tsx`

**Steps**:
1. **Create Analyzer** (`analysis/llm_insights/time_analyzer.py`):
   - Data that the llm can uses includes: by_time_control": {"bullet": {"elo_range": "1300-1400", "time_control": "bullet",  "time_management": {"raw_metrics": {"total_games": 2, "timeouts": 1, "timeout_rate": 0.5, "time_pressure_blunders": 1, "time_pressure_blunder_rate": 0.5, "lost_with_time_remaining": 0}, "elo_comparison": {"user_timeout_rate": 0.5, "elo_average": 0.277, "difference": 0.223, "percentile": 52.7}}}}, "blitz": {"elo_range": "1200-1300", "time_control": "blitz", 

2. **Add Prompt Method** in `InsightsGenerator`:
   - `generate_time_insights(username, enriched_games, time_management_data, elo_averages)`
   - Highlight good and bad of the users time usage.

3. **Update Task Processor**:
   - Generate after blunder insights
   - Store in `llm_insights['time_analysis']`

4. **Update React Component**:
   - Add collapsible insights section
   - Integrate with time management charts

### 4. Principles Summary

**Component**: `src/components/principles-summary.tsx`

**Steps**:
1. **Create Analyzer** (`analysis/llm_insights/principles_analyzer_llm.py`):
   - Data the llm can use includes: "principles": {"opening_awareness": {"raw_metrics": {"games_analyzed": 18, "avg_opening_inaccuracies": 0.89, "avg_opening_mistakes": 0.61, "avg_opening_blunders": 0.44, "total_opening_errors": 1.94, "by_opening": {"B40": {"games": 1, "avg_errors": 5.0}, "D06": {"games": 1, "avg_errors": 2.0}, "D00": {"games": 2, "avg_errors": 1.0}, "A04": {"games": 1, "avg_errors": 2.0}, "D02": {"games": 3, "avg_errors": 0.0}, "C47": {"games": 1, "avg_errors": 3.0}, "A46": {"games": 1, "avg_errors": 1.0}, "B00": {"games": 1, "avg_errors": 4.0}, "C60": {"games": 1, "avg_errors": 1.0}, "A45": {"games": 1, "avg_errors": 2.0}, "C55": {"games": 1, "avg_errors": 2.0}, "C80": {"games": 1, "avg_errors": 1.0}, "C24": {"games": 1, "avg_errors": 5.0}, "C64": {"games": 1, "avg_errors": 3.0}, "B01": {"games": 1, "avg_errors": 2.0}}}, "elo_comparison": {"user_total_errors": 1.94, "elo_average": 2.09, "difference": -0.15, "percentile": 80.1}}, "middlegame_planning": {"raw_metrics": {"games_analyzed": 18, "avg_middlegame_inaccuracies": 1.17, "avg_middlegame_mistakes": 0.56, "avg_middlegame_blunders": 1.39, "total_middlegame_errors": 3.11}, "elo_comparison": {"user_total_errors": 3.11, "elo_average": 3.04, "difference": 0.07, "percentile": 67.9}}, "endgame_technique": {"raw_metrics": {"games_analyzed": 18, "avg_endgame_inaccuracies": 1.0, "avg_endgame_mistakes": 0.56, "avg_endgame_blunders": 0.44, "total_endgame_errors": 2.0}, "elo_comparison": {"user_total_errors": 2.0, "elo_average": 1.74, "difference": 0.26, "percentile": 80.3}}, "king_safety": {"raw_metrics": {"total_games": 18, "checkmated_count": 6, "checkmated_rate": 0.333, "lost_with_mate_threat": 8, "lost_with_threat_rate": 0.444}, "elo_comparison": {"user_checkmate_rate": 0.333, "elo_average": 0.167, "difference": 0.167, "percentile": 61.2}}, "checkmate_ability": {"raw_metrics": {"forced_mate_positions": 3, "mates_converted": 2, "mates_lost": 1, "conversion_rate": 0.667}, "elo_comparison": {"user_conversion_rate": 0.667, "elo_average": 0.177, "difference": 0.49, "percentile": 80.7}}, "defensive_skill": {"raw_metrics": {"losing_positions": 12, "comebacks_won": 1, "comebacks_drawn": 2, "total_comebacks": 3, "comeback_rate": 0.25}, "elo_comparison": {"user_comeback_rate": 0.25, "elo_average": 0.13, "difference": 0.12, "percentile": 31.7}}, "precision_move_quality": {"raw_metrics": {"games_analyzed": 18, "avg_eval_volatility": 191.91, "smooth_games": 8, "volatile_games": 5}, "elo_comparison": {"user_volatility": 191.91, "elo_average": 133.07, "difference": 58.84, "percentile": 27.9}}, "planning_calculating": {"raw_metrics": {"total_quiet_moves": 441, "avg_quiet_move_eval_change": 54.57, "good_quiet_moves": 356, "bad_quiet_moves": 39}, "elo_comparison": {"user_quiet_move_quality": 54.57, "elo_average": 69.35, "difference": -14.78, "percentile": 39.3}}, "time_management": {"raw_metrics": {"total_games": 18, "timeouts": 0, "timeout_rate": 0.0, "time_pressure_blunders": 11, "time_pressure_blunder_rate": 0.611, "lost_with_time_remaining": 0}, "elo_comparison": 

2. **Add Prompt Method** in `InsightsGenerator`:
   - `generate_principles_insights(username, principles_data, elo_averages)`
   - Prioritize which principles to focus on
   - Explain why certain principles matter for this skill level

3. **Update Task Processor**:
   - Generate after time insights
   - Store in `llm_insights['principles_summary']`

4. **Update React Component**:
   - Add collapsible insights section
   - Position near principle cards

### Implementation Checklist

For each component, follow this pattern:

- [ ] Create data analyzer class with structured output
- [ ] Add prompt building method to `InsightsGenerator`
- [ ] Update `task_processor.py` to generate insights during streaming
- [ ] Add insights to streaming completion event in `views.py`
- [ ] Update React component with collapsible insights section
- [ ] Add event listener for `llmInsightsReady`
- [ ] Test with new report generation
- [ ] Test with existing report viewing
- [ ] Verify insights are cached in database
- [ ] Verify no page refresh needed for real-time updates

### Benefits of Completing This TODO

1. **Comprehensive Analysis**: Users get AI insights for every aspect of their play
2. **Actionable Advice**: Each component provides specific recommendations
3. **Consistent UX**: All insights use the same collapsible, event-driven pattern
4. **Efficient Caching**: All insights generated once during report creation
5. **Real-Time Updates**: No waiting or page refreshes needed

## Future Enhancements

### Planned Features

1. ~~**Streaming responses**: Real-time insight generation for better UX~~ ✅ **COMPLETED**
2. **Multi-component insights**: Generate insights for all components (see TODO above)
3. **Personalized advice**: Tailored recommendations based on playing style
4. **Comparative analysis**: Compare with specific opponents or time periods
5. **Multi-language support**: Generate insights in user's preferred language
6. **Insight history**: Track how insights change over time
7. **A/B testing**: Experiment with different prompt templates
8. **Interactive insights**: Click to see specific games/positions referenced

### Extension Points

The system is designed for easy extension:

- New LLM providers (plug-and-play architecture)
- New component analyzers (opening, tactics, endgame, etc.)
- Custom prompt templates (per user preferences)
- Advanced analytics (ML-based pattern detection)
- Integration with training modules (generate practice plans)

## Contributing

When adding new features:

1. Follow the existing architecture patterns
2. Write comprehensive docstrings
3. Add type hints for all functions
4. Create unit tests for new analyzers
5. Update this README with new capabilities
6. Consider backward compatibility

## Support

For issues or questions:
- Check this README first
- Review code comments and docstrings
- Test with example data
- Check DeepSeek API documentation
- Create detailed bug reports with logs

## License

This module is part of the Learn Chess Like a Computer project.
