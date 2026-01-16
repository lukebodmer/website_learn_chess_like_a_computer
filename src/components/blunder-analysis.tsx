import React, { useState, useMemo } from 'react';
import { Chess } from 'chess.js';
import BlunderBoard from './blunder-board';
import BaseChessBoard from './base-chess-board';
import { SendToBuddyBoardIcon } from './send-to-buddy-board-icon';
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
  gameData?: any; // Full game data for sending to buddy board
}

interface BlunderAnalysisProps {
  enrichedGames: any[];
  username: string;
  reportId?: number;
}

export const BlunderAnalysis: React.FC<BlunderAnalysisProps> = ({
  enrichedGames = [],
  username,
  reportId
}) => {
  const [filteredGames, setFilteredGames] = useState<any[]>(enrichedGames);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [selectedBlunder, setSelectedBlunder] = useState<BlunderData | null>(null);
  const [solvedBlunders, setSolvedBlunders] = useState<Set<string>>(new Set());

  // Fetch solved blunders when component mounts
  React.useEffect(() => {
    if (reportId) {
      fetch(`/api/solved-blunders/${reportId}/`)
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            setSolvedBlunders(new Set(data.solved_blunders));
          }
        })
        .catch(error => {
          console.error('Error fetching solved blunders:', error);
        });
    }
  }, [reportId]);

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

  // Helper function to generate a unique key for a blunder
  const getBlunderKey = (blunder: BlunderData): string => {
    return `${blunder.gameId}_${blunder.moveNumber}_${blunder.position}`;
  };

  // Callback when a blunder is solved
  const handleBlunderSolved = (blunder: BlunderData) => {
    if (!reportId) return;

    const blunderKey = getBlunderKey(blunder);

    // Optimistically update UI
    setSolvedBlunders(prev => new Set([...prev, blunderKey]));

    // Send to backend
    fetch(`/api/mark-blunder-solved/${reportId}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken') || '',
      },
      body: JSON.stringify({ blunder_key: blunderKey })
    })
      .then(response => response.json())
      .then(data => {
        if (!data.success) {
          console.error('Error marking blunder as solved:', data.error);
          // Revert optimistic update on error
          setSolvedBlunders(prev => {
            const newSet = new Set(prev);
            newSet.delete(blunderKey);
            return newSet;
          });
        }
      })
      .catch(error => {
        console.error('Error marking blunder as solved:', error);
        // Revert optimistic update on error
        setSolvedBlunders(prev => {
          const newSet = new Set(prev);
          newSet.delete(blunderKey);
          return newSet;
        });
      });
  };

  // Helper function to get CSRF token from cookies
  const getCookie = (name: string): string | null => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  };

  // Handler to send game to buddy board
  const handleSendToBuddyBoard = (blunder: BlunderData) => {
    if (!blunder.gameData) return;

    // Determine which color the user is playing to calculate the correct move index
    const whitePlayer = blunder.gameData.players?.white?.user?.name || blunder.gameData.white_player || 'Unknown';
    const blackPlayer = blunder.gameData.players?.black?.user?.name || blunder.gameData.black_player || 'Unknown';

    let userColor: 'w' | 'b' | null = null;
    if (whitePlayer.toLowerCase() === username.toLowerCase()) {
      userColor = 'w';
    } else if (blackPlayer.toLowerCase() === username.toLowerCase()) {
      userColor = 'b';
    }

    // Calculate the move index (0-based) from the move number and color
    // moveNumber is the full move number (1, 2, 3, etc.)
    // White moves are at even indices (0, 2, 4...), Black at odd indices (1, 3, 5...)
    let moveIndex = 0;
    if (userColor === 'w') {
      // White's move in move N is at index (N-1)*2
      moveIndex = (blunder.moveNumber - 1) * 2;
    } else if (userColor === 'b') {
      // Black's move in move N is at index (N-1)*2 + 1
      moveIndex = (blunder.moveNumber - 1) * 2 + 1;
    }

    // Create a custom event with the game data and the specific move index
    const sendToBuddyBoardEvent = new CustomEvent('sendToBuddyBoard', {
      detail: {
        games: [blunder.gameData],
        shouldOpen: true,
        moveIndex: moveIndex
      }
    });
    window.dispatchEvent(sendToBuddyBoardEvent);
  };

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
            mateAfter,
            gameData: game // Store full game data
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
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 6px var(--shadow-light)',
      minHeight: '700px'
    }}>
      {/* Main Layout: List on Left, Board on Right */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
        justifyContent: 'center',
        flexWrap: 'wrap',
        minHeight: '650px'
      }}>
        {/* Blunder List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          minWidth: '320px',
          maxWidth: '400px',
          flex: '1',
          height: '700px',
          minHeight: '700px',
          backgroundColor: 'var(--background-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden'
        }}>
          {/* Sticky Header */}
          <div style={{
            position: 'sticky',
            top: 0,
            backgroundColor: 'var(--background-primary)',
            padding: '12px',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '14px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            zIndex: 1
          }}>
            <div>Total Blunders: {allBlunders.length} from {filteredGames.length} games</div>
            <div style={{
              fontSize: '12px',
              fontWeight: '400',
              color: 'var(--text-secondary)',
              marginTop: '4px'
            }}>
              {gameFilterManager.getFilterDescription()}
            </div>
          </div>

          {/* Blunder Items */}
          <div style={{ padding: '8px', flex: 1, overflowY: 'auto' }}>
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
            allBlunders.map((blunder, index) => {
              const isSolved = solvedBlunders.has(getBlunderKey(blunder));
              return (
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
                    position: 'relative',
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <div style={{ flex: 1 }}>
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
                    </div>
                    {isSolved && (
                      <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: '#00aa00',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <span style={{
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: 'bold'
                        }}>✓</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          </div>

          {/* Progress Bar */}
          <div style={{
            backgroundColor: 'var(--background-secondary)',
            padding: '8px 12px',
            borderTop: '1px solid var(--border-color)',
            flexShrink: 0
          }}>
            <div style={{
              height: '6px',
              backgroundColor: 'var(--background-primary)',
              borderRadius: '3px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                height: '100%',
                backgroundColor: '#00aa00',
                width: `${allBlunders.length > 0 ? (allBlunders.filter(b => solvedBlunders.has(getBlunderKey(b))).length / allBlunders.length) * 100 : 0}%`,
                transition: 'width 0.3s ease',
                borderRadius: '2px'
              }} />
            </div>
          </div>
        </div>

        {/* Blunder Board */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          flex: '1',
          minWidth: '320px',
          maxWidth: '500px'
        }}>
          {selectedBlunder ? (
            <BlunderBoard
              blunder={selectedBlunder}
              size={450}
              isSolved={solvedBlunders.has(getBlunderKey(selectedBlunder))}
              onSolved={() => handleBlunderSolved(selectedBlunder)}
              onSendToBuddyBoard={() => handleSendToBuddyBoard(selectedBlunder)}
              username={username}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '450px' }}>
              {/* Empty state - show opening position */}
              <div style={{
                padding: '12px',
                backgroundColor: 'var(--background-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                position: 'relative'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <div style={{ flex: 1, fontSize: '14px', color: 'var(--text-primary)' }}>
                    <strong>Move :</strong>
                  </div>
                  <button
                    disabled={true}
                    style={{
                      width: '36px',
                      height: '36px',
                      padding: '4px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-tertiary)',
                      color: 'var(--text-muted)',
                      cursor: 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.5
                    }}
                    title="Send game to Buddy Board"
                  >
                    <SendToBuddyBoardIcon size={28} />
                  </button>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <strong>Played:</strong>
                    <br />
                    <strong>Before:</strong>
                  </div>
                  <div>
                    <strong>Best:</strong>
                    <br />
                    <strong>After:</strong>
                  </div>
                </div>
              </div>

              {/* Status Message Placeholder */}
              <div style={{
                padding: '8px',
                backgroundColor: 'var(--background-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                textAlign: 'center',
                fontSize: '14px',
                color: 'var(--text-secondary)'
              }}>
                {allBlunders.length === 0 ? 'No blunders to display' : 'Select a blunder to view'}
              </div>

              <div style={{
                backgroundColor: 'var(--background-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                padding: '16px',
                display: 'flex',
                justifyContent: 'center'
              }}>
                <BaseChessBoard
                  size={450}
                  position="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                  orientation="white"
                  coordinates={true}
                  showGameEndSymbols={false}
                  showCheckHighlight={false}
                  interactive={false}
                  allowPieceDragging={false}
                  highlightedSquares={[]}
                  arrows={[]}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlunderAnalysis;
