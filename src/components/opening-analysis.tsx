import React, { useMemo, useEffect, useState } from 'react';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';

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

interface OpeningData {
  eco: string;
  name: string;
  count: number;
  averagePly: number;
}

export const OpeningAnalysis: React.FC<OpeningAnalysisProps> = ({
  enrichedGames = [],
  username
}) => {
  const [filteredGames, setFilteredGames] = useState<GameOpening[]>(enrichedGames);
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

      // Create a unique key for this opening
      const openingKey = `${gameOpening.eco}-${gameOpening.name}`;

      if (openingsMap.has(openingKey)) {
        const existing = openingsMap.get(openingKey)!;
        existing.count++;
        // Update average ply (running average)
        existing.averagePly = ((existing.averagePly * (existing.count - 1)) + (gameOpening.ply || 0)) / existing.count;
      } else {
        openingsMap.set(openingKey, {
          eco: gameOpening.eco || 'Unknown',
          name: gameOpening.name || 'Unknown Opening',
          count: 1,
          averagePly: gameOpening.ply || 0
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
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: 'var(--background-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease'
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
                    {opening.name}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)'
                  }}>
                    Avg. depth: {opening.averagePly.toFixed(1)} moves
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '80px'
                }}>
                  <span style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: 'var(--primary-color)'
                  }}>
                    {opening.count}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                  }}>
                    {((opening.count / totalGames) * 100).toFixed(1)}%
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