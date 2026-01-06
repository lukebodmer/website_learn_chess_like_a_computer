import React, { useState } from 'react'
import BaseChessBoard from './base-chess-board'
import { useChessGame } from '../hooks/useChessGame'

export interface PlayableChessBoardProps {
  size?: number
  initialFen?: string
  pieceTheme?: string
  orientation?: 'white' | 'black'
  coordinates?: boolean
  showGameEndSymbols?: boolean
  showCheckHighlight?: boolean
  animationDuration?: number
  onMove?: (move: any, fen: string) => void
  onGameEnd?: (result: any) => void
}

const PlayableChessBoard: React.FC<PlayableChessBoardProps> = ({
  size = 400,
  initialFen,
  pieceTheme,
  orientation = 'white',
  coordinates = true,
  showGameEndSymbols = true,
  showCheckHighlight = true,
  animationDuration = 300,
  onMove,
  onGameEnd
}) => {
  const [promotionData, setPromotionData] = useState<{
    from: string,
    to: string,
    color: 'w' | 'b'
  } | null>(null)

  const [draggedSquare, setDraggedSquare] = useState<string | null>(null)
  const [dragLegalMoves, setDragLegalMoves] = useState<string[]>([])

  const {
    position,
    selectedSquare,
    legalMoves,
    lastMove,
    makeMove,
    handleSquareClick,
    handlePieceDrag,
    getCurrentTurn,
    getLegalMovesForSquare,
    animationData,
    handleAnimationComplete,
    gameResult,
    chess
  } = useChessGame({
    initialFen,
    onMove,
    onGameEnd
  })

  // Handle promotion
  const handlePromotion = (promotionPiece: 'q' | 'r' | 'b' | 'n') => {
    if (!promotionData) return

    const success = makeMove(promotionData.from, promotionData.to, promotionPiece)
    if (success) {
      setPromotionData(null)
    }
  }

  // Enhanced square click handler that includes promotion logic
  const handleSquareClickWithPromotion = (square: string) => {
    if (selectedSquare) {
      const piece = chess.get(selectedSquare)

      // Check for pawn promotion
      if (piece && piece.type === 'p') {
        const toRank = parseInt(square[1])
        const isPromotion = (piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)

        if (isPromotion) {
          // Test if move is legal
          try {
            const testChess = chess.fen()
            const testMove = chess.move({ from: selectedSquare, to: square, promotion: 'q' })
            if (testMove) {
              chess.undo() // Undo the test move
              setPromotionData({ from: selectedSquare, to: square, color: piece.color })
              return
            }
          } catch (error) {
            // Move not legal, continue with normal flow
          }
        }
      }
    }

    handleSquareClick(square)
  }

  // Enhanced drag handler that includes promotion logic
  const handlePieceDragWithPromotion = (from: string, to: string): boolean => {
    const piece = chess.get(from)

    // Check for pawn promotion
    if (piece && piece.type === 'p') {
      const toRank = parseInt(to[1])
      const isPromotion = (piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)

      if (isPromotion) {
        setPromotionData({ from, to, color: piece.color })
        return false // Don't animate yet, wait for promotion choice
      }
    }

    return handlePieceDrag(from, to)
  }

  // Handle drag start to show legal moves
  const handleDragStart = (square: string) => {
    setDraggedSquare(square)
    const moves = getLegalMovesForSquare(square)
    setDragLegalMoves(moves)
  }

  // Handle drag end to clear legal moves
  const handleDragEnd = () => {
    setDraggedSquare(null)
    setDragLegalMoves([])
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <BaseChessBoard
        size={size}
        position={position}
        pieceTheme={pieceTheme}
        orientation={orientation}
        coordinates={coordinates}
        interactive={!promotionData} // Disable interaction during promotion
        selectedSquare={draggedSquare || selectedSquare}
        legalMoves={draggedSquare ? dragLegalMoves : legalMoves}
        lastMove={lastMove}
        currentTurn={getCurrentTurn()}
        gameResult={gameResult}
        animationData={animationData}
        showGameEndSymbols={showGameEndSymbols}
        showCheckHighlight={showCheckHighlight}
        onSquareClick={handleSquareClickWithPromotion}
        onPieceDrag={handlePieceDragWithPromotion}
        onPieceDragStart={handleDragStart}
        onPieceDragEnd={handleDragEnd}
        onAnimationComplete={handleAnimationComplete}
        animationDuration={animationDuration}
      />

      {/* Promotion Popup */}
      {promotionData && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10
          }}
        >
          <div style={{
            color: 'white',
            fontSize: `${size / 25}px`,
            marginBottom: `${size / 40}px`,
            textAlign: 'center'
          }}>
            Choose promotion piece:
          </div>
          <div style={{ display: 'flex', gap: `${size * 0.02}px` }}>
            {['q', 'r', 'b', 'n'].map((piece) => (
              <button
                key={piece}
                onClick={() => handlePromotion(piece as 'q' | 'r' | 'b' | 'n')}
                style={{
                  width: `${size * 0.12}px`,
                  height: `${size * 0.12}px`,
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(200, 200, 200, 0.5)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `${size * 0.006}px`
                }}
              >
                <img
                  src={`${pieceTheme || '/static/images/chesspieces/default/'}${promotionData.color}${piece.toUpperCase()}.svg`}
                  alt={piece}
                  style={{
                    width: '100%',
                    height: '100%',
                    imageRendering: 'crisp-edges'
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayableChessBoard