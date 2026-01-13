import React, { useMemo, useEffect, useState } from 'react';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';
import OpeningBoard from './opening-board';
import { Chess } from 'chess.js';

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
  };
  raw_json?: any;
  game?: any;
}

interface OpeningAnalysisProps {
  enrichedGames: GameOpening[];
  username: string;
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
}

export const OpeningAnalysis: React.FC<OpeningAnalysisProps> = ({
  enrichedGames = [],
  username
}) => {
  const [filteredGames, setFilteredGames] = useState<GameOpening[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [selectedOpeningFen, setSelectedOpeningFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [selectedOpening, setSelectedOpening] = useState<OpeningData | null>(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(0);
  const [openingMoves, setOpeningMoves] = useState<string[]>([]);
  const [baseOpeningData, setBaseOpeningData] = useState<{ name: string, pgn: string, fen: string } | null>(null);
  const [canonicalOpenings, setCanonicalOpenings] = useState<Map<string, { name: string, pgn: string, fen: string }>>(new Map());
  const [selectedVariationName, setSelectedVariationName] = useState<string | null>(null);

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

    // Reset selection when filter changes
    setSelectedOpening(null);
    setSelectedVariationName(null);

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

      // Create a unique key for the base opening
      const openingKey = `${gameOpening.eco}-${baseName}`;

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

    // Convert to array and sort by frequency (most common first)
    const openingsData = Array.from(openingsMap.values()).sort((a, b) => b.count - a.count);

    return {
      openingsData,
      totalGames: validGameCount
    };
  }, [filteredGames, username, currentFilter]);

  // Auto-select the first opening and its first variation when openingsData changes
  useEffect(() => {
    if (openingsData.length > 0 && !selectedOpening) {
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
  }, [openingsData]);

  if (totalGames === 0) {
    const filterDescription = currentFilter === 'all'
      ? 'No games with opening data available yet...'
      : `No ${currentFilter} games with opening data found for ${username}`;

    return (
      <div className="opening-analysis" style={{
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
            Opening Analysis ({gameFilterManager.getFilterDescription()})
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
    <div className="opening-analysis" style={{
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
          Opening Analysis ({gameFilterManager.getFilterDescription()})
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Games with Opening Data: {totalGames} | Unique Openings: {openingsData.length}
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
        {/* Mistake Bar Chart */}
        {selectedOpening && (
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '20px',
            minWidth: '250px'
          }}>
            <h4 style={{
              margin: '0 0 16px 0',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              Average Mistakes in {selectedOpening.eco}
            </h4>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
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
                    {selectedOpening.avgInaccuracies.toFixed(1)}
                  </span>
                </div>
                <div style={{
                  height: '20px',
                  backgroundColor: 'var(--background-secondary)',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    backgroundColor: '#FFA726',
                    width: `${Math.min((selectedOpening.avgInaccuracies / 10) * 100, 100)}%`,
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
                    {selectedOpening.avgMistakes.toFixed(1)}
                  </span>
                </div>
                <div style={{
                  height: '20px',
                  backgroundColor: 'var(--background-secondary)',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    backgroundColor: '#FF7043',
                    width: `${Math.min((selectedOpening.avgMistakes / 10) * 100, 100)}%`,
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
                    {selectedOpening.avgBlunders.toFixed(1)}
                  </span>
                </div>
                <div style={{
                  height: '20px',
                  backgroundColor: 'var(--background-secondary)',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    backgroundColor: '#EF5350',
                    width: `${Math.min((selectedOpening.avgBlunders / 10) * 100, 100)}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            </div>
            <div style={{
              marginTop: '12px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              fontStyle: 'italic'
            }}>
              Based on {selectedOpening.count} game{selectedOpening.count !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Opening Board with Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <OpeningBoard size={300} position={selectedOpeningFen} />

          {/* Navigation Controls */}
          {openingMoves.length > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '4px'
            }}>
              <button
                onClick={() => {
                  setCurrentMoveIndex(0);
                  setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                }}
                disabled={currentMoveIndex === 0}
                style={{
                  padding: '6px 10px',
                  fontSize: '11px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: currentMoveIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                  color: currentMoveIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: currentMoveIndex === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                ⏮ Start
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
                disabled={currentMoveIndex === 0}
                style={{
                  padding: '6px 10px',
                  fontSize: '11px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: currentMoveIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                  color: currentMoveIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: currentMoveIndex === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                ⏪ Prev
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
                disabled={currentMoveIndex >= openingMoves.length}
                style={{
                  padding: '6px 10px',
                  fontSize: '11px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: currentMoveIndex >= openingMoves.length ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                  color: currentMoveIndex >= openingMoves.length ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: currentMoveIndex >= openingMoves.length ? 'not-allowed' : 'pointer'
                }}
              >
                Next ⏩
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
                disabled={currentMoveIndex >= openingMoves.length}
                style={{
                  padding: '6px 10px',
                  fontSize: '11px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: currentMoveIndex >= openingMoves.length ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                  color: currentMoveIndex >= openingMoves.length ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: currentMoveIndex >= openingMoves.length ? 'not-allowed' : 'pointer'
                }}
              >
                End ⏭
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Variations List - shown when opening is selected */}
      {selectedOpening && selectedOpening.variations.length > 0 && (
        <div style={{
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px',
          marginTop: '16px'
        }}>
          <h4 style={{
            margin: '0 0 12px 0',
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            {selectedOpening.baseName} Variations
          </h4>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
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
                  padding: '10px 12px',
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
                    fontSize: '13px',
                    color: selectedVariationName === '__base__' ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    fontWeight: '600',
                    marginBottom: '2px'
                  }}>
                    {baseOpeningData.name} (Base)
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: selectedVariationName === '__base__' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                    fontStyle: 'italic'
                  }}>
                    {baseOpeningData.pgn}
                  </div>
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
                  padding: '10px 12px',
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
                    fontSize: '13px',
                    color: selectedVariationName === variation.fullName ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    marginBottom: '4px'
                  }}>
                    {variation.fullName}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: selectedVariationName === variation.fullName ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                    display: 'flex',
                    gap: '12px'
                  }}>
                    <span>Inaccuracies: {variation.avgInaccuracies.toFixed(1)}</span>
                    <span>Mistakes: {variation.avgMistakes.toFixed(1)}</span>
                    <span>Blunders: {variation.avgBlunders.toFixed(1)}</span>
                  </div>
                </div>

                {/* Win/Draw/Loss for variation */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '100px',
                  gap: '4px'
                }}>
                  <div style={{
                    width: '100%',
                    height: '16px',
                    display: 'flex',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                  }}>
                    {variation.wins > 0 && (
                      <div
                        style={{
                          width: `${(variation.wins / variation.count) * 100}%`,
                          backgroundColor: '#4CAF50',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${variation.wins} wins`}
                      />
                    )}
                    {variation.draws > 0 && (
                      <div
                        style={{
                          width: `${(variation.draws / variation.count) * 100}%`,
                          backgroundColor: '#9E9E9E',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${variation.draws} draws`}
                      />
                    )}
                    {variation.losses > 0 && (
                      <div
                        style={{
                          width: `${(variation.losses / variation.count) * 100}%`,
                          backgroundColor: '#F44336',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${variation.losses} losses`}
                      />
                    )}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: '6px'
                  }}>
                    <span style={{ color: '#4CAF50' }}>{variation.wins}W</span>
                    <span style={{ color: '#9E9E9E' }}>{variation.draws}D</span>
                    <span style={{ color: '#F44336' }}>{variation.losses}L</span>
                  </div>
                </div>

                <div style={{
                  minWidth: '40px',
                  textAlign: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: 'var(--primary-color)'
                }}>
                  {variation.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Openings List */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px',
        marginTop: '16px',
        maxHeight: '500px',
        overflowY: 'auto'
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
          <p style={{
            textAlign: 'center',
            color: 'var(--text-secondary)',
            margin: '20px 0',
            fontStyle: 'italic'
          }}>
            No opening data found in analyzed games
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {openingsData.map((opening, index) => (
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
                  backgroundColor: 'var(--background-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease',
                  cursor: opening.fen ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (opening.fen) {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    marginBottom: '4px'
                  }}>
                    <span style={{
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--text-on-primary)',
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
                      color: 'var(--text-secondary)',
                      marginTop: '2px'
                    }}>
                      {opening.variations.length} variations
                    </div>
                  )}
                </div>

                {/* Win/Draw/Loss Bar */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '120px',
                  gap: '4px'
                }}>
                  <div style={{
                    width: '100%',
                    height: '20px',
                    display: 'flex',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                  }}>
                    {opening.wins > 0 && (
                      <div
                        style={{
                          width: `${(opening.wins / opening.count) * 100}%`,
                          backgroundColor: '#4CAF50',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${opening.wins} wins`}
                      />
                    )}
                    {opening.draws > 0 && (
                      <div
                        style={{
                          width: `${(opening.draws / opening.count) * 100}%`,
                          backgroundColor: '#9E9E9E',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${opening.draws} draws`}
                      />
                    )}
                    {opening.losses > 0 && (
                      <div
                        style={{
                          width: `${(opening.losses / opening.count) * 100}%`,
                          backgroundColor: '#F44336',
                          transition: 'width 0.3s ease'
                        }}
                        title={`${opening.losses} losses`}
                      />
                    )}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: '8px'
                  }}>
                    <span style={{ color: '#4CAF50' }}>{opening.wins}W</span>
                    <span style={{ color: '#9E9E9E' }}>{opening.draws}D</span>
                    <span style={{ color: '#F44336' }}>{opening.losses}L</span>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '60px'
                }}>
                  <span style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: 'var(--primary-color)'
                  }}>
                    {opening.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OpeningAnalysis;