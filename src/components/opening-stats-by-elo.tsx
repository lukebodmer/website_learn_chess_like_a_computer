import React, { useState, useEffect, useMemo } from 'react';
import OpeningBoard from './opening-board';
import BaseChessBoard from './base-chess-board';
import { Chess } from 'chess.js';
import { StartIcon, PrevIcon, NextIcon, EndIcon } from './navigation-icons';
import { getCurrentBoardTheme, BoardTheme } from '../board-theme-utils';

interface CommonMistake {
  fen: string;
  move: string;
  count: number;
  best_move?: string;
  variation?: string;
  evaluation?: number;
}

type ErrorType = 'blunder' | 'mistake' | 'inaccuracy';

interface EloRangeData {
  [timeControl: string]: {
    [openingName: string]: {
      eco: string;
      sample_size: number;
      number_of_times_played: number;
      opening_fen?: string;
      opening_pgn?: string;
      top_3_blunders?: CommonMistake[];
      top_3_mistakes?: CommonMistake[];
      top_3_inaccuracies?: CommonMistake[];
      opening_inaccuracies_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
      opening_mistakes_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
      opening_blunders_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
    };
  };
}

interface OpeningStatsData {
  name: string;
  eco: string;
  sampleSize: number;
  timesPlayed: number;
  popularity: number; // percentage of total games
  avgInaccuracies: number;
  avgMistakes: number;
  avgBlunders: number;
  errorRate: number; // 1 * inaccuracies + 2 * mistakes + 3 * blunders
  timeControl: string;
  openingFen?: string;
  openingPgn?: string;
  top_3_blunders?: CommonMistake[];
  top_3_mistakes?: CommonMistake[];
  top_3_inaccuracies?: CommonMistake[];
}

interface GroupedOpening {
  baseName: string;
  ecoPrefix: string;
  totalSampleSize: number;
  totalTimesPlayed: number;
  totalPopularity: number;
  avgInaccuracies: number;
  avgMistakes: number;
  avgBlunders: number;
  errorRate: number;
  variations: OpeningStatsData[];
}

interface SelectedError {
  error: CommonMistake;
  type: ErrorType;
}

type PuzzleMode = 'viewing' | 'solving' | 'solved' | 'failed';

interface UserReport {
  id: number;
  title: string;
  username: string;
}

interface UserOpeningStats {
  opening: string;
  total: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  success_rate: number;
  avg_inaccuracies: number;
  avg_mistakes: number;
  avg_blunders: number;
}

const ELO_RANGES = [
  '0-600',
  '700-800',
  '1100-1200',
  '1200-1300',
  '1300-1400'
];

const TIME_CONTROLS = ['bullet', 'blitz', 'rapid'];

