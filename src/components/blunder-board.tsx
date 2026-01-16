import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import BaseChessBoard from './base-chess-board';
import { SendToBuddyBoardIcon } from './send-to-buddy-board-icon';

interface BlunderData {
  gameId: string;
  whitePlayer: string;
  blackPlayer: string;
  moveNumber: number;
  position: string; // FEN before the blunder move
  blunderMove: string;
  bestMove: string;
  evalBefore: number | null;
  evalAfter: number | null;
  mateBefore: number | null;
  mateAfter: number | null;
}

interface BlunderBoardProps {
  blunder: BlunderData | null;
  size?: number;
  isSolved?: boolean;
  onSolved?: () => void;
  onSendToBuddyBoard?: () => void;
  username?: string;
}

type PuzzleMode = 'viewing' | 'solving' | 'solved' | 'failed';

export const BlunderBoard: React.FC<BlunderBoardProps> = ({
  blunder,
  size = 400,
  isSolved = false,
  onSolved,
  onSendToBuddyBoard,
  username = ''
}) => {
  const [chess] = useState(() => new Chess());
  const [position, setPosition] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [highlightedSquares, setHighlightedSquares] = useState<{ square: string, color: string }[]>([]);
  const [arrows, setArrows] = useState<{ from: string, to: string, color: string }[]>([]);
  const [puzzleMode, setPuzzleMode] = useState<PuzzleMode>('viewing');
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null);
  const [pendingPositionUpdate, setPendingPositionUpdate] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0); // 0 = no hint, 1 = highlight piece, 2 = show arrow
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');

  // Reset to viewing mode when blunder changes
  useEffect(() => {
    if (!blunder) {
      setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      setHighlightedSquares([]);
      setArrows([]);
      setPuzzleMode('viewing');
      setSelectedSquare(null);
      setLegalMoves([]);
      setBoardOrientation('white');
      return;
    }

    // Determine board orientation based on which player the user is
    if (username) {
      const isBlackPlayer = blunder.blackPlayer.toLowerCase() === username.toLowerCase();
      setBoardOrientation(isBlackPlayer ? 'black' : 'white');
    } else {
      setBoardOrientation('white');
    }

    // Reset to viewing mode
    setPuzzleMode('viewing');
    setSelectedSquare(null);
    setLegalMoves([]);

    // Load position and make the blunder move to show the result
    chess.load(blunder.position);

    const highlights: { square: string, color: string }[] = [];

    // Try to make the blunder move to get the squares and show the result
    try {
      const move = chess.move(blunder.blunderMove);
      if (move) {
        // Show position AFTER the blunder
        setPosition(chess.fen());
        // Highlight the blunder move in red
        highlights.push(
          { square: move.from, color: 'rgba(255, 0, 0, 0.4)' },
          { square: move.to, color: 'rgba(255, 0, 0, 0.4)' }
        );
      } else {
        console.error('Move returned null/undefined');
        setPosition(blunder.position);
      }
    } catch (error) {
      console.error('Error parsing blunder move:', blunder.blunderMove, error);
      setPosition(blunder.position);
    }

    setHighlightedSquares(highlights);
    setArrows([]);
  }, [blunder, chess, username]);

  const startPuzzleMode = () => {
    if (!blunder) return;

    // Load position before the blunder
    chess.load(blunder.position);
    setPosition(blunder.position);
    setHighlightedSquares([]);
    setArrows([]);
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintLevel(0);
    setPuzzleMode('solving');
  };

  const handleSquareClick = (square: string) => {
    // Left-click only works in solving mode for puzzle interaction
    if (puzzleMode !== 'solving') return;

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
            const isCorrect = testMove.san === blunder?.bestMove;

            if (isCorrect) {
              // Correct move - animate it
              setAnimationData({
                piece: movingPiece,
                from: selectedSquare,
                to: square
              });

              setPendingPositionUpdate(chess.fen());
              setPuzzleMode('solved');

              // Call the onSolved callback if provided
              if (onSolved) {
                onSolved();
              }
            } else {
              // Incorrect move - undo and show feedback
              chess.undo();
              setPuzzleMode('failed');

              // Reset after a delay
              setTimeout(() => {
                chess.load(blunder?.position || '');
                setPosition(blunder?.position || '');
                setPuzzleMode('solving');
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
      setPosition(pendingPositionUpdate);
      setPendingPositionUpdate(null);

      // Show the correct move with green highlights
      if (puzzleMode === 'solved' && blunder) {
        const tempChess = new Chess(blunder.position);
        const move = tempChess.move(blunder.bestMove);
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
    if (!blunder) return;

    // Reload the blunder position and show the blunder move
    chess.load(blunder.position);
    const move = chess.move(blunder.blunderMove);

    if (move) {
      setPosition(chess.fen());
      setHighlightedSquares([
        { square: move.from, color: 'rgba(255, 0, 0, 0.4)' },
        { square: move.to, color: 'rgba(255, 0, 0, 0.4)' }
      ]);
    }

    setArrows([]);
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintLevel(0);
    setPuzzleMode('viewing');
  };

  const showHint = () => {
    if (!blunder || puzzleMode !== 'solving') return;

    if (hintLevel === 0) {
      // First hint: highlight the piece to move
      const tempChess = new Chess(blunder.position);
      const move = tempChess.move(blunder.bestMove);
      if (move) {
        setHighlightedSquares([
          { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
        ]);
        setHintLevel(1);
      }
    } else if (hintLevel === 1) {
      // Second hint: show arrow to destination
      const tempChess = new Chess(blunder.position);
      const move = tempChess.move(blunder.bestMove);
      if (move) {
        setHighlightedSquares([
          { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
        ]);
        setArrows([
          { from: move.from, to: move.to, color: '#ffff00' }
        ]);
        setHintLevel(2);
      }
    }
  };

  if (!blunder) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        backgroundColor: 'var(--background-secondary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
        fontSize: '14px'
      }}>
        Select a blunder to view
      </div>
    );
  }

  const getEvalDisplay = () => {
    if (blunder.mateAfter !== null) {
      return `Mate in ${Math.abs(blunder.mateAfter)}`;
    }
    if (blunder.evalAfter !== null) {
      return `Eval: ${(blunder.evalAfter / 100).toFixed(2)}`;
    }
    return 'Game Over';
  };

  const getEvalBeforeDisplay = () => {
    if (blunder.mateBefore !== null) {
      return `Mate in ${Math.abs(blunder.mateBefore)}`;
    }
    if (blunder.evalBefore !== null) {
      return `Eval: ${(blunder.evalBefore / 100).toFixed(2)}`;
    }
    return 'Unknown';
  };

  const getStatusMessage = () => {
    switch (puzzleMode) {
      case 'viewing':
        return 'Viewing blunder move';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Info Display */}
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
          <div style={{ flex: 1, fontSize: '14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span><strong>Move {blunder.moveNumber}:</strong> {blunder.whitePlayer} vs {blunder.blackPlayer}</span>
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
          <button
            onClick={onSendToBuddyBoard}
            style={{
              width: '44px',
              height: '44px',
              padding: '6px',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--primary-color)',
              color: 'var(--text-on-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px var(--shadow-light)',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-color-dark, var(--primary-color))';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-color)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
            }}
            title="Send game to Buddy Board"
          >
            <SendToBuddyBoardIcon size={34} />
          </button>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <strong>Played:</strong> {blunder.blunderMove}
            <br />
            <strong>Before:</strong> {getEvalBeforeDisplay()}
          </div>
          <div>
            <strong>Best:</strong> {(puzzleMode === 'solved' || isSolved) ? blunder.bestMove : '???'}
            <br />
            <strong>After:</strong> {getEvalDisplay()}
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div style={{
        padding: '8px',
        backgroundColor: puzzleMode === 'solved' ? 'rgba(0, 255, 0, 0.1)' : puzzleMode === 'failed' ? 'rgba(255, 0, 0, 0.1)' : 'var(--background-primary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        textAlign: 'center',
        fontSize: '14px',
        fontWeight: '600',
        color: puzzleMode === 'solved' ? '#00aa00' : puzzleMode === 'failed' ? '#cc0000' : 'var(--text-primary)'
      }}>
        {getStatusMessage()}
      </div>

      {/* Chess Board */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        padding: '16px',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <BaseChessBoard
          size={size}
          position={position}
          orientation={boardOrientation}
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
        />
      </div>

      {/* Controls */}
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
              padding: '8px 16px',
              fontSize: '14px',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--primary-color)',
              color: 'var(--text-on-primary)',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px var(--shadow-light)'
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
                padding: '8px 16px',
                fontSize: '14px',
                border: '2px solid var(--border-color)',
                borderRadius: '6px',
                backgroundColor: hintLevel >= 2 ? 'var(--background-tertiary)' : 'var(--background-primary)',
                color: hintLevel >= 2 ? 'var(--text-muted)' : 'var(--primary-color)',
                cursor: hintLevel >= 2 ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                transition: 'all 0.2s ease',
                boxShadow: hintLevel >= 2 ? 'none' : '0 2px 4px var(--shadow-light)',
                opacity: hintLevel >= 2 ? 0.6 : 1
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
                padding: '8px 16px',
                fontSize: '14px',
                border: '2px solid var(--border-color)',
                borderRadius: '6px',
                backgroundColor: 'var(--background-primary)',
                color: 'var(--primary-color)',
                cursor: 'pointer',
                fontWeight: '600',
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
            >
              Back to Blunder
            </button>
          </>
        )}
        {(puzzleMode === 'solved' || puzzleMode === 'failed') && (
          <button
            onClick={resetToViewingMode}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--background-primary)',
              color: 'var(--primary-color)',
              cursor: 'pointer',
              fontWeight: '600',
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
          >
            Back to Blunder
          </button>
        )}
      </div>

    </div>
  );
};

export default BlunderBoard;
