import React, { useMemo, useEffect, useState } from 'react';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';
import OpeningBoard from './opening-board';
import { Chess } from 'chess.js';
import { StartIcon, PrevIcon, NextIcon, EndIcon } from './navigation-icons';
import { SendToBuddyBoardIcon } from './send-to-buddy-board-icon';

// Helper function to determine ELO bracket
const getEloBracket = (rating: number): string => {
  if (rating < 600) return 'below-600';
  if (rating < 700) return '600-700';
  if (rating < 800) return '700-800';
  if (rating < 900) return '800-900';
  if (rating < 1000) return '900-1000';
  if (rating < 1100) return '1000-1100';
  if (rating < 1200) return '1100-1200';
  if (rating < 1300) return '1200-1300';
  if (rating < 1400) return '1300-1400';
  if (rating < 1500) return '1400-1500';
  if (rating < 1600) return '1500-1600';
  if (rating < 1700) return '1600-1700';
  if (rating < 1800) return '1700-1800';
  if (rating < 1900) return '1800-1900';
  if (rating < 2000) return '1900-2000';
  if (rating < 2100) return '2000-2100';
  if (rating < 2200) return '2100-2200';
  if (rating < 2300) return '2200-2300';
  if (rating < 2400) return '2300-2400';
  return '2400+';
};

// Helper function to calculate z-score and convert to percentile
const calculatePercentile = (
  userErrorScore: number,
  popMeanErrorScore: number,
  popStdErrorScore: number,
  sampleSize: number
): number | null => {
  if (popStdErrorScore === 0 || sampleSize === 0) return null;

  // Adjust standard deviation for sample size (standard error of the mean)
  const standardError = popStdErrorScore / Math.sqrt(sampleSize);

  // Calculate z-score
  const zScore = (userErrorScore - popMeanErrorScore) / standardError;

  // Convert z-score to percentile using approximation (cumulative distribution function)
  // Note: Lower error score is better, so we invert the percentile
  const percentile = 100 * (1 - normalCDF(zScore));

  return Math.max(0, Math.min(100, percentile));
};

