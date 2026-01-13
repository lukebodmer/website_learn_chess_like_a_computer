import React, { useState, useMemo } from 'react';
import { Chess } from 'chess.js';
import BlunderBoard from './blunder-board';
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager';

interface BlunderData {
  gameId: string;
  whitePlayer: string;
  blackPlayer: string;
  moveNumber: number;
  position: string;
  blunderMove: string;
  bestMove: string;
  evalBefore: number | null;
  evalAfter: number | null;
  mateBefore: number | null;
  mateAfter: number | null;
}

interface BlunderAnalysisProps {
  enrichedGames: any[];
  username: string;
}

export const BlunderAnalysis: React.FC<BlunderAnalysisProps> = ({
  enrichedGames = [],
  username
}) => {
  const [filteredGames, setFilteredGames] = useState<any[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [selectedBlunder, setSelectedBlunder] = useState<BlunderData | null>(null);

  // Set up filter manager when component mounts
  React.useEffect(() => {
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
  React.useEffect(() => {
    gameFilterManager.updateAllGames(enrichedGames);
  }, [enrichedGames]);

  // Parse all blunders from the filtered games
  const allBlunders = useMemo(() => {
    const blunders: BlunderData[] = [];

    filteredGames.forEach(game => {
      if (!game.analysis || !game.moves) return;

      // Extract player names from nested structure
      const whitePlayer = game.players?.white?.user?.name || game.white_player || 'Unknown';
      const blackPlayer = game.players?.black?.user?.name || game.black_player || 'Unknown';

      // Determine which color the user is playing
      let userColor: 'w' | 'b' | null = null;
      if (whitePlayer.toLowerCase() === username.toLowerCase()) {
        userColor = 'w';
      } else if (blackPlayer.toLowerCase() === username.toLowerCase()) {
        userColor = 'b';
      }

      // Skip if we can't determine the user's color
      if (!userColor) return;

      const chess = new Chess();
      const movesArray = game.moves.split(' ');

      // Iterate through moves and analysis together
      movesArray.forEach((move, index) => {
        const analysisEntry = game.analysis[index];
        if (!analysisEntry) return;

        // Determine whose turn it is for this move
        // White plays on even indices (0, 2, 4...), Black on odd indices (1, 3, 5...)
        const moveColor = index % 2 === 0 ? 'w' : 'b';

        // Only include blunders made by the user
        if (analysisEntry.judgment && analysisEntry.judgment.name === 'Blunder' && moveColor === userColor) {
          // Get the position before this move
          const positionBeforeMove = chess.fen();

          // Get eval before and after
          const evalBefore = game.analysis[index - 1]?.eval ?? null;
          const evalAfter = analysisEntry.eval ?? null;
          const mateBefore = game.analysis[index - 1]?.mate ?? null;
          const mateAfter = analysisEntry.mate ?? null;

          blunders.push({
            gameId: game.id || `${whitePlayer}-${blackPlayer}-${game.date}`,
            whitePlayer,
            blackPlayer,
            moveNumber: Math.floor(index / 2) + 1,
            position: positionBeforeMove,
            blunderMove: move,
            bestMove: analysisEntry.best || '',
            evalBefore,
            evalAfter,
            mateBefore,
            mateAfter
          });
        }

        // Make the move to keep the chess instance in sync
        try {
          chess.move(move);
        } catch (e) {
          console.error('Failed to make move:', move, 'at index', index, 'from position', chess.fen(), e);
        }
      });
    });

    return blunders;
  }, [filteredGames, username]);

  // Auto-select the first blunder when blunders list changes
  React.useEffect(() => {
    if (allBlunders.length > 0 && !selectedBlunder) {
      setSelectedBlunder(allBlunders[0]);
    } else if (allBlunders.length === 0) {
      setSelectedBlunder(null);
    } else if (selectedBlunder && !allBlunders.includes(selectedBlunder)) {
      // If the currently selected blunder is no longer in the list (due to filtering),
      // select the first one
      setSelectedBlunder(allBlunders[0]);
    }
  }, [allBlunders]);

  return (
    <div className="blunder-analysis" style={{
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
          Blunder Analysis ({gameFilterManager.getFilterDescription()})
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px'
        }}>
          Total Blunders: {allBlunders.length} from {filteredGames.length} games
        </div>
      </div>

      {/* Main Layout: List on Left, Board on Right */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start'
      }}>
        {/* Blunder List */}
        <div style={{
          flex: '0 0 300px',
          maxHeight: '600px',
          overflowY: 'auto',
          backgroundColor: 'var(--background-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          padding: '8px'
        }}>
          {allBlunders.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '14px'
            }}>
              No blunders found in the selected games
            </div>
          ) : (
            allBlunders.map((blunder, index) => (
              <div
                key={`${blunder.gameId}-${index}`}
                onClick={() => setSelectedBlunder(blunder)}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: selectedBlunder === blunder ? 'var(--background-secondary)' : 'transparent',
                  borderRadius: '6px',
                  border: selectedBlunder === blunder ? '2px solid var(--primary-color, #4a9eff)' : '1px solid var(--border-color)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  ':hover': {
                    backgroundColor: 'var(--background-secondary)'
                  }
                }}
                onMouseEnter={(e) => {
                  if (selectedBlunder !== blunder) {
                    e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedBlunder !== blunder) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '4px'
                }}>
                  {blunder.whitePlayer} vs {blunder.blackPlayer}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)'
                }}>
                  Move {blunder.moveNumber}: {blunder.blunderMove}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginTop: '2px'
                }}>
                  Best: {blunder.bestMove}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Blunder Board */}
        <div style={{ flex: '1', display: 'flex', justifyContent: 'center' }}>
          <BlunderBoard
            blunder={selectedBlunder}
            size={450}
          />
        </div>
      </div>
    </div>
  );
};

export default BlunderAnalysis;
