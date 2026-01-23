import React, { useMemo, useEffect, useState, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ReferenceArea } from 'recharts';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';
import { eloDataManager } from '../elo-data-manager';

interface GameResult {
  id?: string;
  winner?: 'white' | 'black' | null;
  status?: 'mate' | 'resign' | 'outoftime' | 'draw' | 'stalemate' | 'insufficient';
  endingType?: 'stalemate' | 'agreement' | 'repetition' | '50moveRule' | 'insufficientMaterial' | null;
  speed?: string;
  perf?: string;
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

interface GameResultsChartProps {
  enrichedGames: GameResult[];
  username: string;
  chartType?: 'pie' | 'bar';
  eloAveragesData?: EloAveragesData | null;
  analysisComplete?: boolean;
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
  draws: {
    stalemate: '#8B9DC3',             // Muted blue
    agreement: '#95A99F',             // Muted green
    repetition: '#C9ADA7',            // Muted pink
    '50moveRule': '#B8B8A0',          // Muted yellow
    insufficientMaterial: '#9B9B9B'   // Gray
  }
};

// Colors for different time controls in ELO chart
const TIME_CONTROL_COLORS: Record<string, string> = {
  bullet: '#FF6B6B',    // Red
  blitz: '#4ECDC4',     // Teal
  rapid: '#45B7D1',     // Blue
  daily: '#96CEB4',     // Green
  custom: '#DDA15E',    // Orange
  classical: '#9B59B6', // Purple
  correspondence: '#95A5A6' // Gray
};

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

// Helper function to get current ELO from most recent game
const getCurrentElo = (games: GameResult[], username: string): number | null => {
  if (!games || games.length === 0) return null;

  // Get the most recent game (assumes games are in chronological order)
  const mostRecentGame = games[games.length - 1];
  let rating = null;
  let isWhitePlayer = false;
  let isBlackPlayer = false;

  // Try to extract data from different possible structures
  if (mostRecentGame.players?.white?.user?.name || mostRecentGame.players?.black?.user?.name) {
    // Lichess format
    isWhitePlayer = mostRecentGame.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
    isBlackPlayer = mostRecentGame.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();

    if (isWhitePlayer) {
      rating = mostRecentGame.players?.white?.rating;
    } else if (isBlackPlayer) {
      rating = mostRecentGame.players?.black?.rating;
    }
  } else if (mostRecentGame.white?.username || mostRecentGame.black?.username) {
    // Chess.com format (direct structure)
    isWhitePlayer = mostRecentGame.white?.username?.toLowerCase() === username.toLowerCase();
    isBlackPlayer = mostRecentGame.black?.username?.toLowerCase() === username.toLowerCase();

    if (isWhitePlayer) {
      rating = mostRecentGame.white?.rating;
    } else if (isBlackPlayer) {
      rating = mostRecentGame.black?.rating;
    }
  } else if (mostRecentGame.white_player || mostRecentGame.black_player) {
    // Custom format (enriched games)
    isWhitePlayer = mostRecentGame.white_player?.toLowerCase() === username.toLowerCase();
    isBlackPlayer = mostRecentGame.black_player?.toLowerCase() === username.toLowerCase();

    const rawJson = mostRecentGame.raw_json || mostRecentGame.game?.raw_json;
    if (rawJson) {
      if (isWhitePlayer) {
        rating = rawJson.players?.white?.rating || rawJson.white?.rating;
      } else if (isBlackPlayer) {
        rating = rawJson.players?.black?.rating || rawJson.black?.rating;
      }
    }
  } else if (mostRecentGame.game) {
    // Nested game structure
    const nestedGame = mostRecentGame.game;
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

  return rating;
};

export const GameResultsChart: React.FC<GameResultsChartProps> = ({
  enrichedGames = [],
  username,
  chartType = 'bar',
  eloAveragesData = null,
  analysisComplete = false
}) => {
  const [filteredGames, setFilteredGames] = useState<GameResult[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [currentSpeedFilter, setCurrentSpeedFilter] = useState<any>('all');
  const [filteredEloData, setFilteredEloData] = useState<any>(null);
  const [precomputedEloData, setPrecomputedEloData] = useState<any[] | null>(null);

  // LLM insights state
  const [llmInsights, setLlmInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  // ELO chart zoom state
  const [eloZoomLeft, setEloZoomLeft] = useState<number | null>(null);
  const [eloZoomRight, setEloZoomRight] = useState<number | null>(null);
  const [eloZoomDomain, setEloZoomDomain] = useState<{ x: [number, number] | null; y: [number, number] | null }>({ x: null, y: null });
  const [isEloZoomed, setIsEloZoomed] = useState(false);

  // ELO chart zoom handlers
  const handleEloMouseDown = (e: any) => {
    if (e && e.activeLabel !== undefined) {
      setEloZoomLeft(e.activeLabel);
    }
  };

  const handleEloMouseMove = (e: any) => {
    if (eloZoomLeft !== null && e && e.activeLabel !== undefined) {
      setEloZoomRight(e.activeLabel);
    }
  };

  const handleEloMouseUp = () => {
    if (eloZoomLeft === null || eloZoomRight === null || eloZoomLeft === eloZoomRight) {
      setEloZoomLeft(null);
      setEloZoomRight(null);
      return;
    }

    // Determine the zoom range
    let left = eloZoomLeft;
    let right = eloZoomRight;

    // Ensure left < right
    if (left > right) {
      [left, right] = [right, left];
    }

    // Calculate Y domain based on visible data in the selected range
    const allRatings: number[] = [];
    Object.values(eloOverTimeData.bySpeed).forEach(games => {
      games.forEach(game => {
        if (game.timestamp >= left && game.timestamp <= right) {
          allRatings.push(game.rating);
        }
      });
    });

    let yMin = Math.min(...allRatings);
    let yMax = Math.max(...allRatings);

    // Add some padding (10%)
    const yPadding = (yMax - yMin) * 0.1;
    yMin = Math.floor(yMin - yPadding);
    yMax = Math.ceil(yMax + yPadding);

    setEloZoomDomain({ x: [left, right], y: [yMin, yMax] });
    setIsEloZoomed(true);
    setEloZoomLeft(null);
    setEloZoomRight(null);
  };

  const handleEloZoomOut = () => {
    setEloZoomDomain({ x: null, y: null });
    setIsEloZoomed(false);
    setEloZoomLeft(null);
    setEloZoomRight(null);
  };

  // Fetch LLM insights for this component
  const fetchLlmInsights = async () => {
    try {
      setInsightsLoading(true);
      setInsightsError(null);

      // First, check if insights were provided via streaming (stored in window.llmInsights)
      if ((window as any).llmInsights?.game_results?.insights) {
        console.log('Using LLM insights from streaming data');
        setLlmInsights((window as any).llmInsights.game_results.insights);
        setInsightsLoading(false);
        return;
      }

      // Get report ID from the page
      const reportIdEl = document.getElementById('report-id');
      if (!reportIdEl) {
        setInsightsLoading(false);
        return;
      }
      const reportId = reportIdEl.textContent?.trim();

      if (!reportId) {
        setInsightsLoading(false);
        return;
      }

      // Fetch insights from API (for existing reports or if streaming data not available)
      const response = await fetch(`/api/generate-insights/${reportId}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
          component: 'game_results'
        })
      });

      // Get response text first to handle both JSON and HTML errors
      const responseText = await response.text();

      if (!response.ok) {
        setInsightsError(`API error (${response.status})`);
        setInsightsLoading(false);
        return;
      }

      // Try to parse JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        setInsightsError('Server returned invalid response.');
        setInsightsLoading(false);
        return;
      }

      if (data.success) {
        setLlmInsights(data.insights);
      } else {
        const errorMsg = data.error || 'Failed to generate insights';
        setInsightsError(errorMsg);
      }
    } catch (e) {
      console.error('Error fetching LLM insights:', e);
      setInsightsError(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setInsightsLoading(false);
    }
  };

  // Helper to get CSRF token
  const getCsrfToken = () => {
    const name = 'csrftoken';
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith(name + '=')) {
        return trimmed.substring(name.length + 1);
      }
    }
    return '';
  };

  // Read pre-computed ELO chart data from hidden div on mount
  useEffect(() => {
    try {
      const eloChartDataEl = document.getElementById('elo-chart-data');
      if (eloChartDataEl && eloChartDataEl.textContent?.trim()) {
        const data = JSON.parse(eloChartDataEl.textContent);
        if (data && data.length > 0) {
          setPrecomputedEloData(data);
        }
      }
    } catch (e) {
      console.error('Error loading pre-computed ELO chart data:', e);
    }
  }, []);

  // Track if insights have been fetched to avoid duplicate calls
  const insightsFetchedRef = useRef(false);

  // On mount, check if insights are already available in the report
  useEffect(() => {
    // Try to load pre-existing insights from the report (for existing reports)
    if (enrichedGames && enrichedGames.length > 0 && !insightsFetchedRef.current) {
      // Check if we can fetch from API (will return cached if available)
      const reportIdEl = document.getElementById('report-id');
      if (reportIdEl && reportIdEl.textContent?.trim()) {
        insightsFetchedRef.current = true;
        fetchLlmInsights();
      }
    }
  }, []); // Run once on mount

  // Listen for when analysis completes during streaming
  useEffect(() => {
    if (analysisComplete && enrichedGames && enrichedGames.length > 0 && !insightsFetchedRef.current) {
      // Analysis is complete and data is available, fetch insights
      console.log('Analysis complete, fetching LLM insights for game results...');
      insightsFetchedRef.current = true;
      fetchLlmInsights();
    }
  }, [analysisComplete, enrichedGames]);

  // Set up filter manager when component mounts
  useEffect(() => {
    // Get initial filtered games from the filter manager
    setFilteredGames(gameFilterManager.getFilteredGames());
    setCurrentFilter(gameFilterManager.getCurrentFilter());
    setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter());

    // Get initial filtered ELO data
    const initialEloData = eloDataManager.getFilteredEloAverages();
    setFilteredEloData(initialEloData);

    // Listen for filter changes
    const handleFilterChange = (event: FilterEvent) => {
      setFilteredGames(event.filteredGames);
      setCurrentFilter(event.filter);
      setCurrentSpeedFilter(event.speedFilter);
    };

    // Listen for ELO data changes
    const handleDataChange = (event: any) => {
      setFilteredEloData(event.eloAveragesData);
    };

    // Listen for LLM insights arriving from streaming
    const handleLlmInsightsReady = () => {
      if (!insightsFetchedRef.current && (window as any).llmInsights?.game_results?.insights) {
        console.log('LLM insights ready event received, fetching...');
        insightsFetchedRef.current = true;
        fetchLlmInsights();
      }
    };

    gameFilterManager.addListener(handleFilterChange);
    eloDataManager.addListener(handleDataChange);
    window.addEventListener('llmInsightsReady', handleLlmInsightsReady);

    // Clean up listeners on unmount
    return () => {
      gameFilterManager.removeListener(handleFilterChange);
      eloDataManager.removeListener(handleDataChange);
      window.removeEventListener('llmInsightsReady', handleLlmInsightsReady);
    };
  }, []);

  // Calculate ELO over time data - only filter by speed, not color or result
  const eloOverTimeData = useMemo(() => {
    // If we have pre-computed ELO data, use it instead of computing from games
    if (precomputedEloData && precomputedEloData.length > 0) {

      // Convert pre-computed data to the expected format
      const bySpeed: Record<string, any[]> = {};
      let minTimestamp: number | null = null;
      let maxTimestamp: number | null = null;

      // Process each data point
      precomputedEloData.forEach((dataPoint) => {
        const timestamp = dataPoint.timestamp;

        // Update min/max timestamps
        if (minTimestamp === null || timestamp < minTimestamp) minTimestamp = timestamp;
        if (maxTimestamp === null || timestamp > maxTimestamp) maxTimestamp = timestamp;

        // Extract data for each time control
        ['bullet', 'blitz', 'rapid'].forEach((speed) => {
          if (dataPoint[speed] !== undefined) {
            if (!bySpeed[speed]) {
              bySpeed[speed] = [];
            }

            bySpeed[speed].push({
              gameNumber: bySpeed[speed].length + 1,
              rating: dataPoint[speed],
              timestamp: timestamp,
              date: dataPoint[`${speed}_date`] || new Date(timestamp).toLocaleDateString(),
              speed: speed
            });
          }
        });
      });

      // Get all time controls that have data
      let allTimeControls = Object.keys(bySpeed).sort();

      // Filter by speed if a specific speed filter is active
      let filteredBySpeed = bySpeed;
      let filteredMinTimestamp = minTimestamp;
      let filteredMaxTimestamp = maxTimestamp;

      if (currentSpeedFilter !== 'all') {
        const selectedSpeeds = Array.isArray(currentSpeedFilter) ? currentSpeedFilter : [currentSpeedFilter];

        // Filter to only show selected speeds
        filteredBySpeed = {};
        allTimeControls = [];

        selectedSpeeds.forEach(speed => {
          if (bySpeed[speed]) {
            filteredBySpeed[speed] = bySpeed[speed];
            allTimeControls.push(speed);
          }
        });

        // Recalculate min/max timestamps for filtered data
        const allFilteredTimestamps: number[] = [];
        Object.values(filteredBySpeed).forEach(games => {
          games.forEach(game => allFilteredTimestamps.push(game.timestamp));
        });

        if (allFilteredTimestamps.length > 0) {
          filteredMinTimestamp = Math.min(...allFilteredTimestamps);
          filteredMaxTimestamp = Math.max(...allFilteredTimestamps);
        }
      }

      return {
        bySpeed: filteredBySpeed,
        allTimeControls,
        minTimestamp: filteredMinTimestamp,
        maxTimestamp: filteredMaxTimestamp
      };
    }

    // Fallback: compute from games if no pre-computed data available
    const allGames = gameFilterManager.getAllGames();

    if (!allGames.length) {
      return {
        bySpeed: {},
        allTimeControls: [],
        minTimestamp: null,
        maxTimestamp: null
      };
    }

    // Extract rating data from each game - this processes ALL games
    // All games should be in enriched format with players.white.user.name structure
    const gamesWithRating = allGames.map(game => {
      const isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase();
      const isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase();

      let rating = null;
      if (isWhitePlayer) {
        rating = game.players?.white?.rating;
      } else if (isBlackPlayer) {
        rating = game.players?.black?.rating;
      }

      const timestamp = game.createdAt;
      const speed = game.speed || game.perf;

      return {
        rating,
        timestamp,
        speed: speed || 'unknown',
        isValid: rating !== null && timestamp !== null
      };
    }).filter(item => item.isValid);

    // Sort by timestamp
    gamesWithRating.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate min and max timestamps
    const minTimestamp = gamesWithRating.length > 0 ? gamesWithRating[0].timestamp : null;
    const maxTimestamp = gamesWithRating.length > 0 ? gamesWithRating[gamesWithRating.length - 1].timestamp : null;

    // Group by speed
    const bySpeed: Record<string, any[]> = {};
    gamesWithRating.forEach((item, index) => {
      if (!bySpeed[item.speed]) {
        bySpeed[item.speed] = [];
      }

      bySpeed[item.speed].push({
        gameNumber: bySpeed[item.speed].length + 1,
        rating: item.rating,
        timestamp: item.timestamp,
        date: new Date(item.timestamp).toLocaleDateString(),
        speed: item.speed
      });
    });

    // Get all time controls that have data
    let allTimeControls = Object.keys(bySpeed).sort();

    // Filter by speed if a specific speed filter is active
    let filteredBySpeed = bySpeed;
    let filteredMinTimestamp = minTimestamp;
    let filteredMaxTimestamp = maxTimestamp;

    if (currentSpeedFilter !== 'all') {
      const selectedSpeeds = Array.isArray(currentSpeedFilter) ? currentSpeedFilter : [currentSpeedFilter];

      // Filter to only show selected speeds
      filteredBySpeed = {};
      allTimeControls = [];

      selectedSpeeds.forEach(speed => {
        if (bySpeed[speed]) {
          filteredBySpeed[speed] = bySpeed[speed];
          allTimeControls.push(speed);
        }
      });

      // Recalculate min/max timestamps for filtered data
      const allFilteredTimestamps: number[] = [];
      Object.values(filteredBySpeed).forEach(games => {
        games.forEach(game => allFilteredTimestamps.push(game.timestamp));
      });

      if (allFilteredTimestamps.length > 0) {
        filteredMinTimestamp = Math.min(...allFilteredTimestamps);
        filteredMaxTimestamp = Math.max(...allFilteredTimestamps);
      }
    }

    return {
      bySpeed: filteredBySpeed,
      allTimeControls,
      minTimestamp: filteredMinTimestamp,
      maxTimestamp: filteredMaxTimestamp
    };
  }, [username, currentSpeedFilter, precomputedEloData]);

  const { winsData, lossesData, drawsData, totalGames, userStats, maxYAxisValue, eloBracket } = useMemo(() => {
    if (!filteredGames.length) {
      return {
        winsData: [],
        lossesData: [],
        drawsData: [],
        totalGames: 0,
        userStats: { wins: 0, losses: 0, draws: 0 },
        maxYAxisValue: 0,
        eloBracket: null
      };
    }

    // Get user's current ELO from most recent game and determine bracket
    const currentElo = getCurrentElo(filteredGames, username);
    const eloBracket = currentElo ? getEloBracket(currentElo) : null;

    // Initialize counters
    const results = {
      wins: { mate: 0, resign: 0, outoftime: 0 },
      losses: { mate: 0, resign: 0, outoftime: 0 },
      draws: {
        stalemate: 0,
        agreement: 0,
        repetition: 0,
        '50moveRule': 0,
        insufficientMaterial: 0,
        unknown: 0
      }
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
        // Categorize the draw by endingType
        let endingType = game.endingType || game.raw_json?.endingType || game.game?.raw_json?.endingType;

        if (endingType === 'stalemate') {
          results.draws.stalemate++;
        } else if (endingType === 'agreement') {
          results.draws.agreement++;
        } else if (endingType === 'repetition') {
          results.draws.repetition++;
        } else if (endingType === '50moveRule') {
          results.draws['50moveRule']++;
        } else if (endingType === 'insufficientMaterial') {
          results.draws.insufficientMaterial++;
        } else {
          results.draws.unknown++;
        }
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

    const totalWins = results.wins.mate + results.wins.resign + results.wins.outoftime;
    const totalLosses = results.losses.mate + results.losses.resign + results.losses.outoftime;
    const totalDraws = results.draws.stalemate + results.draws.agreement + results.draws.repetition +
                      results.draws['50moveRule'] + results.draws.insufficientMaterial + results.draws.unknown;
    const totalGames = totalWins + totalLosses + totalDraws;

    // Calculate percentages for user's wins and losses
    const winPercentages = {
      mate: totalWins > 0 ? (results.wins.mate / totalWins) * 100 : 0,
      resign: totalWins > 0 ? (results.wins.resign / totalWins) * 100 : 0,
      timeout: totalWins > 0 ? (results.wins.outoftime / totalWins) * 100 : 0
    };

    const lossPercentages = {
      mate: totalLosses > 0 ? (results.losses.mate / totalLosses) * 100 : 0,
      resign: totalLosses > 0 ? (results.losses.resign / totalLosses) * 100 : 0,
      timeout: totalLosses > 0 ? (results.losses.outoftime / totalLosses) * 100 : 0
    };

    const drawPercentages = {
      stalemate: totalDraws > 0 ? (results.draws.stalemate / totalDraws) * 100 : 0,
      agreement: totalDraws > 0 ? (results.draws.agreement / totalDraws) * 100 : 0,
      repetition: totalDraws > 0 ? (results.draws.repetition / totalDraws) * 100 : 0,
      '50moveRule': totalDraws > 0 ? (results.draws['50moveRule'] / totalDraws) * 100 : 0,
      insufficientMaterial: totalDraws > 0 ? (results.draws.insufficientMaterial / totalDraws) * 100 : 0,
      unknown: totalDraws > 0 ? (results.draws.unknown / totalDraws) * 100 : 0
    };

    // Get population average percentages if we have an ELO bracket and time control
    let popAvgWinPercentages = { mate: 0, resign: 0, timeout: 0 };
    let popAvgLossPercentages = { mate: 0, resign: 0, timeout: 0 };
    let popAvgDrawPercentages = { stalemate: 0, agreement: 0, repetition: 0, '50moveRule': 0, insufficientMaterial: 0 };

    // Determine which time control to use based on current filter
    const speedFilter = gameFilterManager.getCurrentSpeedFilter();
    let timeControl: string | null = null;

    if (Array.isArray(speedFilter) && speedFilter.length === 1) {
      // Single time control selected
      timeControl = speedFilter[0];
    } else if (speedFilter === 'all' || (Array.isArray(speedFilter) && speedFilter.length === 0)) {
      // All speeds or no filter - try to determine from games
      // Use the most common time control in the filtered games
      const speeds = filteredGames.map(g => {
        // Try multiple sources for speed
        return g.speed || g.perf || g.raw_json?.speed || g.raw_json?.perf || g.game?.raw_json?.speed || g.game?.raw_json?.perf;
      }).filter(Boolean);
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

    if (eloBracket && filteredEloData) {
      const timeControlData = filteredEloData;

      // Helper function to extract rate value (handles both number and {mean, std, skew} formats)
      const getRate = (value: any): number => {
        if (typeof value === 'number') {
          return value * 100;
        } else if (value && typeof value === 'object' && 'mean' in value) {
          return (value.mean || 0) * 100;
        }
        return 0;
      };

      popAvgWinPercentages = {
        mate: getRate(timeControlData.win_by_checkmate_rate),
        resign: getRate(timeControlData.win_by_resignation_rate),
        timeout: getRate(timeControlData.win_by_timeout_rate)
      };
      popAvgLossPercentages = {
        mate: getRate(timeControlData.loss_by_checkmate_rate),
        resign: getRate(timeControlData.loss_by_resignation_rate),
        timeout: getRate(timeControlData.loss_by_timeout_rate)
      };
      popAvgDrawPercentages = {
        stalemate: getRate(timeControlData.draw_by_stalemate_rate),
        agreement: getRate(timeControlData.draw_by_agreement_rate),
        repetition: getRate(timeControlData.draw_by_repetition_rate),
        '50moveRule': getRate(timeControlData.draw_by_50move_rate),
        insufficientMaterial: getRate(timeControlData.draw_by_insufficient_material_rate)
      };
    }

    // Build separate data arrays for wins and losses with population comparison (in percentages)
    const winsChartData = [
      {
        name: 'Checkmate',
        value: winPercentages.mate,
        rawCount: results.wins.mate,
        popAvg: popAvgWinPercentages.mate,
        fill: COLORS.wins.mate
      },
      {
        name: 'Resignation',
        value: winPercentages.resign,
        rawCount: results.wins.resign,
        popAvg: popAvgWinPercentages.resign,
        fill: COLORS.wins.resign
      },
      {
        name: 'Timeout',
        value: winPercentages.timeout,
        rawCount: results.wins.outoftime,
        popAvg: popAvgWinPercentages.timeout,
        fill: COLORS.wins.outoftime
      }
    ];

    const lossesChartData = [
      {
        name: 'Checkmate',
        value: lossPercentages.mate,
        rawCount: results.losses.mate,
        popAvg: popAvgLossPercentages.mate,
        fill: COLORS.losses.mate
      },
      {
        name: 'Resignation',
        value: lossPercentages.resign,
        rawCount: results.losses.resign,
        popAvg: popAvgLossPercentages.resign,
        fill: COLORS.losses.resign
      },
      {
        name: 'Timeout',
        value: lossPercentages.timeout,
        rawCount: results.losses.outoftime,
        popAvg: popAvgLossPercentages.timeout,
        fill: COLORS.losses.outoftime
      }
    ];

    const drawsChartData = [
      {
        name: 'Stalemate',
        value: drawPercentages.stalemate,
        rawCount: results.draws.stalemate,
        popAvg: popAvgDrawPercentages.stalemate,
        fill: COLORS.draws.stalemate
      },
      {
        name: 'Agreement',
        value: drawPercentages.agreement,
        rawCount: results.draws.agreement,
        popAvg: popAvgDrawPercentages.agreement,
        fill: COLORS.draws.agreement
      },
      {
        name: 'Repetition',
        value: drawPercentages.repetition,
        rawCount: results.draws.repetition,
        popAvg: popAvgDrawPercentages.repetition,
        fill: COLORS.draws.repetition
      },
      {
        name: '50-Move Rule',
        value: drawPercentages['50moveRule'],
        rawCount: results.draws['50moveRule'],
        popAvg: popAvgDrawPercentages['50moveRule'],
        fill: COLORS.draws['50moveRule']
      },
      {
        name: 'Insufficient Material',
        value: drawPercentages.insufficientMaterial,
        rawCount: results.draws.insufficientMaterial,
        popAvg: popAvgDrawPercentages.insufficientMaterial,
        fill: COLORS.draws.insufficientMaterial
      }
    ];

    // Calculate the maximum Y-axis value - should be 100 for percentages
    const maxYAxisValue = 100;

    return {
      winsData: winsChartData,
      lossesData: lossesChartData,
      drawsData: drawsChartData,
      totalGames,
      userStats: { wins: totalWins, losses: totalLosses, draws: totalDraws },
      maxYAxisValue,
      eloBracket
    };
  }, [filteredGames, username, currentFilter, currentSpeedFilter, filteredEloData]);

  const renderCustomTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

    // Get the data point
    const userBar = props.payload.find((p: any) => p.dataKey === 'value');
    const popAvgBar = props.payload.find((p: any) => p.dataKey === 'popAvg');

    if (!userBar && !popAvgBar) return null;

    const name = userBar?.payload.name || popAvgBar?.payload.name;
    const userPercentage = userBar?.value || 0;
    const rawCount = userBar?.payload.rawCount || 0;
    const popAvgPercentage = popAvgBar?.value || 0;

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
          {userBar && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: userBar.color,
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>You:</strong> {userPercentage.toFixed(1)}% ({rawCount} games)</span>
            </p>
          )}
          {eloBracket && popAvgPercentage > 0 && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: popAvgBar?.color || '#999',
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>Avg ({eloBracket}):</strong> {popAvgPercentage.toFixed(1)}%</span>
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderDrawsTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

    // Get the data point
    const userBar = props.payload.find((p: any) => p.dataKey === 'value');
    const popAvgBar = props.payload.find((p: any) => p.dataKey === 'popAvg');

    if (!userBar && !popAvgBar) return null;

    const name = userBar?.payload.name || popAvgBar?.payload.name;
    const userPercentage = userBar?.value || 0;
    const rawCount = userBar?.payload.rawCount || 0;
    const popAvgPercentage = popAvgBar?.value || 0;

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
          {userBar && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: userBar.color,
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>You:</strong> {userPercentage.toFixed(1)}% ({rawCount} games)</span>
            </p>
          )}
          {eloBracket && popAvgPercentage > 0 && (
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                color: popAvgBar?.color || '#999',
                fontSize: '14px',
                filter: 'brightness(1.1)'
              }}>●</span>
              <span><strong>Avg ({eloBracket}):</strong> {popAvgPercentage.toFixed(1)}%</span>
            </p>
          )}
        </div>
      </div>
    );
  };

  // Custom legend for wins/losses charts
  const renderWinsLossesLegend = (props: any) => {
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

  const renderEloTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null;

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
        {props.payload.map((entry: any, index: number) => (
          <div key={index} style={{ marginBottom: index < props.payload.length - 1 ? '8px' : '0' }}>
            <p style={{
              margin: '0 0 4px 0',
              fontWeight: '600',
              fontSize: '14px',
              color: entry.color,
              textTransform: 'capitalize'
            }}>
              {entry.name || entry.dataKey}
            </p>
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)'
            }}>
              Rating: {entry.value}
            </p>
            {entry.payload.date && (
              <p style={{
                margin: '2px 0 0 0',
                fontSize: '11px',
                color: 'var(--text-muted)'
              }}>
                {entry.payload.date}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Don't return early - always render the full component structure
  // This ensures the component maintains its height even with no data

  return (
    <div className="game-results-chart" style={{
      padding: '20px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '8px',
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 6px var(--shadow-light)',
      margin: '20px 0'
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

      {/* ELO Over Time Chart - Always render */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <h4 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Rating Over Time
          </h4>
          {isEloZoomed && (
            <button
              onClick={handleEloZoomOut}
              style={{
                padding: '4px 12px',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              Zoom Out
            </button>
          )}
        </div>
        {eloOverTimeData.allTimeControls.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={(() => {
                  // Create a unified dataset by merging all time controls
                  const allTimestamps = new Set<number>();
                  Object.values(eloOverTimeData.bySpeed).forEach(games => {
                    games.forEach(game => allTimestamps.add(game.timestamp));
                  });

                  // Convert to array and sort
                  const timestamps = Array.from(allTimestamps).sort((a, b) => a - b);

                  // Create data points for each timestamp
                  return timestamps.map(timestamp => {
                    const dataPoint: any = { timestamp };

                    // Add rating for each time control at this timestamp
                    eloOverTimeData.allTimeControls.forEach(timeControl => {
                      const game = eloOverTimeData.bySpeed[timeControl]?.find(g => g.timestamp === timestamp);
                      if (game) {
                        dataPoint[timeControl] = game.rating;
                        dataPoint[`${timeControl}_date`] = game.date;
                      }
                    });

                    return dataPoint;
                  });
                })()}
                margin={{ top: 10, right: 30, left: 10, bottom: 20 }}
                onMouseDown={handleEloMouseDown}
                onMouseMove={handleEloMouseMove}
                onMouseUp={handleEloMouseUp}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={eloZoomDomain.x || [eloOverTimeData.minTimestamp ?? 'auto', eloOverTimeData.maxTimestamp ?? 'auto']}
                  allowDataOverflow={true}
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                  tickFormatter={(timestamp) => new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  label={{ value: 'Date', position: 'insideBottom', offset: -10, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  fontSize={12}
                  tick={{ fill: 'var(--text-secondary)' }}
                  label={{ value: 'Elo Rating', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)' }}
                  domain={eloZoomDomain.y || ['auto', 'auto']}
                  allowDataOverflow={true}
                />
                <Tooltip content={renderEloTooltip} />
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }}
                  iconType="line"
                  verticalAlign="top"
                  align="right"
                  layout="vertical"
                />
                {eloOverTimeData.allTimeControls.map((timeControl, index) => {
                  const color = TIME_CONTROL_COLORS[timeControl] || '#999999';

                  return (
                    <Line
                      key={timeControl}
                      type="monotone"
                      dataKey={timeControl}
                      name={timeControl.charAt(0).toUpperCase() + timeControl.slice(1)}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ fill: color, r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  );
                })}
                {eloZoomLeft !== null && eloZoomRight !== null && (
                  <ReferenceArea
                    x1={eloZoomLeft}
                    x2={eloZoomRight}
                    strokeOpacity={0.3}
                    fill="var(--primary-color)"
                    fillOpacity={0.3}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div style={{
            height: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No rating data available yet...
          </div>
        )}
      </div>

      {/* Wins, Losses, and Draws Charts Container */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '20px',
        marginTop: '16px'
      }}>
        {/* Wins Chart - Always render */}
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
          {(userStats.wins > 0 || (eloBracket && winsData.some(d => d.popAvg > 0))) ? (
            <ResponsiveContainer width="100%" height={180}>
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
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: 'Percentage', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)', offset: 10 }}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={false}
                />
                <Legend content={renderWinsLossesLegend} />
                {/* User's actual wins */}
                <Bar
                  dataKey="value"
                  name="You"
                  radius={[4, 4, 0, 0]}
                >
                  {winsData.map((entry, index) => (
                    <Cell key={`wins-user-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
                {/* Population average wins */}
                {eloBracket && (
                  <Bar
                    dataKey="popAvg"
                    name={`Avg (${eloBracket})`}
                    radius={[4, 4, 0, 0]}
                    fillOpacity={0.5}
                  >
                    {winsData.map((entry, index) => (
                      <Cell key={`wins-pop-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px'
            }}>
              No wins in selected filter
            </div>
          )}
        </div>

        {/* Losses Chart - Always render */}
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
          {(userStats.losses > 0 || (eloBracket && lossesData.some(d => d.popAvg > 0))) ? (
            <ResponsiveContainer width="100%" height={180}>
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
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: 'Percentage', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)', offset: 10 }}
                />
                <Tooltip
                  content={renderCustomTooltip}
                  cursor={false}
                />
                <Legend content={renderWinsLossesLegend} />
                {/* User's actual losses */}
                <Bar
                  dataKey="value"
                  name="You"
                  radius={[4, 4, 0, 0]}
                >
                  {lossesData.map((entry, index) => (
                    <Cell key={`losses-user-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
                {/* Population average losses */}
                {eloBracket && (
                  <Bar
                    dataKey="popAvg"
                    name={`Avg (${eloBracket})`}
                    radius={[4, 4, 0, 0]}
                    fillOpacity={0.5}
                  >
                    {lossesData.map((entry, index) => (
                      <Cell key={`losses-pop-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px'
            }}>
              No losses in selected filter
            </div>
          )}
        </div>

        {/* Draws Chart - Always render */}
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
            color: 'var(--text-muted)',
            textAlign: 'center'
          }}>
            Draws ({userStats.draws})
          </h4>
          {(userStats.draws > 0 || (eloBracket && drawsData.some(d => d.popAvg > 0))) ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={drawsData}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                style={{ cursor: 'default' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis
                  label={{
                    value: 'Percentage of Draws',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--text-secondary)', fontSize: 12 }
                  }}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  domain={[0, maxYAxisValue]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip content={renderDrawsTooltip} cursor={false} />
                {/* User's actual draws - Solid bar */}
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {drawsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
                {/* Population Average - Semi-transparent background bar */}
                {eloBracket && (
                  <Bar dataKey="popAvg" radius={[4, 4, 0, 0]} fillOpacity={0.5}>
                    {drawsData.map((entry, index) => (
                      <Cell key={`cell-pop-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '300px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px'
            }}>
              No draws in selected filter
            </div>
          )}
        </div>
      </div>

      {/* Overall Results Horizontal Bar Chart - Below wins/losses charts */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px',
        marginTop: '20px'
      }}>
        {totalGames > 0 ? (
          <ResponsiveContainer width="100%" height={50}>
            <BarChart
              layout="vertical"
              data={[{
                name: 'Results',
                Wins: userStats.wins,
                Draws: userStats.draws,
                Losses: userStats.losses
              }]}
              margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
              barSize={30}
            >
              <XAxis
                type="number"
                fontSize={12}
                tick={{ fill: 'var(--text-secondary)' }}
                domain={[0, totalGames]}
              />
              <YAxis
                type="category"
                dataKey="name"
                fontSize={12}
                tick={{ fill: 'var(--text-secondary)' }}
                width={50}
              />
              <Tooltip
                content={(props: any) => {
                  if (!props.active || !props.payload || !props.payload.length) return null;

                  return (
                    <div style={{
                      backgroundColor: 'var(--background-primary)',
                      padding: '12px 16px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      boxShadow: '0 4px 16px var(--shadow-medium)',
                      color: 'var(--text-primary)',
                      backdropFilter: 'blur(8px)'
                    }}>
                      {props.payload.map((entry: any, index: number) => (
                        <p key={index} style={{
                          margin: '4px 0',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <span style={{
                            color: entry.fill,
                            fontSize: '14px',
                            filter: 'brightness(1.1)'
                          }}>●</span>
                          <span><strong>{entry.name}:</strong> {entry.value} games ({((entry.value / totalGames) * 100).toFixed(1)}%)</span>
                        </p>
                      ))}
                    </div>
                  );
                }}
                cursor={{ fill: 'var(--hover-background)' }}
              />
              <Bar dataKey="Wins" stackId="a" fill="var(--success-color)" />
              <Bar dataKey="Draws" stackId="a" fill="#C9ADA7" />
              <Bar dataKey="Losses" stackId="a" fill="var(--danger-color)" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{
            height: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No games in selected filter
          </div>
        )}
      </div>

      {/* Insights Section - Collapsible */}
      <div
        style={{
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px',
          marginTop: '20px',
          minHeight: '100px',
          cursor: llmInsights ? 'pointer' : 'default'
        }}
        onClick={() => {
          if (llmInsights) setInsightsExpanded(!insightsExpanded);
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}
        >
          <h4 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            AI Insights
          </h4>
          {llmInsights && (
            <span style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              userSelect: 'none',
              transform: insightsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block'
            }}>
              ▼
            </span>
          )}
        </div>

        {insightsLoading && (
          <div style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            fontStyle: 'italic'
          }}>
            Generating insights...
          </div>
        )}

        {insightsError && !insightsLoading && (
          <div style={{
            fontSize: '14px',
            color: 'var(--danger-color)',
            backgroundColor: 'rgba(220, 53, 69, 0.1)',
            padding: '8px',
            borderRadius: '4px'
          }}>
            {insightsError}
          </div>
        )}

        {llmInsights && !insightsLoading && !insightsError && (
          <div
            style={{
              fontSize: '14px',
              lineHeight: '1.6',
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              maxHeight: insightsExpanded ? 'none' : '2.4em',
              overflow: 'hidden',
              position: 'relative',
              transition: 'max-height 0.3s ease'
            }}
          >
            <div
              dangerouslySetInnerHTML={{
                __html: llmInsights
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold
                  .replace(/\n/g, '<br />') // Line breaks
              }}
            />
            {!insightsExpanded && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                background: 'linear-gradient(to right, transparent, var(--background-primary) 50%)',
                width: '100px',
                height: '100%',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        )}

        {!insightsLoading && !insightsError && !llmInsights && (
          <div style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60px'
          }}>
            Waiting for game analysis to complete...
          </div>
        )}
      </div>
    </div>
  );
};

export default GameResultsChart;