// Approximation of the cumulative distribution function for standard normal distribution
const normalCDF = (z: number): number => {
  // Using the error function approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
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

interface GameOpening {
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
  opening?: {
    eco: string;
    name: string;
    ply: number;
    fen?: string;
    moves?: string;
  };
  raw_json?: any;
  game?: any;
  winner?: string | null;
  analysis?: any[];
  division?: {
    middle?: number;
  };
  speed?: string;
}

interface EloAveragesData {
  bullet?: {
    [key: string]: {
      mean: number;
      std: number;
      skew: number;
    };
  };
  blitz?: {
    [key: string]: {
      mean: number;
      std: number;
      skew: number;
    };
  };
  rapid?: {
    [key: string]: {
      mean: number;
      std: number;
      skew: number;
    };
  };
}

interface CommonError {
  fen: string;
  move: string;
  count: number;
  best_move?: string;
  variation?: string;
  evaluation?: number;
  mate?: number;
}

interface OpeningStatsData {
  [timeControl: string]: {
    [openingName: string]: {
      eco: string;
      sample_size: number;
      number_of_times_played: number;
      top_3_blunders?: CommonError[];
      top_3_mistakes?: CommonError[];
      top_3_inaccuracies?: CommonError[];
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
  _enriched?: boolean;
  _enrichment_timestamp?: string;
}

interface OpeningAnalysisProps {
  enrichedGames: GameOpening[];
  username: string;
  eloAveragesData?: EloAveragesData | null;
  openingStatsData?: OpeningStatsData | null;
}

interface OpeningVariation {
  fullName: string;
  count: number;
  fen?: string;
  moves?: string;
  avgInaccuracies: number;
  avgMistakes: number;
  avgBlunders: number;
  wins: number;
  draws: number;
  losses: number;
}

interface OpeningData {
  eco: string;
  baseName: string;
  fullName: string;
  count: number;
  averagePly: number;
  fen?: string;
  moves?: string;
  avgInaccuracies: number;
  avgMistakes: number;
  avgBlunders: number;
  wins: number;
  draws: number;
  losses: number;
  variations: OpeningVariation[];
  percentile?: number | null;
}

export const OpeningAnalysis: React.FC<OpeningAnalysisProps> = ({
  enrichedGames = [],
  username,
  eloAveragesData = null,
  openingStatsData = null
}) => {
  const [filteredGames, setFilteredGames] = useState<GameOpening[]>([]);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [selectedOpeningFen, setSelectedOpeningFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [selectedOpening, setSelectedOpening] = useState<OpeningData | null>(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(0);
  const [openingMoves, setOpeningMoves] = useState<string[]>([]);
  const [baseOpeningData, setBaseOpeningData] = useState<{ name: string, pgn: string, fen: string } | null>(null);
  const [canonicalOpenings, setCanonicalOpenings] = useState<Map<string, { name: string, pgn: string, fen: string }>>(new Map());
  const [selectedVariationName, setSelectedVariationName] = useState<string | null>(null);
  const [boardSize, setBoardSize] = useState<number>(400);
  const [sortBy, setSortBy] = useState<'percentile' | 'name' | 'games'>('percentile');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Responsive board size based on window width
  useEffect(() => {
    const updateBoardSize = () => {
      if (window.innerWidth < 768) {
        setBoardSize(280);
      } else if (window.innerWidth < 1024) {
        setBoardSize(350);
      } else {
        setBoardSize(400);
      }
    };

    updateBoardSize();
    window.addEventListener('resize', updateBoardSize);
    return () => window.removeEventListener('resize', updateBoardSize);
  }, []);

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

  // Fetch canonical openings file once on mount
  useEffect(() => {
    const fetchCanonicalOpenings = async () => {
      try {
        const response = await fetch('/static/data/openings/lichess_openings_canonical.tsv');
        const text = await response.text();
        const lines = text.split('\n');

        const openingsMap = new Map<string, { name: string, pgn: string, fen: string }>();

        // Skip header line and parse all openings
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split('\t');
          if (parts.length >= 5) {
            const [eco, name, pgn, uci, epd] = parts;
            // Key by name only for matching
            openingsMap.set(name, { name, pgn, fen: epd });
          }
        }

        setCanonicalOpenings(openingsMap);
      } catch (error) {
        console.error('Error fetching canonical openings:', error);
      }
    };

    fetchCanonicalOpenings();
  }, []);

  // Find base opening when selected opening changes
  useEffect(() => {
    if (selectedOpening && canonicalOpenings.size > 0) {
      // Match by base name only
      const baseOpening = canonicalOpenings.get(selectedOpening.baseName);
      setBaseOpeningData(baseOpening || null);
    } else {
      setBaseOpeningData(null);
    }
  }, [selectedOpening, canonicalOpenings]);

  const { openingsData, totalGames } = useMemo(() => {
    if (!filteredGames.length) {
      return {
        openingsData: [],
        totalGames: 0
      };
    }

    // Track openings frequency
    const openingsMap = new Map<string, OpeningData>();
    let validGameCount = 0;

    // Process each game to extract opening data
    filteredGames.forEach(game => {
      // Handle different data structures
      let isUserInGame = false;
      let gameOpening = null;

      // Try to extract player info and opening from different possible structures
      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        // Lichess format
        const isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;
        gameOpening = game.opening;
      } else if (game.white_player || game.black_player) {
        // Your custom format
        const isWhitePlayer = game.white_player?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = game.black_player?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;
        gameOpening = game.opening || game.raw_json?.opening || game.game?.opening;
      } else if (game.game) {
        // Nested game structure
        const nestedGame = game.game;
        const isWhitePlayer = nestedGame.white_player?.toLowerCase() === username.toLowerCase();
        const isBlackPlayer = nestedGame.black_player?.toLowerCase() === username.toLowerCase();
        isUserInGame = isWhitePlayer || isBlackPlayer;
        gameOpening = nestedGame.opening || nestedGame.raw_json?.opening;
      }

      // Skip if user is not in this game or no opening data
      if (!isUserInGame || !gameOpening) {
        return;
      }

      validGameCount++;

      // Extract base opening name (everything before the first colon)
      const fullOpeningName = gameOpening.name || 'Unknown Opening';
      const baseName = fullOpeningName.split(':')[0].trim();

      // Create a unique key for the base opening (group by base name only, not ECO)
      const openingKey = baseName;

      // Count user's mistakes from analysis data
      let inaccuracyCount = 0;
      let mistakeCount = 0;
      let blunderCount = 0;

      // Determine which color the user played
      let userColor: 'white' | 'black' | null = null;
      if (game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase()) {
        userColor = 'white';
      } else if (game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase()) {
        userColor = 'black';
      } else if (game.white_player?.toLowerCase() === username.toLowerCase()) {
        userColor = 'white';
      } else if (game.black_player?.toLowerCase() === username.toLowerCase()) {
        userColor = 'black';
      }

      // Determine game result for the user (win, draw, loss)
      let isWin = 0;
      let isDraw = 0;
      let isLoss = 0;

      const winner = game.raw_json?.winner || game.game?.raw_json?.winner || game.winner;
      if (winner === null || winner === undefined || winner === 'draw') {
        isDraw = 1;
      } else if ((winner === 'white' && userColor === 'white') || (winner === 'black' && userColor === 'black')) {
        isWin = 1;
      } else {
        isLoss = 1;
      }

      // Get analysis data and division data from game
      const analysis = game.raw_json?.analysis || game.game?.raw_json?.analysis || game.analysis || [];
      const division = game.raw_json?.division || game.game?.raw_json?.division || game.division;

      // Determine the end of opening phase
      // If division.middle exists, opening ends at that move index
      // If no division at all, the entire game is opening
      const openingEndIndex = division?.middle !== undefined ? division.middle : analysis.length;

      if (userColor && Array.isArray(analysis)) {
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

      if (openingsMap.has(openingKey)) {
        const existing = openingsMap.get(openingKey)!;
        const oldCount = existing.count;
        existing.count++;
        // Update running averages
        existing.averagePly = ((existing.averagePly * oldCount) + (gameOpening.ply || 0)) / existing.count;
        existing.avgInaccuracies = ((existing.avgInaccuracies * oldCount) + inaccuracyCount) / existing.count;
        existing.avgMistakes = ((existing.avgMistakes * oldCount) + mistakeCount) / existing.count;
        existing.avgBlunders = ((existing.avgBlunders * oldCount) + blunderCount) / existing.count;
        // Update game results
        existing.wins += isWin;
        existing.draws += isDraw;
        existing.losses += isLoss;

        // Add or update variation
        const variationIndex = existing.variations.findIndex(v => v.fullName === fullOpeningName);
        if (variationIndex >= 0) {
          const variation = existing.variations[variationIndex];
          const oldVarCount = variation.count;
          variation.count++;
          variation.avgInaccuracies = ((variation.avgInaccuracies * oldVarCount) + inaccuracyCount) / variation.count;
          variation.avgMistakes = ((variation.avgMistakes * oldVarCount) + mistakeCount) / variation.count;
          variation.avgBlunders = ((variation.avgBlunders * oldVarCount) + blunderCount) / variation.count;
          variation.wins += isWin;
          variation.draws += isDraw;
          variation.losses += isLoss;
        } else {
          existing.variations.push({
            fullName: fullOpeningName,
            count: 1,
            fen: gameOpening.fen,
            moves: gameOpening.moves,
            avgInaccuracies: inaccuracyCount,
            avgMistakes: mistakeCount,
            avgBlunders: blunderCount,
            wins: isWin,
            draws: isDraw,
            losses: isLoss
          });
        }
      } else {
        openingsMap.set(openingKey, {
          eco: gameOpening.eco || 'Unknown',
          baseName: baseName,
          fullName: fullOpeningName,
          count: 1,
          averagePly: gameOpening.ply || 0,
          fen: gameOpening.fen,
          moves: gameOpening.moves,
          avgInaccuracies: inaccuracyCount,
          avgMistakes: mistakeCount,
          avgBlunders: blunderCount,
          wins: isWin,
          draws: isDraw,
          losses: isLoss,
          variations: [{
            fullName: fullOpeningName,
            count: 1,
            fen: gameOpening.fen,
            moves: gameOpening.moves,
            avgInaccuracies: inaccuracyCount,
            avgMistakes: mistakeCount,
            avgBlunders: blunderCount,
            wins: isWin,
            draws: isDraw,
            losses: isLoss
          }]
        });
      }
    });

    // Convert to array (will sort after calculating percentiles)
    const openingsData = Array.from(openingsMap.values());

    // Calculate percentiles for each opening if openingStatsData is available
    if (openingStatsData) {
      // Determine which time control to use based on current filter
      const speedFilter = gameFilterManager.getCurrentSpeedFilter();
      let timeControl: string | null = null;

      if (Array.isArray(speedFilter) && speedFilter.length === 1) {
        timeControl = speedFilter[0];
      } else if (speedFilter === 'all' || (Array.isArray(speedFilter) && speedFilter.length === 0)) {
        // Use the most common time control in the filtered games
        const speeds = filteredGames.map(g => g.speed).filter((s): s is string => Boolean(s));
        if (speeds.length > 0) {
          const speedCounts = speeds.reduce((acc, s) => {
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const entries = Object.entries(speedCounts).sort((a, b) => b[1] - a[1]);
          timeControl = entries[0]?.[0] ?? null;
        }
      } else if (Array.isArray(speedFilter) && speedFilter.length > 1) {
        timeControl = speedFilter[0];
      }

      if (timeControl && openingStatsData[timeControl]) {
        openingsData.forEach(opening => {
          // Try to find the opening stats using the base name first
          let openingStats = openingStatsData[timeControl!][opening.baseName];

          // If not found, the base name might not be in the data file
          // (since the new format only includes the top 100 openings with full names)
          // In this case, we won't have population data for comparison
          if (openingStats) {
            // Calculate user's error score
            const userErrorScore = opening.avgInaccuracies + 2 * opening.avgMistakes + 3 * opening.avgBlunders;

            // Calculate population mean error score
            const popMeanInaccuracies = openingStats.opening_inaccuracies_per_game?.mean || 0;
            const popMeanMistakes = openingStats.opening_mistakes_per_game?.mean || 0;
            const popMeanBlunders = openingStats.opening_blunders_per_game?.mean || 0;
            const popMeanErrorScore = popMeanInaccuracies + 2 * popMeanMistakes + 3 * popMeanBlunders;

            // Calculate population standard deviation of error score
            // σ² = σ²_I + 4σ²_M + 9σ²_B
            const popStdInaccuracies = openingStats.opening_inaccuracies_per_game?.std || 0;
            const popStdMistakes = openingStats.opening_mistakes_per_game?.std || 0;
            const popStdBlunders = openingStats.opening_blunders_per_game?.std || 0;
            const popVarianceErrorScore =
              Math.pow(popStdInaccuracies, 2) +
              4 * Math.pow(popStdMistakes, 2) +
              9 * Math.pow(popStdBlunders, 2);
            const popStdErrorScore = Math.sqrt(popVarianceErrorScore);

            // Calculate percentile
            opening.percentile = calculatePercentile(
              userErrorScore,
              popMeanErrorScore,
              popStdErrorScore,
              opening.count
            );
          }
        });
      }
    }

    // Initial sort by percentile (lowest first, meaning worst performance first)
    // This will be re-sorted based on sortBy state in a separate useMemo
    openingsData.sort((a, b) => {
      const hasPercentileA = a.percentile !== undefined && a.percentile !== null;
      const hasPercentileB = b.percentile !== undefined && b.percentile !== null;

      if (hasPercentileA && hasPercentileB) {
        // Both have percentiles - sort by percentile (lowest first)
        return a.percentile! - b.percentile!;
      } else if (hasPercentileA) {
        // Only A has percentile - A comes first
        return -1;
      } else if (hasPercentileB) {
        // Only B has percentile - B comes first
        return 1;
      } else {
        // Neither has percentile - sort by frequency (most common first)
        return b.count - a.count;
      }
    });

    return {
      openingsData,
      totalGames: validGameCount
    };
  }, [filteredGames, username, currentFilter, openingStatsData]);

  // Sort openings based on the selected sort method and direction
  const sortedOpeningsData = useMemo(() => {
    const sorted = [...openingsData];

    switch (sortBy) {
      case 'name':
        // Sort alphabetically by base name
        sorted.sort((a, b) => {
          const comparison = a.baseName.localeCompare(b.baseName);
          return sortDirection === 'asc' ? comparison : -comparison;
        });
        break;
      case 'games':
        // Sort by number of games
        sorted.sort((a, b) => {
          const comparison = b.count - a.count;
          return sortDirection === 'asc' ? comparison : -comparison;
        });
        break;
      case 'percentile':
      default:
        // Sort by percentile
        sorted.sort((a, b) => {
          const hasPercentileA = a.percentile !== undefined && a.percentile !== null;
          const hasPercentileB = b.percentile !== undefined && b.percentile !== null;

          let comparison: number;
          if (hasPercentileA && hasPercentileB) {
            comparison = a.percentile! - b.percentile!;
          } else if (hasPercentileA) {
            comparison = -1;
          } else if (hasPercentileB) {
            comparison = 1;
          } else {
            comparison = b.count - a.count;
          }
          return sortDirection === 'asc' ? comparison : -comparison;
        });
        break;
    }

    return sorted;
  }, [openingsData, sortBy, sortDirection]);

  // Update selected opening with fresh data when openingsData changes
  useEffect(() => {
    if (openingsData.length === 0) {
      // Clear selection if no data
      setSelectedOpening(null);
      setSelectedVariationName(null);
      return;
    }

    if (selectedOpening) {
      // Find and update the currently selected opening with fresh data
      const updatedOpening = openingsData.find(
        o => o.baseName === selectedOpening.baseName && o.eco === selectedOpening.eco
      );

      if (updatedOpening) {
        // Update the selected opening with fresh data
        setSelectedOpening(updatedOpening);

        // Update the selected variation if one is selected
        if (selectedVariationName && selectedVariationName !== '__base__') {
          const updatedVariation = updatedOpening.variations.find(
            v => v.fullName === selectedVariationName
          );

          if (updatedVariation) {
            // Keep the current variation selected but update moves/fen if needed
            if (updatedVariation.moves) {
              const moves = updatedVariation.moves.split(' ').filter(m => m.trim() !== '');
              setOpeningMoves(moves);
            }
          } else {
            // Variation no longer exists, select first variation or base
            if (updatedOpening.variations.length > 0) {
              const firstVariation = updatedOpening.variations[0];
              setSelectedVariationName(firstVariation.fullName);
              if (firstVariation.moves) {
                const moves = firstVariation.moves.split(' ').filter(m => m.trim() !== '');
                setOpeningMoves(moves);
                setCurrentMoveIndex(moves.length);
                const chess = new Chess();
                for (let i = 0; i < moves.length; i++) {
                  chess.move(moves[i]);
                }
                setSelectedOpeningFen(chess.fen());
              }
            }
          }
        }
      } else {
        // Selected opening no longer exists, select first available
        const topOpening = openingsData[0];
        setSelectedOpening(topOpening);

        if (topOpening.variations.length > 0) {
          const firstVariation = topOpening.variations[0];
          setSelectedVariationName(firstVariation.fullName);
          if (firstVariation.moves) {
            const moves = firstVariation.moves.split(' ').filter(m => m.trim() !== '');
            setOpeningMoves(moves);
            setCurrentMoveIndex(moves.length);
            const chess = new Chess();
            for (let i = 0; i < moves.length; i++) {
              chess.move(moves[i]);
            }
            setSelectedOpeningFen(chess.fen());
          }
        }
      }
    } else {
      // No selection yet, auto-select the first opening
      const topOpening = openingsData[0];
      setSelectedOpening(topOpening);

      // Select the first variation
      if (topOpening.variations.length > 0) {
        const firstVariation = topOpening.variations[0];
        setSelectedVariationName(firstVariation.fullName);

        // Parse the moves string and set opening moves for this variation
        if (firstVariation.moves) {
          const moves = firstVariation.moves.split(' ').filter(m => m.trim() !== '');
          setOpeningMoves(moves);
          setCurrentMoveIndex(moves.length); // Start at the end of the opening

          // Calculate FEN for the end position
          const chess = new Chess();
          for (let i = 0; i < moves.length; i++) {
            chess.move(moves[i]);
          }
          setSelectedOpeningFen(chess.fen());
        } else if (firstVariation.fen) {
          setSelectedOpeningFen(firstVariation.fen);
          setOpeningMoves([]);
          setCurrentMoveIndex(0);
        }
      }
    }
  }, [openingsData, selectedOpening?.baseName, selectedOpening?.eco, selectedVariationName]);

  // Handler to toggle sort column and direction
  const handleSortColumnClick = (column: 'percentile' | 'name' | 'games') => {
    if (sortBy === column) {
      // Clicking the same column toggles direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Clicking a new column sets it as the sort column with ascending direction
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  // Handler to send games with selected opening to buddy board
  const handleSendToBuddyBoard = () => {
    if (!selectedOpening || !selectedVariationName) return;

    // Filter games based on selected opening variation
    const gamesWithOpening = filteredGames.filter(game => {
      // Handle different data structures
      let gameOpening = null;

      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        gameOpening = game.opening;
      } else if (game.white_player || game.black_player) {
        gameOpening = game.opening || game.raw_json?.opening || game.game?.opening;
      } else if (game.game) {
        const nestedGame = game.game;
        gameOpening = nestedGame.opening || nestedGame.raw_json?.opening;
      }

      if (!gameOpening) return false;

      const fullOpeningName = gameOpening.name || '';

      // If base opening is selected, match all variations of this opening
      if (selectedVariationName === '__base__') {
        const baseName = fullOpeningName.split(':')[0].trim();
        return baseName === selectedOpening.baseName && gameOpening.eco === selectedOpening.eco;
      }

      // Otherwise match the specific variation
      return fullOpeningName === selectedVariationName;
    });

    if (gamesWithOpening.length === 0) {
      console.warn('No games found with the selected opening');
      return;
    }

    // Create a custom event with the filtered games
    const sendToBuddyBoardEvent = new CustomEvent('sendToBuddyBoard', {
      detail: { games: gamesWithOpening, shouldOpen: true }
    });
    window.dispatchEvent(sendToBuddyBoardEvent);
  };

  return (
    <div className="opening-analysis" style={{
      padding: '20px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '8px',
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 6px var(--shadow-light)'
    }}>
      {/* Header Row with Three Columns */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        padding: '10px',
        backgroundColor: 'var(--background-primary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        gap: '20px',
        minHeight: '70px',
        maxHeight: '70px'
      }}>
        {/* Left: Stats */}
        <div style={{
          flex: '0 0 auto',
          textAlign: 'left',
          fontSize: '14px',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ marginBottom: '4px' }}>
            {gameFilterManager.getFilterDescription()}
          </div>
          <div>
            Unique Openings: {openingsData.length}
          </div>
        </div>

        {/* Center: Opening and Variation Name */}
        <div style={{
          flex: '1',
          textAlign: 'center',
          minWidth: '0',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: '50px'
        }}>
          <h2 style={{
            margin: '0',
            fontSize: '1.5rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            lineHeight: '1.2'
          }}>
            {selectedOpening ? selectedOpening.baseName : 'Select an Opening'}
          </h2>
          <div style={{
            marginTop: '4px',
            fontSize: '0.9rem',
            fontWeight: '400',
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            minHeight: '20px',
            lineHeight: '1.2'
          }}>
            {selectedOpening && selectedVariationName && selectedVariationName !== '__base__'
              ? `Variation: ${selectedVariationName.split(':').slice(1).join(':').trim() || selectedVariationName}`
              : '\u00A0' /* non-breaking space to maintain height */
            }
          </div>
        </div>

        {/* Right: Send to Buddy Board Button */}
        <div style={{
          flex: '0 0 auto'
        }}>
          <button
            onClick={handleSendToBuddyBoard}
            disabled={!selectedOpening || !selectedVariationName}
            style={{
              width: '50px',
              height: '50px',
              padding: '6px',
              border: '2px solid var(--border-color)',
              borderRadius: '8px',
              backgroundColor: selectedOpening && selectedVariationName ? 'var(--primary-color)' : 'var(--background-tertiary)',
              color: selectedOpening && selectedVariationName ? 'var(--text-on-primary)' : 'var(--text-muted)',
              cursor: selectedOpening && selectedVariationName ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px var(--shadow-light)'
            }}
            onMouseEnter={(e) => {
              if (selectedOpening && selectedVariationName) {
                e.currentTarget.style.backgroundColor = 'var(--primary-color-dark, var(--primary-color))';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedOpening && selectedVariationName) {
                e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
              }
            }}
            title="Send games with this opening to Buddy Board"
          >
            <SendToBuddyBoardIcon size={42} />
          </button>
        </div>
      </div>

      {/* Opening Board and Mistake Chart */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        {/* Left Column: Mistake Chart and Variations */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          minWidth: '320px',
          maxWidth: '400px',
          flex: '1'
        }}>
          {/* Mistake Bar Chart */}
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <h4 style={{
              margin: '0 0 16px 0',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              Average Mistakes
              <br />
              <span style={{
                fontSize: '11px',
                fontWeight: '400',
                color: 'var(--text-secondary)',
                fontStyle: 'italic'
              }}>
                {(() => {
                  if (!selectedOpening) return '(Based on 0 games)';
                  const currentVariation = selectedVariationName === '__base__'
                    ? null
                    : selectedOpening.variations.find(v => v.fullName === selectedVariationName);
                  const stats = currentVariation || selectedOpening;
                  return `(Based on ${stats.count} game${stats.count !== 1 ? 's' : ''})`;
                })()}
              </span>
            </h4>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {(() => {
                // Calculate user's ELO and get population averages
                const avgElo = calculateAverageElo(filteredGames, username);
                const eloBracket = avgElo ? getEloBracket(avgElo) : null;

                // Determine which time control to use based on current filter
                const speedFilter = gameFilterManager.getCurrentSpeedFilter();
                let timeControl: string | null = null;

                if (Array.isArray(speedFilter) && speedFilter.length === 1) {
                  timeControl = speedFilter[0];
                } else if (speedFilter === 'all' || (Array.isArray(speedFilter) && speedFilter.length === 0)) {
                  // Use the most common time control in the filtered games
                  const speeds = filteredGames.map(g => g.speed).filter((s): s is string => Boolean(s));
                  if (speeds.length > 0) {
                    const speedCounts = speeds.reduce((acc, s) => {
                      acc[s] = (acc[s] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);
                    const entries = Object.entries(speedCounts).sort((a, b) => b[1] - a[1]);
                    timeControl = entries[0]?.[0] ?? null;
                  }
                } else if (Array.isArray(speedFilter) && speedFilter.length > 1) {
                  timeControl = speedFilter[0];
                }


                // Get population averages for this opening
                let popAvgInaccuracies = 0;
                let popAvgMistakes = 0;
                let popAvgBlunders = 0;

                if (openingStatsData && timeControl && selectedOpening) {
                  // openingStatsData is organized by time control
                  if (openingStatsData[timeControl]) {
                    // Determine which opening to look up based on selected variation
                    let lookupKey = selectedOpening.baseName;

                    // If a specific variation is selected (not base), try to find it in the data
                    if (selectedVariationName && selectedVariationName !== '__base__') {
                      // First try exact match with the variation name
                      if (openingStatsData[timeControl][selectedVariationName]) {
                        lookupKey = selectedVariationName;
                      }
                    }

                    const openingStats = openingStatsData[timeControl][lookupKey];

                    if (openingStats) {
                      popAvgInaccuracies = openingStats.opening_inaccuracies_per_game?.mean || 0;
                      popAvgMistakes = openingStats.opening_mistakes_per_game?.mean || 0;
                      popAvgBlunders = openingStats.opening_blunders_per_game?.mean || 0;
                    }
                  }
                }

                // Get the current variation's stats or fall back to opening stats or show zeros
                if (!selectedOpening) {
                  return (
                    <>
                      {/* Inaccuracies */}
                      <div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Inaccuracies</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                            0.0
                          </span>
                        </div>
                        <div style={{
                          height: '20px',
                          backgroundColor: 'var(--background-secondary)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <div style={{
                            height: '100%',
                            backgroundColor: '#FFA726',
                            width: '0%',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>

                      {/* Mistakes */}
                      <div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Mistakes</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                            0.0
                          </span>
                        </div>
                        <div style={{
                          height: '20px',
                          backgroundColor: 'var(--background-secondary)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <div style={{
                            height: '100%',
                            backgroundColor: '#FF7043',
                            width: '0%',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>

                      {/* Blunders */}
                      <div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Blunders</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                            0.0
                          </span>
                        </div>
                        <div style={{
                          height: '20px',
                          backgroundColor: 'var(--background-secondary)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <div style={{
                            height: '100%',
                            backgroundColor: '#EF5350',
                            width: '0%',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>
                    </>
                  );
                }

                const currentVariation = selectedVariationName === '__base__'
                  ? null
                  : selectedOpening.variations.find(v => v.fullName === selectedVariationName);

                const stats = currentVariation || selectedOpening;

                  return (
                    <>
                      {/* Inaccuracies */}
                      <div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Inaccuracies</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* User's bar */}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {stats.avgInaccuracies.toFixed(1)}
                            </div>
                            <div style={{
                              height: '16px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#FFA726',
                                width: `${Math.min((stats.avgInaccuracies / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                          {/* Population average bar */}
                          {popAvgInaccuracies > 0 && (
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                Avg: {popAvgInaccuracies.toFixed(1)}
                              </div>
                              <div style={{
                                height: '16px',
                                backgroundColor: 'var(--background-secondary)',
                                borderRadius: '3px',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  height: '100%',
                                  backgroundColor: '#FFA726',
                                  opacity: 0.5,
                                  width: `${Math.min((popAvgInaccuracies / 10) * 100, 100)}%`,
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
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Mistakes</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* User's bar */}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {stats.avgMistakes.toFixed(1)}
                            </div>
                            <div style={{
                              height: '16px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#FF7043',
                                width: `${Math.min((stats.avgMistakes / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                          {/* Population average bar */}
                          {popAvgMistakes > 0 && (
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                Avg: {popAvgMistakes.toFixed(1)}
                              </div>
                              <div style={{
                                height: '16px',
                                backgroundColor: 'var(--background-secondary)',
                                borderRadius: '3px',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  height: '100%',
                                  backgroundColor: '#FF7043',
                                  opacity: 0.5,
                                  width: `${Math.min((popAvgMistakes / 10) * 100, 100)}%`,
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
                          marginBottom: '4px',
                          fontSize: '12px'
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Blunders</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* User's bar */}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              You: {stats.avgBlunders.toFixed(1)}
                            </div>
                            <div style={{
                              height: '16px',
                              backgroundColor: 'var(--background-secondary)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: '#EF5350',
                                width: `${Math.min((stats.avgBlunders / 10) * 100, 100)}%`,
                                transition: 'width 0.3s ease'
                              }} />
                            </div>
                          </div>
                          {/* Population average bar */}
                          {popAvgBlunders > 0 && (
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                Avg: {popAvgBlunders.toFixed(1)}
                              </div>
                              <div style={{
                                height: '16px',
                                backgroundColor: 'var(--background-secondary)',
                                borderRadius: '3px',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  height: '100%',
                                  backgroundColor: '#EF5350',
                                  opacity: 0.5,
                                  width: `${Math.min((popAvgBlunders / 10) * 100, 100)}%`,
                                  transition: 'width 0.3s ease'
                                }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Variations List - Compact and Scrollable */}
            <div style={{
              backgroundColor: 'var(--background-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h4 style={{
                margin: '0 0 8px 0',
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                textAlign: 'center'
              }}>
                {selectedOpening ? selectedOpening.baseName : 'Opening'} Variations
              </h4>
              {/* Percentile Bar for Selected Opening */}
              {selectedOpening?.percentile !== undefined && selectedOpening?.percentile !== null && (
                <div style={{
                  marginBottom: '12px',
                  display: 'flex',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    width: '80%',
                    height: '12px',
                    backgroundColor: 'var(--background-secondary)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${selectedOpening.percentile}%`,
                      backgroundColor: selectedOpening.percentile >= 75
                        ? '#4CAF50'
                        : selectedOpening.percentile >= 50
                          ? '#FFA726'
                          : '#F44336',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              )}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minHeight: '145px',
                maxHeight: '145px',
                overflowY: 'auto',
                paddingRight: '4px'
              }}>
                {selectedOpening && selectedOpening.variations.length > 0 ? (
                  <>
                  {/* Base Opening - show at top if available */}
                  {baseOpeningData && (
                    <div
                      onClick={() => {
                        // Parse the PGN moves for the base opening
                        const pgnMoves = baseOpeningData.pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
                        setOpeningMoves(pgnMoves);
                        setCurrentMoveIndex(pgnMoves.length);
                        setSelectedVariationName('__base__');

                        // Calculate FEN for the end position
                        const chess = new Chess();
                        for (let i = 0; i < pgnMoves.length; i++) {
                          chess.move(pgnMoves[i]);
                        }
                        setSelectedOpeningFen(chess.fen());
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        backgroundColor: selectedVariationName === '__base__' ? 'var(--primary-color)' : 'var(--background-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedVariationName !== '__base__') {
                          e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                        }
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedVariationName !== '__base__') {
                          e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                        }
                        e.currentTarget.style.transform = 'translateX(0)';
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '12px',
                          color: selectedVariationName === '__base__' ? 'var(--text-on-primary)' : 'var(--text-primary)',
                          fontWeight: '600'
                        }}>
                          {baseOpeningData.name} (Base)
                        </div>
                      </div>

                      <div style={{
                        minWidth: '30px',
                        textAlign: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: selectedVariationName === '__base__' ? 'var(--text-on-primary)' : 'var(--primary-color)'
                      }}>
                        {selectedOpening.count}
                      </div>
                    </div>
                  )}

                  {/* User's variations */}
                  {selectedOpening.variations.map((variation, index) => (
                    <div
                      key={`${variation.fullName}-${index}`}
                      onClick={() => {
                        // Parse the moves string and set opening moves for this variation
                        if (variation.moves) {
                          const moves = variation.moves.split(' ').filter(m => m.trim() !== '');
                          setOpeningMoves(moves);
                          setCurrentMoveIndex(moves.length); // Start at the end of the opening
                          setSelectedVariationName(variation.fullName);

                          // Calculate FEN for the end position
                          const chess = new Chess();
                          for (let i = 0; i < moves.length; i++) {
                            chess.move(moves[i]);
                          }
                          setSelectedOpeningFen(chess.fen());
                        } else if (variation.fen) {
                          setSelectedOpeningFen(variation.fen);
                          setOpeningMoves([]);
                          setCurrentMoveIndex(0);
                          setSelectedVariationName(variation.fullName);
                        }
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        backgroundColor: selectedVariationName === variation.fullName ? 'var(--primary-color)' : 'var(--background-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        transition: 'all 0.2s ease',
                        cursor: variation.fen ? 'pointer' : 'default'
                      }}
                      onMouseEnter={(e) => {
                        if (variation.fen && selectedVariationName !== variation.fullName) {
                          e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                        }
                        if (variation.fen) {
                          e.currentTarget.style.transform = 'translateX(4px)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedVariationName !== variation.fullName) {
                          e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                        }
                        e.currentTarget.style.transform = 'translateX(0)';
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '12px',
                          color: selectedVariationName === variation.fullName ? 'var(--text-on-primary)' : 'var(--text-primary)'
                        }}>
                          {variation.fullName}
                        </div>
                      </div>

                      <div style={{
                        minWidth: '30px',
                        textAlign: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: selectedVariationName === variation.fullName ? 'var(--text-on-primary)' : 'var(--primary-color)'
                      }}>
                        {variation.count}
                      </div>
                    </div>
                  ))}
                  </>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    fontStyle: 'italic',
                    textAlign: 'center',
                    padding: '20px'
                  }}>
                    No variations available
                  </div>
                )}
              </div>
            </div>
          </div>

        {/* Opening Board with Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <OpeningBoard size={boardSize} position={selectedOpeningFen} />

          {/* Navigation Controls */}
          {openingMoves.length > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '8px',
            }}>
              <button
                onClick={() => {
                  if (currentMoveIndex > 0) {
                    setCurrentMoveIndex(0);
                    setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
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
                  if (currentMoveIndex < openingMoves.length) {
                    setCurrentMoveIndex(openingMoves.length);

                    const chess = new Chess();
                    for (let i = 0; i < openingMoves.length; i++) {
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
                aria-label="Go to end"
              >
                <EndIcon disabled={false} size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Openings List */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px',
        marginTop: '16px'
      }}>
        <h4 style={{
          margin: '0 0 16px 0',
          fontSize: '16px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          textAlign: 'center'
        }}>
          Opening Frequency
        </h4>

        {openingsData.length === 0 ? (
          <div style={{
            minHeight: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <p style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              margin: 0,
              fontStyle: 'italic'
            }}>
              No opening data found in analyzed games
            </p>
          </div>
        ) : (
          <>
            {/* Column Headers */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 16px',
              borderBottom: '2px solid var(--border-color)',
              marginBottom: '8px'
            }}>
              <div
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortColumnClick('name')}
              >
                <span style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  color: sortBy === 'name' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Opening Name {sortBy === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              <div
                style={{
                  minWidth: '100px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  marginRight: '20px'
                }}
                onClick={() => handleSortColumnClick('percentile')}
              >
                <span style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  color: sortBy === 'percentile' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Performance {sortBy === 'percentile' && (sortDirection === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              <div
                style={{
                  minWidth: '60px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortColumnClick('games')}
              >
                <span style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  color: sortBy === 'games' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Games {sortBy === 'games' && (sortDirection === 'asc' ? '▲' : '▼')}
                </span>
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minHeight: '260px',
              maxHeight: '260px',
              overflowY: 'auto',
              paddingRight: '8px'
            }}>
              {sortedOpeningsData.map((opening, index) => (
              <div
                key={`${opening.eco}-${index}`}
                onClick={() => {
                  setSelectedOpening(opening);

                  // Parse the moves string and set opening moves
                  if (opening.moves) {
                    const moves = opening.moves.split(' ').filter(m => m.trim() !== '');
                    setOpeningMoves(moves);
                    setCurrentMoveIndex(moves.length); // Start at the end of the opening

                    // Calculate FEN for the end position
                    const chess = new Chess();
                    for (let i = 0; i < moves.length; i++) {
                      chess.move(moves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  } else if (opening.fen) {
                    setSelectedOpeningFen(opening.fen);
                    setOpeningMoves([]);
                    setCurrentMoveIndex(0);
                  }
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--primary-color)' : 'var(--background-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease',
                  cursor: opening.fen ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (opening.fen && !(selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName)) {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                  }
                  if (opening.fen) {
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }
                }}
                onMouseLeave={(e) => {
                  const isSelected = selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName;
                  e.currentTarget.style.backgroundColor = isSelected ? 'var(--primary-color)' : 'var(--background-secondary)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: '600',
                    color: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    fontSize: '14px',
                    marginBottom: '4px'
                  }}>
                    <span style={{
                      backgroundColor: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--background-primary)' : 'var(--primary-color)',
                      color: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--primary-color)' : 'var(--text-on-primary)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      marginRight: '8px'
                    }}>
                      {opening.eco}
                    </span>
                    {opening.baseName}
                  </div>
                  {opening.variations.length > 1 && (
                    <div style={{
                      fontSize: '11px',
                      color: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                      marginTop: '2px'
                    }}>
                      {opening.variations.length} variations
                    </div>
                  )}
                </div>

                {/* Percentile Bar */}
                {opening.percentile !== undefined && opening.percentile !== null && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    minWidth: '100px',
                    marginRight: '20px'
                  }}>
                    <div style={{
                      width: '100%',
                      height: '12px',
                      backgroundColor: 'var(--background-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${opening.percentile}%`,
                        backgroundColor: opening.percentile >= 75
                          ? '#4CAF50'
                          : opening.percentile >= 50
                            ? '#FFA726'
                            : '#F44336',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '60px'
                }}>
                  <span style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: selectedOpening?.eco === opening.eco && selectedOpening?.baseName === opening.baseName ? 'var(--text-on-primary)' : 'var(--primary-color)'
                  }}>
                    {opening.count}
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

export default OpeningAnalysis;