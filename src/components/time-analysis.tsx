import React, { useState, useMemo } from 'react';
import { gameFilterManager, FilterEvent, FilterType, SpeedFilter } from '../game-filter-manager';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis, LineChart, Line, Area, AreaChart, ComposedChart } from 'recharts';

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
const calculateAverageElo = (games: any[], username: string): number | null => {
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

interface TimeAnalysisProps {
  enrichedGames: any[];
  username: string;
  timeManagementData?: any;
  eloAveragesData?: EloAveragesData | null;
}

export const TimeAnalysis: React.FC<TimeAnalysisProps> = ({
  enrichedGames = [],
  username,
  timeManagementData,
  eloAveragesData = null
}) => {
  const [filteredGames, setFilteredGames] = useState<any[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

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
        totalGames: 0,
        eloBracket: null
      };
    }

    // Calculate user's average ELO and bracket
    const avgElo = calculateAverageElo(filteredGames, username);
    const eloBracket = avgElo ? getEloBracket(avgElo) : null;

    let totalOpeningTime = 0;
    let totalMiddleTime = 0;
    let totalEndTime = 0;
    let validGameCount = 0;

    // Track win percentages at different phases
    let afterOpeningWinPctSum = 0;
    let afterMiddleWinPctSum = 0;
    let endWinPctSum = 0;
    let winPctGameCount = 0;

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

      // Calculate win percentages at different phases
      const analysis = game.analysis || game.raw_json?.analysis || game.game?.analysis || game.game?.raw_json?.analysis;
      const winner = game.winner || game.raw_json?.winner || game.game?.winner || game.game?.raw_json?.winner;
      const status = game.status || game.raw_json?.status || game.game?.status || game.game?.raw_json?.status;

      if (analysis && analysis.length > 0) {
        const isWhite = userColor === 'white';

        // Determine game outcome from user's perspective
        const userWon = winner === userColor;
        const isDraw = !winner || status === 'draw' || status === 'stalemate';
        const outcomeWinPct = userWon ? 100 : (isDraw ? 50 : 0);

        // Helper function to get user's win percentage from white's perspective
        const getUserWinPct = (lichessWinPctWhite: number) => {
          return isWhite ? lichessWinPctWhite : (100 - lichessWinPctWhite);
        };

        // After opening phase
        if (!division || division.middle === undefined) {
          // Game ended in opening
          afterOpeningWinPctSum += outcomeWinPct;
        } else if (analysis[division.middle]?.lichess_win_percentage_white !== undefined) {
          afterOpeningWinPctSum += getUserWinPct(analysis[division.middle].lichess_win_percentage_white);
        }

        // After middle game phase
        if (!division || division.middle === undefined) {
          // Game ended in opening - no middle game
          afterMiddleWinPctSum += outcomeWinPct;
        } else if (!division.end) {
          // Game ended in middle game
          afterMiddleWinPctSum += outcomeWinPct;
        } else if (analysis[division.end]?.lichess_win_percentage_white !== undefined) {
          afterMiddleWinPctSum += getUserWinPct(analysis[division.end].lichess_win_percentage_white);
        }

        // End of game
        if (division && division.end !== undefined) {
          // Game reached endgame
          endWinPctSum += outcomeWinPct;
        } else {
          // Game ended earlier
          endWinPctSum += outcomeWinPct;
        }

        winPctGameCount++;
      }
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

    // Calculate average win percentages at each phase
    const avgAfterOpeningWinPct = winPctGameCount > 0 ? afterOpeningWinPctSum / winPctGameCount : 50;
    const avgAfterMiddleWinPct = winPctGameCount > 0 ? afterMiddleWinPctSum / winPctGameCount : 50;
    const avgEndWinPct = winPctGameCount > 0 ? endWinPctSum / winPctGameCount : 50;

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

    // Get population averages from eloAveragesData
    let popAvgOpeningPercent = 0;
    let popAvgMiddlePercent = 0;
    let popAvgEndPercent = 0;

    if (eloAveragesData && timeControl && eloAveragesData[timeControl]) {
      const timeControlData = eloAveragesData[timeControl].data;
      // Convert to percentages (they're stored as decimals like 0.30 for 30%)
      popAvgOpeningPercent = (timeControlData.percent_time_used_in_opening?.mean || 0) * 100;
      popAvgMiddlePercent = (timeControlData.percent_time_used_in_middlegame?.mean || 0) * 100;
      popAvgEndPercent = (timeControlData.percent_time_used_in_endgame?.mean || 0) * 100;
    }

    const chartData = [
      {
        phase: 'Start',
        percentage: null,
        timeSeconds: null,
        popAvg: null,
        winPct: 50
      },
      {
        phase: 'Opening',
        percentage: parseFloat(openingPercent.toFixed(1)),
        timeSeconds: parseFloat((avgOpeningTime / 100).toFixed(1)),
        popAvg: parseFloat(popAvgOpeningPercent.toFixed(1)),
        winPct: null
      },
      {
        phase: 'After Opening',
        percentage: null,
        timeSeconds: null,
        popAvg: null,
        winPct: parseFloat(avgAfterOpeningWinPct.toFixed(1))
      },
      {
        phase: 'Middle Game',
        percentage: parseFloat(middlePercent.toFixed(1)),
        timeSeconds: parseFloat((avgMiddleTime / 100).toFixed(1)),
        popAvg: parseFloat(popAvgMiddlePercent.toFixed(1)),
        winPct: null
      },
      {
        phase: 'After Middle',
        percentage: null,
        timeSeconds: null,
        popAvg: null,
        winPct: parseFloat(avgAfterMiddleWinPct.toFixed(1))
      },
      {
        phase: 'Endgame',
        percentage: parseFloat(endPercent.toFixed(1)),
        timeSeconds: parseFloat((avgEndTime / 100).toFixed(1)),
        popAvg: parseFloat(popAvgEndPercent.toFixed(1)),
        winPct: null
      },
      {
        phase: 'Game End',
        percentage: null,
        timeSeconds: null,
        popAvg: null,
        winPct: parseFloat(avgEndWinPct.toFixed(1))
      }
    ];

    return {
      chartData,
      totalGames: validGameCount,
      eloBracket
    };
  }, [filteredGames, username, eloAveragesData]);

  // Calculate time remaining distribution
  const timeRemainingData = useMemo(() => {
    if (!filteredGames.length) {
      return {
        chartData: [],
        totalGames: 0
      };
    }

    const gameResults: Array<{ timeRemaining: number; result: 'win' | 'loss' | 'draw' }> = [];
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

      // Determine result
      const userWon = winner === userColor;
      const isDraw = !winner || status === 'draw' || status === 'stalemate';

      let result: 'win' | 'loss' | 'draw';
      if (userWon) {
        result = 'win';
      } else if (isDraw) {
        result = 'draw';
      } else {
        result = 'loss';
      }

      gameResults.push({
        timeRemaining: Math.floor(userFinalTime / 1) * 1, // Round down to nearest 1 second
        result
      });
    });

    if (gameResults.length === 0) {
      return {
        chartData: [],
        totalGames: 0
      };
    }

    // Find max time to create buckets
    const maxTime = Math.max(...gameResults.map(g => g.timeRemaining));

    // Create 1-second buckets from 0 to maxTime
    const buckets: Record<number, { wins: number; losses: number; draws: number; total: number }> = {};
    for (let i = 0; i <= maxTime; i += 1) {
      buckets[i] = { wins: 0, losses: 0, draws: 0, total: 0 };
    }

    // Fill buckets
    gameResults.forEach(({ timeRemaining, result }) => {
      buckets[timeRemaining].total++;
      if (result === 'win') {
        buckets[timeRemaining].wins++;
      } else if (result === 'draw') {
        buckets[timeRemaining].draws++;
      } else {
        buckets[timeRemaining].losses++;
      }
    });

    // Helper function to calculate log-normal parameters from data
    const calculateLogNormalParams = (values: number[]): { mu: number; sigma: number } | null => {
      if (values.length === 0) return null;

      // Filter out zero values for log-normal (add small epsilon)
      const logValues = values.map(v => Math.log(Math.max(v, 0.1)));
      const n = logValues.length;

      const mu = logValues.reduce((sum, val) => sum + val, 0) / n;
      const variance = logValues.reduce((sum, val) => sum + Math.pow(val - mu, 2), 0) / n;
      const sigma = Math.sqrt(variance);

      return { mu, sigma };
    };

    // Helper function to calculate log-normal PDF
    const logNormalPDF = (x: number, mu: number, sigma: number): number => {
      if (x <= 0) return 0;
      const logX = Math.log(x);
      const exponent = -Math.pow(logX - mu, 2) / (2 * sigma * sigma);
      return Math.exp(exponent) / (x * sigma * Math.sqrt(2 * Math.PI));
    };

    // Extract time values for each result type (with repetition for frequency)
    const winTimes: number[] = [];
    const lossTimes: number[] = [];
    const drawTimes: number[] = [];

    gameResults.forEach(({ timeRemaining, result }) => {
      const time = timeRemaining;
      if (result === 'win') winTimes.push(time);
      else if (result === 'loss') lossTimes.push(time);
      else if (result === 'draw') drawTimes.push(time);
    });

    // Calculate log-normal parameters for each category
    const winParams = calculateLogNormalParams(winTimes);
    const lossParams = calculateLogNormalParams(lossTimes);
    const drawParams = calculateLogNormalParams(drawTimes);

    // Create smooth curve data points
    const curvePoints = 200; // Number of points for smooth curve
    const chartData: any[] = [];
    const densityThreshold = 0.01;

    // Track which result types have data
    const hasWinData = winTimes.length > 0;
    const hasLossData = lossTimes.length > 0;
    const hasDrawData = drawTimes.length > 0;

    for (let i = 0; i <= curvePoints; i++) {
      const time = (maxTime * i) / curvePoints;
      if (time < 0.1) continue; // Skip near-zero values for log-normal

      const point: any = { time: parseFloat(time.toFixed(1)) };

      // Calculate PDF values and scale by total count for each category
      let maxDensity = 0;

      if (winParams && hasWinData) {
        point.winsPDF = logNormalPDF(time, winParams.mu, winParams.sigma) * winTimes.length * (maxTime / curvePoints);
        maxDensity = Math.max(maxDensity, point.winsPDF);
      }
      if (lossParams && hasLossData) {
        point.lossesPDF = logNormalPDF(time, lossParams.mu, lossParams.sigma) * lossTimes.length * (maxTime / curvePoints);
        maxDensity = Math.max(maxDensity, point.lossesPDF);
      }
      if (drawParams && hasDrawData) {
        point.drawsPDF = logNormalPDF(time, drawParams.mu, drawParams.sigma) * drawTimes.length * (maxTime / curvePoints);
        maxDensity = Math.max(maxDensity, point.drawsPDF);
      }

      // Only add points where at least one density is above threshold
      if (maxDensity >= densityThreshold) {
        chartData.push(point);
      }
    }

    return {
      chartData,
      totalGames: validGameCount,
      hasWinData,
      hasLossData,
      hasDrawData
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

        const prevWinPct = analysis[i]?.lichess_win_percentage_white;
        const currWinPct = analysis[i + 1]?.lichess_win_percentage_white;
        const judgment = analysis[i + 1]?.judgment?.name;

        if (prevWinPct === undefined || currWinPct === undefined) continue;

        // Calculate win percentage change from user's perspective
        let winPctChange = isWhite ? (currWinPct - prevWinPct) : (prevWinPct - currWinPct);

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
            winPctChange: Math.abs(winPctChange),
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

  const hasData = timeUsageData.totalGames > 0;

  // Color mapping for each phase in the chart
  const getColorForPhase = (phase: string) => {
    switch (phase) {
      case 'Opening':
        return 'var(--primary-color)';
      case 'Middle Game':
        return 'var(--info-color)';
      case 'Endgame':
        return 'var(--secondary-color)';
      default:
        return 'transparent';
    }
  };

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

    const youBar = props.payload.find((p: any) => p.dataKey === 'percentage');
    const popAvgBar = props.payload.find((p: any) => p.dataKey === 'popAvg');
    const winPctLine = props.payload.find((p: any) => p.dataKey === 'winPct');
    const phase = props.label;
    const timeSeconds = youBar?.payload.timeSeconds;

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
          {phase}
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
              <span><strong>You:</strong> {youBar.value}% ({timeSeconds}s)</span>
            </p>
          )}
          {timeUsageData.eloBracket && popAvgBar && popAvgBar.value > 0 && (
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
              <span><strong>Avg ({timeUsageData.eloBracket}):</strong> {popAvgBar.value}%</span>
            </p>
          )}
          {winPctLine && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: 'var(--text-muted)',
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>Win %:</strong> {winPctLine.value}%</span>
            </p>
          )}
        </div>
      </div>
    );
  };

  // Custom legend for time usage chart
  const renderTimeLegend = (props: any) => {
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
        {timeUsageData.eloBracket && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              backgroundColor: 'var(--text-primary)',
              opacity: 0.5
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>Avg ({timeUsageData.eloBracket})</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '12px',
            height: '2px',
            backgroundColor: 'var(--text-muted)'
          }} />
          <span style={{ color: 'var(--text-secondary)' }}>Average Evaluation</span>
        </div>
      </div>
    );
  };

  return (
    <div className="time-analysis" style={{
      padding: '20px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '8px',
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 6px var(--shadow-light)'
    }}>
      <div style={{ marginBottom: '16px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{
            fontSize: '1.125rem',
            fontWeight: '600',
            marginBottom: '8px',
            color: 'var(--text-primary)'
          }}>
            Time Analysis ({gameFilterManager.getFilterDescription()})
          </h3>
          <div
            style={{
              position: 'relative',
              cursor: 'pointer',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              backgroundColor: 'var(--background-primary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '18px',
              fontWeight: 'normal',
              transition: 'all 0.2s ease',
              lineHeight: '1'
            }}
            onMouseEnter={() => setShowInfoTooltip(true)}
            onMouseLeave={() => setShowInfoTooltip(false)}
            onClick={() => setShowInfoTooltip(!showInfoTooltip)}
          >
            ⓘ
            {showInfoTooltip && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '8px',
                width: '320px',
                maxWidth: '90vw',
                padding: '16px',
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                boxShadow: '0 4px 16px var(--shadow-medium)',
                zIndex: 1000,
                fontSize: '13px',
                color: 'var(--text-primary)',
                lineHeight: '1.5',
                textAlign: 'left'
              }}>
                <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: '600' }}>
                  How to Read This Chart
                </h4>
                <ul style={{ marginBottom: 0, paddingLeft: '18px', marginTop: '8px' }}>
                  <li style={{ marginBottom: '10px' }}>
                    <strong>Time Usage Bars:</strong> Show what percentage of your total game time you spend in each phase (opening, middlegame, endgame).
                  </li>
                  <li style={{ marginBottom: '10px' }}>
                    <strong>Population Average:</strong> Semi-transparent bars show how players in your ELO bracket typically spend their time, helping you identify if you're over/under-thinking certain phases.
                  </li>
                  <li style={{ marginBottom: '10px' }}>
                    <strong>Win % Line:</strong> The gray line shows your average evaluation/win percentage at key transition points in the game.
                  </li>
                  <li style={{ marginBottom: '10px' }}>
                    <strong>Time Remaining Distribution:</strong> Shows when your games typically end and how much time you have left by result type.
                  </li>
                  <li>
                    <strong>Critical Moves Scatter:</strong> Plots time spent vs. position criticality to reveal if you're investing time appropriately on important decisions.
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          {hasData ? (
            <>Average time usage per game phase (based on {timeUsageData.totalGames} games)</>
          ) : (
            <span style={{ fontStyle: 'italic' }}>No games with time data available yet...</span>
          )}
        </div>
      </div>

      {/* Chart Container */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px',
        minHeight: '316px'
      }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={timeUsageData.chartData}
            margin={{ top: 10, right: 40, left: 10, bottom: 5 }}
            style={{ cursor: 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis
              dataKey="phase"
              fontSize={12}
              tick={{ fill: 'var(--text-secondary)' }}
            />
            <YAxis
              yAxisId="left"
              fontSize={12}
              tick={{ fill: 'var(--text-secondary)' }}
              label={{
                value: 'Time Usage (%)',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'var(--text-secondary)', fontSize: 12 }
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              fontSize={12}
              tick={{ fill: 'var(--text-secondary)' }}
              domain={[0, 100]}
              label={{
                value: 'Win %',
                angle: 90,
                position: 'insideRight',
                style: { fill: 'var(--text-secondary)', fontSize: 12 }
              }}
            />
            <Tooltip
              content={renderCustomTooltip}
              cursor={false}
            />
            <Legend content={renderTimeLegend} />
            {/* User's actual time usage */}
            <Bar yAxisId="left" dataKey="percentage" name="You" radius={[4, 4, 0, 0]}>
              {timeUsageData.chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColorForPhase(entry.phase)} />
              ))}
            </Bar>
            {/* Population average */}
            {timeUsageData.eloBracket && (
              <Bar yAxisId="left" dataKey="popAvg" name={`Avg (${timeUsageData.eloBracket})`} radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                {timeUsageData.chartData.map((entry, index) => (
                  <Cell key={`cell-pop-${index}`} fill={getColorForPhase(entry.phase)} />
                ))}
              </Bar>
            )}
            {/* Win percentage line */}
            <Line
              yAxisId="right"
              type="linear"
              dataKey="winPct"
              stroke="var(--text-muted)"
              strokeWidth={2}
              name="Win %"
              dot={{ fill: 'var(--text-muted)', r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls={true}
            />
          </ComposedChart>
        </ResponsiveContainer>
        ) : (
          <div style={{
            height: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px',
            fontStyle: 'italic'
          }}>
            Loading time usage data...
          </div>
        )}
      </div>

      {/* Time Remaining Distribution and Critical Moments Charts */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
        gap: '20px',
        marginTop: '24px'
      }}>
        {/* Time Remaining Distribution */}
        <div style={{
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px',
          minHeight: '338px'
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
            Log-normal probability distribution of time remaining by result
          </div>
          {hasData && timeRemainingData.totalGames > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart
                data={timeRemainingData.chartData}
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="time"
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Time Remaining (seconds)',
                    position: 'insideBottom',
                    offset: -5,
                    style: { fill: 'var(--text-secondary)', fontSize: 11 }
                  }}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Probability Density',
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
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>{data.time.toFixed(1)}s remaining</div>
                        {data.winsPDF !== undefined && (
                          <div style={{ color: 'var(--success-color)' }}>Win density: {data.winsPDF.toFixed(3)}</div>
                        )}
                        {data.drawsPDF !== undefined && (
                          <div style={{ color: 'var(--text-secondary)' }}>Draw density: {data.drawsPDF.toFixed(3)}</div>
                        )}
                        {data.lossesPDF !== undefined && (
                          <div style={{ color: 'var(--danger-color)' }}>Loss density: {data.lossesPDF.toFixed(3)}</div>
                        )}
                      </div>
                    );
                  }}
                  cursor={{ strokeDasharray: '3 3' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  iconType="line"
                />
                {timeRemainingData.hasWinData && (
                  <Area
                    type="monotone"
                    dataKey="winsPDF"
                    stroke="var(--success-color)"
                    fill="var(--success-color)"
                    fillOpacity={0.4}
                    name="Wins"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
                {timeRemainingData.hasDrawData && (
                  <Area
                    type="monotone"
                    dataKey="drawsPDF"
                    stroke="var(--text-secondary)"
                    fill="var(--text-secondary)"
                    fillOpacity={0.4}
                    name="Draws"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
                {timeRemainingData.hasLossData && (
                  <Area
                    type="monotone"
                    dataKey="lossesPDF"
                    stroke="var(--danger-color)"
                    fill="var(--danger-color)"
                    fillOpacity={0.4}
                    name="Losses"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '250px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px',
              fontStyle: 'italic'
            }}>
              Loading time remaining data...
            </div>
          )}
        </div>

        {/* Critical Moments Time Usage */}
        <div style={{
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px',
          minHeight: '338px'
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
            {hasData && criticalMomentsData.totalMoves > 0 ? (
              <>Time usage vs. move quality ({criticalMomentsData.totalMoves} moves analyzed)</>
            ) : (
              <span style={{ fontStyle: 'italic' }}>Analyzing move quality...</span>
            )}
          </div>
          {hasData && criticalMomentsData.totalMoves > 0 ? (
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
                  dataKey="winPctChange"
                  name="Win % Change"
                  fontSize={11}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{
                    value: 'Win % Change',
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
                        <div>Win % change: {data.winPctChange.toFixed(1)}%</div>
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
          ) : (
            <div style={{
              height: '250px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px',
              fontStyle: 'italic'
            }}>
              Loading critical moments data...
            </div>
          )}
        </div>
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
                <strong>Insight:</strong> You've lost {timeManagementData.raw_metrics.timeouts} game{timeManagementData.raw_metrics.timeouts > 1 ? 's' : ''} on time.
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
                <strong>Insight:</strong> You lost {timeManagementData.raw_metrics.lost_with_time_remaining} game{timeManagementData.raw_metrics.lost_with_time_remaining > 1 ? 's' : ''} while having more than 60 seconds remaining.
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
