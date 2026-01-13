import React, { useState, useEffect } from 'react'
import BaseChessBoard from './base-chess-board'
import { Chess } from 'chess.js'

// Helper to normalize incomplete FEN strings from Lichess puzzles
// Lichess FENs often only have 4 fields, but chess.js requires all 6
const normalizeFEN = (fen: string): string => {
  const parts = fen.trim().split(' ')
  if (parts.length === 6) return fen // Already complete

  // Add missing fields: halfmove clock (0) and fullmove number (1)
  while (parts.length < 6) {
    if (parts.length === 4) parts.push('0') // halfmove clock
    else if (parts.length === 5) parts.push('1') // fullmove number
  }

  return parts.join(' ')
}

export interface CustomPuzzlesProps {
  puzzles: Array<{
    puzzle_id: string
    fen: string
    moves: string
    rating: number
    themes: string
  }>
  size?: number
  pieceTheme?: string
}

interface PuzzleState {
  status: 'ready' | 'solving' | 'solved' | 'failed'
  currentMoveIndex: number
  userMoves: string[]
  showHint: boolean
}

const CustomPuzzles: React.FC<CustomPuzzlesProps> = ({
  puzzles,
  size = 400,
  pieceTheme
}) => {
  console.log('🧩 CustomPuzzles component rendering with', puzzles.length, 'puzzles')

  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0)
  const [chess] = useState(() => new Chess())
  // Initialize position with first puzzle's FEN if available
  const [position, setPosition] = useState<string>(() => {
    if (puzzles.length > 0 && puzzles[0].fen) {
      return normalizeFEN(puzzles[0].fen)
    }
    return ''
  })
  const [puzzleState, setPuzzleState] = useState<PuzzleState>({
    status: 'ready',
    currentMoveIndex: 0,
    userMoves: [],
    showHint: false
  })
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [legalMoves, setLegalMoves] = useState<string[]>([])
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null)
  const [pendingPositionUpdate, setPendingPositionUpdate] = useState<string | null>(null)
  const [pendingStateUpdate, setPendingStateUpdate] = useState<any>(null)
  const [solvedPuzzles, setSolvedPuzzles] = useState<Set<number>>(new Set())

  const currentPuzzle = puzzles[currentPuzzleIndex]
  console.log('🧩 Current puzzle:', currentPuzzle)

  // Load current puzzle
  useEffect(() => {
    console.log('🧩 Loading puzzle effect, currentPuzzle:', currentPuzzle)
    if (currentPuzzle) {
      const normalizedFEN = normalizeFEN(currentPuzzle.fen)
      console.log('🧩 Normalized FEN:', normalizedFEN)
      chess.load(normalizedFEN)
      setPosition(normalizedFEN)
      setPuzzleState({
        status: 'ready',
        currentMoveIndex: 0,
        userMoves: [],
        showHint: false
      })
      setSelectedSquare(null)
      setLegalMoves([])
      setAnimationData(null)
      setPendingPositionUpdate(null)
      setPendingStateUpdate(null)
    }
  }, [currentPuzzleIndex, currentPuzzle, chess])

  // Parse solution moves from UCI format
  const getSolutionMoves = (): string[] => {
    if (!currentPuzzle?.moves) return []

    try {
      const normalizedFEN = normalizeFEN(currentPuzzle.fen)
      const tempChess = new Chess(normalizedFEN)
      const uciMoves = currentPuzzle.moves.split(' ')
      const sanMoves: string[] = []

      for (const uciMove of uciMoves) {
        if (!uciMove) continue

        try {
          // Parse UCI move (e.g., "e2e4")
          const from = uciMove.substring(0, 2)
          const to = uciMove.substring(2, 4)
          const promotion = uciMove.length > 4 ? uciMove[4] : undefined

          const move = tempChess.move({
            from,
            to,
            promotion
          })

          if (move) {
            sanMoves.push(move.san)
          }
        } catch (e) {
          console.error('Error parsing move:', uciMove, e)
          break
        }
      }

      return sanMoves
    } catch (error) {
      console.error('Error parsing solution:', error)
      return []
    }
  }

  const handleSquareClick = (square: string) => {
    if (puzzleState.status !== 'ready' && puzzleState.status !== 'solving') return

    const piece = chess.get(square)
    const playerColor = chess.turn()

    if (selectedSquare) {
      if (selectedSquare === square) {
        // Deselect
        setSelectedSquare(null)
        setLegalMoves([])
      } else {
        // Try to make a move
        try {
          const movingPiece = chess.get(selectedSquare)
          if (!movingPiece) return

          // Get solution moves
          const solutionMoves = getSolutionMoves()

          // Try the move
          const testMove = chess.move({ from: selectedSquare, to: square })
          if (testMove) {
            const isCorrect = solutionMoves[puzzleState.currentMoveIndex] === testMove.san

            if (isCorrect) {
              // Correct move - animate it
              setAnimationData({
                piece: movingPiece,
                from: selectedSquare,
                to: square
              })

              const newPosition = chess.fen()
              setPendingPositionUpdate(newPosition)

              const newUserMoves = [...puzzleState.userMoves, testMove.san]
              const newMoveIndex = puzzleState.currentMoveIndex + 1

              setPendingStateUpdate({
                type: 'userMove',
                data: {
                  status: 'solving',
                  userMoves: newUserMoves,
                  currentMoveIndex: newMoveIndex,
                  isCorrect: true,
                  solutionMoves,
                  nextMoveIndex: newMoveIndex
                }
              })
            } else {
              // Incorrect move - undo and animate back
              chess.undo()

              setPuzzleState(prev => ({
                ...prev,
                status: 'failed'
              }))

              setAnimationData({
                piece: movingPiece,
                from: square,
                to: selectedSquare
              })

              setPendingStateUpdate({
                type: 'puzzleState',
                data: { status: 'ready' }
              })
            }

            setSelectedSquare(null)
            setLegalMoves([])
          } else {
            // Invalid move, try to select new piece
            if (piece && piece.color === playerColor) {
              setSelectedSquare(square)
              const moves = chess.moves({ square, verbose: true })
              setLegalMoves(moves.map(move => move.to))
            } else {
              setSelectedSquare(null)
              setLegalMoves([])
            }
          }
        } catch (error) {
          // Move failed, try to select new piece
          if (piece && piece.color === playerColor) {
            setSelectedSquare(square)
            const moves = chess.moves({ square, verbose: true })
            setLegalMoves(moves.map(move => move.to))
          } else {
            setSelectedSquare(null)
            setLegalMoves([])
          }
        }
      }
    } else {
      // Select piece if valid
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square)
        const moves = chess.moves({ square, verbose: true })
        setLegalMoves(moves.map(move => move.to))
      }
    }
  }

  const handleAnimationComplete = () => {
    setAnimationData(null)

    if (pendingPositionUpdate) {
      setPosition(pendingPositionUpdate)
      setPendingPositionUpdate(null)
    }

    if (pendingStateUpdate) {
      if (pendingStateUpdate.type === 'puzzleState') {
        setPuzzleState(prev => ({ ...prev, ...pendingStateUpdate.data }))
      } else if (pendingStateUpdate.type === 'userMove') {
        const data = pendingStateUpdate.data
        setPuzzleState(prev => ({
          ...prev,
          status: data.status,
          userMoves: data.userMoves,
          currentMoveIndex: data.currentMoveIndex
        }))

        if (data.isCorrect) {
          if (data.nextMoveIndex >= data.solutionMoves.length) {
            // Puzzle solved!
            setPuzzleState(prev => ({ ...prev, status: 'solved' }))
            setSolvedPuzzles(prev => new Set([...prev, currentPuzzleIndex]))
          } else {
            // Auto-play opponent's response
            const nextMoveIndex = data.nextMoveIndex
            if (nextMoveIndex < data.solutionMoves.length) {
              const opponentMove = data.solutionMoves[nextMoveIndex]

              setTimeout(() => {
                try {
                  const tempChess = new Chess(chess.fen())
                  const moveObj = tempChess.move(opponentMove)
                  if (!moveObj) return

                  const opponentPiece = chess.get(moveObj.from)
                  if (!opponentPiece) return

                  const opponentMoveResult = chess.move(opponentMove)
                  if (!opponentMoveResult) return

                  setAnimationData({
                    piece: opponentPiece,
                    from: moveObj.from,
                    to: moveObj.to
                  })

                  const updatedPosition = chess.fen()
                  setPendingPositionUpdate(updatedPosition)
                  setPendingStateUpdate({
                    type: 'puzzleState',
                    data: {
                      currentMoveIndex: nextMoveIndex + 1,
                      userMoves: [...data.userMoves, opponentMove],
                      status: nextMoveIndex + 1 >= data.solutionMoves.length ? 'solved' : 'ready'
                    }
                  })
                } catch (error) {
                  console.error('Error playing opponent move:', error)
                }
              }, 600)
            }
          }
        }
      }
      setPendingStateUpdate(null)
    }
  }

  const resetPuzzle = () => {
    if (currentPuzzle) {
      const normalizedFEN = normalizeFEN(currentPuzzle.fen)
      chess.load(normalizedFEN)
      setPosition(normalizedFEN)
      setPuzzleState({
        status: 'ready',
        currentMoveIndex: 0,
        userMoves: [],
        showHint: false
      })
      setSelectedSquare(null)
      setLegalMoves([])
      setAnimationData(null)
      setPendingPositionUpdate(null)
      setPendingStateUpdate(null)
    }
  }

  const nextPuzzle = () => {
    if (currentPuzzleIndex < puzzles.length - 1) {
      setCurrentPuzzleIndex(prev => prev + 1)
    }
  }

  const previousPuzzle = () => {
    if (currentPuzzleIndex > 0) {
      setCurrentPuzzleIndex(prev => prev - 1)
    }
  }

  const showHint = () => {
    const solutionMoves = getSolutionMoves()
    if (solutionMoves.length > puzzleState.currentMoveIndex) {
      setPuzzleState(prev => ({ ...prev, showHint: true }))
    }
  }

  const getStatusMessage = () => {
    switch (puzzleState.status) {
      case 'ready':
        return chess.turn() === 'w' ? 'White to move' : 'Black to move'
      case 'solving':
        return 'Good move! Continue...'
      case 'solved':
        return '🎉 Puzzle solved! Great job!'
      case 'failed':
        return '❌ Not quite right. Try again!'
      default:
        return ''
    }
  }

  if (!puzzles || puzzles.length === 0) {
    console.log('🧩 No puzzles, returning empty state')
    return (
      <div className="empty-state" style={{
        padding: '40px',
        textAlign: 'center',
        background: 'var(--background-primary)',
        borderRadius: '12px',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '15px' }}>🧩</div>
        <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
          No puzzles available
        </div>
        <div style={{ fontSize: '14px' }}>
          Generate an analysis report to get personalized training puzzles
        </div>
      </div>
    )
  }

  console.log('🧩 Rendering puzzle UI, position:', position)

  // Don't render if position isn't loaded yet
  if (!position) {
    return (
      <div className="puzzle-loading" style={{
        padding: '40px',
        textAlign: 'center',
        background: 'var(--background-primary)',
        borderRadius: '12px'
      }}>
        <div className="loading-spinner" style={{ margin: '0 auto 15px' }}></div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Loading puzzle...
        </div>
      </div>
    )
  }

  const themes = currentPuzzle.themes.split(' ').slice(0, 3)
  const progress = `${currentPuzzleIndex + 1} / ${puzzles.length}`
  const solvedCount = solvedPuzzles.size

  return (
    <div className="puzzle-column" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '15px',
      maxWidth: '100%'
    }}>
      {/* Description */}
      <div style={{
        width: '100%',
        maxWidth: '600px',
        textAlign: 'center',
        padding: '15px 20px',
        background: 'var(--background-primary)',
        borderRadius: '8px',
        marginBottom: '10px'
      }}>
        <p style={{
          color: 'var(--text-secondary)',
          margin: 0,
          fontSize: '14px',
          lineHeight: '1.6'
        }}>
          Practice 1000 puzzles personalized to your weaknesses. These puzzles are specifically selected based on your principle analysis to help you improve where you need it most.
        </p>
      </div>

      {/* Header */}
      <div style={{
        width: '100%',
        maxWidth: '500px',
        textAlign: 'center'
      }}>
        <div className="puzzle-info" style={{
          marginBottom: '15px'
        }}>
          <div className="puzzle-title" style={{
            fontSize: '1.2em',
            marginBottom: '8px'
          }}>
            Puzzle {currentPuzzleIndex + 1} of {puzzles.length}
          </div>
          <div className="puzzle-status" style={{
            marginBottom: '8px'
          }}>
            Rating: {currentPuzzle.rating} • Solved: {solvedCount}/{puzzles.length}
          </div>
        </div>
        <div style={{
          display: 'flex',
          gap: '6px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginBottom: '10px'
        }}>
          {themes.map((theme, i) => (
            <span key={i} style={{
              display: 'inline-block',
              padding: '4px 10px',
              background: 'var(--background-tertiary)',
              color: 'var(--text-secondary)',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500
            }}>
              {theme}
            </span>
          ))}
        </div>
        <div className="puzzle-status" style={{
          fontSize: '14px',
          fontWeight: 600,
          color: puzzleState.status === 'solved' ? 'var(--success-color)' :
                 puzzleState.status === 'failed' ? 'var(--danger-color)' :
                 'var(--text-primary)',
          padding: '8px',
          background: puzzleState.status === 'solved' ? 'var(--success-background)' :
                     puzzleState.status === 'failed' ? '#f8d7da' :
                     'var(--background-primary)',
          borderRadius: '6px'
        }}>
          {getStatusMessage()}
        </div>
      </div>

      {/* Chess Board */}
      <BaseChessBoard
        size={size}
        position={position}
        pieceTheme={pieceTheme}
        orientation="white"
        coordinates={true}
        interactive={puzzleState.status === 'ready' || puzzleState.status === 'solving'}
        selectedSquare={selectedSquare}
        legalMoves={legalMoves}
        animationData={animationData}
        onSquareClick={handleSquareClick}
        onAnimationComplete={handleAnimationComplete}
      />

      {/* Controls */}
      <div className="puzzle-controls" style={{
        display: 'flex',
        gap: '10px',
        justifyContent: 'center',
        flexWrap: 'wrap',
        width: '100%',
        maxWidth: '500px'
      }}>
        <button
          className="btn"
          onClick={previousPuzzle}
          disabled={currentPuzzleIndex === 0}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            background: currentPuzzleIndex === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
            color: 'var(--text-on-primary)',
            border: 'none',
            borderRadius: '6px',
            cursor: currentPuzzleIndex === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            transition: 'all 0.2s ease',
            opacity: currentPuzzleIndex === 0 ? 0.5 : 1
          }}
        >
          ← Previous
        </button>

        <button
          className="btn"
          onClick={resetPuzzle}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            background: 'var(--text-secondary)',
            color: 'var(--text-on-primary)',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 600,
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--text-muted)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--text-secondary)'}
        >
          Reset
        </button>

        {puzzleState.status !== 'solved' && (
          <button
            className="btn"
            onClick={showHint}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              background: 'var(--info-color)',
              color: 'var(--text-on-primary)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            💡 Hint
          </button>
        )}

        <button
          className="btn btn-success"
          onClick={nextPuzzle}
          disabled={currentPuzzleIndex === puzzles.length - 1}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            background: currentPuzzleIndex === puzzles.length - 1 ? 'var(--text-muted)' : 'var(--success-color)',
            color: 'var(--text-on-primary)',
            border: 'none',
            borderRadius: '6px',
            cursor: currentPuzzleIndex === puzzles.length - 1 ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            transition: 'all 0.2s ease',
            opacity: currentPuzzleIndex === puzzles.length - 1 ? 0.5 : 1
          }}
        >
          Next →
        </button>
      </div>

      {/* Hint Display */}
      {puzzleState.showHint && (
        <div className="puzzle-feedback hint" style={{
          padding: '12px 20px',
          background: 'var(--background-primary)',
          border: '2px solid var(--info-color)',
          borderRadius: '8px',
          fontSize: '14px',
          textAlign: 'center',
          color: 'var(--text-primary)',
          width: '100%',
          maxWidth: '500px',
          fontWeight: 500
        }}>
          💡 Hint: {getSolutionMoves()[puzzleState.currentMoveIndex] || 'No more hints available'}
        </div>
      )}
    </div>
  )
}

export default CustomPuzzles
