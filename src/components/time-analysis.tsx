import React, { useState, useMemo } from 'react';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';

interface TimeAnalysisProps {
  enrichedGames: any[];
  username: string;
  timeManagementData?: any;
}

export const TimeAnalysis: React.FC<TimeAnalysisProps> = ({
  enrichedGames = [],
  username,
  timeManagementData
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

  // Calculate time remaining distribution
  const timeRemainingData = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalGames: 0
      };
    }

    // Time buckets: 0-10s, 10-30s, 30-60s, 60-120s, 120s+
    const buckets = {
      '0-10s': { wins: 0, losses: 0, draws: 0, total: 0 },
      '10-30s': { wins: 0, losses: 0, draws: 0, total: 0 },
      '30-60s': { wins: 0, losses: 0, draws: 0, total: 0 },
      '60-120s': { wins: 0, losses: 0, draws: 0, total: 0 },
      '120s+': { wins: 0, losses: 0, draws: 0, total: 0 }
    };

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

      // Get clocks and game result
      const clocks = game.clocks || game.raw_json?.clocks || game.game?.clocks || game.game?.raw_json?.clocks;
      const winner = game.winner || game.raw_json?.winner || game.game?.winner || game.game?.raw_json?.winner;
      const status = game.status || game.raw_json?.status || game.game?.status || game.game?.raw_json?.status;

      if (!clocks || clocks.length === 0) return;

      validGameCount++;

      // Get user's final time
      const isWhite = userColor === 'white';
      let userFinalTime = null;

      // Find user's last clock entry
      for (let i = clocks.length - 1; i >= 0; i--) {
        const moveNumber = i + 1;
        const isWhiteMove = moveNumber % 2 === 1;
        if ((isWhite && isWhiteMove) || (!isWhite && !isWhiteMove)) {
          userFinalTime = clocks[i] / 100; // Convert centiseconds to seconds
          break;
        }
      }

      if (userFinalTime === null) return;

      // Determine bucket
      let bucket: string;
      if (userFinalTime < 10) bucket = '0-10s';
      else if (userFinalTime < 30) bucket = '10-30s';
      else if (userFinalTime < 60) bucket = '30-60s';
      else if (userFinalTime < 120) bucket = '60-120s';
      else bucket = '120s+';

      // Determine result
      const userWon = winner === userColor;
      const isDraw = !winner || status === 'draw' || status === 'stalemate';

      buckets[bucket].total++;
      if (userWon) {
        buckets[bucket].wins++;
      } else if (isDraw) {
        buckets[bucket].draws++;
      } else {
        buckets[bucket].losses++;
      }
    });

    // Convert to chart data
    const chartData = Object.entries(buckets).map(([bucket, data]) => ({
      bucket,
      wins: data.wins,
      losses: data.losses,
      draws: data.draws,
      total: data.total
    }));

    return {
      chartData,
      totalGames: validGameCount
    };
  }, [filteredGames, username]);

  // Calculate critical moments time usage
  const criticalMomentsData = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalMoves: 0
      };
    }

    const moveData: any[] = [];

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

      // Get clocks and analysis
      const clocks = game.clocks || game.raw_json?.clocks || game.game?.clocks || game.game?.raw_json?.clocks;
      const analysis = game.analysis || game.raw_json?.analysis || game.game?.analysis || game.game?.raw_json?.analysis;

      if (!clocks || !analysis || clocks.length === 0 || analysis.length === 0) return;

      const isWhite = userColor === 'white';

      // Analyze each user move
      for (let i = 0; i < analysis.length - 1; i++) {
        const moveNumber = i + 1;
        const isWhiteMove = moveNumber % 2 === 1;
        const isUserMove = (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

        if (!isUserMove) continue;

        const prevEval = analysis[i]?.eval;
        const currEval = analysis[i + 1]?.eval;
        const judgment = analysis[i + 1]?.judgment?.name;

        if (prevEval === undefined || currEval === undefined) continue;

        // Calculate eval change from user's perspective
        let evalChange = currEval - prevEval;
        if (!isWhite) evalChange = -evalChange;

        // Calculate time spent on this move
        let timeSpent = 0;
        if (i > 0 && i < clocks.length) {
          const prevTime = clocks[i - 1] || clocks[0];
          const currTime = clocks[i];
          timeSpent = Math.max(0, (prevTime - currTime) / 100); // Convert to seconds
        }

        // Categorize move
        let category: string;
        if (judgment === 'Blunder') {
          category = 'Blunder';
        } else if (judgment === 'Mistake') {
          category = 'Mistake';
        } else if (judgment === 'Inaccuracy') {
          category = 'Inaccuracy';
        } else if (judgment === 'Good' || judgment === 'Excellent' || judgment === 'Best') {
          category = 'Good Move';
        } else {
          category = 'Normal Move';
        }

        // Only include moves with reasonable time spent (filter outliers)
        if (timeSpent < 300) { // Less than 5 minutes per move
          moveData.push({
            evalChange: Math.abs(evalChange),
            timeSpent,
            category,
            moveNumber
          });
        }
      }
    });

    return {
      chartData: moveData,
      totalMoves: moveData.length
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

      {/* Time Remaining Distribution and Critical Moments Charts */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
        gap: '20px',
        marginTop: '24px'
      }}>
        {/* Time Remaining Distribution */}
        {timeRemainingData.totalGames > 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              marginBottom: '12px',
              color: 'var(--text-primary)'
            }}>
              Time Remaining at Game End
            </h4>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '12px'
            }}>
              Win/loss distribution by time remaining
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={timeRemainingData.chartData}
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="bucket"
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Games',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--text-secondary)', fontSize: 11 }
                  }}
                />
                <Tooltip
                  content={(props: any) => {
                    if (!props.active || !props.payload || !props.payload[0]) return null;
                    const data = props.payload[0].payload;
                    return (
                      <div style={{
                        backgroundColor: 'var(--background-primary)',
                        padding: '8px 12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{data.bucket}</div>
                        <div style={{ color: 'var(--success-color)' }}>Wins: {data.wins}</div>
                        <div style={{ color: 'var(--text-secondary)' }}>Draws: {data.draws}</div>
                        <div style={{ color: 'var(--danger-color)' }}>Losses: {data.losses}</div>
                        <div style={{ marginTop: '4px', fontWeight: '600' }}>Total: {data.total}</div>
                      </div>
                    );
                  }}
                  cursor={false}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  iconType="circle"
                />
                <Bar dataKey="wins" stackId="a" fill="var(--success-color)" name="Wins" radius={[0, 0, 0, 0]} />
                <Bar dataKey="draws" stackId="a" fill="var(--text-secondary)" name="Draws" radius={[0, 0, 0, 0]} />
                <Bar dataKey="losses" stackId="a" fill="var(--danger-color)" name="Losses" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Critical Moments Time Usage */}
        {criticalMomentsData.totalMoves > 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              marginBottom: '12px',
              color: 'var(--text-primary)'
            }}>
              Time Spent on Critical Moves
            </h4>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '12px'
            }}>
              Time usage vs. move quality ({criticalMomentsData.totalMoves} moves analyzed)
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  type="number"
                  dataKey="timeSpent"
                  name="Time Spent"
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Time (seconds)',
                    position: 'insideBottom',
                    offset: -5,
                    style: { fill: 'var(--text-secondary)', fontSize: 11 }
                  }}
                  domain={[0, 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="evalChange"
                  name="Position Complexity"
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Eval Change (cp)',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--text-secondary)', fontSize: 11 }
                  }}
                  domain={[0, 'auto']}
                />
                <ZAxis range={[20, 20]} />
                <Tooltip
                  content={(props: any) => {
                    if (!props.active || !props.payload || !props.payload[0]) return null;
                    const data = props.payload[0].payload;
                    return (
                      <div style={{
                        backgroundColor: 'var(--background-primary)',
                        padding: '8px 12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{data.category}</div>
                        <div>Time: {data.timeSpent.toFixed(1)}s</div>
                        <div>Eval change: {data.evalChange.toFixed(0)}cp</div>
                      </div>
                    );
                  }}
                  cursor={{ strokeDasharray: '3 3' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  iconType="circle"
                />
                <Scatter
                  name="Blunder"
                  data={criticalMomentsData.chartData.filter((d: any) => d.category === 'Blunder')}
                  fill="var(--danger-color)"
                  fillOpacity={0.6}
                />
                <Scatter
                  name="Mistake"
                  data={criticalMomentsData.chartData.filter((d: any) => d.category === 'Mistake')}
                  fill="var(--warning-color)"
                  fillOpacity={0.6}
                />
                <Scatter
                  name="Good Move"
                  data={criticalMomentsData.chartData.filter((d: any) => d.category === 'Good Move')}
                  fill="var(--success-color)"
                  fillOpacity={0.6}
                />
                <Scatter
                  name="Normal"
                  data={criticalMomentsData.chartData.filter((d: any) => d.category === 'Normal Move')}
                  fill="var(--text-secondary)"
                  fillOpacity={0.3}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Time Management Metrics from Principles Analyzer */}
      {timeManagementData && (
        <div style={{
          marginTop: '24px',
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <h4 style={{
            fontSize: '1rem',
            fontWeight: '600',
            marginBottom: '16px',
            color: 'var(--text-primary)'
          }}>
            Time Management Performance
          </h4>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px'
          }}>
            {/* Timeout Rate */}
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--background-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '4px'
              }}>
                Timeout Rate
              </div>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '4px'
              }}>
                {(timeManagementData.raw_metrics.timeout_rate * 100).toFixed(1)}%
              </div>
              <div style={{
                fontSize: '11px',
                color: timeManagementData.elo_comparison.difference > 0
                  ? 'var(--danger-color)'
                  : 'var(--success-color)'
              }}>
                {timeManagementData.elo_comparison.difference > 0 ? '↑' : '↓'}
                {Math.abs(timeManagementData.elo_comparison.difference * 100).toFixed(1)}% vs avg
              </div>
            </div>

            {/* Percentile Score */}
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--background-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '4px'
              }}>
                Percentile
              </div>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                color: timeManagementData.elo_comparison.percentile >= 50
                  ? 'var(--success-color)'
                  : 'var(--warning-color)',
                marginBottom: '4px'
              }}>
                {timeManagementData.elo_comparison.percentile}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)'
              }}>
                {timeManagementData.elo_comparison.percentile >= 75
                  ? 'Excellent'
                  : timeManagementData.elo_comparison.percentile >= 50
                    ? 'Above Average'
                    : timeManagementData.elo_comparison.percentile >= 25
                      ? 'Below Average'
                      : 'Needs Work'}
              </div>
            </div>

            {/* Time Pressure Blunders */}
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--background-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '4px'
              }}>
                Time Pressure Blunders
              </div>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '4px'
              }}>
                {timeManagementData.raw_metrics.time_pressure_blunders}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)'
              }}>
                {(timeManagementData.raw_metrics.time_pressure_blunder_rate * 100).toFixed(0)}% of games
              </div>
            </div>

            {/* Total Timeouts */}
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--background-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '4px'
              }}>
                Games Lost on Time
              </div>
              <div style={{
                fontSize: '20px',
                fontWeight: '600',
                color: timeManagementData.raw_metrics.timeouts > 0
                  ? 'var(--danger-color)'
                  : 'var(--success-color)',
                marginBottom: '4px'
              }}>
                {timeManagementData.raw_metrics.timeouts}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)'
              }}>
                out of {timeManagementData.raw_metrics.total_games} games
              </div>
            </div>
          </div>

          {/* Insights */}
          {timeManagementData.raw_metrics.timeouts > 0 && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: 'var(--warning-bg)',
              border: '1px solid var(--warning-color)',
              borderRadius: '6px'
            }}>
              <div style={{
                fontSize: '13px',
                color: 'var(--text-primary)',
                lineHeight: '1.5'
              }}>
                <strong>💡 Insight:</strong> You've lost {timeManagementData.raw_metrics.timeouts} game{timeManagementData.raw_metrics.timeouts > 1 ? 's' : ''} on time.
                {timeManagementData.raw_metrics.time_pressure_blunders > 0 &&
                  ` Additionally, you made ${timeManagementData.raw_metrics.time_pressure_blunders} blunder${timeManagementData.raw_metrics.time_pressure_blunders > 1 ? 's' : ''} while under time pressure (< 10 seconds).`
                }
                {' '}Consider practicing with longer time controls or working on faster pattern recognition.
              </div>
            </div>
          )}

          {timeManagementData.raw_metrics.lost_with_time_remaining > 0 && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: 'var(--info-bg)',
              border: '1px solid var(--primary-color)',
              borderRadius: '6px'
            }}>
              <div style={{
                fontSize: '13px',
                color: 'var(--text-primary)',
                lineHeight: '1.5'
              }}>
                <strong>💡 Insight:</strong> You lost {timeManagementData.raw_metrics.lost_with_time_remaining} game{timeManagementData.raw_metrics.lost_with_time_remaining > 1 ? 's' : ''} while having more than 60 seconds remaining.
                This suggests you could benefit from using more time to calculate critical positions.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimeAnalysis;
