"""
Time Management Data Analyzer

Extracts and structures time management data for LLM insight generation.
Analyzes timeout rates, time pressure blunders, and time management patterns.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class TimeControlStats:
    """Time management statistics for a specific time control"""
    time_control: str
    games_analyzed: int

    # Timeout metrics
    timeouts: int
    timeout_rate: float

    # Time pressure metrics
    time_pressure_blunders: int
    time_pressure_blunder_rate: float

    # Games lost with time remaining
    lost_with_time_remaining: int

    # Population comparison
    pop_avg_timeout_rate: float
    pop_avg_time_pressure_blunder_rate: float

    # Differences
    diff_timeout_rate: float
    diff_time_pressure_blunder_rate: float

    # Percentile
    percentile: Optional[float] = None


@dataclass
class TimeManagementData:
    """Complete structured data for time management analysis"""
    total_games: int
    elo_bracket: Optional[str]

    # Aggregated stats
    total_timeouts: int
    total_timeout_rate: float
    total_time_pressure_blunders: int
    total_time_pressure_blunder_rate: float
    total_lost_with_time_remaining: int

    # By time control
    by_time_control: List[TimeControlStats]

    # Primary time control (most games)
    primary_time_control: Optional[TimeControlStats]

    # Notable patterns
    notable_patterns: List[str]


class TimeAnalyzer:
    """
    Analyzes time management patterns and prepares data for LLM insight generation

    This class extracts time management data from stockfish analysis principles,
    compares with population averages, and identifies actionable patterns.
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
    ) -> TimeManagementData:
        """
        Analyze time management data and produce structured output

        Args:
            stockfish_analysis: The stockfish analysis data containing principles
            elo_averages_data: Population average data by ELO bracket

        Returns:
            TimeManagementData object with all extracted statistics
        """
        # Extract basic info
        total_games = stockfish_analysis.get('total_games_analyzed', 0)

        if total_games == 0:
            return self._create_empty_data()

        # Get principles data which contains time management info
        principles = stockfish_analysis.get('principles', {})
        by_time_control = principles.get('by_time_control', {})

        # Analyze each time control
        time_control_stats = []
        total_timeouts = 0
        total_time_pressure_blunders = 0
        total_lost_with_time_remaining = 0

        for tc, tc_data in by_time_control.items():
            games_analyzed = tc_data.get('games_analyzed', 0)
            if games_analyzed == 0:
                continue

            stats = self._analyze_time_control(tc, tc_data, elo_averages_data)
            if stats:
                time_control_stats.append(stats)
                total_timeouts += stats.timeouts
                total_time_pressure_blunders += stats.time_pressure_blunders
                total_lost_with_time_remaining += stats.lost_with_time_remaining

        # If no time control specific data, use aggregated
        if not time_control_stats:
            aggregated = principles.get('aggregated', {})
            if aggregated:
                stats = self._analyze_time_control('aggregated', aggregated, elo_averages_data)
                if stats:
                    time_control_stats.append(stats)
                    total_timeouts = stats.timeouts
                    total_time_pressure_blunders = stats.time_pressure_blunders
                    total_lost_with_time_remaining = stats.lost_with_time_remaining

        # Sort by games analyzed to find primary time control
        time_control_stats.sort(key=lambda x: x.games_analyzed, reverse=True)
        primary_tc = time_control_stats[0] if time_control_stats else None

        # Determine ELO bracket
        elo_bracket = None
        if primary_tc:
            # Try to get ELO bracket from the primary time control data
            for tc, tc_data in by_time_control.items():
                if tc == primary_tc.time_control:
                    elo_bracket = tc_data.get('elo_range')
                    break

        if not elo_bracket and principles.get('aggregated'):
            elo_bracket = principles['aggregated'].get('elo_range')

        # Calculate totals
        total_timeout_rate = round(total_timeouts / total_games, 3) if total_games > 0 else 0.0
        total_time_pressure_blunder_rate = round(
            total_time_pressure_blunders / total_games, 3
        ) if total_games > 0 else 0.0

        # Identify notable patterns
        notable = self._identify_notable_patterns(time_control_stats)

        return TimeManagementData(
            total_games=total_games,
            elo_bracket=elo_bracket,
            total_timeouts=total_timeouts,
            total_timeout_rate=total_timeout_rate,
            total_time_pressure_blunders=total_time_pressure_blunders,
            total_time_pressure_blunder_rate=total_time_pressure_blunder_rate,
            total_lost_with_time_remaining=total_lost_with_time_remaining,
            by_time_control=time_control_stats,
            primary_time_control=primary_tc,
            notable_patterns=notable
        )

    def _analyze_time_control(
        self,
        time_control: str,
        tc_data: Dict[str, Any],
        elo_averages_data: Optional[Dict[str, Any]]
    ) -> Optional[TimeControlStats]:
        """Analyze time management for a specific time control"""
        games_analyzed = tc_data.get('games_analyzed', 0)
        if games_analyzed == 0:
            return None

        principles_data = tc_data.get('principles', {})
        time_mgmt = principles_data.get('time_management', {})

        if not time_mgmt:
            return None

        raw_metrics = time_mgmt.get('raw_metrics', {})
        elo_comparison = time_mgmt.get('elo_comparison', {})

        timeouts = raw_metrics.get('timeouts', 0)
        timeout_rate = raw_metrics.get('timeout_rate', 0.0)
        time_pressure_blunders = raw_metrics.get('time_pressure_blunders', 0)
        time_pressure_blunder_rate = raw_metrics.get('time_pressure_blunder_rate', 0.0)
        lost_with_time_remaining = raw_metrics.get('lost_with_time_remaining', 0)

        # Get population averages
        pop_avg_timeout_rate = elo_comparison.get('elo_average', 0.0)
        percentile = elo_comparison.get('percentile')

        # Get time pressure blunder rate from population data
        pop_avg_time_pressure_blunder_rate = 0.0
        if elo_averages_data and time_control in elo_averages_data:
            tc_pop_data = elo_averages_data[time_control].get('data', {})
            pop_avg_time_pressure_blunder_rate = tc_pop_data.get(
                'time_pressure_blunder_rate', {}
            ).get('mean', 0.0)

        # Calculate differences
        diff_timeout = round(timeout_rate - pop_avg_timeout_rate, 3)
        diff_time_pressure = round(
            time_pressure_blunder_rate - pop_avg_time_pressure_blunder_rate, 3
        )

        return TimeControlStats(
            time_control=time_control,
            games_analyzed=games_analyzed,
            timeouts=timeouts,
            timeout_rate=round(timeout_rate, 3),
            time_pressure_blunders=time_pressure_blunders,
            time_pressure_blunder_rate=round(time_pressure_blunder_rate, 3),
            lost_with_time_remaining=lost_with_time_remaining,
            pop_avg_timeout_rate=round(pop_avg_timeout_rate, 3),
            pop_avg_time_pressure_blunder_rate=round(pop_avg_time_pressure_blunder_rate, 3),
            diff_timeout_rate=diff_timeout,
            diff_time_pressure_blunder_rate=diff_time_pressure,
            percentile=percentile
        )

    def _identify_notable_patterns(
        self,
        time_control_stats: List[TimeControlStats]
    ) -> List[str]:
        """Identify notable patterns worth highlighting"""
        notable = []

        for stats in time_control_stats:
            # Check timeout rate
            if abs(stats.diff_timeout_rate) >= 0.1:
                direction = "higher" if stats.diff_timeout_rate > 0 else "lower"
                notable.append(
                    f"{direction} timeout rate in {stats.time_control} "
                    f"({stats.diff_timeout_rate:+.1%} vs avg)"
                )

            # Check time pressure blunders
            if abs(stats.diff_time_pressure_blunder_rate) >= 0.1:
                direction = "more" if stats.diff_time_pressure_blunder_rate > 0 else "fewer"
                notable.append(
                    f"{direction} time pressure blunders in {stats.time_control} "
                    f"({stats.diff_time_pressure_blunder_rate:+.1%} vs avg)"
                )

            # Check if losing with time remaining
            if stats.lost_with_time_remaining > 0:
                notable.append(
                    f"{stats.lost_with_time_remaining} game(s) lost with time remaining "
                    f"in {stats.time_control}"
                )

        return notable[:5]  # Limit to top 5

    def _create_empty_data(self) -> TimeManagementData:
        """Create empty data structure when no games available"""
        return TimeManagementData(
            total_games=0,
            elo_bracket=None,
            total_timeouts=0,
            total_timeout_rate=0.0,
            total_time_pressure_blunders=0,
            total_time_pressure_blunder_rate=0.0,
            total_lost_with_time_remaining=0,
            by_time_control=[],
            primary_time_control=None,
            notable_patterns=[]
        )

    def to_dict(self, data: TimeManagementData) -> Dict[str, Any]:
        """Convert TimeManagementData to a dictionary for JSON serialization"""
        return asdict(data)
