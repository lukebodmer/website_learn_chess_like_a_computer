import React, { useMemo, useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';

interface GameResult {
  id?: string;
  winner?: 'white' | 'black' | null;
  status?: 'mate' | 'resign' | 'outoftime' | 'draw' | 'stalemate' | 'insufficient';
  players?: {
    white?: {
      user?: {
        name?: string;
      };
    };
    black?: {
      user?: {
        name?: string;
      };
    };
  };
  // Handle different data structures from your system
  white_player?: string;
  black_player?: string;
  raw_json?: any;
  game?: any;
}

interface GameResultsChartProps {
  enrichedGames: GameResult[];
  username: string;
  chartType?: 'pie' | 'bar';
}

interface ChartData {
  name: string;
  value: number;
  fill: string;
  category: 'win' | 'loss' | 'draw';
}

// Color scheme using CSS variables from main.css
const COLORS = {
  wins: {
    mate: 'var(--success-color)',      // Green - checkmate win
    resign: 'var(--success-light)',    // Light green - resignation win
    outoftime: 'var(--success-color)' // Green - timeout win
  },
  losses: {
    mate: 'var(--danger-color)',      // Red - checkmate loss
    resign: 'var(--warning-color)',   // Orange - resignation loss
    outoftime: 'var(--danger-color)' // Red - timeout loss
  },
  draws: 'var(--text-muted)'          // Gray - draws
};

export const GameResultsChart: React.FC<GameResultsChartProps> = ({
  enrichedGames = [],
  username,
  chartType = 'bar'
}) => {
  const [filteredGames, setFilteredGames] = useState<GameResult[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');

  // Set up filter manager when component mounts
  useEffect(() => {
    // Initialize the filter manager with username and current games
    gameFilterManager.setUsername(username);
    gameFilterManager.updateAllGames(enrichedGames);

    // Listen for filter changes
    const handleFilterChange = (event: FilterEvent) => {
      setFilteredGames(event.filteredGames);
      setCurrentFilter(event.filter);
    };

    gameFilterManager.addListener(handleFilterChange);

    // Clean up listener on unmount
    return () => {
      gameFilterManager.removeListener(handleFilterChange);
    };
  }, [username]);

  // Update games when enrichedGames prop changes
  useEffect(() => {
    gameFilterManager.updateAllGames(enrichedGames);
  }, [enrichedGames]);

  const { winsData, lossesData, totalGames, userStats, maxYAxisValue } = useMemo(() => {
    if (!filteredGames.length) {
      return {
        winsData: [],
        lossesData: [],
        totalGames: 0,
        userStats: { wins: 0, losses: 0, draws: 0 }
      };
    }

    // Initialize counters
    const results = {
      wins: { mate: 0, resign: 0, outoftime: 0 },
      losses: { mate: 0, resign: 0, outoftime: 0 },
      draws: 0
    };

    // Process each game to categorize results
    filteredGames.forEach(game => {
      // Handle different data structures
      let isWhitePlayer = false;
      let isBlackPlayer = false;
      let gameWinner = null;
      let gameStatus = 'unknown';

      // Try to extract player info from different possible structures
      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        // Lichess format
        isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
        isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();
        gameWinner = game.winner;
        gameStatus = game.status;
      } else if (game.white_player || game.black_player) {
        // Your custom format
        isWhitePlayer = game.white_player?.toLowerCase() === username.toLowerCase();
        isBlackPlayer = game.black_player?.toLowerCase() === username.toLowerCase();
        gameWinner = game.raw_json?.winner || game.game?.raw_json?.winner;
        gameStatus = game.raw_json?.status || game.game?.raw_json?.status;
      } else if (game.game) {
        // Nested game structure
        const nestedGame = game.game;
        isWhitePlayer = nestedGame.white_player?.toLowerCase() === username.toLowerCase();
        isBlackPlayer = nestedGame.black_player?.toLowerCase() === username.toLowerCase();
        gameWinner = nestedGame.raw_json?.winner;
        gameStatus = nestedGame.raw_json?.status;
      }

      // Skip if user is not in this game
      if (!isWhitePlayer && !isBlackPlayer) {
        return;
      }

      const userColor = isWhitePlayer ? 'white' : 'black';

      // Determine if user won, lost, or drew
      if (gameWinner === null || gameStatus === 'draw' || gameStatus === 'stalemate') {
        results.draws++;
      } else if (gameWinner === userColor) {
        // User won - categorize by how
        if (gameStatus === 'mate') {
          results.wins.mate++;
        } else if (gameStatus === 'resign') {
          results.wins.resign++;
        } else if (gameStatus === 'outoftime') {
          results.wins.outoftime++;
        }
      } else {
        // User lost - categorize by how
        if (gameStatus === 'mate') {
          results.losses.mate++;
        } else if (gameStatus === 'resign') {
          results.losses.resign++;
        } else if (gameStatus === 'outoftime') {
          results.losses.outoftime++;
        }
      }
    });

    // Build separate data arrays for wins and losses
    const winsChartData = [
      { name: 'Checkmate', value: results.wins.mate, fill: COLORS.wins.mate },
      { name: 'Resignation', value: results.wins.resign, fill: COLORS.wins.resign },
      { name: 'Timeout', value: results.wins.outoftime, fill: COLORS.wins.outoftime }
    ];

    const lossesChartData = [
      { name: 'Checkmate', value: results.losses.mate, fill: COLORS.losses.mate },
      { name: 'Resignation', value: results.losses.resign, fill: COLORS.losses.resign },
      { name: 'Timeout', value: results.losses.outoftime, fill: COLORS.losses.outoftime }
    ];

    const totalWins = results.wins.mate + results.wins.resign + results.wins.outoftime;
    const totalLosses = results.losses.mate + results.losses.resign + results.losses.outoftime;
    const totalGames = totalWins + totalLosses + results.draws;

    // Calculate the maximum Y-axis value for consistent comparison
    const maxWinValue = Math.max(...winsChartData.map(item => item.value));
    const maxLossValue = Math.max(...lossesChartData.map(item => item.value));
    const maxYAxisValue = Math.max(maxWinValue, maxLossValue);

    return {
      winsData: winsChartData,
      lossesData: lossesChartData,
      totalGames,
      userStats: { wins: totalWins, losses: totalLosses, draws: results.draws },
      maxYAxisValue
    };
  }, [filteredGames, username, currentFilter]);

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload[0]) return null;

    const data = props.payload[0];
    const percentage = totalGames > 0 ? ((data.value / totalGames) * 100).toFixed(1) : '0';

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
          {data.payload.name}
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
          <span>{`${data.value} games (${percentage}%)`}</span>
        </p>
      </div>
    );
  };

  if (totalGames === 0) {
    const filterDescription = currentFilter === 'all'
      ? 'No games available yet...'
      : `No ${currentFilter} games found for ${username}`;

    return (
      <div className="game-results-chart" style={{
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
            Game Results ({gameFilterManager.getFilterDescription()})
          </h3>
          <p style={{
            color: 'var(--text-secondary)',
            margin: 0,
            fontSize: '14px'
          }}>
            {filterDescription}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="game-results-chart" style={{
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
          Game Results ({gameFilterManager.getFilterDescription()})
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Total Games: {totalGames} | Wins: {userStats.wins} | Losses: {userStats.losses} | Draws: {userStats.draws}
        </div>
      </div>

      {/* Charts Container */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '20px',
        marginTop: '16px'
      }}>
        {/* Wins Chart */}
        {userStats.wins > 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{
              margin: '0 0 12px 0',
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--success-color)',
              textAlign: 'center'
            }}>
              Wins ({userStats.wins})
            </h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={winsData}
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                style={{ cursor: 'default' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="name"
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                  domain={[0, maxYAxisValue]}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={false}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {winsData.map((entry, index) => (
                    <Cell key={`wins-cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Losses Chart */}
        {userStats.losses > 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{
              margin: '0 0 12px 0',
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--danger-color)',
              textAlign: 'center'
            }}>
              Losses ({userStats.losses})
            </h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={lossesData}
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                style={{ cursor: 'default' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="name"
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                  domain={[0, maxYAxisValue]}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={false}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {lossesData.map((entry, index) => (
                    <Cell key={`losses-cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Overall Results Pie Chart */}
        {totalGames > 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{
              margin: '0 0 12px 0',
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              Overall Results
            </h4>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={[
                    {
                      name: 'Wins',
                      value: userStats.wins,
                      fill: 'var(--success-color)'
                    },
                    {
                      name: 'Losses',
                      value: userStats.losses,
                      fill: 'var(--danger-color)'
                    },
                    {
                      name: 'Draws',
                      value: userStats.draws,
                      fill: 'var(--text-muted)'
                    }
                  ].filter(item => item.value > 0)}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={60}
                  dataKey="value"
                  animationDuration={500}
                  animationBegin={0}
                >
                  {[
                    { name: 'Wins', value: userStats.wins, fill: 'var(--success-color)' },
                    { name: 'Losses', value: userStats.losses, fill: 'var(--danger-color)' },
                    { name: 'Draws', value: userStats.draws, fill: 'var(--text-muted)' }
                  ].filter(item => item.value > 0).map((entry, index) => (
                    <Cell key={`overall-cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={renderCustomTooltip} />
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }}
                  iconType="circle"
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* No Data State */}
        {userStats.wins === 0 && userStats.losses === 0 && userStats.draws === 0 && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            gridColumn: '1 / -1'
          }}>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: '16px',
              margin: 0
            }}>
              No game data available for the selected filter.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GameResultsChart;