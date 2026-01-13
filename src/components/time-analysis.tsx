import React, { useState, useMemo } from 'react';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface TimeAnalysisProps {
  enrichedGames: any[];
  username: string;
}

export const TimeAnalysis: React.FC<TimeAnalysisProps> = ({
  enrichedGames = [],
  username
}) => {
  const [filteredGames, setFilteredGames] = useState<any[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');

  // Set up filter manager when component mounts
  React.useEffect(() => {
    gameFilterManager.setUsername(username);
    gameFilterManager.updateAllGames(enrichedGames);

    const handleFilterChange = (event: FilterEvent) => {
      setFilteredGames(event.filteredGames);
      setCurrentFilter(event.filter);
    };

    gameFilterManager.addListener(handleFilterChange);

    return () => {
      gameFilterManager.removeListener(handleFilterChange);
    };
  }, [username]);

  React.useEffect(() => {
    gameFilterManager.updateAllGames(enrichedGames);
  }, [enrichedGames]);

  // Calculate time usage data
  const timeUsageData = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalGames: 0
      };
    }

    let totalOpeningTime = 0;
    let totalMiddleTime = 0;
    let totalEndTime = 0;
    let validGameCount = 0;

    filteredGames.forEach(game => {
      // Check if user is in this game
      let isUserInGame = false;
      let userColor: 'white' | 'black' | null = null;

      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        const isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;
        userColor = isWhitePlayer ? 'white' : 'black';
      } else if (game.white_player || game.black_player) {
        const isWhitePlayer = game.white_player?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.black_player?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;
        userColor = isWhitePlayer ? 'white' : 'black';
      }

      if (!isUserInGame || !userColor) return;

      // Get clocks and clock data
      const clocks = game.clocks || game.raw_json?.clocks || game.game?.clocks || game.game?.raw_json?.clocks;
      const clock = game.clock || game.raw_json?.clock || game.game?.clock || game.game?.raw_json?.clock;
      const division = game.division || game.raw_json?.division || game.game?.division || game.game?.raw_json?.division;

      if (!clocks || !clock || !clock.initial) return;

      validGameCount++;

      const initialTime = clock.initial * 100; // Convert to centiseconds

      // Determine move indices for each phase
      // White moves: 0, 2, 4, 6... (even indices)
      // Black moves: 1, 3, 5, 7... (odd indices)
      const isWhite = userColor === 'white';

      // Calculate time used in opening phase
      let openingTime = 0;
      if (division && division.middle !== undefined) {
        // Opening ends at division.middle
        const openingEndMove = division.middle;

        // Find user's last move in opening
        let lastOpeningMoveIndex = -1;
        for (let i = (isWhite ? 0 : 1); i < openingEndMove && i < clocks.length; i += 2) {
          lastOpeningMoveIndex = i;
        }

        if (lastOpeningMoveIndex >= 0) {
          // Time used = initial time - time remaining after last opening move
          openingTime = initialTime - clocks[lastOpeningMoveIndex];
        }
      } else {
        // No division data - entire game was in opening
        const userMoves = clocks.filter((_, idx) => isWhite ? idx % 2 === 0 : idx % 2 === 1);
        if (userMoves.length > 0) {
          openingTime = initialTime - userMoves[userMoves.length - 1];
        }
      }

      // Calculate time used in middle game phase
      let middleTime = 0;
      if (division && division.middle !== undefined) {
        const middleStartMove = division.middle;
        const middleEndMove = division.end !== undefined ? division.end : clocks.length;

        // Find user's first and last moves in middle game
        let firstMiddleMoveIndex = -1;
        let lastMiddleMoveIndex = -1;

        for (let i = (isWhite ? 0 : 1); i < clocks.length; i += 2) {
          if (i >= middleStartMove && firstMiddleMoveIndex === -1) {
            firstMiddleMoveIndex = i;
          }
          if (i >= middleStartMove && i < middleEndMove) {
            lastMiddleMoveIndex = i;
          }
        }

        if (firstMiddleMoveIndex >= 0 && lastMiddleMoveIndex >= 0 && firstMiddleMoveIndex < clocks.length) {
          const timeAtMiddleStart = clocks[firstMiddleMoveIndex - 2] || initialTime; // Get time before first middle move
          const timeAtMiddleEnd = lastMiddleMoveIndex < clocks.length ? clocks[lastMiddleMoveIndex] : clocks[clocks.length - 1];
          middleTime = timeAtMiddleStart - timeAtMiddleEnd;
        }
      }

      // Calculate time used in endgame phase
      let endTime = 0;
      if (division && division.end !== undefined) {
        const endStartMove = division.end;

        // Find user's first move in endgame
        let firstEndMoveIndex = -1;
        let lastEndMoveIndex = -1;

        for (let i = (isWhite ? 0 : 1); i < clocks.length; i += 2) {
          if (i >= endStartMove && firstEndMoveIndex === -1) {
            firstEndMoveIndex = i;
          }
          if (i >= endStartMove) {
            lastEndMoveIndex = i;
          }
        }

        if (firstEndMoveIndex >= 0 && firstEndMoveIndex < clocks.length) {
          const timeAtEndStart = clocks[firstEndMoveIndex - 2] || (firstEndMoveIndex >= 2 ? clocks[firstEndMoveIndex - 2] : clocks[0]);
          const timeAtEndEnd = lastEndMoveIndex < clocks.length ? clocks[lastEndMoveIndex] : clocks[clocks.length - 1];
          endTime = timeAtEndStart - timeAtEndEnd;
        }
      }

      totalOpeningTime += openingTime;
      totalMiddleTime += middleTime;
      totalEndTime += endTime;
    });

    if (validGameCount === 0) {
      return {
        chartData: [],
        totalGames: 0
      };
    }

    // Calculate average time per game for each phase
    const avgOpeningTime = totalOpeningTime / validGameCount;
    const avgMiddleTime = totalMiddleTime / validGameCount;
    const avgEndTime = totalEndTime / validGameCount;

    // Get average initial time (in centiseconds)
    const totalInitialTime = filteredGames.reduce((sum, game) => {
      const clock = game.clock || game.raw_json?.clock || game.game?.clock || game.game?.raw_json?.clock;
      return sum + (clock?.initial ? clock.initial * 100 : 0);
    }, 0);
    const avgInitialTime = totalInitialTime / validGameCount;

    // Calculate percentages
    const openingPercent = (avgOpeningTime / avgInitialTime) * 100;
    const middlePercent = (avgMiddleTime / avgInitialTime) * 100;
    const endPercent = (avgEndTime / avgInitialTime) * 100;

    const chartData = [
      {
        phase: 'Opening',
        percentage: parseFloat(openingPercent.toFixed(1)),
        timeSeconds: parseFloat((avgOpeningTime / 100).toFixed(1))
      },
      {
        phase: 'Middle Game',
        percentage: parseFloat(middlePercent.toFixed(1)),
        timeSeconds: parseFloat((avgMiddleTime / 100).toFixed(1))
      },
      {
        phase: 'Endgame',
        percentage: parseFloat(endPercent.toFixed(1)),
        timeSeconds: parseFloat((avgEndTime / 100).toFixed(1))
      }
    ];

    return {
      chartData,
      totalGames: validGameCount
    };
  }, [filteredGames, username]);

  if (timeUsageData.totalGames === 0) {
    return (
      <div className="time-analysis" style={{
        padding: '20px',
        backgroundColor: 'var(--background-secondary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 2px 6px var(--shadow-light)'
      }}>
        <h3 style={{
          fontSize: '1.125rem',
          fontWeight: '600',
          marginBottom: '8px',
          color: 'var(--text-primary)'
        }}>
          Time Analysis ({gameFilterManager.getFilterDescription()})
        </h3>
        <p style={{
          color: 'var(--text-secondary)',
          margin: 0,
          fontSize: '14px'
        }}>
          No games with time data available yet...
        </p>
      </div>
    );
  }

  const colors = ['var(--primary-color)', 'var(--success-color)', 'var(--warning-color)'];

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload[0]) return null;

    const data = props.payload[0];
    const percentage = data.value;
    const timeSeconds = data.payload.timeSeconds;

    return (
      <div style={{
        backgroundColor: 'var(--background-primary)',
        padding: '10px 14px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px var(--shadow-medium)',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(8px)'
      }}>
        <p style={{
          margin: '0 0 6px 0',
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}>
          {data.payload.phase}
        </p>
        <p style={{
          margin: 0,
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{
            color: data.color,
            fontSize: '14px',
            filter: 'brightness(1.1)'
          }}>●</span>
          <span>{`${percentage}% (${timeSeconds}s)`}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="time-analysis" style={{
      padding: '20px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      boxShadow: '0 2px 6px var(--shadow-light)'
    }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{
          fontSize: '1.125rem',
          fontWeight: '600',
          marginBottom: '8px',
          color: 'var(--text-primary)'
        }}>
          Time Analysis ({gameFilterManager.getFilterDescription()})
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Average time usage per game phase (based on {timeUsageData.totalGames} games)
        </div>
      </div>

      {/* Chart Container */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={timeUsageData.chartData}
            margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
            style={{ cursor: 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis
              dataKey="phase"
              fontSize={12}
              tick={{ fill: 'var(--text-secondary)' }}
            />
            <YAxis
              fontSize={12}
              tick={{ fill: 'var(--text-secondary)' }}
              label={{
                value: 'Time Usage (%)',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'var(--text-secondary)', fontSize: 12 }
              }}
            />
            <Tooltip
              content={renderCustomTooltip}
              cursor={false}
            />
            <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
              {timeUsageData.chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TimeAnalysis;
