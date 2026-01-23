"""
Game Results Data Analyzer

Extracts and structures game results data for LLM insight generation.
Analyzes wins, losses, draws, ELO trends, and provides statistical comparisons.
"""

import json
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict


@dataclass
class GameTerminationStats:
    """Statistics for a specific game termination type"""
    termination_type: str
    count: int
    percentage: float


@dataclass
class WinLossDrawStats:
    """Win/loss/draw statistics broken down by termination method"""
    total_wins: int
    total_losses: int
    total_draws: int
    win_percentage: float
    loss_percentage: float
    draw_percentage: float

    # Breakdown by method
    wins_by_checkmate: int
    wins_by_resignation: int
    wins_by_timeout: int
    wins_by_checkmate_pct: float
    wins_by_resignation_pct: float
    wins_by_timeout_pct: float

    losses_by_checkmate: int
    losses_by_resignation: int
    losses_by_timeout: int
    losses_by_checkmate_pct: float
    losses_by_resignation_pct: float
    losses_by_timeout_pct: float

    draws_by_stalemate: int
    draws_by_agreement: int
    draws_by_repetition: int
    draws_by_50move: int
    draws_by_insufficient_material: int
    draws_by_stalemate_pct: float
    draws_by_agreement_pct: float
    draws_by_repetition_pct: float
    draws_by_50move_pct: float
    draws_by_insufficient_material_pct: float


@dataclass
class TimeControlStats:
    """Statistics for a specific time control"""
    time_control: str
    total_games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    current_elo: Optional[int] = None


@dataclass
class EloTrendData:
    """ELO rating trend information"""
    has_improved: bool
    improvement_description: str
    time_controls: List[TimeControlStats]
    overall_trend: str  # "improving", "declining", "stable"


@dataclass
class PopulationComparison:
    """Comparison with population averages"""
    user_elo_bracket: Optional[str]
    time_control: Optional[str]

    # Win method comparisons
    checkmate_wins_diff: float  # Difference from population avg (percentage points)
    resignation_wins_diff: float
    timeout_wins_diff: float

    # Loss method comparisons
    checkmate_losses_diff: float
    resignation_losses_diff: float
    timeout_losses_diff: float

    # Draw method comparisons
    stalemate_draws_diff: float
    agreement_draws_diff: float
    repetition_draws_diff: float
    fifty_move_draws_diff: float
    insufficient_material_draws_diff: float

    # Notable differences (human-readable insights)
    notable_differences: List[str]


@dataclass
class GameResultsData:
    """Complete structured data for game results analysis"""
    total_games: int
    win_loss_draw: WinLossDrawStats
    time_control_breakdown: List[TimeControlStats]
    elo_trends: Optional[EloTrendData]
    population_comparison: Optional[PopulationComparison]