export const OpeningStatsByElo: React.FC = () => {
  const [selectedEloRange, setSelectedEloRange] = useState<string>('700-800');
  const [selectedTimeControl, setSelectedTimeControl] = useState<string>('blitz');
  const [eloData, setEloData] = useState<EloRangeData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedOpening, setSelectedOpening] = useState<OpeningStatsData | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupedOpening | null>(null);
  const [selectedOpeningFen, setSelectedOpeningFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [boardSize, setBoardSize] = useState<number>(320);
  const [sortBy, setSortBy] = useState<'name' | 'sample' | 'performance' | 'user_performance'>('sample');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(0);
  const [openingMoves, setOpeningMoves] = useState<string[]>([]);
  const [selectedError, setSelectedError] = useState<SelectedError | null>(null);
  const [puzzleMode, setPuzzleMode] = useState<PuzzleMode>('viewing');
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null);
  const [pendingPositionUpdate, setPendingPositionUpdate] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(getCurrentBoardTheme());
  const [arrows, setArrows] = useState<{ from: string, to: string, color: string }[]>([]);
  const [highlightedSquares, setHighlightedSquares] = useState<{ square: string, color: string }[]>([]);
  const [solvedErrors, setSolvedErrors] = useState<Set<string>>(new Set());
  const [availableReports, setAvailableReports] = useState<UserReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [userOpeningStats, setUserOpeningStats] = useState<Map<string, UserOpeningStats>>(new Map());
  const [loadingUserData, setLoadingUserData] = useState<boolean>(false);

  // Handle column header clicks
  const handleSortClick = (column: 'name' | 'sample' | 'performance' | 'user_performance') => {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default sort order
      setSortBy(column);
      // Default sort orders for each column
      if (column === 'name') {
        setSortOrder('asc'); // A-Z by default
      } else if (column === 'performance') {
        setSortOrder('asc'); // Best (lowest error) first by default
      } else if (column === 'user_performance') {
        setSortOrder('desc'); // Best (highest positive diff) first by default
      } else {
        setSortOrder('desc'); // Most popular first by default
      }
    }
  };

  // Responsive board size based on window width
  useEffect(() => {
    const updateBoardSize = () => {
      if (window.innerWidth < 768) {
        setBoardSize(240);
      } else if (window.innerWidth < 1024) {
        setBoardSize(280);
      } else {
        setBoardSize(320);
      }
    };

    updateBoardSize();
    window.addEventListener('resize', updateBoardSize);
    return () => window.removeEventListener('resize', updateBoardSize);
  }, []);

  // Listen for board theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      setBoardTheme(getCurrentBoardTheme());
    };

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          handleThemeChange();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);


  // Fetch available reports on mount
  useEffect(() => {
    const fetchReports = async () => {
      try {
        const response = await fetch('/api/user-reports/');
        const data = await response.json();
        if (data.reports && Array.isArray(data.reports)) {
          setAvailableReports(data.reports);
        }
      } catch (error) {
        console.error('Error fetching user reports:', error);
      }
    };

    fetchReports();
  }, []);

  // Fetch ELO range data when selection changes
  useEffect(() => {
    const fetchEloData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/static/data/top_100_opening_stats/${selectedEloRange}.json`);
        const data: EloRangeData = await response.json();
        setEloData(data);
      } catch (error) {
        console.error('Error fetching ELO data:', error);
        setEloData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchEloData();
  }, [selectedEloRange]);

  // Fetch and process user opening stats when a report is selected
  useEffect(() => {
    if (!selectedReportId) {
      setUserOpeningStats(new Map());
      return;
    }

    const fetchUserOpeningData = async () => {
      setLoadingUserData(true);
      try {
        const response = await fetch(`/api/report/${selectedReportId}/`);
        const data = await response.json();

        if (data.enriched_games && Array.isArray(data.enriched_games)) {
          // Process enriched games to extract opening stats
          const openingStatsMap = new Map<string, UserOpeningStats>();
          const username = data.report?.username || '';

          for (const game of data.enriched_games) {
            const opening = game.opening?.name;
            if (!opening) continue;

            // Determine if user won, lost, or drew
            const isWhite = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
            const isBlack = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();

            if (!isWhite && !isBlack) continue;

            const winner = game.winner;
            const userWon = (isWhite && winner === 'white') || (isBlack && winner === 'black');
            const userLost = (isWhite && winner === 'black') || (isBlack && winner === 'white');
            const draw = !winner;

            // Count user's mistakes from analysis data
            let inaccuracyCount = 0;
            let mistakeCount = 0;
            let blunderCount = 0;

            const userColor = isWhite ? 'white' : 'black';
            const analysis = game.analysis || [];
            const division = game.division;

            // Determine the end of opening phase
            const openingEndIndex = division?.middle !== undefined ? division.middle : analysis.length;

            if (Array.isArray(analysis)) {
              analysis.forEach((move: any, index: number) => {
                // Only count mistakes in the opening phase
                if (index >= openingEndIndex) return;

                // White moves are at even indices (0, 2, 4...), black moves at odd indices (1, 3, 5...)
                const isUserMove = (userColor === 'white' && index % 2 === 0) || (userColor === 'black' && index % 2 === 1);

                if (isUserMove && move.judgment) {
                  const judgmentName = move.judgment.name?.toLowerCase();
                  if (judgmentName === 'inaccuracy') {
                    inaccuracyCount++;
                  } else if (judgmentName === 'mistake') {
                    mistakeCount++;
                  } else if (judgmentName === 'blunder') {
                    blunderCount++;
                  }
                }
              });
            }

            // Extract base opening name (before colon)
            const baseName = opening.split(':')[0].trim();

            if (!openingStatsMap.has(baseName)) {
              openingStatsMap.set(baseName, {
                opening: baseName,
                total: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                win_rate: 0,
                success_rate: 0,
                avg_inaccuracies: 0,
                avg_mistakes: 0,
                avg_blunders: 0
              });
            }

            const stats = openingStatsMap.get(baseName)!;
            const oldCount = stats.total;
            stats.total += 1;
            if (userWon) stats.wins += 1;
            else if (draw) stats.draws += 1;
            else if (userLost) stats.losses += 1;

            // Update running averages for errors
            stats.avg_inaccuracies = ((stats.avg_inaccuracies * oldCount) + inaccuracyCount) / stats.total;
            stats.avg_mistakes = ((stats.avg_mistakes * oldCount) + mistakeCount) / stats.total;
            stats.avg_blunders = ((stats.avg_blunders * oldCount) + blunderCount) / stats.total;
          }

          // Calculate rates
          for (const stats of openingStatsMap.values()) {
            if (stats.total > 0) {
              stats.win_rate = (stats.wins / stats.total) * 100;
              stats.success_rate = ((stats.wins + stats.draws * 0.5) / stats.total) * 100;
            }
          }

          setUserOpeningStats(openingStatsMap);
        }
      } catch (error) {
        console.error('Error fetching user opening data:', error);
        setUserOpeningStats(new Map());
      } finally {
        setLoadingUserData(false);
      }
    };

    fetchUserOpeningData();
  }, [selectedReportId]);

  // Helper function to extract base name from opening name
  const getBaseName = (openingName: string): string => {
    // Split by colon to get the base name (before the colon)
    const parts = openingName.split(':');
    return parts[0].trim();
  };

  // Helper function to get color based on performance percentage
  const getPerformanceColor = (percentage: number): string => {
    if (percentage >= 70) {
      return '#4CAF50'; // Green for high performance
    } else if (percentage >= 40) {
      return '#FFA726'; // Yellow/orange for medium performance
    } else {
      return '#EF5350'; // Red for low performance
    }
  };

  // Process openings data
  const openingsData = useMemo(() => {
    if (!eloData || !eloData[selectedTimeControl]) {
      return [];
    }

    const openings: OpeningStatsData[] = [];
    const timeControlData = eloData[selectedTimeControl];

    // First, calculate total times played across all openings
    let totalTimesPlayed = 0;
    for (const stats of Object.values(timeControlData)) {
      totalTimesPlayed += stats.number_of_times_played;
    }

    // Then create the openings data with popularity percentage and error rate
    for (const [name, stats] of Object.entries(timeControlData)) {
      const popularity = totalTimesPlayed > 0
        ? (stats.number_of_times_played / totalTimesPlayed) * 100
        : 0;

      const avgInaccuracies = stats.opening_inaccuracies_per_game.mean;
      const avgMistakes = stats.opening_mistakes_per_game.mean;
      const avgBlunders = stats.opening_blunders_per_game.mean;
      const errorRate = 1 * avgInaccuracies + 2 * avgMistakes + 3 * avgBlunders;

      openings.push({
        name,
        eco: stats.eco,
        sampleSize: stats.sample_size,
        timesPlayed: stats.number_of_times_played,
        popularity,
        avgInaccuracies,
        avgMistakes,
        avgBlunders,
        errorRate,
        timeControl: selectedTimeControl,
        openingFen: stats.opening_fen,
        openingPgn: stats.opening_pgn,
        top_3_blunders: stats.top_3_blunders,
        top_3_mistakes: stats.top_3_mistakes,
        top_3_inaccuracies: stats.top_3_inaccuracies
      });
    }

    return openings;
  }, [eloData, selectedTimeControl]);

  // Group openings by base name
  const groupedOpenings = useMemo(() => {
    const groups = new Map<string, GroupedOpening>();

    for (const opening of openingsData) {
      const baseName = getBaseName(opening.name);

      if (!groups.has(baseName)) {
        // Create new group
        groups.set(baseName, {
          baseName,
          ecoPrefix: opening.eco.split(/[0-9]/)[0], // Get letter part of ECO code
          totalSampleSize: 0,
          totalTimesPlayed: 0,
          totalPopularity: 0,
          avgInaccuracies: 0,
          avgMistakes: 0,
          avgBlunders: 0,
          errorRate: 0,
          variations: []
        });
      }

      const group = groups.get(baseName)!;
      group.variations.push(opening);
      group.totalSampleSize += opening.sampleSize;
      group.totalTimesPlayed += opening.timesPlayed;
      group.totalPopularity += opening.popularity;
    }

    // Calculate weighted averages for each group
    for (const group of groups.values()) {
      let weightedInaccuracies = 0;
      let weightedMistakes = 0;
      let weightedBlunders = 0;

      for (const variation of group.variations) {
        const weight = variation.timesPlayed / group.totalTimesPlayed;
        weightedInaccuracies += variation.avgInaccuracies * weight;
        weightedMistakes += variation.avgMistakes * weight;
        weightedBlunders += variation.avgBlunders * weight;
      }

      group.avgInaccuracies = weightedInaccuracies;
      group.avgMistakes = weightedMistakes;
      group.avgBlunders = weightedBlunders;
      group.errorRate = 1 * weightedInaccuracies + 2 * weightedMistakes + 3 * weightedBlunders;

      // Sort variations by popularity within each group
      group.variations.sort((a, b) => b.popularity - a.popularity);
    }

    return Array.from(groups.values());
  }, [openingsData]);

  // Calculate min and max error rates for normalization
  const { minErrorRate, maxErrorRate } = useMemo(() => {
    if (groupedOpenings.length === 0) {
      return { minErrorRate: 0, maxErrorRate: 1 };
    }

    const errorRates = groupedOpenings.map(o => o.errorRate);
    return {
      minErrorRate: Math.min(...errorRates),
      maxErrorRate: Math.max(...errorRates)
    };
  }, [groupedOpenings]);

  // Calculate user performance compared to global average
  const getUserPerformance = (opening: GroupedOpening): { hasData: boolean, performanceDiff: number, userSuccessRate: number, globalSuccessRate: number } => {
    const userStats = userOpeningStats.get(opening.baseName);

    if (!userStats || userStats.total === 0) {
      return { hasData: false, performanceDiff: 0, userSuccessRate: 0, globalSuccessRate: 0 };
    }

    // Global success rate calculation (assuming 50% is par, adjust based on error rate)
    // Lower error rate = better performance, so invert the relationship
    const globalSuccessRate = 50; // Baseline assumption (draws count as 0.5)
    const userSuccessRate = userStats.success_rate;
    const performanceDiff = userSuccessRate - globalSuccessRate;

    return {
      hasData: true,
      performanceDiff,
      userSuccessRate,
      globalSuccessRate
    };
  };

  // Sort grouped openings based on selected sort method
  const sortedGroupedOpenings = useMemo(() => {
    const sorted = [...groupedOpenings];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => {
          const comparison = a.baseName.localeCompare(b.baseName);
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
      case 'sample':
        sorted.sort((a, b) => {
          const comparison = a.totalPopularity - b.totalPopularity;
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
      case 'performance':
        sorted.sort((a, b) => {
          const comparison = a.errorRate - b.errorRate;
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
      case 'user_performance':
        sorted.sort((a, b) => {
          const perfA = getUserPerformance(a);
          const perfB = getUserPerformance(b);

          // Put items without data at the end
          if (!perfA.hasData && !perfB.hasData) return 0;
          if (!perfA.hasData) return 1;
          if (!perfB.hasData) return -1;

          const comparison = perfA.performanceDiff - perfB.performanceDiff;
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
    }

    return sorted;
  }, [groupedOpenings, sortBy, sortOrder, userOpeningStats]);

  // Auto-select the first group and opening when data changes
  useEffect(() => {
    if (sortedGroupedOpenings.length > 0) {
      const firstGroup = sortedGroupedOpenings[0];
      setSelectedGroup(firstGroup);
      const firstOpening = firstGroup.variations[0];
      setSelectedOpening(firstOpening);

      // Parse PGN and set up moves
      if (firstOpening.openingPgn) {
        const pgnMoves = firstOpening.openingPgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
        setOpeningMoves(pgnMoves);
        setCurrentMoveIndex(pgnMoves.length);

        // Calculate FEN for the end position
        const chess = new Chess();
        for (let i = 0; i < pgnMoves.length; i++) {
          chess.move(pgnMoves[i]);
        }
        setSelectedOpeningFen(chess.fen());
      } else {
        setSelectedOpeningFen(firstOpening.openingFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        setOpeningMoves([]);
        setCurrentMoveIndex(0);
      }
    }
  }, [sortedGroupedOpenings]);

  const handleGroupClick = (group: GroupedOpening) => {
    setSelectedGroup(group);
    setSelectedError(null); // Clear any selected error

    // Auto-select the first variation in the group
    if (group.variations.length > 0) {
      const firstVariation = group.variations[0];
      setSelectedOpening(firstVariation);

      // Parse PGN and set up moves
      if (firstVariation.openingPgn) {
        const pgnMoves = firstVariation.openingPgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
        setOpeningMoves(pgnMoves);
        setCurrentMoveIndex(pgnMoves.length);

        // Calculate FEN for the end position
        const chess = new Chess();
        for (let i = 0; i < pgnMoves.length; i++) {
          chess.move(pgnMoves[i]);
        }
        setSelectedOpeningFen(chess.fen());
      } else {
        setSelectedOpeningFen(firstVariation.openingFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        setOpeningMoves([]);
        setCurrentMoveIndex(0);
      }
    }
  };

  const handleOpeningClick = (opening: OpeningStatsData) => {
    setSelectedOpening(opening);
    setSelectedError(null); // Clear selected error when changing opening

    // Parse PGN and set up moves
    if (opening.openingPgn) {
      const pgnMoves = opening.openingPgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
      setOpeningMoves(pgnMoves);
      setCurrentMoveIndex(pgnMoves.length);

      // Calculate FEN for the end position
      const chess = new Chess();
      for (let i = 0; i < pgnMoves.length; i++) {
        chess.move(pgnMoves[i]);
      }
      setSelectedOpeningFen(chess.fen());
    } else {
      setSelectedOpeningFen(opening.openingFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      setOpeningMoves([]);
      setCurrentMoveIndex(0);
    }
  };

  // Helper function to parse move and get from/to squares
  const getMoveSquares = (move: string, fen: string): { from: string, to: string } | null => {
    try {
      const chess = new Chess(fen);
      const moveResult = chess.move(move);
      if (moveResult) {
        return { from: moveResult.from, to: moveResult.to };
      }
    } catch (error) {
      console.error('Error parsing move:', error);
    }
    return null;
  };

  const handleErrorClick = (error: CommonMistake, type: ErrorType) => {
    setSelectedError({ error, type });
    setOpeningMoves([]);
    setCurrentMoveIndex(0);
    setPuzzleMode('viewing');
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintLevel(0);
    setArrows([]);

    // Show the position with the error move highlighted
    const chess = new Chess(error.fen);
    try {
      const move = chess.move(error.move);
      if (move) {
        setSelectedOpeningFen(chess.fen());
        const color = type === 'blunder' ? 'rgba(239, 83, 80, 0.4)' :
                     type === 'mistake' ? 'rgba(255, 112, 67, 0.4)' : 'rgba(255, 167, 38, 0.4)';
        setHighlightedSquares([
          { square: move.from, color: color },
          { square: move.to, color: color }
        ]);
      } else {
        setSelectedOpeningFen(error.fen);
        setHighlightedSquares([]);
      }
    } catch (err) {
      console.error('Error showing error move:', err);
      setSelectedOpeningFen(error.fen);
      setHighlightedSquares([]);
    }
  };

  const startPuzzleMode = () => {
    if (!selectedError) return;

    // Load position before the error
    setSelectedOpeningFen(selectedError.error.fen);
    setHighlightedSquares([]);
    setArrows([]);
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintLevel(0);
    setPuzzleMode('solving');
  };

  const handleSquareClick = (square: string) => {
    if (puzzleMode !== 'solving' || !selectedError) return;

    const chess = new Chess(selectedError.error.fen);
    const piece = chess.get(square);
    const playerColor = chess.turn();

    if (selectedSquare) {
      if (selectedSquare === square) {
        // Deselect
        setSelectedSquare(null);
        setLegalMoves([]);
      } else {
        // Try to make a move
        try {
          const movingPiece = chess.get(selectedSquare);
          if (!movingPiece) return;

          // Try the move
          const testMove = chess.move({ from: selectedSquare, to: square });
          if (testMove) {
            // Check if this is the best move
            // The best_move might be in UCI notation (e.g., "e2e4") or SAN notation (e.g., "e4")
            // We need to convert UCI to SAN for comparison
            let isCorrect = false;
            const bestMove = selectedError.error.best_move;

            // First try direct SAN comparison
            if (testMove.san === bestMove) {
              isCorrect = true;
            } else {
              // Try UCI comparison (from+to squares)
              const uciMove = testMove.from + testMove.to;
              if (uciMove === bestMove || uciMove === bestMove.substring(0, 4)) {
                isCorrect = true;
              }
            }

            if (isCorrect) {
              // Correct move - animate it
              setAnimationData({
                piece: movingPiece,
                from: selectedSquare,
                to: square
              });

              setPendingPositionUpdate(chess.fen());
              setPuzzleMode('solved');

              // Mark this error as solved
              const errorKey = `${selectedError.error.fen}-${selectedError.error.move}`;
              setSolvedErrors(prev => new Set(prev).add(errorKey));
            } else {
              // Incorrect move - undo and show feedback
              chess.undo();
              setPuzzleMode('failed');

              // Reset after a delay
              setTimeout(() => {
                setSelectedOpeningFen(selectedError.error.fen);
                setPuzzleMode('solving');
                setHighlightedSquares([]);
              }, 1500);
            }

            setSelectedSquare(null);
            setLegalMoves([]);
          } else {
            // Invalid move, try to select new piece
            if (piece && piece.color === playerColor) {
              setSelectedSquare(square);
              const moves = chess.moves({ square, verbose: true });
              setLegalMoves(moves.map(move => move.to));
            } else {
              setSelectedSquare(null);
              setLegalMoves([]);
            }
          }
        } catch (error) {
          // Move failed, try to select new piece
          if (piece && piece.color === playerColor) {
            setSelectedSquare(square);
            const moves = chess.moves({ square, verbose: true });
            setLegalMoves(moves.map(move => move.to));
          } else {
            setSelectedSquare(null);
            setLegalMoves([]);
          }
        }
      }
    } else {
      // Select piece if valid
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square, verbose: true });
        setLegalMoves(moves.map(move => move.to));
      }
    }
  };

  const handleAnimationComplete = () => {
    setAnimationData(null);

    if (pendingPositionUpdate) {
      setSelectedOpeningFen(pendingPositionUpdate);
      setPendingPositionUpdate(null);

      // Show the correct move with green highlights
      if (puzzleMode === 'solved' && selectedError) {
        const chess = new Chess(selectedError.error.fen);
        const bestMove = selectedError.error.best_move;

        let move = null;
        try {
          // First try as SAN
          move = chess.move(bestMove);
        } catch (e) {
          // If that fails, try as UCI (from+to)
          if (bestMove && bestMove.length >= 4) {
            const from = bestMove.substring(0, 2);
            const to = bestMove.substring(2, 4);
            try {
              move = chess.move({ from, to });
            } catch (err) {
              console.error('Could not parse best move:', bestMove);
            }
          }
        }

        if (move) {
          setHighlightedSquares([
            { square: move.from, color: 'rgba(0, 255, 0, 0.4)' },
            { square: move.to, color: 'rgba(0, 255, 0, 0.4)' }
          ]);
        }
      }
    }
  };

  const resetToViewingMode = () => {
    if (!selectedError) return;

    setPuzzleMode('viewing');
    setSelectedOpeningFen(selectedError.error.fen);
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintLevel(0);
    setArrows([]);

    // Show the error move highlighted
    const chess = new Chess(selectedError.error.fen);
    try {
      const move = chess.move(selectedError.error.move);
      if (move) {
        const color = selectedError.type === 'blunder' ? 'rgba(239, 83, 80, 0.4)' :
                     selectedError.type === 'mistake' ? 'rgba(255, 112, 67, 0.4)' : 'rgba(255, 167, 38, 0.4)';
        setHighlightedSquares([
          { square: move.from, color: color },
          { square: move.to, color: color }
        ]);
      }
    } catch (error) {
      console.error('Error showing error move:', error);
    }
  };

  const showHint = () => {
    if (!selectedError || puzzleMode !== 'solving') return;

    const chess = new Chess(selectedError.error.fen);
    const bestMove = selectedError.error.best_move;

    // Try to parse the best move - it might be in UCI format (e.g., "e2e4")
    let move = null;
    try {
      // First try as SAN
      move = chess.move(bestMove);
    } catch (e) {
      // If that fails, try as UCI (from+to)
      if (bestMove && bestMove.length >= 4) {
        const from = bestMove.substring(0, 2);
        const to = bestMove.substring(2, 4);
        try {
          move = chess.move({ from, to });
        } catch (err) {
          console.error('Could not parse best move:', bestMove);
        }
      }
    }

    if (!move) return;

    if (hintLevel === 0) {
      // First hint: highlight the piece to move
      setHighlightedSquares([
        { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
      ]);
      setHintLevel(1);
    } else if (hintLevel === 1) {
      // Second hint: show arrow to destination
      setHighlightedSquares([
        { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
      ]);
      setArrows([
        { from: move.from, to: move.to, color: '#ffff00' }
      ]);
      setHintLevel(2);
    }
  };

  const getStatusMessage = () => {
    switch (puzzleMode) {
      case 'viewing':
        return `Viewing ${selectedError?.type || 'error'} move`;
      case 'solving':
        return 'Find the best move!';
      case 'solved':
        return '✓ Correct! That was the best move!';
      case 'failed':
        return '✗ Not quite. Try again!';
      default:
        return '';
    }
  };

  const isErrorSolved = (error: CommonMistake): boolean => {
    const errorKey = `${error.fen}-${error.move}`;
    return solvedErrors.has(errorKey);
  };

  // Get color for performance bar
  const getPerformanceBarColor = (performanceDiff: number): string => {
    if (performanceDiff > 10) return '#4CAF50'; // Green - significantly better
    if (performanceDiff > 0) return '#8BC34A'; // Light green - better
    if (performanceDiff > -10) return '#FFA726'; // Orange - slightly worse
    return '#EF5350'; // Red - significantly worse
  };

  return (
    <div className="opening-stats-by-elo" style={{
      padding: '12px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '6px',
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 4px var(--shadow-light)'
    }}>
      {/* Header Row with Dropdowns */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        padding: '10px',
        backgroundColor: 'var(--background-primary)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        {/* Left: Dropdowns */}
        <div style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '3px',
              textTransform: 'uppercase'
            }}>
              ELO Range
            </label>
            <select
              value={selectedEloRange}
              onChange={(e) => setSelectedEloRange(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '2px solid var(--border-color)',
                borderRadius: '4px',
                backgroundColor: 'var(--background-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                minWidth: '120px'
              }}
            >
              {ELO_RANGES.map(range => (
                <option key={range} value={range}>{range}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '3px',
              textTransform: 'uppercase'
            }}>
              Time Control
            </label>
            <select
              value={selectedTimeControl}
              onChange={(e) => setSelectedTimeControl(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '2px solid var(--border-color)',
                borderRadius: '4px',
                backgroundColor: 'var(--background-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                minWidth: '100px'
              }}
            >
              {TIME_CONTROLS.map(tc => (
                <option key={tc} value={tc}>{tc.charAt(0).toUpperCase() + tc.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: Selected Opening Name */}
        <div style={{
          flex: '1',
          textAlign: 'center',
          minWidth: '150px'
        }}>
          <h2 style={{
            margin: '0',
            fontSize: '1.1rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            lineHeight: '1.2'
          }}>
            {selectedOpening ? selectedOpening.name : 'Select an Opening'}
          </h2>
          {selectedOpening && (
            <div style={{
              marginTop: '2px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              fontStyle: 'italic'
            }}>
              Based on {selectedOpening.sampleSize.toLocaleString()} games
            </div>
          )}
        </div>

        {/* Right: Report Selector */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '10px',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            marginBottom: '3px',
            textTransform: 'uppercase'
          }}>
            Compare to Report
          </label>
          <select
            value={selectedReportId || ''}
            onChange={(e) => setSelectedReportId(e.target.value ? parseInt(e.target.value) : null)}
            style={{
              padding: '6px 10px',
              fontSize: '13px',
              border: '2px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--background-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              minWidth: '150px'
            }}
          >
            <option value="">None</option>
            {availableReports.map(report => (
              <option key={report.id} value={report.id}>{report.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Opening Board and Stats */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: '12px'
      }}>
        {/* Left Column: Mistake Chart and Variations List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minWidth: '250px',
          maxWidth: '320px',
          flex: '1'
        }}>
          {/* Mistake Bar Chart */}
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '12px'
          }}>
            <h4 style={{
              margin: '0 0 10px 0',
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              Average Opening Mistakes
            </h4>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {selectedOpening ? (() => {
                // Get user stats for the selected opening if available
                const userStats = selectedGroup ? userOpeningStats.get(selectedGroup.baseName) : null;

                return (
                  <>
                    {/* Inaccuracies */}
                    <div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '3px',
                        fontSize: '11px'
                      }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Inaccuracies</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* Population average bar */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                            Avg: {selectedOpening.avgInaccuracies.toFixed(1)}
                          </div>
                          <div style={{
                            height: '14px',
                            backgroundColor: 'var(--background-secondary)',
                            borderRadius: '3px',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              height: '100%',
                              backgroundColor: '#FFA726',
                              opacity: 0.5,
                              width: `${Math.min((selectedOpening.avgInaccuracies / 10) * 100, 100)}%`,
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                        </div>
                        {/* User's bar */}
                        {userStats && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {userStats.avg_inaccuracies.toFixed(1)}
                            </div>
                            <div style={{
                              height: '14px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#FFA726',
                                width: `${Math.min((userStats.avg_inaccuracies / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Mistakes */}
                    <div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '3px',
                        fontSize: '11px'
                      }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Mistakes</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* Population average bar */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                            Avg: {selectedOpening.avgMistakes.toFixed(1)}
                          </div>
                          <div style={{
                            height: '14px',
                            backgroundColor: 'var(--background-secondary)',
                            borderRadius: '3px',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              height: '100%',
                              backgroundColor: '#FF7043',
                              opacity: 0.5,
                              width: `${Math.min((selectedOpening.avgMistakes / 10) * 100, 100)}%`,
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                        </div>
                        {/* User's bar */}
                        {userStats && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {userStats.avg_mistakes.toFixed(1)}
                            </div>
                            <div style={{
                              height: '14px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#FF7043',
                                width: `${Math.min((userStats.avg_mistakes / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Blunders */}
                    <div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '3px',
                        fontSize: '11px'
                      }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Blunders</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* Population average bar */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                            Avg: {selectedOpening.avgBlunders.toFixed(1)}
                          </div>
                          <div style={{
                            height: '14px',
                            backgroundColor: 'var(--background-secondary)',
                            borderRadius: '3px',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              height: '100%',
                              backgroundColor: '#EF5350',
                              opacity: 0.5,
                              width: `${Math.min((selectedOpening.avgBlunders / 10) * 100, 100)}%`,
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                        </div>
                        {/* User's bar */}
                        {userStats && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {userStats.avg_blunders.toFixed(1)}
                            </div>
                            <div style={{
                              height: '14px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#EF5350',
                                width: `${Math.min((userStats.avg_blunders / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })() : (
                <div style={{
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontStyle: 'italic',
                  padding: '12px'
                }}>
                  {loading ? 'Loading...' : 'No opening selected'}
                </div>
              )}
            </div>
          </div>

          {/* Variations List */}
          {selectedGroup && (
            <div style={{
              backgroundColor: 'var(--background-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '10px'
            }}>
              <h4 style={{
                margin: '0 0 8px 0',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                textAlign: 'center'
              }}>
                Variations ({selectedGroup.variations.length})
              </h4>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                height: '165px',
                overflowY: 'auto',
                paddingRight: '4px'
              }}>
                {selectedGroup.variations.map((opening, index) => (
                  <div
                    key={`${opening.eco}-${opening.name}-${index}`}
                    onClick={() => handleOpeningClick(opening)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      gap: '8px',
                      backgroundColor: selectedOpening?.name === opening.name ? 'var(--primary-color)' : 'var(--background-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedOpening?.name !== opening.name) {
                        e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                      }
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={(e) => {
                      const isSelected = selectedOpening?.name === opening.name;
                      e.currentTarget.style.backgroundColor = isSelected ? 'var(--primary-color)' : 'var(--background-secondary)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: '600',
                        color: selectedOpening?.name === opening.name ? 'var(--text-on-primary)' : 'var(--text-primary)',
                        fontSize: '10px'
                      }}>
                        <span style={{
                          backgroundColor: selectedOpening?.name === opening.name ? 'var(--background-primary)' : 'var(--primary-color)',
                          color: selectedOpening?.name === opening.name ? 'var(--primary-color)' : 'var(--text-on-primary)',
                          padding: '1px 4px',
                          borderRadius: '2px',
                          fontSize: '8px',
                          fontWeight: 'bold',
                          marginRight: '4px'
                        }}>
                          {opening.eco}
                        </span>
                        {opening.name.includes(':') ? opening.name.split(':')[1].trim() : opening.name}
                      </div>
                    </div>
                    {/* Performance Bar */}
                    <div style={{
                      width: '40px',
                      height: '6px',
                      backgroundColor: selectedOpening?.name === opening.name ? 'var(--background-primary)' : 'var(--background-primary)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                      flexShrink: 0
                    }}>
                      {(() => {
                        const range = maxErrorRate - minErrorRate;
                        const normalizedPerformance = range > 0
                          ? ((maxErrorRate - opening.errorRate) / range) * 100
                          : 50;

                        return (
                          <div style={{
                            height: '100%',
                            width: `${normalizedPerformance}%`,
                            backgroundColor: getPerformanceColor(normalizedPerformance),
                            transition: 'width 0.3s ease'
                          }} />
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Opening Board with Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '20px',
            backgroundColor: 'var(--background-primary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            marginBottom: '1px'
          }}>
            {selectedError ? (
              // Show interactive board for error puzzles
              <div style={{
                width: `${boardSize}px`,
                height: `${boardSize}px`,
                flexShrink: 0
              }}>
                <BaseChessBoard
                  size={boardSize}
                  position={selectedOpeningFen}
                  orientation="white"
                  coordinates={true}
                  showGameEndSymbols={false}
                  showCheckHighlight={true}
                  interactive={true}
                  allowPieceDragging={puzzleMode === 'solving'}
                  highlightedSquares={highlightedSquares}
                  arrows={arrows}
                  selectedSquare={selectedSquare || undefined}
                  legalMoves={legalMoves}
                  animationData={animationData}
                  onSquareClick={handleSquareClick}
                  onAnimationComplete={handleAnimationComplete}
                  boardTheme={boardTheme}
                />
              </div>
            ) : (
              // Show regular opening board
              <BaseChessBoard
                size={boardSize}
                position={selectedOpeningFen}
                orientation="white"
                coordinates={true}
                interactive={false}
                allowPieceDragging={false}
                showGameEndSymbols={false}
                showCheckHighlight={true}
                boardTheme={boardTheme}
                highlightedSquares={[]}
              />
            )}
          </div>

          {/* Status Message and Puzzle Controls for Error Puzzles - Combined to match navigation height */}
          {selectedError && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              {/* Status Message */}
              <div style={{
                padding: '4px 8px',
                backgroundColor: puzzleMode === 'solved' ? 'rgba(0, 255, 0, 0.1)' : puzzleMode === 'failed' ? 'rgba(255, 0, 0, 0.1)' : 'var(--background-primary)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                textAlign: 'center',
                fontSize: '12px',
                fontWeight: '600',
                color: puzzleMode === 'solved' ? '#00aa00' : puzzleMode === 'failed' ? '#cc0000' : 'var(--text-primary)',
                minWidth: `${boardSize}px`,
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {getStatusMessage()}
              </div>

              {/* Puzzle Controls */}
              <div style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'center',
                flexWrap: 'wrap'
              }}>
              {puzzleMode === 'viewing' && (
                <button
                  onClick={startPuzzleMode}
                  style={{
                    padding: '6px 10px',
                    fontSize: '13px',
                    border: '2px solid var(--border-color)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--primary-color)',
                    color: 'var(--text-on-primary)',
                    cursor: 'pointer',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 4px var(--shadow-light)',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color-dark, var(--primary-color))';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                  }}
                >
                  Find Best Move
                </button>
              )}
              {puzzleMode === 'solving' && (
                <>
                  <button
                    onClick={showHint}
                    disabled={hintLevel >= 2}
                    style={{
                      padding: '6px 10px',
                      fontSize: '13px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: hintLevel >= 2 ? 'var(--background-tertiary)' : 'var(--background-primary)',
                      color: hintLevel >= 2 ? 'var(--text-muted)' : 'var(--primary-color)',
                      cursor: hintLevel >= 2 ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      transition: 'all 0.2s ease',
                      boxShadow: hintLevel >= 2 ? 'none' : '0 2px 4px var(--shadow-light)',
                      opacity: hintLevel >= 2 ? 0.6 : 1,
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => {
                      if (hintLevel < 2) {
                        e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                        e.currentTarget.style.color = 'var(--text-on-primary)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (hintLevel < 2) {
                        e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                        e.currentTarget.style.color = 'var(--primary-color)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                      }
                    }}
                  >
                    Hint {hintLevel > 0 ? `(${hintLevel}/2)` : ''}
                  </button>
                  <button
                    onClick={resetToViewingMode}
                    style={{
                      padding: '6px 10px',
                      fontSize: '13px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-primary)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      fontWeight: '600',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px var(--shadow-light)',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                      e.currentTarget.style.color = 'var(--text-on-primary)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                      e.currentTarget.style.color = 'var(--primary-color)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                    }}
                  >
                    Back to Error
                  </button>
                </>
              )}
              {(puzzleMode === 'solved' || puzzleMode === 'failed') && (
                <button
                  onClick={resetToViewingMode}
                  style={{
                    padding: '6px 10px',
                    fontSize: '13px',
                    border: '2px solid var(--border-color)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--background-primary)',
                    color: 'var(--primary-color)',
                    cursor: 'pointer',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 4px var(--shadow-light)',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                    e.currentTarget.style.color = 'var(--text-on-primary)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                    e.currentTarget.style.color = 'var(--primary-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                  }}
                >
                  Back to Error
                </button>
              )}
              </div>
            </div>
          )}

          {/* Navigation Controls */}
          {openingMoves.length > 0 && !selectedError && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '8px',
            }}>
              <button
                onClick={() => {
                  setCurrentMoveIndex(0);
                  setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                }}
                style={{
                  padding: '6px 10px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                }}
                aria-label="Go to start"
              >
                <StartIcon disabled={false} size={18} />
              </button>
              <button
                onClick={() => {
                  if (currentMoveIndex > 0) {
                    const newIndex = currentMoveIndex - 1;
                    setCurrentMoveIndex(newIndex);

                    const chess = new Chess();
                    for (let i = 0; i < newIndex; i++) {
                      chess.move(openingMoves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  }
                }}
                style={{
                  padding: '6px 10px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                }}
                aria-label="Previous move"
              >
                <PrevIcon disabled={false} size={18} />
              </button>
              <button
                onClick={() => {
                  if (currentMoveIndex < openingMoves.length) {
                    const newIndex = currentMoveIndex + 1;
                    setCurrentMoveIndex(newIndex);

                    const chess = new Chess();
                    for (let i = 0; i < newIndex; i++) {
                      chess.move(openingMoves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  }
                }}
                style={{
                  padding: '6px 10px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                }}
                aria-label="Next move"
              >
                <NextIcon disabled={false} size={18} />
              </button>
              <button
                onClick={() => {
                  setCurrentMoveIndex(openingMoves.length);

                  const chess = new Chess();
                  for (let i = 0; i < openingMoves.length; i++) {
                    chess.move(openingMoves[i]);
                  }
                  setSelectedOpeningFen(chess.fen());
                }}
                style={{
                  padding: '6px 10px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
                }}
                aria-label="Go to end"
              >
                <EndIcon disabled={false} size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Common Errors */}
        {selectedOpening && (selectedOpening.top_3_blunders || selectedOpening.top_3_mistakes || selectedOpening.top_3_inaccuracies) && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minWidth: '280px',
            maxWidth: '320px',
            flex: '1'
          }}>
            {/* Blunders */}
            {selectedOpening.top_3_blunders && selectedOpening.top_3_blunders.length > 0 && (
              <div style={{
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '10px'
              }}>
                <h4 style={{
                  margin: '0 0 8px 0',
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#EF5350',
                  textAlign: 'center'
                }}>
                  Common Blunders
                </h4>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  {selectedOpening.top_3_blunders.map((error, index) => (
                    <div
                      key={index}
                      onClick={() => handleErrorClick(error, 'blunder')}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: selectedError?.error === error ? 'var(--primary-color)' : 'var(--background-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                        }
                        e.currentTarget.style.transform = 'translateX(2px)';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                        }
                        e.currentTarget.style.transform = 'translateX(0)';
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: selectedError?.error === error ? 'var(--text-on-primary)' : 'var(--text-primary)'
                        }}>
                          {error.move}
                        </div>
                      </div>
                      {isErrorSolved(error) && (
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: '#00aa00',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <span style={{
                            color: 'white',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            lineHeight: '1'
                          }}>✓</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mistakes */}
            {selectedOpening.top_3_mistakes && selectedOpening.top_3_mistakes.length > 0 && (
              <div style={{
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '10px'
              }}>
                <h4 style={{
                  margin: '0 0 8px 0',
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#FF7043',
                  textAlign: 'center'
                }}>
                  Common Mistakes
                </h4>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  {selectedOpening.top_3_mistakes.map((error, index) => (
                    <div
                      key={index}
                      onClick={() => handleErrorClick(error, 'mistake')}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: selectedError?.error === error ? 'var(--primary-color)' : 'var(--background-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                        }
                        e.currentTarget.style.transform = 'translateX(2px)';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                        }
                        e.currentTarget.style.transform = 'translateX(0)';
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: selectedError?.error === error ? 'var(--text-on-primary)' : 'var(--text-primary)'
                        }}>
                          {error.move}
                        </div>
                      </div>
                      {isErrorSolved(error) && (
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: '#00aa00',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <span style={{
                            color: 'white',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            lineHeight: '1'
                          }}>✓</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inaccuracies */}
            {selectedOpening.top_3_inaccuracies && selectedOpening.top_3_inaccuracies.length > 0 && (
              <div style={{
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '10px'
              }}>
                <h4 style={{
                  margin: '0 0 8px 0',
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#FFA726',
                  textAlign: 'center'
                }}>
                  Common Inaccuracies
                </h4>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  {selectedOpening.top_3_inaccuracies.map((error, index) => (
                    <div
                      key={index}
                      onClick={() => handleErrorClick(error, 'inaccuracy')}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: selectedError?.error === error ? 'var(--primary-color)' : 'var(--background-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                        }
                        e.currentTarget.style.transform = 'translateX(2px)';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedError?.error !== error) {
                          e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                        }
                        e.currentTarget.style.transform = 'translateX(0)';
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: selectedError?.error === error ? 'var(--text-on-primary)' : 'var(--text-primary)'
                        }}>
                          {error.move}
                        </div>
                      </div>
                      {isErrorSolved(error) && (
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: '#00aa00',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <span style={{
                            color: 'white',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            lineHeight: '1'
                          }}>✓</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Openings List */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '10px',
        marginTop: '12px'
      }}>
        <h4 style={{
          margin: '0 0 10px 0',
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          textAlign: 'center'
        }}>
          All Openings ({groupedOpenings.length} groups, {openingsData.length} variations)
        </h4>

        {loading ? (
          <div style={{
            minHeight: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <p style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              margin: 0,
              fontStyle: 'italic',
              fontSize: '12px'
            }}>
              Loading...
            </p>
          </div>
        ) : groupedOpenings.length === 0 ? (
          <div style={{
            minHeight: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <p style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              margin: 0,
              fontStyle: 'italic',
              fontSize: '12px'
            }}>
              No opening data found for this ELO range and time control
            </p>
          </div>
        ) : (
          <>
            {/* Column Headers */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 10px',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '6px'
            }}>
              <div
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('name')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'name' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Opening Name {sortBy === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              {selectedReportId && (
                <div
                  style={{
                    minWidth: '100px',
                    textAlign: 'center',
                    marginRight: '10px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => handleSortClick('user_performance')}
                >
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '700',
                    color: sortBy === 'user_performance' ? 'var(--primary-color)' : 'var(--text-secondary)',
                    textTransform: 'uppercase'
                  }}>
                    User Performance {sortBy === 'user_performance' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </span>
                </div>
              )}
              <div
                style={{
                  minWidth: '120px',
                  textAlign: 'center',
                  marginRight: '10px',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('performance')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'performance' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Performance {sortBy === 'performance' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              <div
                style={{
                  minWidth: '80px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('sample')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'sample' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Popularity {sortBy === 'sample' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              minHeight: '200px',
              maxHeight: '320px',
              overflowY: 'auto',
              paddingRight: '6px'
            }}>
              {sortedGroupedOpenings.map((group, groupIndex) => (
                <div
                  key={`${group.baseName}-${groupIndex}`}
                  onClick={() => handleGroupClick(group)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    backgroundColor: selectedGroup?.baseName === group.baseName ? 'var(--primary-color)' : 'var(--background-secondary)',
                    border: selectedGroup?.baseName === group.baseName ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                    borderRadius: '4px',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedGroup?.baseName !== group.baseName) {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                    }
                    e.currentTarget.style.transform = 'translateX(3px)';
                  }}
                  onMouseLeave={(e) => {
                    const isSelected = selectedGroup?.baseName === group.baseName;
                    e.currentTarget.style.backgroundColor = isSelected ? 'var(--primary-color)' : 'var(--background-secondary)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontWeight: '700',
                      color: selectedGroup?.baseName === group.baseName ? 'var(--text-on-primary)' : 'var(--text-primary)',
                      fontSize: '12px',
                      marginBottom: '3px'
                    }}>
                      <span style={{
                        backgroundColor: selectedGroup?.baseName === group.baseName ? 'var(--background-primary)' : 'var(--primary-color)',
                        color: selectedGroup?.baseName === group.baseName ? 'var(--primary-color)' : 'var(--text-on-primary)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        marginRight: '6px'
                      }}>
                        {group.ecoPrefix}
                      </span>
                      {group.baseName}
                      <span style={{
                        fontSize: '10px',
                        color: selectedGroup?.baseName === group.baseName ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                        marginLeft: '6px',
                        fontWeight: '400'
                      }}>
                        ({group.variations.length} var{group.variations.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                  </div>

                  {/* User Performance Column */}
                  {selectedReportId && (() => {
                    const perf = getUserPerformance(group);
                    return (
                      <div style={{
                        minWidth: '100px',
                        marginRight: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {perf.hasData ? (
                          <div style={{
                            width: '100%',
                            height: '10px',
                            backgroundColor: 'var(--background-primary)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            border: '1px solid var(--border-color)'
                          }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(Math.max((perf.performanceDiff + 50) / 100 * 100, 0), 100)}%`,
                              backgroundColor: getPerformanceBarColor(perf.performanceDiff),
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                        ) : (
                          <span style={{
                            fontSize: '9px',
                            color: selectedGroup?.baseName === group.baseName ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                            fontStyle: 'italic'
                          }}>
                            No data
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Performance Bar */}
                  <div style={{
                    minWidth: '120px',
                    marginRight: '10px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '100%',
                      height: '10px',
                      backgroundColor: 'var(--background-primary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)'
                    }}>
                      {(() => {
                        const range = maxErrorRate - minErrorRate;
                        const normalizedPerformance = range > 0
                          ? ((maxErrorRate - group.errorRate) / range) * 100
                          : 50;

                        return (
                          <div style={{
                            height: '100%',
                            width: `${normalizedPerformance}%`,
                            backgroundColor: getPerformanceColor(normalizedPerformance),
                            transition: 'width 0.3s ease'
                          }} />
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '80px'
                  }}>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: 'bold',
                      color: selectedGroup?.baseName === group.baseName ? 'var(--text-on-primary)' : 'var(--primary-color)'
                    }}>
                      {group.totalPopularity.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OpeningStatsByElo;
