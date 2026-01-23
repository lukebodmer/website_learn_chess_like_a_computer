"""
Blunder Data Analyzer

Extracts and structures blunder data for LLM insight generation.
Analyzes blunder patterns by game phase and time pressure.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class BlunderPhaseBreakdown:
    """Breakdown of blunders by game phase"""
    opening_blunders: int
    middlegame_blunders: int
    endgame_blunders: int
    total_blunders: int

    avg_opening_blunders: float
    avg_middlegame_blunders: float
    avg_endgame_blunders: float

    # Population comparison
    pop_avg_opening_blunders: float
    pop_avg_middlegame_blunders: float
    pop_avg_endgame_blunders: float

    # Differences
    diff_opening: float
    diff_middlegame: float
    diff_endgame: float

    # Percentiles
    opening_percentile: Optional[float] = None
    middlegame_percentile: Optional[float] = None
    endgame_percentile: Optional[float] = None


@dataclass
class TimePressureBlunders:
    """Analysis of blunders made under time pressure"""
    time_pressure_blunders: int
    time_pressure_blunder_rate: float
    total_games: int

    # Population comparison
    pop_avg_time_pressure_blunder_rate: float
    diff_time_pressure_blunder_rate: float


@dataclass
class BlunderData:
    """Complete structured data for blunder analysis"""
    total_games: int
    time_control: str
    elo_bracket: Optional[str]

    # Overall breakdown
    total_blunders: int
    total_mistakes: int
    total_inaccuracies: int
    avg_blunders_per_game: float

    # Phase breakdown
    phase_breakdown: BlunderPhaseBreakdown
    time_pressure: Optional[TimePressureBlunders]

    # Patterns
    worst_phase: str  # "opening", "middlegame", or "endgame"
    best_phase: str
    notable_patterns: List[str]


class BlunderAnalyzer:
    """
    Analyzes blunder patterns and prepares data for LLM insight generation

    This class extracts blunder data from stockfish analysis, breaks it down
    by phase, compares with population averages, and identifies actionable patterns.
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
    ) -> BlunderData:
        """
        Analyze blunder data and produce structured output

        Args:
            stockfish_analysis: The stockfish analysis data containing mistake breakdown
            elo_averages_data: Population average data by ELO bracket

        Returns:
            BlunderData object with all extracted statistics
        """
        # Extract basic info
        total_games = stockfish_analysis.get('total_games_analyzed', 0)

        if total_games == 0:
            return self._create_empty_data()

        # Get principles data which contains phase breakdowns
        principles = stockfish_analysis.get('principles', {})

        # Determine time control and ELO bracket
        time_control, elo_bracket = self._determine_time_control_and_bracket(principles)

        # Get mistake breakdown
        mistake_breakdown = stockfish_analysis.get('mistake_breakdown', {})
        total_blunders = mistake_breakdown.get('blunders', 0)
        total_mistakes = mistake_breakdown.get('mistakes', 0)
        total_inaccuracies = mistake_breakdown.get('inaccuracies', 0)
        avg_blunders_per_game = round(total_blunders / total_games, 2) if total_games > 0 else 0.0

        # Analyze blunders by phase
        phase_breakdown = self._analyze_phase_breakdown(
            principles,
            time_control,
            total_games,
            elo_averages_data
        )

        # Analyze time pressure blunders
        time_pressure = self._analyze_time_pressure(
            principles,
            time_control,
            total_games,
            elo_averages_data
        )

        # Identify worst and best phases
        phases = [
            ('opening', phase_breakdown.avg_opening_blunders),
            ('middlegame', phase_breakdown.avg_middlegame_blunders),
            ('endgame', phase_breakdown.avg_endgame_blunders)
        ]
        phases.sort(key=lambda x: x[1], reverse=True)
        worst_phase = phases[0][0]
        best_phase = phases[-1][0]

        # Identify notable patterns
        notable = self._identify_notable_patterns(phase_breakdown, time_pressure)

        return BlunderData(
            total_games=total_games,
            time_control=time_control,
            elo_bracket=elo_bracket,
            total_blunders=total_blunders,
            total_mistakes=total_mistakes,
            total_inaccuracies=total_inaccuracies,
            avg_blunders_per_game=avg_blunders_per_game,
            phase_breakdown=phase_breakdown,
            time_pressure=time_pressure,
            worst_phase=worst_phase,
            best_phase=best_phase,
            notable_patterns=notable
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

    def _analyze_phase_breakdown(
        self,
        principles: Dict[str, Any],
        time_control: str,
        total_games: int,
        elo_averages_data: Optional[Dict[str, Any]]
    ) -> BlunderPhaseBreakdown:
        """Analyze blunders by game phase"""
        # Get the relevant time control data
        by_time_control = principles.get('by_time_control', {})
        tc_data = by_time_control.get(time_control, {})

        # If no specific time control data, use aggregated
        if not tc_data:
            tc_data = principles.get('aggregated', {})

        principles_data = tc_data.get('principles', {})

        # Extract blunder data from each phase
        opening_data = principles_data.get('opening_awareness', {}).get('raw_metrics', {})
        middlegame_data = principles_data.get('middlegame_planning', {}).get('raw_metrics', {})
        endgame_data = principles_data.get('endgame_technique', {}).get('raw_metrics', {})

        avg_opening_blunders = opening_data.get('avg_opening_blunders', 0.0)
        avg_middlegame_blunders = middlegame_data.get('avg_middlegame_blunders', 0.0)
        avg_endgame_blunders = endgame_data.get('avg_endgame_blunders', 0.0)

        # Calculate totals
        opening_blunders = int(avg_opening_blunders * total_games)
        middlegame_blunders = int(avg_middlegame_blunders * total_games)
        endgame_blunders = int(avg_endgame_blunders * total_games)
        total_blunders = opening_blunders + middlegame_blunders + endgame_blunders

        # Get population averages
        pop_avg_opening = 0.0
        pop_avg_middlegame = 0.0
        pop_avg_endgame = 0.0
        opening_percentile = None
        middlegame_percentile = None
        endgame_percentile = None

        if elo_averages_data and time_control in elo_averages_data:
            tc_pop_data = elo_averages_data[time_control].get('data', {})
            pop_avg_opening = tc_pop_data.get('opening_blunders_per_game', {}).get('mean', 0.0)
            pop_avg_middlegame = tc_pop_data.get('middlegame_blunders_per_game', {}).get('mean', 0.0)
            pop_avg_endgame = tc_pop_data.get('endgame_blunders_per_game', {}).get('mean', 0.0)

        # Get percentiles from elo_comparison
        opening_elo_comp = principles_data.get('opening_awareness', {}).get('elo_comparison', {})
        middlegame_elo_comp = principles_data.get('middlegame_planning', {}).get('elo_comparison', {})
        endgame_elo_comp = principles_data.get('endgame_technique', {}).get('elo_comparison', {})

        opening_percentile = opening_elo_comp.get('percentile')
        middlegame_percentile = middlegame_elo_comp.get('percentile')
        endgame_percentile = endgame_elo_comp.get('percentile')

        # Calculate differences
        diff_opening = round(avg_opening_blunders - pop_avg_opening, 2)
        diff_middlegame = round(avg_middlegame_blunders - pop_avg_middlegame, 2)
        diff_endgame = round(avg_endgame_blunders - pop_avg_endgame, 2)

        return BlunderPhaseBreakdown(
            opening_blunders=opening_blunders,
            middlegame_blunders=middlegame_blunders,
            endgame_blunders=endgame_blunders,
            total_blunders=total_blunders,
            avg_opening_blunders=round(avg_opening_blunders, 2),
            avg_middlegame_blunders=round(avg_middlegame_blunders, 2),
            avg_endgame_blunders=round(avg_endgame_blunders, 2),
            pop_avg_opening_blunders=round(pop_avg_opening, 2),
            pop_avg_middlegame_blunders=round(pop_avg_middlegame, 2),
            pop_avg_endgame_blunders=round(pop_avg_endgame, 2),
            diff_opening=diff_opening,
            diff_middlegame=diff_middlegame,
            diff_endgame=diff_endgame,
            opening_percentile=opening_percentile,
            middlegame_percentile=middlegame_percentile,
            endgame_percentile=endgame_percentile
        )

    def _analyze_time_pressure(
        self,
        principles: Dict[str, Any],
        time_control: str,
        total_games: int,
        elo_averages_data: Optional[Dict[str, Any]]
    ) -> Optional[TimePressureBlunders]:
        """Analyze blunders made under time pressure"""
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
        time_pressure_blunders = raw_metrics.get('time_pressure_blunders', 0)
        time_pressure_blunder_rate = raw_metrics.get('time_pressure_blunder_rate', 0.0)

        # Get population average
        pop_avg_time_pressure_blunder_rate = 0.0
        if elo_averages_data and time_control in elo_averages_data:
            tc_pop_data = elo_averages_data[time_control].get('data', {})
            pop_avg_time_pressure_blunder_rate = tc_pop_data.get(
                'time_pressure_blunder_rate', {}
            ).get('mean', 0.0)

        diff_time_pressure = round(
            time_pressure_blunder_rate - pop_avg_time_pressure_blunder_rate, 3
        )

        return TimePressureBlunders(
            time_pressure_blunders=time_pressure_blunders,
            time_pressure_blunder_rate=round(time_pressure_blunder_rate, 3),
            total_games=total_games,
            pop_avg_time_pressure_blunder_rate=round(pop_avg_time_pressure_blunder_rate, 3),
            diff_time_pressure_blunder_rate=diff_time_pressure
        )

    def _identify_notable_patterns(
        self,
        phase_breakdown: BlunderPhaseBreakdown,
        time_pressure: Optional[TimePressureBlunders]
    ) -> List[str]:
        """Identify notable patterns worth highlighting"""
        notable = []
        threshold = 0.3  # Difference threshold

        # Check each phase for significant differences
        phases = [
            ('opening', phase_breakdown.diff_opening, phase_breakdown.avg_opening_blunders),
            ('middlegame', phase_breakdown.diff_middlegame, phase_breakdown.avg_middlegame_blunders),
            ('endgame', phase_breakdown.diff_endgame, phase_breakdown.avg_endgame_blunders)
        ]

        for phase_name, diff, avg in phases:
            if abs(diff) >= threshold:
                direction = "more" if diff > 0 else "fewer"
                notable.append(
                    f"{direction} {phase_name} blunders ({diff:+.2f} vs avg, {avg:.2f} per game)"
                )

        # Check time pressure
        if time_pressure and abs(time_pressure.diff_time_pressure_blunder_rate) >= 0.1:
            direction = "higher" if time_pressure.diff_time_pressure_blunder_rate > 0 else "lower"
            notable.append(
                f"{direction} time pressure blunder rate "
                f"({time_pressure.diff_time_pressure_blunder_rate:+.1%} vs avg)"
            )

        return notable[:5]  # Limit to top 5

    def _create_empty_data(self) -> BlunderData:
        """Create empty data structure when no games available"""
        empty_phase = BlunderPhaseBreakdown(
            opening_blunders=0,
            middlegame_blunders=0,
            endgame_blunders=0,
            total_blunders=0,
            avg_opening_blunders=0.0,
            avg_middlegame_blunders=0.0,
            avg_endgame_blunders=0.0,
            pop_avg_opening_blunders=0.0,
            pop_avg_middlegame_blunders=0.0,
            pop_avg_endgame_blunders=0.0,
            diff_opening=0.0,
            diff_middlegame=0.0,
            diff_endgame=0.0
        )

        return BlunderData(
            total_games=0,
            time_control='unknown',
            elo_bracket=None,
            total_blunders=0,
            total_mistakes=0,
            total_inaccuracies=0,
            avg_blunders_per_game=0.0,
            phase_breakdown=empty_phase,
            time_pressure=None,
            worst_phase='unknown',
            best_phase='unknown',
            notable_patterns=[]
        )

    def to_dict(self, data: BlunderData) -> Dict[str, Any]:
        """Convert BlunderData to a dictionary for JSON serialization"""
        return asdict(data)
