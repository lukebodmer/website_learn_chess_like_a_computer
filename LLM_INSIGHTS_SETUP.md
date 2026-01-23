# LLM Insights - Quick Setup Guide

## What's New

You now have an AI-powered insights system that generates human-readable summaries of your chess analysis! The system uses DeepSeek's API to analyze your game results and provide actionable insights like:

- How your games typically end (wins by checkmate, resignation, timeout, etc.)
- Comparison with similar-rated players
- Specific recommendations for improvement
- Rating trends and progress analysis

## Setup Instructions

### 1. Get a DeepSeek API Key

1. Visit https://platform.deepseek.com/
2. Create an account (if you don't have one)
3. Navigate to the API Keys section
4. Generate a new API key
5. Copy the key (you'll need it in the next step)

**Note**: DeepSeek is very cost-effective - each insight generation costs less than $0.001 (a fraction of a cent).

### 2. Configure Your API Key

Add your API key to your environment:

```bash
export DEEPSEEK_API_KEY="your_api_key_here"
```

Or create a `.env` file in the project root:

```
DEEPSEEK_API_KEY=your_api_key_here
```

### 3. Run Migrations

The system added a new field to store insights:

```bash
python manage.py migrate
```

### 4. Test It Out!

1. Generate a new chess analysis report (or view an existing one)
2. Look for the "🤖 AI Insights" section in the Game Results chart
3. The insights will be automatically generated and displayed

## Architecture Overview

The system is modular and extensible:

```
analysis/llm_insights/
├── llm_client.py              # Abstract LLM interface
├── deepseek_client.py         # DeepSeek implementation
├── game_results_analyzer.py   # Data extraction & structuring
├── insights_generator.py      # Prompt creation & orchestration
└── README.md                  # Comprehensive documentation
```

### Key Features

✅ **Modular Design**: Easy to swap LLM providers (OpenAI, Anthropic, etc.)
✅ **Object-Oriented**: Clean separation of concerns
✅ **Cached**: Insights stored in database to avoid regeneration
✅ **Cost-Effective**: Uses DeepSeek's affordable API
✅ **Extensible**: Easy to add insights for other components
✅ **Well-Documented**: Comprehensive README with examples

## Usage

### Backend API

Generate insights programmatically:

```python
POST /api/generate-insights/<report_id>/
Content-Type: application/json

{
  "component": "game_results",
  "force_regenerate": false
}
```

### Frontend Integration

The GameResultsChart component automatically:
1. Fetches insights when the report loads
2. Shows a loading state
3. Displays insights in a highlighted section
4. Handles errors gracefully

### Python API

Use the insights system directly in code:

```python
from analysis.llm_insights import (
    DeepSeekClient,
    GameResultsAnalyzer,
    InsightsGenerator
)

# Initialize client
client = DeepSeekClient(api_key=settings.DEEPSEEK_API_KEY)
generator = InsightsGenerator(client)

# Generate insights
result = generator.generate_game_results_insights(
    username="player123",
    enriched_games=report.enriched_games,
    elo_averages_data=elo_data,
    elo_chart_data=report.elo_chart_data
)

if result['success']:
    print(result['insights'])
```

## Cost Breakdown

### DeepSeek Pricing
- Input: $0.14 per 1M tokens
- Output: $0.28 per 1M tokens

### Typical Usage Per Report
- Input tokens: ~500 (game stats + population data)
- Output tokens: ~250 (concise insights)
- **Total cost: ~$0.0001** (less than 1/100th of a cent)

### Cost Optimization
- ✅ Insights cached in database
- ✅ Max 300 tokens per response
- ✅ Generated only when user views report
- ✅ Efficient prompt structure

## Extending the System

### Add Insights for Other Components

Want insights for blunder analysis, openings, or time management? It's easy!

1. **Create an Analyzer** (if needed):
```python
# analysis/llm_insights/blunder_analyzer.py
class BlunderAnalyzer:
    def analyze(self, stockfish_data):
        # Extract blunder patterns
        return structured_data
```

2. **Add to InsightsGenerator**:
```python
def generate_blunder_insights(self, username, stockfish_data):
    analyzer = BlunderAnalyzer(username)
    data = analyzer.analyze(stockfish_data)
    prompt = self._build_blunder_prompt(data)
    return self.llm_client.generate(prompt, ...)
```

3. **Update the API View**:
```python
elif component == 'blunder_analysis':
    result = generator.generate_blunder_insights(...)
```

4. **Update Frontend**:
```typescript
// Fetch insights for blunder component
fetchLlmInsights('blunder_analysis')
```

### Add a Different LLM Provider

Want to use OpenAI or Anthropic instead?

1. **Implement the LLMClient interface**:
```python
# analysis/llm_insights/openai_client.py
from .llm_client import LLMClient, LLMResponse

class OpenAIClient(LLMClient):
    def generate(self, prompt, **kwargs):
        # Call OpenAI API
        pass
```

2. **Update the view**:
```python
# In views.py
llm_client = OpenAIClient(api_key=settings.OPENAI_API_KEY)
```

That's it! The rest of the system works unchanged.

## Troubleshooting

### "DeepSeek API key not configured"
- Check that `DEEPSEEK_API_KEY` is set in your environment
- Restart Django after adding the key
- Verify the key is correct

### Insights not appearing
- Check browser console for JavaScript errors
- Ensure report_id is present in the page
- Verify the API endpoint is accessible
- Check Django logs for backend errors

### "Request timed out"
- Check your internet connection
- Verify DeepSeek API is accessible
- Increase timeout in DeepSeekClient initialization

## Next Steps

1. **Get your API key**: https://platform.deepseek.com/
2. **Configure environment**: Add `DEEPSEEK_API_KEY`
3. **Run migrations**: `python manage.py migrate`
4. **Test it out**: Generate or view a report
5. **Expand functionality**: Add insights for other components

## Learn More

- Full documentation: `analysis/llm_insights/README.md`
- DeepSeek API docs: https://platform.deepseek.com/docs
- Architecture details: See README.md in llm_insights module

## Support

Questions or issues? Check:
1. The comprehensive README in `analysis/llm_insights/`
2. Code comments and docstrings
3. Django logs for error messages
4. Browser console for frontend issues

---

**Built with**: DeepSeek API, Django, React, TypeScript
**Cost**: <$0.001 per insight generation
**Status**: Production ready ✅
