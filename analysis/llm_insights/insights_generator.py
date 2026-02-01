"""
Insights Generator

Orchestrates the generation of AI-powered insights from chess game data.
Uses structured data from analyzers and combines them with carefully crafted
prompts to generate human-readable summaries.
"""

import logging
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from .llm_client import LLMClient, LLMResponse
from .game_results_analyzer import GameResultsAnalyzer, GameResultsData
from .mistakes_analyzer import MistakesAnalyzer, MistakesData
from .blunder_analyzer import BlunderAnalyzer, BlunderData
from .time_analyzer import TimeAnalyzer, TimeManagementData


logger = logging.getLogger(__name__)


class InsightsGenerator:
    """
    Generates human-readable insights from chess game data using LLMs

    This class coordinates between data analyzers and LLM clients to produce
    concise, actionable insights about a player's game results, trends, and
    areas for improvement.
    """

    def __init__(self, llm_client: LLMClient):
        """
        Initialize the insights generator

        Args:
            llm_client: The LLM client to use for generating insights
        """
        self.llm_client = llm_client

    def generate_game_results_insights(
        self,
        username: str,
        enriched_games: list,
        elo_averages_data: Optional[Dict[str, Any]] = None,
        elo_chart_data: Optional[list] = None
    ) -> Dict[str, Any]:
        """
        Generate insights for the game results component

        Args:
            username: Player's username
            enriched_games: List of enriched game objects
            elo_averages_data: Population average data
            elo_chart_data: Historical ELO data

        Returns:
            Dictionary containing the generated insights and metadata
        """
        try:
            # Analyze the game data
            analyzer = GameResultsAnalyzer(username)
            results_data = analyzer.analyze(
                enriched_games,
                elo_averages_data,
                elo_chart_data
            )

            # Generate the LLM prompt
            prompt = self._build_game_results_prompt(username, results_data)
            system_prompt = self._get_system_prompt()

            # Call the LLM
            logger.info(f"Generating game results insights for {username}")
            response = self.llm_client.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.7,
                max_tokens=300  # Keep it concise
            )

            if response.success:
                return {
                    'success': True,
                    'insights': response.content,
                    'username': username,
                    'total_games': results_data.total_games,
                    'tokens_used': response.tokens_used,
                    'metadata': {
                        'has_population_comparison': results_data.population_comparison is not None,
                        'has_elo_trends': results_data.elo_trends is not None,
                        'time_controls_analyzed': len(results_data.time_control_breakdown)
                    }
                }
            else:
                logger.error(f"LLM generation failed: {response.error}")
                return {
                    'success': False,
                    'error': response.error,
                    'insights': None
                }

        except Exception as e:
            logger.error(f"Error generating game results insights: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'insights': None
            }

    def _get_system_prompt(self) -> str:
        """Get the system prompt for the LLM"""
        return """You are an expert chess analyst providing insights to help players improve their game.

Your role is to:
1. Analyze the provided game statistics and trends
2. Identify patterns, strengths, and areas for improvement
3. Provide concise, actionable insights in a neutral tone (focus on data, not emotions)
4. Compare the player's performance with population averages when available
5. Focus on the most notable and actionable observations

Keep your response to 2 short paragraphs (max 250 words). Be specific with numbers and avoid generic advice."""

    def _build_game_results_prompt(
        self,
        username: str,
        data: GameResultsData
    ) -> str:
        """Build the prompt for game results insights"""
        wld = data.win_loss_draw
        elo = data.elo_trends
        pop = data.population_comparison
        tc_breakdown = data.time_control_breakdown

        prompt = f"""Analyze {username}'s chess game results and provide a brief, insightful summary.

## Game Overview
- Total games: {data.total_games}
- Record: {wld.total_wins}W - {wld.total_losses}L - {wld.total_draws}D ({wld.win_percentage}% wins)
- Win rate by time control: {', '.join([f'{tc.time_control}: {tc.win_rate}%' for tc in tc_breakdown[:3]])}

## How Games End

### Wins ({wld.total_wins} games)
- Checkmate: {wld.wins_by_checkmate} ({wld.wins_by_checkmate_pct}%)
- Resignation: {wld.wins_by_resignation} ({wld.wins_by_resignation_pct}%)
- Timeout: {wld.wins_by_timeout} ({wld.wins_by_timeout_pct}%)

### Losses ({wld.total_losses} games)
- Checkmate: {wld.losses_by_checkmate} ({wld.losses_by_checkmate_pct}%)
- Resignation: {wld.losses_by_resignation} ({wld.losses_by_resignation_pct}%)
- Timeout: {wld.losses_by_timeout} ({wld.losses_by_timeout_pct}%)

### Draws ({wld.total_draws} games)
- Stalemate: {wld.draws_by_stalemate} ({wld.draws_by_stalemate_pct}%)
- Agreement: {wld.draws_by_agreement} ({wld.draws_by_agreement_pct}%)
- Repetition: {wld.draws_by_repetition} ({wld.draws_by_repetition_pct}%)
- 50-move rule: {wld.draws_by_50move} ({wld.draws_by_50move_pct}%)
- Insufficient material: {wld.draws_by_insufficient_material} ({wld.draws_by_insufficient_material_pct}%)
"""

        # Add ELO trend information
        if elo:
            prompt += f"""
## Rating Trends
- Overall trend: {elo.overall_trend} ({elo.improvement_description})
- Primary time control: {tc_breakdown[0].time_control} at {tc_breakdown[0].current_elo} ELO
"""

        # Add population comparison
        if pop and pop.notable_differences:
            prompt += f"""
## Comparison with {pop.user_elo_bracket} ELO players
Notable differences from average {pop.time_control} players:
"""
            for diff in pop.notable_differences[:5]:  # Limit to top 5
                prompt += f"- {diff}\n"

        prompt += """
Based on this data, provide a brief analysis (2-3 paragraphs) focusing on:
1. The most notable patterns in how games end (wins, losses, draws)
2. Comparison with similar-rated players (if data available)

Be neutral and honest. Use specific numbers and avoid clichés."""

        return prompt

    def generate_mistakes_insights(
        self,
        username: str,
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate insights for the mistakes analysis component

        Args:
            username: Player's username
            stockfish_analysis: Stockfish analysis data with mistake breakdown
            elo_averages_data: Population average data

        Returns:
            Dictionary containing the generated insights and metadata
        """
        try:
            # Analyze the mistakes data
            analyzer = MistakesAnalyzer(username)
            mistakes_data = analyzer.analyze(
                stockfish_analysis,
                elo_averages_data
            )

            # Generate the LLM prompt
            prompt = self._build_mistakes_prompt(username, mistakes_data)
            system_prompt = self._get_system_prompt()

            # Call the LLM
            logger.info(f"Generating mistakes insights for {username}")
            response = self.llm_client.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.7,
                max_tokens=300  # Keep it concise
            )

            if response.success:
                return {
                    'success': True,
                    'insights': response.content,
                    'username': username,
                    'total_games': mistakes_data.total_games,
                    'tokens_used': response.tokens_used,
                    'metadata': {
                        'time_control': mistakes_data.time_control,
                        'elo_bracket': mistakes_data.elo_bracket,
                        'worst_phase': mistakes_data.worst_phase,
                        'best_phase': mistakes_data.best_phase
                    }
                }
            else:
                logger.error(f"LLM generation failed: {response.error}")
                return {
                    'success': False,
                    'error': response.error,
                    'insights': None
                }

        except Exception as e:
            logger.error(f"Error generating mistakes insights: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'insights': None
            }

    def _build_mistakes_prompt(
        self,
        username: str,
        data: MistakesData
    ) -> str:
        """Build the prompt for mistakes insights"""
        overall = data.overall_breakdown
        opening = data.opening_phase
        middlegame = data.middlegame_phase
        endgame = data.endgame_phase
        time_pressure = data.time_pressure

        prompt = f"""Analyze {username}'s chess mistakes and provide a brief, insightful summary.

## Overall Mistakes ({data.total_games} games)
- Total errors: {overall.total_errors} ({overall.avg_errors_per_game} per game)
- Breakdown: {overall.total_blunders} blunders ({overall.blunder_percentage}%), {overall.total_mistakes} mistakes ({overall.mistake_percentage}%), {overall.total_inaccuracies} inaccuracies ({overall.inaccuracy_percentage}%)
- Averages per game: {overall.avg_blunders_per_game} blunders, {overall.avg_mistakes_per_game} mistakes, {overall.avg_inaccuracies_per_game} inaccuracies

## Mistakes by Game Phase

### Opening
- Errors per game: {opening.total_errors} (Avg: {opening.pop_avg_total_errors}, Diff: {opening.diff_total:+.2f})
- Breakdown: {opening.avg_inaccuracies} inaccuracies, {opening.avg_mistakes} mistakes, {opening.avg_blunders} blunders
- vs Population: {opening.diff_inaccuracies:+.2f} inaccuracies, {opening.diff_mistakes:+.2f} mistakes, {opening.diff_blunders:+.2f} blunders"""

        if opening.percentile:
            prompt += f"\n- Performance percentile: {opening.percentile:.1f}%"

        prompt += f"""

### Middlegame
- Errors per game: {middlegame.total_errors} (Avg: {middlegame.pop_avg_total_errors}, Diff: {middlegame.diff_total:+.2f})
- Breakdown: {middlegame.avg_inaccuracies} inaccuracies, {middlegame.avg_mistakes} mistakes, {middlegame.avg_blunders} blunders
- vs Population: {middlegame.diff_inaccuracies:+.2f} inaccuracies, {middlegame.diff_mistakes:+.2f} mistakes, {middlegame.diff_blunders:+.2f} blunders"""

        if middlegame.percentile:
            prompt += f"\n- Performance percentile: {middlegame.percentile:.1f}%"

        prompt += f"""

### Endgame
- Errors per game: {endgame.total_errors} (Avg: {endgame.pop_avg_total_errors}, Diff: {endgame.diff_total:+.2f})
- Breakdown: {endgame.avg_inaccuracies} inaccuracies, {endgame.avg_mistakes} mistakes, {endgame.avg_blunders} blunders
- vs Population: {endgame.diff_inaccuracies:+.2f} inaccuracies, {endgame.diff_mistakes:+.2f} mistakes, {endgame.diff_blunders:+.2f} blunders"""

        if endgame.percentile:
            prompt += f"\n- Performance percentile: {endgame.percentile:.1f}%"

        # Add time pressure analysis if available
        if time_pressure:
            prompt += f"""

## Time Pressure
- Time pressure blunders: {time_pressure.time_pressure_blunders} ({time_pressure.time_pressure_blunder_rate:.1%} of games)
- Timeouts: {time_pressure.timeouts} ({time_pressure.timeout_rate:.1%} of games)
- vs Population: {time_pressure.diff_time_pressure_blunder_rate:+.1%} time pressure blunder rate, {time_pressure.diff_timeout_rate:+.1%} timeout rate"""

        # Add notable patterns
        if data.notable_differences:
            prompt += f"""

## Key Patterns (vs {data.elo_bracket} ELO players in {data.time_control})
"""
            for pattern in data.notable_differences:
                prompt += f"- {pattern}\n"

        prompt += f"""

## Summary
- Weakest phase: {data.worst_phase}
- Strongest phase: {data.best_phase}

Based on this data, provide a brief analysis (2-3 paragraphs) focusing on:
1. Which game phases need the most improvement and why
2. Specific patterns in mistake types (blunders vs mistakes vs inaccuracies)
3. Actionable recommendations for reducing mistakes

Be direct and specific. Use numbers from the data above."""

        return prompt

    def generate_blunder_insights(
        self,
        username: str,
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate insights for the blunder analysis component

        Args:
            username: Player's username
            stockfish_analysis: Stockfish analysis data with blunder breakdown
            elo_averages_data: Population average data

        Returns:
            Dictionary containing the generated insights and metadata
        """
        try:
            # Analyze the blunder data
            analyzer = BlunderAnalyzer(username)
            blunder_data = analyzer.analyze(
                stockfish_analysis,
                elo_averages_data
            )

            # Generate the LLM prompt
            prompt = self._build_blunder_prompt(username, blunder_data)
            system_prompt = self._get_system_prompt()

            # Call the LLM
            logger.info(f"Generating blunder insights for {username}")
            response = self.llm_client.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.7,
                max_tokens=300  # Keep it concise
            )

            if response.success:
                return {
                    'success': True,
                    'insights': response.content,
                    'username': username,
                    'total_games': blunder_data.total_games,
                    'tokens_used': response.tokens_used,
                    'metadata': {
                        'time_control': blunder_data.time_control,
                        'elo_bracket': blunder_data.elo_bracket,
                        'worst_phase': blunder_data.worst_phase,
                        'best_phase': blunder_data.best_phase,
                        'total_blunders': blunder_data.total_blunders
                    }
                }
            else:
                logger.error(f"LLM generation failed: {response.error}")
                return {
                    'success': False,
                    'error': response.error,
                    'insights': None
                }

        except Exception as e:
            logger.error(f"Error generating blunder insights: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'insights': None
            }

    def _build_blunder_prompt(
        self,
        username: str,
        data: BlunderData
    ) -> str:
        """Build the prompt for blunder insights"""
        phase = data.phase_breakdown
        time_pressure = data.time_pressure

        prompt = f"""Analyze {username}'s chess blunders and provide a brief, insightful summary.

## Overall Blunders ({data.total_games} games)
- Total blunders: {data.total_blunders} ({data.avg_blunders_per_game} per game)
- Also made: {data.total_mistakes} mistakes, {data.total_inaccuracies} inaccuracies

## Blunders by Game Phase

### Opening
- Blunders per game: {phase.avg_opening_blunders}
- Population average: {phase.pop_avg_opening_blunders}
- Difference: {phase.diff_opening:+.2f}"""

        if phase.opening_percentile:
            prompt += f"\n- Performance percentile: {phase.opening_percentile:.1f}%"

        prompt += f"""

### Middlegame
- Blunders per game: {phase.avg_middlegame_blunders}
- Population average: {phase.pop_avg_middlegame_blunders}
- Difference: {phase.diff_middlegame:+.2f}"""

        if phase.middlegame_percentile:
            prompt += f"\n- Performance percentile: {phase.middlegame_percentile:.1f}%"

        prompt += f"""

### Endgame
- Blunders per game: {phase.avg_endgame_blunders}
- Population average: {phase.pop_avg_endgame_blunders}
- Difference: {phase.diff_endgame:+.2f}"""

        if phase.endgame_percentile:
            prompt += f"\n- Performance percentile: {phase.endgame_percentile:.1f}%"

        # Add time pressure analysis if available
        if time_pressure:
            prompt += f"""

## Time Pressure
- Games with time pressure blunders: {time_pressure.time_pressure_blunders} ({time_pressure.time_pressure_blunder_rate:.1%})
- Population average: {time_pressure.pop_avg_time_pressure_blunder_rate:.1%}
- Difference: {time_pressure.diff_time_pressure_blunder_rate:+.1%}"""

        # Add notable patterns
        if data.notable_patterns:
            prompt += f"""

## Key Patterns (vs {data.elo_bracket} ELO players in {data.time_control})
"""
            for pattern in data.notable_patterns:
                prompt += f"- {pattern}\n"

        prompt += f"""

## Summary
- Most blunders in: {data.worst_phase}
- Fewest blunders in: {data.best_phase}

Based on this data, provide a brief analysis (2-3 paragraphs) focusing on:
1. Which game phase has the most critical blunder problems and why this matters
2. Whether time pressure is a contributing factor
3. One specific, actionable recommendation to reduce blunders

Be direct and specific. Focus on the most impactful insights."""

        return prompt

    def generate_time_insights(
        self,
        username: str,
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate insights for the time analysis component

        Args:
            username: Player's username
            stockfish_analysis: Stockfish analysis data with time management info
            elo_averages_data: Population average data

        Returns:
            Dictionary containing the generated insights and metadata
        """
        try:
            # Analyze the time management data
            analyzer = TimeAnalyzer(username)
            time_data = analyzer.analyze(
                stockfish_analysis,
                elo_averages_data
            )

            # Generate the LLM prompt
            prompt = self._build_time_prompt(username, time_data)
            system_prompt = self._get_system_prompt()

            # Call the LLM
            logger.info(f"Generating time management insights for {username}")
            response = self.llm_client.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.7,
                max_tokens=300  # Keep it concise
            )

            if response.success:
                return {
                    'success': True,
                    'insights': response.content,
                    'username': username,
                    'total_games': time_data.total_games,
                    'tokens_used': response.tokens_used,
                    'metadata': {
                        'elo_bracket': time_data.elo_bracket,
                        'total_timeouts': time_data.total_timeouts,
                        'total_time_pressure_blunders': time_data.total_time_pressure_blunders,
                        'primary_time_control': time_data.primary_time_control.time_control if time_data.primary_time_control else None
                    }
                }
            else:
                logger.error(f"LLM generation failed: {response.error}")
                return {
                    'success': False,
                    'error': response.error,
                    'insights': None
                }

        except Exception as e:
            logger.error(f"Error generating time insights: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'insights': None
            }

    def _build_time_prompt(
        self,
        username: str,
        data: TimeManagementData
    ) -> str:
        """Build the prompt for time management insights"""
        prompt = f"""Analyze {username}'s time management in chess and provide a brief, insightful summary.

## Overall Time Management ({data.total_games} games)
- Total timeouts: {data.total_timeouts} ({data.total_timeout_rate:.1%} of games)
- Time pressure blunders: {data.total_time_pressure_blunders} ({data.total_time_pressure_blunder_rate:.1%} of games)
- Games lost with time remaining (60+ seconds): {data.total_lost_with_time_remaining}
"""

        # Add primary time control details
        if data.primary_time_control:
            tc = data.primary_time_control
            prompt += f"""

## Primary Time Control: {tc.time_control.capitalize()} ({tc.games_analyzed} games)
- Timeout rate: {tc.timeout_rate:.1%} (Population avg: {tc.pop_avg_timeout_rate:.1%}, Diff: {tc.diff_timeout_rate:+.1%})
- Time pressure blunders: {tc.time_pressure_blunders} ({tc.time_pressure_blunder_rate:.1%})
- Population avg time pressure blunders: {tc.pop_avg_time_pressure_blunder_rate:.1%} (Diff: {tc.diff_time_pressure_blunder_rate:+.1%})"""

            if tc.percentile:
                prompt += f"\n- Performance percentile: {tc.percentile:.1f}%"

        # Add breakdown by time control if multiple
        if len(data.by_time_control) > 1:
            prompt += "\n\n## Time Control Breakdown"
            for tc in data.by_time_control[:3]:  # Top 3 time controls
                prompt += f"""
- {tc.time_control.capitalize()}: {tc.timeouts} timeouts, {tc.time_pressure_blunders} time pressure blunders ({tc.games_analyzed} games)"""

        # Add notable patterns
        if data.notable_patterns:
            prompt += f"""

## Key Patterns (vs {data.elo_bracket} ELO players)
"""
            for pattern in data.notable_patterns:
                prompt += f"- {pattern}\n"

        prompt += """

Based on this data, provide a brief analysis (2-3 paragraphs) focusing on:
1. Overall time management quality and comparison with similar-rated players
2. Whether timeouts or time pressure blunders are a significant issue
3. One specific, actionable recommendation to improve time management

Be direct and specific. Focus on the most impactful insights."""

        return prompt

    def estimate_cost(
        self,
        username: str,
        enriched_games: list,
        elo_averages_data: Optional[Dict[str, Any]] = None,
        elo_chart_data: Optional[list] = None
    ) -> float:
        """
        Estimate the cost of generating insights

        Args:
            Same as generate_game_results_insights

        Returns:
            Estimated cost in USD
        """
        try:
            # Analyze data to build the prompt
            analyzer = GameResultsAnalyzer(username)
            results_data = analyzer.analyze(
                enriched_games,
                elo_averages_data,
                elo_chart_data
            )

            # Build the prompt
            prompt = self._build_game_results_prompt(username, results_data)
            system_prompt = self._get_system_prompt()

            # Estimate tokens
            if hasattr(self.llm_client, 'estimate_tokens'):
                input_tokens = (
                    self.llm_client.estimate_tokens(prompt) +
                    self.llm_client.estimate_tokens(system_prompt)
                )
                output_tokens = 300  # Max tokens we'll request

                if hasattr(self.llm_client, 'calculate_cost'):
                    return self.llm_client.calculate_cost(input_tokens, output_tokens)

            # Fallback rough estimate
            return 0.001  # Rough estimate: $0.001 per request

        except Exception as e:
            logger.error(f"Error estimating cost: {e}")
            return 0.0

    def _generate_single_insight(
        self,
        insight_type: str,
        username: str,
        enriched_games: list,
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]],
        elo_chart_data: Optional[list]
    ) -> tuple[str, Dict[str, Any]]:
        """
        Generate a single insight type (helper for parallel execution)

        Args:
            insight_type: One of 'game_results', 'mistakes_analysis', 'blunder_analysis', 'time_analysis'
            username: Player's username
            enriched_games: List of enriched game objects
            stockfish_analysis: Stockfish analysis data
            elo_averages_data: Population average data
            elo_chart_data: Historical ELO data

        Returns:
            Tuple of (insight_type, result_dict)
        """
        try:
            if insight_type == 'game_results':
                result = self.generate_game_results_insights(
                    username=username,
                    enriched_games=enriched_games,
                    elo_averages_data=elo_averages_data,
                    elo_chart_data=elo_chart_data
                )
            elif insight_type == 'mistakes_analysis':
                result = self.generate_mistakes_insights(
                    username=username,
                    stockfish_analysis=stockfish_analysis,
                    elo_averages_data=elo_averages_data
                )
            elif insight_type == 'blunder_analysis':
                result = self.generate_blunder_insights(
                    username=username,
                    stockfish_analysis=stockfish_analysis,
                    elo_averages_data=elo_averages_data
                )
            elif insight_type == 'time_analysis':
                result = self.generate_time_insights(
                    username=username,
                    stockfish_analysis=stockfish_analysis,
                    elo_averages_data=elo_averages_data
                )
            else:
                result = {'success': False, 'error': f'Unknown insight type: {insight_type}'}

            return (insight_type, result)

        except Exception as e:
            logger.error(f"Error generating {insight_type}: {e}")
            return (insight_type, {'success': False, 'error': str(e)})

    def generate_all_insights(
        self,
        username: str,
        enriched_games: list,
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]] = None,
        elo_chart_data: Optional[list] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        Generate all insights in parallel for better performance

        This method runs all 4 insight generation tasks concurrently using
        ThreadPoolExecutor, reducing total time from sequential execution
        (4-12 seconds) to parallel execution (1-3 seconds).

        Args:
            username: Player's username
            enriched_games: List of enriched game objects
            stockfish_analysis: Stockfish analysis data
            elo_averages_data: Population average data
            elo_chart_data: Historical ELO data

        Returns:
            Dictionary with keys: 'game_results', 'mistakes_analysis',
            'blunder_analysis', 'time_analysis', each containing the
            respective insight result
        """
        results = {
            'game_results': None,
            'mistakes_analysis': None,
            'blunder_analysis': None,
            'time_analysis': None
        }

        insight_types = ['game_results', 'mistakes_analysis', 'blunder_analysis', 'time_analysis']

        # Execute all tasks in parallel
        logger.info(f"Generating all insights in parallel for {username}")
        with ThreadPoolExecutor(max_workers=4) as executor:
            # Submit all tasks
            futures = {
                executor.submit(
                    self._generate_single_insight,
                    insight_type,
                    username,
                    enriched_games,
                    stockfish_analysis,
                    elo_averages_data,
                    elo_chart_data
                ): insight_type
                for insight_type in insight_types
            }

            # Collect results as they complete
            for future in as_completed(futures):
                try:
                    insight_type, result = future.result()
                    results[insight_type] = result
                    if result.get('success'):
                        logger.info(f"✓ {insight_type} insights generated ({result.get('tokens_used', 0)} tokens)")
                    else:
                        logger.warning(f"✗ {insight_type} insights failed: {result.get('error')}")
                except Exception as e:
                    insight_type = futures[future]
                    logger.error(f"Error collecting result for {insight_type}: {e}")
                    results[insight_type] = {'success': False, 'error': str(e)}

        # Log summary
        successful = sum(1 for r in results.values() if r and r.get('success'))
        total_tokens = sum(r.get('tokens_used', 0) for r in results.values() if r and r.get('success'))
        logger.info(f"Parallel insight generation complete: {successful}/4 successful, {total_tokens} total tokens")

        return results
