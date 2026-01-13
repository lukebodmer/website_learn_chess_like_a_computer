import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import BaseChessBoard from './base-chess-board';

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
}

type PuzzleMode = 'viewing' | 'solving' | 'solved' | 'failed';

export const BlunderBoard: React.FC<BlunderBoardProps> = ({
  blunder,
  size = 400
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

  // Reset to viewing mode when blunder changes
  useEffect(() => {
    if (!blunder) {
      setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      setHighlightedSquares([]);
      setArrows([]);
      setPuzzleMode('viewing');
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
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
      console.log('Attempting to parse blunder move:', blunder.blunderMove, 'from position:', blunder.position);
      const move = chess.move(blunder.blunderMove);
      if (move) {
        console.log('Blunder move parsed successfully:', move);
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
  }, [blunder, chess]);

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
        backgroundColor: 'var(--background-secondary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '8px' }}>
          <strong>Move {blunder.moveNumber}:</strong> {blunder.whitePlayer} vs {blunder.blackPlayer}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <strong>Played:</strong> {blunder.blunderMove}
            <br />
            <strong>Before:</strong> {getEvalBeforeDisplay()}
          </div>
          <div>
            <strong>Best:</strong> {puzzleMode === 'viewing' ? '???' : blunder.bestMove}
            <br />
            <strong>After:</strong> {getEvalDisplay()}
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div style={{
        padding: '8px',
        backgroundColor: puzzleMode === 'solved' ? 'rgba(0, 255, 0, 0.1)' : puzzleMode === 'failed' ? 'rgba(255, 0, 0, 0.1)' : 'var(--background-secondary)',
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
      <BaseChessBoard
        size={size}
        position={position}
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
      />

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
              backgroundColor: '#4a9eff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600'
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
                backgroundColor: hintLevel >= 2 ? '#cccccc' : '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: hintLevel >= 2 ? 'not-allowed' : 'pointer',
                fontWeight: '600'
              }}
            >
              Hint {hintLevel > 0 ? `(${hintLevel}/2)` : ''}
            </button>
            <button
              onClick={resetToViewingMode}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600'
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
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Back to Blunder
          </button>
        )}
      </div>

      {/* Legend */}
      <div style={{
        padding: '8px',
        backgroundColor: 'var(--background-secondary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        display: 'flex',
        gap: '16px',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>Right-click to highlight/draw arrows</span>
        </div>
        {puzzleMode === 'viewing' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', backgroundColor: 'rgba(255, 0, 0, 0.4)', border: '1px solid #999' }}></div>
            <span>Blunder Move</span>
          </div>
        )}
        {puzzleMode === 'solved' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', backgroundColor: 'rgba(0, 255, 0, 0.4)', border: '1px solid #999' }}></div>
            <span>Best Move</span>
          </div>
        )}
        {puzzleMode === 'solving' && hintLevel > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', backgroundColor: 'rgba(255, 255, 0, 0.5)', border: '1px solid #999' }}></div>
            <span>Hint</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlunderBoard;
