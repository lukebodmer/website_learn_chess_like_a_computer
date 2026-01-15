import React, { useMemo, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell, Legend } from 'recharts';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';

interface GameAnalysis {
  id?: string;
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
  white_player?: string;
  black_player?: string;
  raw_json?: any;
  game?: any;
}

interface MistakesAnalysisChartProps {
  enrichedGames: GameAnalysis[];
  username: string;
}

interface ChartData {
  name: string;
  value: number;
  fill: string;
}

interface PhaseData {
  phase: string;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

// Color scheme using CSS variables from main.css
const COLORS = {
  inaccuracies: 'var(--warning-color)',     // Orange for inaccuracies
  mistakes: 'var(--danger-color)',          // Red for mistakes
  blunders: 'var(--text-muted)'            // Gray for blunders (most severe)
};

export const MistakesAnalysisChart: React.FC<MistakesAnalysisChartProps> = ({
  enrichedGames = [],
  username
}) => {
  const [filteredGames, setFilteredGames] = useState<GameAnalysis[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');

  // Set up filter manager when component mounts
  useEffect(() => {
    // Get initial filtered games from the filter manager
    setFilteredGames(gameFilterManager.getFilteredGames());
    setCurrentFilter(gameFilterManager.getCurrentFilter());

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
  }, []);

  const { chartData, totalGames, averageStats, phaseData, totalPhaseData } = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalGames: 0,
        averageStats: { inaccuracies: 0, mistakes: 0, blunders: 0 },
        phaseData: [],
        totalPhaseData: []
      };
    }

    // Initialize counters
    let totalInaccuracies = 0;
    let totalMistakes = 0;
    let totalBlunders = 0;
    let validGameCount = 0;

    // Initialize phase counters
    const phaseCounters = {
      opening: { inaccuracies: 0, mistakes: 0, blunders: 0, gameCount: 0 },
      middle: { inaccuracies: 0, mistakes: 0, blunders: 0, gameCount: 0 },
      end: { inaccuracies: 0, mistakes: 0, blunders: 0, gameCount: 0 }
    };