class GameResultsAnalyzer:
    """
    Analyzes game results data and prepares it for LLM insight generation

    This class extracts structured data from enriched games and stockfish
    analysis, compares it with population averages, and packages everything
    into a format suitable for LLM prompts.
    """

    def __init__(self, username: str):
        """
        Initialize the analyzer

        Args:
            username: The player's username
        """
        self.username = username

    def analyze(
        self,
        enriched_games: List[Dict[str, Any]],
        elo_averages_data: Optional[Dict[str, Any]] = None,
        elo_chart_data: Optional[List[Dict[str, Any]]] = None
    ) -> GameResultsData:
        """
        Analyze game results and produce structured data

        Args:
            enriched_games: List of enriched game objects
            elo_averages_data: Population average data by ELO bracket
            elo_chart_data: Historical ELO data over time

        Returns:
            GameResultsData object with all extracted statistics
        """
        # Calculate win/loss/draw statistics
        wld_stats = self._calculate_wld_stats(enriched_games)

        # Calculate time control breakdown
        time_control_stats = self._calculate_time_control_stats(enriched_games)

        # Analyze ELO trends
        elo_trends = self._analyze_elo_trends(elo_chart_data, time_control_stats)

        # Compare with population averages
        population_comparison = self._compare_with_population(
            wld_stats,
            elo_averages_data,
            time_control_stats
        )

        return GameResultsData(
            total_games=len(enriched_games),
            win_loss_draw=wld_stats,
            time_control_breakdown=time_control_stats,
            elo_trends=elo_trends,
            population_comparison=population_comparison
        )

    def _calculate_wld_stats(self, enriched_games: List[Dict[str, Any]]) -> WinLossDrawStats:
        """Calculate detailed win/loss/draw statistics"""
        # Initialize counters
        total_wins = total_losses = total_draws = 0
        wins_by_mate = wins_by_resign = wins_by_timeout = 0
        losses_by_mate = losses_by_resign = losses_by_timeout = 0
        draws_by_stalemate = draws_by_agreement = 0
        draws_by_repetition = draws_by_50move = draws_by_insufficient = 0

        for game in enriched_games:
            # Determine if user won, lost, or drew
            is_white = game.get('players', {}).get('white', {}).get('user', {}).get('name', '').lower() == self.username.lower()
            is_black = game.get('players', {}).get('black', {}).get('user', {}).get('name', '').lower() == self.username.lower()

            if not (is_white or is_black):
                continue

            user_color = 'white' if is_white else 'black'
            winner = game.get('winner')
            status = game.get('status', '')
            ending_type = game.get('endingType')

            # Categorize result
            if winner == user_color:
                # User won
                total_wins += 1
                if status == 'mate':
                    wins_by_mate += 1
                elif status == 'resign':
                    wins_by_resign += 1
                elif status == 'outoftime':
                    wins_by_timeout += 1
            elif winner is None:
                # Draw
                total_draws += 1
                if ending_type == 'stalemate':
                    draws_by_stalemate += 1
                elif ending_type == 'agreement':
                    draws_by_agreement += 1
                elif ending_type == 'repetition':
                    draws_by_repetition += 1
                elif ending_type == '50moveRule':
                    draws_by_50move += 1
                elif ending_type == 'insufficientMaterial':
                    draws_by_insufficient += 1
            else:
                # User lost
                total_losses += 1
                if status == 'mate':
                    losses_by_mate += 1
                elif status == 'resign':
                    losses_by_resign += 1
                elif status == 'outoftime':
                    losses_by_timeout += 1

        total_games = total_wins + total_losses + total_draws

        # Calculate percentages
        def safe_pct(value, total):
            return round((value / total * 100), 1) if total > 0 else 0.0

        return WinLossDrawStats(
            total_wins=total_wins,
            total_losses=total_losses,
            total_draws=total_draws,
            win_percentage=safe_pct(total_wins, total_games),
            loss_percentage=safe_pct(total_losses, total_games),
            draw_percentage=safe_pct(total_draws, total_games),
            wins_by_checkmate=wins_by_mate,
            wins_by_resignation=wins_by_resign,
            wins_by_timeout=wins_by_timeout,
            wins_by_checkmate_pct=safe_pct(wins_by_mate, total_wins),
            wins_by_resignation_pct=safe_pct(wins_by_resign, total_wins),
            wins_by_timeout_pct=safe_pct(wins_by_timeout, total_wins),
            losses_by_checkmate=losses_by_mate,
            losses_by_resignation=losses_by_resign,
            losses_by_timeout=losses_by_timeout,
            losses_by_checkmate_pct=safe_pct(losses_by_mate, total_losses),
            losses_by_resignation_pct=safe_pct(losses_by_resign, total_losses),
            losses_by_timeout_pct=safe_pct(losses_by_timeout, total_losses),
            draws_by_stalemate=draws_by_stalemate,
            draws_by_agreement=draws_by_agreement,
            draws_by_repetition=draws_by_repetition,
            draws_by_50move=draws_by_50move,
            draws_by_insufficient_material=draws_by_insufficient,
            draws_by_stalemate_pct=safe_pct(draws_by_stalemate, total_draws),
            draws_by_agreement_pct=safe_pct(draws_by_agreement, total_draws),
            draws_by_repetition_pct=safe_pct(draws_by_repetition, total_draws),
            draws_by_50move_pct=safe_pct(draws_by_50move, total_draws),
            draws_by_insufficient_material_pct=safe_pct(draws_by_insufficient, total_draws),
        )

    def _calculate_time_control_stats(
        self,
        enriched_games: List[Dict[str, Any]]
    ) -> List[TimeControlStats]:
        """Calculate statistics broken down by time control"""
        time_control_data = defaultdict(lambda: {
            'wins': 0, 'losses': 0, 'draws': 0, 'total': 0, 'elo': None
        })

        for game in enriched_games:
            is_white = game.get('players', {}).get('white', {}).get('user', {}).get('name', '').lower() == self.username.lower()
            is_black = game.get('players', {}).get('black', {}).get('user', {}).get('name', '').lower() == self.username.lower()

            if not (is_white or is_black):
                continue

            time_control = game.get('speed', game.get('perf', 'unknown'))
            user_color = 'white' if is_white else 'black'
            winner = game.get('winner')

            # Get user's ELO for this game
            if time_control_data[time_control]['elo'] is None:
                if is_white:
                    time_control_data[time_control]['elo'] = game.get('players', {}).get('white', {}).get('rating')
                else:
                    time_control_data[time_control]['elo'] = game.get('players', {}).get('black', {}).get('rating')

            time_control_data[time_control]['total'] += 1

            if winner == user_color:
                time_control_data[time_control]['wins'] += 1
            elif winner is None:
                time_control_data[time_control]['draws'] += 1
            else:
                time_control_data[time_control]['losses'] += 1

        # Convert to list of TimeControlStats
        stats_list = []
        for tc, data in time_control_data.items():
            total = data['total']
            wins = data['wins']
            win_rate = round((wins / total * 100), 1) if total > 0 else 0.0

            stats_list.append(TimeControlStats(
                time_control=tc,
                total_games=total,
                wins=wins,
                losses=data['losses'],
                draws=data['draws'],
                win_rate=win_rate,
                current_elo=data['elo']
            ))

        # Sort by total games (most played first)
        stats_list.sort(key=lambda x: x.total_games, reverse=True)
        return stats_list

    def _analyze_elo_trends(
        self,
        elo_chart_data: Optional[List[Dict[str, Any]]],
        time_control_stats: List[TimeControlStats]
    ) -> Optional[EloTrendData]:
        """Analyze ELO rating trends over time"""
        if not elo_chart_data or len(elo_chart_data) == 0:
            return None

        # Analyze each time control's trend
        time_controls = time_control_stats

        # Determine overall trend by looking at the most-played time control
        if len(time_controls) > 0:
            primary_tc = time_controls[0].time_control

            # Find data points for this time control
            tc_data = [d for d in elo_chart_data if primary_tc in d]

            if len(tc_data) >= 2:
                start_elo = tc_data[0].get(primary_tc)
                end_elo = tc_data[-1].get(primary_tc)

                if start_elo and end_elo:
                    diff = end_elo - start_elo
                    if diff > 50:
                        overall = "improving"
                        desc = f"improved by {diff} points"
                        has_improved = True
                    elif diff < -50:
                        overall = "declining"
                        desc = f"declined by {abs(diff)} points"
                        has_improved = False
                    else:
                        overall = "stable"
                        desc = f"remained stable (±{abs(diff)} points)"
                        has_improved = diff >= 0
                else:
                    overall = "insufficient_data"
                    desc = "not enough data for trend analysis"
                    has_improved = False
            else:
                overall = "insufficient_data"
                desc = "not enough data for trend analysis"
                has_improved = False
        else:
            overall = "no_data"
            desc = "no ELO data available"
            has_improved = False

        return EloTrendData(
            has_improved=has_improved,
            improvement_description=desc,
            time_controls=time_controls,
            overall_trend=overall
        )

    def _compare_with_population(
        self,
        wld_stats: WinLossDrawStats,
        elo_averages_data: Optional[Dict[str, Any]],
        time_control_stats: List[TimeControlStats]
    ) -> Optional[PopulationComparison]:
        """Compare user's statistics with population averages"""
        if not elo_averages_data or len(time_control_stats) == 0:
            return None

        # Get the primary time control and its ELO bracket
        primary_tc = time_control_stats[0]
        tc_name = primary_tc.time_control

        # Check if we have population data for this time control
        if tc_name not in elo_averages_data:
            return None

        tc_data = elo_averages_data[tc_name]
        bracket = tc_data.get('bracket')
        pop_data = tc_data.get('data', {})

        def get_rate(key):
            """Extract rate from population data (handles both number and object formats)"""
            val = pop_data.get(key, 0)
            if isinstance(val, dict):
                return val.get('mean', 0) * 100
            return val * 100 if val < 1 else val

        # Calculate differences
        checkmate_wins_diff = wld_stats.wins_by_checkmate_pct - get_rate('win_by_checkmate_rate')
        resignation_wins_diff = wld_stats.wins_by_resignation_pct - get_rate('win_by_resignation_rate')
        timeout_wins_diff = wld_stats.wins_by_timeout_pct - get_rate('win_by_timeout_rate')

        checkmate_losses_diff = wld_stats.losses_by_checkmate_pct - get_rate('loss_by_checkmate_rate')
        resignation_losses_diff = wld_stats.losses_by_resignation_pct - get_rate('loss_by_resignation_rate')
        timeout_losses_diff = wld_stats.losses_by_timeout_pct - get_rate('loss_by_timeout_rate')

        stalemate_draws_diff = wld_stats.draws_by_stalemate_pct - get_rate('draw_by_stalemate_rate')
        agreement_draws_diff = wld_stats.draws_by_agreement_pct - get_rate('draw_by_agreement_rate')
        repetition_draws_diff = wld_stats.draws_by_repetition_pct - get_rate('draw_by_repetition_rate')
        fifty_move_draws_diff = wld_stats.draws_by_50move_pct - get_rate('draw_by_50move_rate')
        insufficient_draws_diff = wld_stats.draws_by_insufficient_material_pct - get_rate('draw_by_insufficient_material_rate')

        # Identify notable differences (threshold: 10 percentage points)
        notable = []
        threshold = 10.0

        comparisons = [
            (checkmate_wins_diff, "checkmate wins", "more", "fewer"),
            (resignation_wins_diff, "resignation wins", "more", "fewer"),
            (timeout_wins_diff, "timeout wins", "more", "fewer"),
            (checkmate_losses_diff, "checkmate losses", "more", "fewer"),
            (resignation_losses_diff, "resignation losses", "more", "fewer"),
            (timeout_losses_diff, "timeout losses", "more", "fewer"),
            (stalemate_draws_diff, "stalemate draws", "more", "fewer"),
            (agreement_draws_diff, "drawn by agreement", "more often", "less often"),
            (repetition_draws_diff, "repetition draws", "more", "fewer"),
            (fifty_move_draws_diff, "50-move rule draws", "more", "fewer"),
            (insufficient_draws_diff, "insufficient material draws", "more", "fewer"),
        ]

        for diff, category, more_word, fewer_word in comparisons:
            if abs(diff) >= threshold:
                direction = more_word if diff > 0 else fewer_word
                notable.append(f"{direction} {category} ({diff:+.1f}% vs avg)")

        return PopulationComparison(
            user_elo_bracket=bracket,
            time_control=tc_name,
            checkmate_wins_diff=round(checkmate_wins_diff, 1),
            resignation_wins_diff=round(resignation_wins_diff, 1),
            timeout_wins_diff=round(timeout_wins_diff, 1),
            checkmate_losses_diff=round(checkmate_losses_diff, 1),
            resignation_losses_diff=round(resignation_losses_diff, 1),
            timeout_losses_diff=round(timeout_losses_diff, 1),
            stalemate_draws_diff=round(stalemate_draws_diff, 1),
            agreement_draws_diff=round(agreement_draws_diff, 1),
            repetition_draws_diff=round(repetition_draws_diff, 1),
            fifty_move_draws_diff=round(fifty_move_draws_diff, 1),
            insufficient_material_draws_diff=round(insufficient_draws_diff, 1),
            notable_differences=notable
        )

    def to_dict(self, data: GameResultsData) -> Dict[str, Any]:
        """Convert GameResultsData to a dictionary for JSON serialization"""
        return asdict(data)
