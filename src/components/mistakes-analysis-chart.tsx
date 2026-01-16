import React, { useMemo, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell, Legend } from 'recharts';
import { gameFilterManager, FilterEvent, FilterType, SpeedFilter } from '../game-filter-manager';

interface GameAnalysis {
  id?: string;
  speed?: string;
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

interface EloAveragesData {
  [timeControl: string]: {
    bracket: string;
    elo: number;
    data: {
      [key: string]: {
        mean: number;
        std: number;
        skew: number;
      };
    };
  };
}

interface MistakesAnalysisChartProps {
  enrichedGames: GameAnalysis[];
  username: string;
  eloAveragesData?: EloAveragesData | null;
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
  popAvgInaccuracies?: number;
  popAvgMistakes?: number;
  popAvgBlunders?: number;
}

// Helper function to determine ELO bracket
const getEloBracket = (rating: number): string => {
  if (rating < 1200) return '800-1200';
  if (rating < 1400) return '1200-1400';
  if (rating < 1600) return '1400-1600';
  if (rating < 1800) return '1600-1800';
  if (rating < 2000) return '1800-2000';
  return '2000+';
};

// Helper function to calculate average ELO from games
const calculateAverageElo = (games: GameAnalysis[], username: string): number | null => {
  let totalRating = 0;
  let count = 0;

  games.forEach(game => {
    let rating = null;
    let isWhitePlayer = false;
    let isBlackPlayer = false;

    // Try to extract data from different possible structures
    if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
      // Lichess format
      isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
      isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();

      if (isWhitePlayer) {
        rating = game.players?.white?.rating;
      } else if (isBlackPlayer) {
        rating = game.players?.black?.rating;
      }
    } else if (game.white_player || game.black_player) {
      // Custom format
      isWhitePlayer = game.white_player?.toLowerCase() === username.toLowerCase();
      isBlackPlayer = game.black_player?.toLowerCase() === username.toLowerCase();

      const rawJson = game.raw_json || game.game?.raw_json;
      if (rawJson) {
        if (isWhitePlayer) {
          rating = rawJson.players?.white?.rating;
        } else if (isBlackPlayer) {
          rating = rawJson.players?.black?.rating;
        }
      }
    } else if (game.game) {
      // Nested game structure
      const nestedGame = game.game;
      isWhitePlayer = nestedGame.white_player?.toLowerCase() === username.toLowerCase();
      isBlackPlayer = nestedGame.black_player?.toLowerCase() === username.toLowerCase();

      const rawJson = nestedGame.raw_json;
      if (rawJson) {
        if (isWhitePlayer) {
          rating = rawJson.players?.white?.rating;
        } else if (isBlackPlayer) {
          rating = rawJson.players?.black?.rating;
        }
      }
    }

    if (rating !== null) {
      totalRating += rating;
      count++;
    }
  });

  return count > 0 ? totalRating / count : null;
};

// Color scheme using CSS variables from main.css
const COLORS = {
  inaccuracies: 'var(--text-muted)',        // Gray for inaccuracies (least severe)
  mistakes: 'var(--warning-color)',         // Orange for mistakes
  blunders: 'var(--danger-color)'           // Red for blunders (most severe)
};

