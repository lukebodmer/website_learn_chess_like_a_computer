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

  // LLM insights state
  const [llmInsights, setLlmInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  // Helper to get CSRF token from cookie
  const getCsrfToken = () => {
    const name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  };

  // Fetch LLM insights for this component
  const fetchLlmInsights = async () => {
    try {
      setInsightsLoading(true);
      setInsightsError(null);

      // First, check if insights were provided via streaming (stored in window.llmInsights)
      if ((window as any).llmInsights?.blunder_analysis?.insights) {
        console.log('Using blunder insights from streaming data');
        setLlmInsights((window as any).llmInsights.blunder_analysis.insights);
        setInsightsLoading(false);
        return;
      }

      // If not available via streaming, fetch from API (for existing reports)
      if (!reportId) {
        console.log('No report ID found, waiting for streaming data...');
        setInsightsLoading(false);
        return;
      }

      const csrfToken = getCsrfToken();
      if (!csrfToken) {
        console.error('CSRF token not found');
        setInsightsError('Security token not found. Please refresh the page.');
        setInsightsLoading(false);
        return;
      }

      const response = await fetch(`/api/generate-insights/${reportId}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
          component: 'blunder_analysis',
          force_regenerate: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.insights) {
        setLlmInsights(data.insights);
      } else {
        setInsightsError(data.error || 'Failed to generate insights');
      }
    } catch (e) {
      console.error('Error fetching blunder insights:', e);
      setInsightsError(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setInsightsLoading(false);
    }
  };

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

  // Listen for LLM insights arriving from streaming and fetch when report is loaded
  React.useEffect(() => {
    // Check if insights are already available on mount
    if ((window as any).llmInsights?.blunder_analysis?.insights) {
      console.log('Blunder insights already available on mount');
      setLlmInsights((window as any).llmInsights.blunder_analysis.insights);
      setInsightsLoading(false);
      return;
    }

    // If we have enriched games and a report ID, fetch insights
    if (enrichedGames && enrichedGames.length > 0 && reportId) {
      console.log('Fetching blunder insights for existing report...');
      fetchLlmInsights();
    }

    // Listen for streaming insights
    const handleLlmInsightsReady = () => {
      if ((window as any).llmInsights?.blunder_analysis?.insights) {
        console.log('Blunder insights ready event received');
        setLlmInsights((window as any).llmInsights.blunder_analysis.insights);
        setInsightsLoading(false);
      }
    };

    window.addEventListener('llmInsightsReady', handleLlmInsightsReady);

    return () => {
      window.removeEventListener('llmInsightsReady', handleLlmInsightsReady);
    };
  }, []);

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
    const whitePlayer = blunder.gameData.players?.white?.user?.name || 'Unknown';
    const blackPlayer = blunder.gameData.players?.black?.user?.name || 'Unknown';

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

      // Extract player names from enriched game format
      const whitePlayer = game.players?.white?.user?.name || 'Unknown';
      const blackPlayer = game.players?.black?.user?.name || 'Unknown';

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
    if (allBlunders.length === 0) {
      setSelectedBlunder(null);
      return;
    }

    // If no blunder is selected, select the first one
    if (!selectedBlunder) {
      setSelectedBlunder(allBlunders[0]);
      return;
    }

    // Check if the currently selected blunder still exists in the new list
    // by comparing the blunder key instead of object reference
    const selectedBlunderKey = getBlunderKey(selectedBlunder);
    const stillExists = allBlunders.some(b => getBlunderKey(b) === selectedBlunderKey);

    if (!stillExists) {
      // If the currently selected blunder is no longer in the list (due to filtering),
      // select the first one
      setSelectedBlunder(allBlunders[0]);
    }
    // If it still exists, keep the current selection (don't update state unnecessarily)
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
      {/* AI Insights Section */}
      <div
        style={{
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
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
            Waiting for analysis to complete...
          </div>
        )}
      </div>

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