    // Process each game to extract mistake data
    filteredGames.forEach((game, index) => {
      // Handle different data structures
      let isUserInGame = false;
      let gameAnalysis = null;

      // Try to extract player info and analysis from different possible structures
      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        // Lichess format
        const isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;

        if (isUserInGame) {
          const userColor = isWhitePlayer ? 'white' : 'black';
          // Direct access to analysis data in the main players structure
          gameAnalysis = game.players?.[userColor]?.analysis;
        }
      } else if (game.white_player || game.black_player) {
        // Your custom format
        const isWhitePlayer = game.white_player?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.black_player?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;

        if (isUserInGame) {
          const userColor = isWhitePlayer ? 'white' : 'black';
          gameAnalysis = game.raw_json?.players?.[userColor]?.analysis ||
                        game.game?.raw_json?.players?.[userColor]?.analysis ||
                        game.players?.[userColor]?.analysis;
        }
      } else if (game.game) {
        // Nested game structure
        const nestedGame = game.game;
        const isWhitePlayer = nestedGame.white_player?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = nestedGame.black_player?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;

        if (isUserInGame) {
          const userColor = isWhitePlayer ? 'white' : 'black';
          gameAnalysis = nestedGame.raw_json?.players?.[userColor]?.analysis ||
                        nestedGame.players?.[userColor]?.analysis;
        }
      }

      // Skip if user is not in this game or no analysis data
      if (!isUserInGame || !gameAnalysis) {
        return;
      }

      // Extract mistake counts
      const inaccuracies = gameAnalysis.inaccuracy || 0;
      const mistakes = gameAnalysis.mistake || 0;
      const blunders = gameAnalysis.blunder || 0;

      totalInaccuracies += inaccuracies;
      totalMistakes += mistakes;
      totalBlunders += blunders;
      validGameCount++;

      // Detailed phase analysis
      const analysisArray = game.analysis || [];
      const division = game.division;

      if (analysisArray.length > 0) {
        // Determine game phases based on division data
        let openingEnd = 0;
        let middleEnd = analysisArray.length;

        if (division) {
          openingEnd = division.middle || 0;
          middleEnd = division.end || analysisArray.length;
        }

        // Count mistakes by phase
        const phaseMistakes = {
          opening: { inaccuracies: 0, mistakes: 0, blunders: 0 },
          middle: { inaccuracies: 0, mistakes: 0, blunders: 0 },
          end: { inaccuracies: 0, mistakes: 0, blunders: 0 }
        };

        analysisArray.forEach((move, moveIndex) => {
          if (move.judgment) {
            const phase = moveIndex < openingEnd ? 'opening' :
                         moveIndex < middleEnd ? 'middle' : 'end';

            switch (move.judgment.name) {
              case 'Inaccuracy':
                phaseMistakes[phase].inaccuracies++;
                break;
              case 'Mistake':
                phaseMistakes[phase].mistakes++;
                break;
              case 'Blunder':
                phaseMistakes[phase].blunders++;
                break;
            }
          }
        });

        // Add to phase counters
        Object.keys(phaseMistakes).forEach(phase => {
          phaseCounters[phase].inaccuracies += phaseMistakes[phase].inaccuracies;
          phaseCounters[phase].mistakes += phaseMistakes[phase].mistakes;
          phaseCounters[phase].blunders += phaseMistakes[phase].blunders;
          phaseCounters[phase].gameCount++;
        });
      }
    });

    // Calculate averages
    const avgInaccuracies = validGameCount > 0 ? totalInaccuracies / validGameCount : 0;
    const avgMistakes = validGameCount > 0 ? totalMistakes / validGameCount : 0;
    const avgBlunders = validGameCount > 0 ? totalBlunders / validGameCount : 0;

    // Build chart data
    const chartData = [
      {
        name: 'Inaccuracies',
        value: parseFloat(avgInaccuracies.toFixed(2)),
        fill: COLORS.inaccuracies
      },
      {
        name: 'Mistakes',
        value: parseFloat(avgMistakes.toFixed(2)),
        fill: COLORS.mistakes
      },
      {
        name: 'Blunders',
        value: parseFloat(avgBlunders.toFixed(2)),
        fill: COLORS.blunders
      }
    ];

    // Build phase data for charts
    const totalPhaseData = [
      { phase: 'Opening', inaccuracies: phaseCounters.opening.inaccuracies, mistakes: phaseCounters.opening.mistakes, blunders: phaseCounters.opening.blunders },
      { phase: 'Middlegame', inaccuracies: phaseCounters.middle.inaccuracies, mistakes: phaseCounters.middle.mistakes, blunders: phaseCounters.middle.blunders },
      { phase: 'Endgame', inaccuracies: phaseCounters.end.inaccuracies, mistakes: phaseCounters.end.mistakes, blunders: phaseCounters.end.blunders }
    ];

    const averagePhaseData = [
      {
        phase: 'Opening',
        inaccuracies: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.inaccuracies / phaseCounters.opening.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.mistakes / phaseCounters.opening.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.blunders / phaseCounters.opening.gameCount).toFixed(2)) : 0
      },
      {
        phase: 'Middlegame',
        inaccuracies: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.inaccuracies / phaseCounters.middle.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.mistakes / phaseCounters.middle.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.blunders / phaseCounters.middle.gameCount).toFixed(2)) : 0
      },
      {
        phase: 'Endgame',
        inaccuracies: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.inaccuracies / phaseCounters.end.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.mistakes / phaseCounters.end.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.blunders / phaseCounters.end.gameCount).toFixed(2)) : 0
      }
    ];

    return {
      chartData,
      totalGames: validGameCount,
      averageStats: {
        inaccuracies: avgInaccuracies,
        mistakes: avgMistakes,
        blunders: avgBlunders
      },
      phaseData: averagePhaseData,
      totalPhaseData: totalPhaseData
    };
  }, [filteredGames, username, currentFilter]);

  // Helper function to convert phase data to grouped bar chart format
  const convertToGroupedData = (phaseData: PhaseData[]) => {
    return phaseData.map(phase => ({
      phase: phase.phase,
      Inaccuracies: phase.inaccuracies,
      Mistakes: phase.mistakes,
      Blunders: phase.blunders
    }));
  };

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload[0]) return null;

    const data = props.payload[0];

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
          {data.payload.name || data.dataKey}
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
          <span>{`${data.value} ${data.payload.name ? 'avg per game' : ''}`}</span>
        </p>
      </div>
    );
  };

  const renderPhaseTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.label) return null;

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
          margin: '0 0 8px 0',
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}>
          {props.label}
        </p>
        {props.payload.map((entry: any, index: number) => (
          <p key={index} style={{
            margin: '2px 0',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              color: entry.color,
              fontSize: '14px',
              filter: 'brightness(1.1)'
            }}>●</span>
            <span>{`${entry.dataKey}: ${entry.value}`}</span>
          </p>
        ))}
      </div>
    );
  };

  if (totalGames === 0) {
    const filterDescription = currentFilter === 'all'
      ? 'No analyzed games available yet...'
      : `No ${currentFilter} analyzed games found for ${username}`;

    return (
      <div className="mistakes-analysis-chart" style={{
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
            Mistakes Analysis ({gameFilterManager.getFilterDescription()})
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
    <div className="mistakes-analysis-chart" style={{
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
          Mistakes Analysis ({gameFilterManager.getFilterDescription()})
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Analyzed Games: {totalGames} | Avg Inaccuracies: {averageStats.inaccuracies.toFixed(2)} | Avg Mistakes: {averageStats.mistakes.toFixed(2)} | Avg Blunders: {averageStats.blunders.toFixed(2)}
        </div>
      </div>

      {/* Charts Container - Side by Side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: '20px',
        marginTop: '16px'
      }}>
        {/* Average Mistakes Per Game Chart */}
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
            Average Mistakes Per Game
          </h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
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
              />
              <Tooltip
                content={renderCustomTooltip}
                cursor={false}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Average Mistakes by Phase Chart */}
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
            Average Mistakes by Game Phase
          </h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={convertToGroupedData(phaseData)}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
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
              />
              <Tooltip
                content={renderPhaseTooltip}
                cursor={false}
              />
              <Legend />
              <Bar dataKey="Inaccuracies" fill={COLORS.inaccuracies} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Mistakes" fill={COLORS.mistakes} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Blunders" fill={COLORS.blunders} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default MistakesAnalysisChart;