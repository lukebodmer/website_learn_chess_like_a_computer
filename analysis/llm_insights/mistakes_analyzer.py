"""
Mistakes Data Analyzer

Extracts and structures mistakes data for LLM insight generation.
Analyzes mistake frequency by type and game phase, with population comparisons.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict


@dataclass
class MistakeTypeBreakdown:
    """Breakdown of mistakes by type"""
    total_blunders: int
    total_mistakes: int
    total_inaccuracies: int
    total_errors: int

    avg_blunders_per_game: float
    avg_mistakes_per_game: float
    avg_inaccuracies_per_game: float
    avg_errors_per_game: float

    blunder_percentage: float
    mistake_percentage: float
    inaccuracy_percentage: float


@dataclass
class PhaseAnalysis:
    """Mistake analysis for a specific game phase"""
    phase_name: str
    avg_inaccuracies: float
    avg_mistakes: float
    avg_blunders: float
    total_errors: float

    # Population comparison
    pop_avg_inaccuracies: float
    pop_avg_mistakes: float
    pop_avg_blunders: float
    pop_avg_total_errors: float

    # Differences from population
    diff_inaccuracies: float
    diff_mistakes: float
    diff_blunders: float
    diff_total: float

    # Performance percentile (if available)
    percentile: Optional[float] = None


@dataclass
class TimePressureAnalysis:
    """Analysis of mistakes made under time pressure"""
    time_pressure_blunders: int
    time_pressure_blunder_rate: float
    timeouts: int
    timeout_rate: float

    # Population comparison
    pop_avg_time_pressure_blunder_rate: float
    pop_avg_timeout_rate: float

    diff_time_pressure_blunder_rate: float
    diff_timeout_rate: float


@dataclass
class MistakesData:
    """Complete structured data for mistakes analysis"""
    total_games: int
    time_control: str
    elo_bracket: Optional[str]

    overall_breakdown: MistakeTypeBreakdown
    opening_phase: PhaseAnalysis
    middlegame_phase: PhaseAnalysis
    endgame_phase: PhaseAnalysis
    time_pressure: Optional[TimePressureAnalysis]

    # Notable patterns
    worst_phase: str  # "opening", "middlegame", or "endgame"
    best_phase: str
    notable_differences: List[str]


class MistakesAnalyzer:
    """
    Analyzes mistake patterns and prepares data for LLM insight generation

    This class extracts mistake data from stockfish analysis, breaks it down
    by phase and type, compares with population averages, and identifies
    actionable patterns.
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
        stockfish_analysis: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]] = None
    ) -> MistakesData:
        """
        Analyze mistakes data and produce structured output

        Args:
            stockfish_analysis: The stockfish analysis data containing mistake breakdown
            elo_averages_data: Population average data by ELO bracket

        Returns:
            MistakesData object with all extracted statistics
        """
        # Extract basic info
        total_games = stockfish_analysis.get('total_games_analyzed', 0)

        if total_games == 0:
            return self._create_empty_data()

        # Get principles data which contains phase breakdowns
        principles = stockfish_analysis.get('principles', {})

        # Determine time control and ELO bracket
        time_control, elo_bracket = self._determine_time_control_and_bracket(principles)

        # Calculate overall breakdown
        mistake_breakdown = stockfish_analysis.get('mistake_breakdown', {})
        overall = self._calculate_overall_breakdown(
            mistake_breakdown,
            total_games
        )

        # Analyze each phase
        opening = self._analyze_phase(
            'opening',
            principles,
            time_control,
            elo_averages_data
        )

        middlegame = self._analyze_phase(
            'middlegame',
            principles,
            time_control,
            elo_averages_data
        )

        endgame = self._analyze_phase(
            'endgame',
            principles,
            time_control,
            elo_averages_data
        )

        # Analyze time pressure
        time_pressure = self._analyze_time_pressure(
            principles,
            time_control,
            elo_averages_data
        )

        # Identify worst and best phases
        phases = [
            ('opening', opening.total_errors),
            ('middlegame', middlegame.total_errors),
            ('endgame', endgame.total_errors)
        ]
        phases.sort(key=lambda x: x[1], reverse=True)
        worst_phase = phases[0][0]
        best_phase = phases[-1][0]

        # Identify notable differences
        notable = self._identify_notable_patterns(
            opening, middlegame, endgame, time_pressure
        )

        return MistakesData(
            total_games=total_games,
            time_control=time_control,
            elo_bracket=elo_bracket,
            overall_breakdown=overall,
            opening_phase=opening,
            middlegame_phase=middlegame,
            endgame_phase=endgame,
            time_pressure=time_pressure,
            worst_phase=worst_phase,
            best_phase=best_phase,
            notable_differences=notable
        )

    def _calculate_overall_breakdown(
        self,
        mistake_breakdown: Dict[str, int],
        total_games: int
    ) -> MistakeTypeBreakdown:
        """Calculate overall mistake type breakdown"""
        blunders = mistake_breakdown.get('blunders', 0)
        mistakes = mistake_breakdown.get('mistakes', 0)
        inaccuracies = mistake_breakdown.get('inaccuracies', 0)
        total_errors = blunders + mistakes + inaccuracies

        # Calculate averages per game
        avg_blunders = round(blunders / total_games, 2) if total_games > 0 else 0.0
        avg_mistakes = round(mistakes / total_games, 2) if total_games > 0 else 0.0
        avg_inaccuracies = round(inaccuracies / total_games, 2) if total_games > 0 else 0.0
        avg_errors = round(total_errors / total_games, 2) if total_games > 0 else 0.0

        # Calculate percentages of total errors
        def safe_pct(value, total):
            return round((value / total * 100), 1) if total > 0 else 0.0

        return MistakeTypeBreakdown(
            total_blunders=blunders,
            total_mistakes=mistakes,
            total_inaccuracies=inaccuracies,
            total_errors=total_errors,
            avg_blunders_per_game=avg_blunders,
            avg_mistakes_per_game=avg_mistakes,
            avg_inaccuracies_per_game=avg_inaccuracies,
            avg_errors_per_game=avg_errors,
            blunder_percentage=safe_pct(blunders, total_errors),
            mistake_percentage=safe_pct(mistakes, total_errors),
            inaccuracy_percentage=safe_pct(inaccuracies, total_errors)
        )

    def _determine_time_control_and_bracket(
        self,
        principles: Dict[str, Any]
    ) -> tuple[str, Optional[str]]:
        """Determine the primary time control and ELO bracket"""
        by_time_control = principles.get('by_time_control', {})

        if not by_time_control:
            # Fall back to aggregated data
            aggregated = principles.get('aggregated', {})
            elo_bracket = aggregated.get('elo_range')
            return 'unknown', elo_bracket

        # Find time control with most games
        max_games = 0
        primary_tc = 'unknown'
        elo_bracket = None

        for tc, data in by_time_control.items():
            games = data.get('games_analyzed', 0)
            if games > max_games:
                max_games = games
                primary_tc = tc
                elo_bracket = data.get('elo_range')

        return primary_tc, elo_bracket

    def _analyze_phase(
        self,
        phase_name: str,
        principles: Dict[str, Any],
        time_control: str,
        elo_averages_data: Optional[Dict[str, Any]]
    ) -> PhaseAnalysis:
        """Analyze a specific game phase"""
        # Get the relevant time control data
        by_time_control = principles.get('by_time_control', {})
        tc_data = by_time_control.get(time_control, {})

        # If no specific time control data, use aggregated
        if not tc_data:
            tc_data = principles.get('aggregated', {})

        principles_data = tc_data.get('principles', {})

        # Map phase names to principle keys
        phase_map = {
            'opening': 'opening_awareness',
            'middlegame': 'middlegame_planning',
            'endgame': 'endgame_technique'
        }

        principle_key = phase_map.get(phase_name, phase_name)
        phase_data = principles_data.get(principle_key, {})

        # Extract raw metrics
        raw_metrics = phase_data.get('raw_metrics', {})
        avg_inaccuracies = raw_metrics.get(f'avg_{phase_name}_inaccuracies', 0.0)
        avg_mistakes = raw_metrics.get(f'avg_{phase_name}_mistakes', 0.0)
        avg_blunders = raw_metrics.get(f'avg_{phase_name}_blunders', 0.0)
        total_errors = raw_metrics.get(f'total_{phase_name}_errors',
                                       avg_inaccuracies + avg_mistakes + avg_blunders)

        # Get population comparison
        elo_comparison = phase_data.get('elo_comparison', {})
        pop_avg_total = elo_comparison.get('elo_average', 0.0)
        percentile = elo_comparison.get('percentile', None)

        # Get detailed population averages from elo_averages_data
        pop_avg_inaccuracies = 0.0
        pop_avg_mistakes = 0.0
        pop_avg_blunders = 0.0

        if elo_averages_data and time_control in elo_averages_data:
            tc_pop_data = elo_averages_data[time_control].get('data', {})
            pop_avg_inaccuracies = tc_pop_data.get(
                f'{phase_name}_inaccuracies_per_game', {}
            ).get('mean', 0.0)
            pop_avg_mistakes = tc_pop_data.get(
                f'{phase_name}_mistakes_per_game', {}
            ).get('mean', 0.0)
            pop_avg_blunders = tc_pop_data.get(
                f'{phase_name}_blunders_per_game', {}
            ).get('mean', 0.0)

        # If we don't have detailed breakdown, use total
        if pop_avg_inaccuracies == 0 and pop_avg_mistakes == 0 and pop_avg_blunders == 0:
            # Estimate breakdown based on typical distributions
            pop_avg_blunders = pop_avg_total * 0.25
            pop_avg_mistakes = pop_avg_total * 0.25
            pop_avg_inaccuracies = pop_avg_total * 0.50

        pop_avg_total_calc = pop_avg_inaccuracies + pop_avg_mistakes + pop_avg_blunders

        # Calculate differences
        diff_inaccuracies = round(avg_inaccuracies - pop_avg_inaccuracies, 2)
        diff_mistakes = round(avg_mistakes - pop_avg_mistakes, 2)
        diff_blunders = round(avg_blunders - pop_avg_blunders, 2)
        diff_total = round(total_errors - pop_avg_total_calc, 2)

        return PhaseAnalysis(
            phase_name=phase_name.capitalize(),
            avg_inaccuracies=round(avg_inaccuracies, 2),
            avg_mistakes=round(avg_mistakes, 2),
            avg_blunders=round(avg_blunders, 2),
            total_errors=round(total_errors, 2),
            pop_avg_inaccuracies=round(pop_avg_inaccuracies, 2),
            pop_avg_mistakes=round(pop_avg_mistakes, 2),
            pop_avg_blunders=round(pop_avg_blunders, 2),
            pop_avg_total_errors=round(pop_avg_total_calc, 2),
            diff_inaccuracies=diff_inaccuracies,
            diff_mistakes=diff_mistakes,
            diff_blunders=diff_blunders,
            diff_total=diff_total,
            percentile=percentile
        )

    def _analyze_time_pressure(
        self,
        principles: Dict[str, Any],
        time_control: str,
        elo_averages_data: Optional[Dict[str, Any]]
    ) -> Optional[TimePressureAnalysis]:
        """Analyze mistakes made under time pressure"""
        # Get the relevant time control data
        by_time_control = principles.get('by_time_control', {})
        tc_data = by_time_control.get(time_control, {})

        # If no specific time control data, use aggregated
        if not tc_data:
            tc_data = principles.get('aggregated', {})

        principles_data = tc_data.get('principles', {})
        time_mgmt = principles_data.get('time_management', {})

        if not time_mgmt:
            return None

        raw_metrics = time_mgmt.get('raw_metrics', {})
        elo_comparison = time_mgmt.get('elo_comparison', {})

        time_pressure_blunders = raw_metrics.get('time_pressure_blunders', 0)
        time_pressure_blunder_rate = raw_metrics.get('time_pressure_blunder_rate', 0.0)
        timeouts = raw_metrics.get('timeouts', 0)
        timeout_rate = raw_metrics.get('timeout_rate', 0.0)

        pop_avg_timeout_rate = elo_comparison.get('elo_average', 0.0)

        # Get time pressure blunder rate from population data
        pop_avg_time_pressure_blunder_rate = 0.0
        if elo_averages_data and time_control in elo_averages_data:
            tc_pop_data = elo_averages_data[time_control].get('data', {})
            pop_avg_time_pressure_blunder_rate = tc_pop_data.get(
                'time_pressure_blunder_rate', {}
            ).get('mean', 0.0)

        diff_time_pressure = round(
            time_pressure_blunder_rate - pop_avg_time_pressure_blunder_rate, 3
        )
        diff_timeout = round(timeout_rate - pop_avg_timeout_rate, 3)

        return TimePressureAnalysis(
            time_pressure_blunders=time_pressure_blunders,
            time_pressure_blunder_rate=round(time_pressure_blunder_rate, 3),
            timeouts=timeouts,
            timeout_rate=round(timeout_rate, 3),
            pop_avg_time_pressure_blunder_rate=round(pop_avg_time_pressure_blunder_rate, 3),
            pop_avg_timeout_rate=round(pop_avg_timeout_rate, 3),
            diff_time_pressure_blunder_rate=diff_time_pressure,
            diff_timeout_rate=diff_timeout
        )

    def _identify_notable_patterns(
        self,
        opening: PhaseAnalysis,
        middlegame: PhaseAnalysis,
        endgame: PhaseAnalysis,
        time_pressure: Optional[TimePressureAnalysis]
    ) -> List[str]:
        """Identify notable patterns worth highlighting"""
        notable = []
        threshold = 0.5  # Difference threshold for phases

        # Check each phase for significant differences
        phases = [opening, middlegame, endgame]

        for phase in phases:
            if abs(phase.diff_total) >= threshold:
                direction = "more" if phase.diff_total > 0 else "fewer"
                notable.append(
                    f"{direction} {phase.phase_name.lower()} errors "
                    f"({phase.diff_total:+.1f} vs avg)"
                )

            # Check for specific mistake types if significantly different
            if abs(phase.diff_blunders) >= 0.3:
                direction = "more" if phase.diff_blunders > 0 else "fewer"
                notable.append(
                    f"{direction} {phase.phase_name.lower()} blunders "
                    f"({phase.diff_blunders:+.1f} vs avg)"
                )

        # Check time pressure
        if time_pressure:
            if abs(time_pressure.diff_time_pressure_blunder_rate) >= 0.1:
                direction = "more" if time_pressure.diff_time_pressure_blunder_rate > 0 else "fewer"
                notable.append(
                    f"{direction} time pressure blunders "
                    f"({time_pressure.diff_time_pressure_blunder_rate:+.1%} vs avg)"
                )

            if abs(time_pressure.diff_timeout_rate) >= 0.1:
                direction = "higher" if time_pressure.diff_timeout_rate > 0 else "lower"
                notable.append(
                    f"{direction} timeout rate "
                    f"({time_pressure.diff_timeout_rate:+.1%} vs avg)"
                )

        return notable[:5]  # Limit to top 5 most notable

    def _create_empty_data(self) -> MistakesData:
        """Create empty data structure when no games available"""
        empty_phase = PhaseAnalysis(
            phase_name="Unknown",
            avg_inaccuracies=0.0,
            avg_mistakes=0.0,
            avg_blunders=0.0,
            total_errors=0.0,
            pop_avg_inaccuracies=0.0,
            pop_avg_mistakes=0.0,
            pop_avg_blunders=0.0,
            pop_avg_total_errors=0.0,
            diff_inaccuracies=0.0,
            diff_mistakes=0.0,
            diff_blunders=0.0,
            diff_total=0.0
        )

        empty_breakdown = MistakeTypeBreakdown(
            total_blunders=0,
            total_mistakes=0,
            total_inaccuracies=0,
            total_errors=0,
            avg_blunders_per_game=0.0,
            avg_mistakes_per_game=0.0,
            avg_inaccuracies_per_game=0.0,
            avg_errors_per_game=0.0,
            blunder_percentage=0.0,
            mistake_percentage=0.0,
            inaccuracy_percentage=0.0
        )

        return MistakesData(
            total_games=0,
            time_control='unknown',
            elo_bracket=None,
            overall_breakdown=empty_breakdown,
            opening_phase=empty_phase,
            middlegame_phase=empty_phase,
            endgame_phase=empty_phase,
            time_pressure=None,
            worst_phase='unknown',
            best_phase='unknown',
            notable_differences=[]
        )

    def to_dict(self, data: MistakesData) -> Dict[str, Any]:
        """Convert MistakesData to a dictionary for JSON serialization"""
        return asdict(data)