export const MistakesAnalysisChart: React.FC<MistakesAnalysisChartProps> = ({
  enrichedGames = [],
  username,
  eloAveragesData = null
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

  const { chartData, totalGames, averageStats, phaseData, totalPhaseData, eloBracket } = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalGames: 0,
        averageStats: { inaccuracies: 0, mistakes: 0, blunders: 0 },
        phaseData: [],
        totalPhaseData: [],
        eloBracket: null
      };
    }

    // Calculate user's average ELO and bracket
    const avgElo = calculateAverageElo(filteredGames, username);
    const eloBracket = avgElo ? getEloBracket(avgElo) : null;

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

    // Calculate averages from phase data
    const avgInaccuracies = validGameCount > 0 ?
      (phaseCounters.opening.inaccuracies + phaseCounters.middle.inaccuracies + phaseCounters.end.inaccuracies) / validGameCount : 0;
    const avgMistakes = validGameCount > 0 ?
      (phaseCounters.opening.mistakes + phaseCounters.middle.mistakes + phaseCounters.end.mistakes) / validGameCount : 0;
    const avgBlunders = validGameCount > 0 ?
      (phaseCounters.opening.blunders + phaseCounters.middle.blunders + phaseCounters.end.blunders) / validGameCount : 0;

    // Get population averages for total mistakes per game if we have ELO averages data
    let popAvgTotalInaccuracies = 0;
    let popAvgTotalMistakes = 0;
    let popAvgTotalBlunders = 0;

    // Determine which time control to use based on current filter
    const speedFilter = gameFilterManager.getCurrentSpeedFilter();
    let timeControl: string | null = null;

    if (Array.isArray(speedFilter) && speedFilter.length === 1) {
      // Single time control selected
      timeControl = speedFilter[0];
    } else if (speedFilter === 'all' || (Array.isArray(speedFilter) && speedFilter.length === 0)) {
      // All speeds or no filter - try to determine from games
      // Use the most common time control in the filtered games
      const speeds = filteredGames.map(g => g.speed).filter(Boolean);
      if (speeds.length > 0) {
        const speedCounts = speeds.reduce((acc, s) => {
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        timeControl = Object.entries(speedCounts).sort((a, b) => b[1] - a[1])[0][0];
      }
    } else if (Array.isArray(speedFilter) && speedFilter.length > 1) {
      // Multiple speeds selected - use the first one
      timeControl = speedFilter[0];
    }

    if (eloAveragesData && timeControl && eloAveragesData[timeControl]) {
      const timeControlData = eloAveragesData[timeControl].data;
      // Sum up opening + middlegame + endgame averages
      popAvgTotalInaccuracies =
        (timeControlData.opening_inaccuracies_per_game?.mean || 0) +
        (timeControlData.middlegame_inaccuracies_per_game?.mean || 0) +
        (timeControlData.endgame_inaccuracies_per_game?.mean || 0);
      popAvgTotalMistakes =
        (timeControlData.opening_mistakes_per_game?.mean || 0) +
        (timeControlData.middlegame_mistakes_per_game?.mean || 0) +
        (timeControlData.endgame_mistakes_per_game?.mean || 0);
      popAvgTotalBlunders =
        (timeControlData.opening_blunders_per_game?.mean || 0) +
        (timeControlData.middlegame_blunders_per_game?.mean || 0) +
        (timeControlData.endgame_blunders_per_game?.mean || 0);
    }

    // Build chart data with population averages
    const chartData = [
      {
        name: 'Inaccuracies',
        value: parseFloat(avgInaccuracies.toFixed(2)),
        popAvg: parseFloat(popAvgTotalInaccuracies.toFixed(2)),
        fill: COLORS.inaccuracies
      },
      {
        name: 'Mistakes',
        value: parseFloat(avgMistakes.toFixed(2)),
        popAvg: parseFloat(popAvgTotalMistakes.toFixed(2)),
        fill: COLORS.mistakes
      },
      {
        name: 'Blunders',
        value: parseFloat(avgBlunders.toFixed(2)),
        popAvg: parseFloat(popAvgTotalBlunders.toFixed(2)),
        fill: COLORS.blunders
      }
    ];

    // Build phase data for charts
    const totalPhaseData = [
      { phase: 'Opening', inaccuracies: phaseCounters.opening.inaccuracies, mistakes: phaseCounters.opening.mistakes, blunders: phaseCounters.opening.blunders },
      { phase: 'Middlegame', inaccuracies: phaseCounters.middle.inaccuracies, mistakes: phaseCounters.middle.mistakes, blunders: phaseCounters.middle.blunders },
      { phase: 'Endgame', inaccuracies: phaseCounters.end.inaccuracies, mistakes: phaseCounters.end.mistakes, blunders: phaseCounters.end.blunders }
    ];

    // Get population averages if we have ELO averages data
    let popAvgOpening = { inaccuracies: 0, mistakes: 0, blunders: 0 };
    let popAvgMiddlegame = { inaccuracies: 0, mistakes: 0, blunders: 0 };
    let popAvgEndgame = { inaccuracies: 0, mistakes: 0, blunders: 0 };

    if (eloAveragesData && timeControl && eloAveragesData[timeControl]) {
      const timeControlData = eloAveragesData[timeControl].data;
      popAvgOpening = {
        inaccuracies: timeControlData.opening_inaccuracies_per_game?.mean || 0,
        mistakes: timeControlData.opening_mistakes_per_game?.mean || 0,
        blunders: timeControlData.opening_blunders_per_game?.mean || 0
      };
      popAvgMiddlegame = {
        inaccuracies: timeControlData.middlegame_inaccuracies_per_game?.mean || 0,
        mistakes: timeControlData.middlegame_mistakes_per_game?.mean || 0,
        blunders: timeControlData.middlegame_blunders_per_game?.mean || 0
      };
      popAvgEndgame = {
        inaccuracies: timeControlData.endgame_inaccuracies_per_game?.mean || 0,
        mistakes: timeControlData.endgame_mistakes_per_game?.mean || 0,
        blunders: timeControlData.endgame_blunders_per_game?.mean || 0
      };
    }

    const averagePhaseData = [
      {
        phase: 'Opening',
        inaccuracies: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.inaccuracies / phaseCounters.opening.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.mistakes / phaseCounters.opening.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.opening.gameCount > 0 ? parseFloat((phaseCounters.opening.blunders / phaseCounters.opening.gameCount).toFixed(2)) : 0,
        popAvgInaccuracies: popAvgOpening.inaccuracies,
        popAvgMistakes: popAvgOpening.mistakes,
        popAvgBlunders: popAvgOpening.blunders
      },
      {
        phase: 'Middlegame',
        inaccuracies: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.inaccuracies / phaseCounters.middle.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.mistakes / phaseCounters.middle.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.middle.gameCount > 0 ? parseFloat((phaseCounters.middle.blunders / phaseCounters.middle.gameCount).toFixed(2)) : 0,
        popAvgInaccuracies: popAvgMiddlegame.inaccuracies,
        popAvgMistakes: popAvgMiddlegame.mistakes,
        popAvgBlunders: popAvgMiddlegame.blunders
      },
      {
        phase: 'Endgame',
        inaccuracies: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.inaccuracies / phaseCounters.end.gameCount).toFixed(2)) : 0,
        mistakes: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.mistakes / phaseCounters.end.gameCount).toFixed(2)) : 0,
        blunders: phaseCounters.end.gameCount > 0 ? parseFloat((phaseCounters.end.blunders / phaseCounters.end.gameCount).toFixed(2)) : 0,
        popAvgInaccuracies: popAvgEndgame.inaccuracies,
        popAvgMistakes: popAvgEndgame.mistakes,
        popAvgBlunders: popAvgEndgame.blunders
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
      totalPhaseData: totalPhaseData,
      eloBracket
    };
  }, [filteredGames, username, currentFilter, eloAveragesData]);

  // Helper function to convert single phase data to chart format
  const convertPhaseToChartData = (phase: PhaseData) => {
    return [
      {
        name: 'Inaccuracies',
        You: phase.inaccuracies,
        PopAvg: phase.popAvgInaccuracies || 0,
        fill: COLORS.inaccuracies
      },
      {
        name: 'Mistakes',
        You: phase.mistakes,
        PopAvg: phase.popAvgMistakes || 0,
        fill: COLORS.mistakes
      },
      {
        name: 'Blunders',
        You: phase.blunders,
        PopAvg: phase.popAvgBlunders || 0,
        fill: COLORS.blunders
      }
    ];
  };

  // Custom legend for phase charts
  const renderPhaseLegend = (props: any) => {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        fontSize: '11px',
        paddingTop: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            backgroundColor: 'var(--text-primary)',
            opacity: 1
          }} />
          <span style={{ color: 'var(--text-secondary)' }}>You</span>
        </div>
        {eloBracket && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              backgroundColor: 'var(--text-primary)',
              opacity: 0.5
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>Avg ({eloBracket})</span>
          </div>
        )}
      </div>
    );
  };

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

    const name = props.label;
    const youBar = props.payload.find((p: any) => p.dataKey === 'value');
    const popAvgBar = props.payload.find((p: any) => p.dataKey === 'popAvg');

    return (
      <div style={{
        backgroundColor: 'var(--background-primary)',
        padding: '12px 16px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px var(--shadow-medium)',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(8px)',
        minWidth: '220px'
      }}>
        <p style={{
          margin: '0 0 8px 0',
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}>
          {name}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {youBar && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: youBar.color,
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>You:</strong> {youBar.value} avg per game</span>
            </p>
          )}
          {eloBracket && popAvgBar && popAvgBar.value > 0 && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: popAvgBar.color || '#999',
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>Avg ({eloBracket}):</strong> {popAvgBar.value} avg per game</span>
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderPhaseTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

    const name = props.label;
    const youBar = props.payload.find((p: any) => p.dataKey === 'You');
    const popAvgBar = props.payload.find((p: any) => p.dataKey === 'PopAvg');

    return (
      <div style={{
        backgroundColor: 'var(--background-primary)',
        padding: '12px 16px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px var(--shadow-medium)',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(8px)',
        minWidth: '200px'
      }}>
        <p style={{
          margin: '0 0 8px 0',
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}>
          {name}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {youBar && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: youBar.color,
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>You:</strong> {youBar.value.toFixed(2)}</span>
            </p>
          )}
          {eloBracket && popAvgBar && popAvgBar.value > 0 && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: popAvgBar.color || '#999',
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>Avg ({eloBracket}):</strong> {popAvgBar.value.toFixed(2)}</span>
            </p>
          )}
        </div>
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
      border: '2px solid var(--primary-color)',
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
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={chartData}
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
              />
              <Tooltip
                content={renderCustomTooltip}
                cursor={false}
              />
              <Legend content={renderPhaseLegend} />
              {/* User's actual mistakes */}
              <Bar dataKey="value" name="You" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
              {/* Population average */}
              {eloBracket && (
                <Bar dataKey="popAvg" name={`Avg (${eloBracket})`} radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-pop-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Opening Phase Chart */}
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
            Opening Mistakes
          </h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={convertPhaseToChartData(phaseData[0])}
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
              />
              <Tooltip
                content={renderPhaseTooltip}
                cursor={false}
              />
              <Legend content={renderPhaseLegend} />
              <Bar dataKey="You" name="You" radius={[4, 4, 0, 0]}>
                <Cell fill={COLORS.inaccuracies} />
                <Cell fill={COLORS.mistakes} />
                <Cell fill={COLORS.blunders} />
              </Bar>
              {eloBracket && (
                <Bar dataKey="PopAvg" name={`Avg (${eloBracket})`} radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                  <Cell fill={COLORS.inaccuracies} />
                  <Cell fill={COLORS.mistakes} />
                  <Cell fill={COLORS.blunders} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Middlegame Phase Chart */}
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
            Middlegame Mistakes
          </h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={convertPhaseToChartData(phaseData[1])}
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
              />
              <Tooltip
                content={renderPhaseTooltip}
                cursor={false}
              />
              <Legend content={renderPhaseLegend} />
              <Bar dataKey="You" name="You" radius={[4, 4, 0, 0]}>
                <Cell fill={COLORS.inaccuracies} />
                <Cell fill={COLORS.mistakes} />
                <Cell fill={COLORS.blunders} />
              </Bar>
              {eloBracket && (
                <Bar dataKey="PopAvg" name={`Avg (${eloBracket})`} radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                  <Cell fill={COLORS.inaccuracies} />
                  <Cell fill={COLORS.mistakes} />
                  <Cell fill={COLORS.blunders} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Endgame Phase Chart */}
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
            Endgame Mistakes
          </h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={convertPhaseToChartData(phaseData[2])}
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
              />
              <Tooltip
                content={renderPhaseTooltip}
                cursor={false}
              />
              <Legend content={renderPhaseLegend} />
              <Bar dataKey="You" name="You" radius={[4, 4, 0, 0]}>
                <Cell fill={COLORS.inaccuracies} />
                <Cell fill={COLORS.mistakes} />
                <Cell fill={COLORS.blunders} />
              </Bar>
              {eloBracket && (
                <Bar dataKey="PopAvg" name={`Avg (${eloBracket})`} radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                  <Cell fill={COLORS.inaccuracies} />
                  <Cell fill={COLORS.mistakes} />
                  <Cell fill={COLORS.blunders} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default MistakesAnalysisChart;