import React, { useState, useEffect } from 'react'
import BaseChessBoard from './base-chess-board'
import { Chess } from 'chess.js'

export interface DailyPuzzleProps {
  size?: number
  pieceTheme?: string
}

interface PuzzleData {
  title: string
  fen: string
  pgn: string
  url?: string
  solution?: string[]
  publish_time?: number
  publish_datetime?: string
  source?: string
  fallback?: boolean
}

interface PuzzleState {
  status: 'loading' | 'ready' | 'solving' | 'solved' | 'failed' | 'error'
  currentMoveIndex: number
  userMoves: string[]
  showHint: boolean
}

const DailyPuzzle: React.FC<DailyPuzzleProps> = ({
  size = 320,
  pieceTheme
}) => {
  const [puzzleData, setPuzzleData] = useState<PuzzleData | null>(null)
  const [chess] = useState(() => new Chess())
  const [position, setPosition] = useState<string>('')
  const [puzzleState, setPuzzleState] = useState<PuzzleState>({
    status: 'loading',
    currentMoveIndex: 0,
    userMoves: [],
    showHint: false
  })
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [legalMoves, setLegalMoves] = useState<string[]>([])
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null)
  const [pendingPositionUpdate, setPendingPositionUpdate] = useState<string | null>(null)
  const [pendingStateUpdate, setPendingStateUpdate] = useState<any>(null)

  // Fetch daily puzzle data
  useEffect(() => {
    const fetchPuzzle = async () => {
      try {
        const response = await fetch('/api/daily-puzzle/?source=chess.com')
        if (!response.ok) {
          throw new Error('Failed to fetch puzzle')
        }

        const data = await response.json()
        if (data.success && data.puzzles['chess.com']) {
          const puzzle = data.puzzles['chess.com']
          setPuzzleData(puzzle)

          // Set up initial position
          chess.load(puzzle.fen)
          setPosition(puzzle.fen)
          setPuzzleState(prev => ({ ...prev, status: 'ready' }))
        } else {
          throw new Error('No puzzle data available')
        }
      } catch (error) {
        console.error('Error fetching daily puzzle:', error)
        setPuzzleState(prev => ({ ...prev, status: 'error' }))
      }
    }

    fetchPuzzle()
  }, [chess])

  // Parse solution moves from PGN
  const getSolutionMoves = (): string[] => {
    if (!puzzleData?.pgn) return []

    try {
      const tempChess = new Chess(puzzleData.fen)
      const moves: string[] = []

      // Extract moves from PGN
      const pgnMoves = puzzleData.pgn.match(/\d+\.\s*([a-zA-Z0-9+#=\-]+)(?:\s+([a-zA-Z0-9+#=\-]+))?/g)

      if (pgnMoves) {
        for (const moveText of pgnMoves) {
          const parts = moveText.replace(/\d+\.\s*/, '').split(/\s+/)

          for (const moveStr of parts) {
            if (moveStr && moveStr !== '1-0' && moveStr !== '0-1' && moveStr !== '1/2-1/2') {
              try {
                const move = tempChess.move(moveStr)
                if (move) {
                  moves.push(move.san)
                }
              } catch (e) {
                // Skip invalid moves
              }
            }
          }
        }
      }

      return moves
    } catch (error) {
      console.error('Error parsing solution:', error)
      return []
    }
  }

  const handleSquareClick = (square: string) => {
    if (puzzleState.status !== 'ready' && puzzleState.status !== 'solving') return

    const piece = chess.get(square)

    // Player should always move whoever's turn it is in the current position
    const playerColor = chess.turn()

    if (selectedSquare) {
      if (selectedSquare === square) {
        // Deselect
        setSelectedSquare(null)
        setLegalMoves([])
      } else {
        // Try to make a move
        try {
          // Get piece info before making move for animation
          const piece = chess.get(selectedSquare)
          if (!piece) return

          // Check if this move would be correct before making it
          const solutionMoves = getSolutionMoves()

          // Try the move to validate it
          const testMove = chess.move({ from: selectedSquare, to: square })
          if (testMove) {
            const isCorrect = solutionMoves[puzzleState.currentMoveIndex] === testMove.san

            if (isCorrect) {
              // Correct move - animate it
              setAnimationData({
                piece: piece,
                from: selectedSquare,
                to: square
              })

              // Prepare position update for after animation
              const newPosition = chess.fen()
              setPendingPositionUpdate(newPosition)

              const newUserMoves = [...puzzleState.userMoves, testMove.san]
              const newMoveIndex = puzzleState.currentMoveIndex + 1

              // Prepare state update for after animation
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

              // Animate piece back
              setAnimationData({
                piece: piece,
                from: square,
                to: selectedSquare
              })

              // Set ready state after animation
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

    // Apply any pending position update
    if (pendingPositionUpdate) {
      setPosition(pendingPositionUpdate)
      setPendingPositionUpdate(null)
    }

    // Apply any pending state update
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

        // Handle move validation and opponent response
        if (data.isCorrect) {
          // Correct move
          if (data.nextMoveIndex >= data.solutionMoves.length) {
            // Puzzle solved!
            setPuzzleState(prev => ({ ...prev, status: 'solved' }))
          } else {
            // Auto-play opponent's response if available
            const nextMoveIndex = data.nextMoveIndex
            if (nextMoveIndex < data.solutionMoves.length) {
              const opponentMove = data.solutionMoves[nextMoveIndex]

              // Delay opponent's move slightly for better UX
              setTimeout(() => {
                try {
                  // Get piece and move info BEFORE making the move
                  const tempChess = new Chess(chess.fen())
                  const moveObj = tempChess.move(opponentMove)
                  if (!moveObj) return

                  const opponentPiece = chess.get(moveObj.from)
                  if (!opponentPiece) return

                  // Make the chess move
                  const opponentMoveResult = chess.move(opponentMove)
                  if (!opponentMoveResult) return

                  // Start animation and prepare position/state updates for callback
                  setAnimationData({
                    piece: opponentPiece,
                    from: moveObj.from,
                    to: moveObj.to
                  })

                  // Prepare updates to be applied when animation completes
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
    if (puzzleData) {
      chess.load(puzzleData.fen)
      setPosition(puzzleData.fen)
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

  const showHint = () => {
    const solutionMoves = getSolutionMoves()
    if (solutionMoves.length > puzzleState.currentMoveIndex) {
      setPuzzleState(prev => ({ ...prev, showHint: true }))
    }
  }

  const getStatusMessage = () => {
    switch (puzzleState.status) {
      case 'loading':
        return 'Loading daily puzzle...'
      case 'ready':
        return chess.turn() === 'w' ? 'White to move' : 'Black to move'
      case 'solving':
        return 'Good move! Continue...'
      case 'solved':
        return '🎉 Puzzle solved! Great job!'
      case 'failed':
        return '❌ Not quite right. Try again!'
      case 'error':
        return 'Failed to load puzzle. Please try again later.'
      default:
        return ''
    }
  }

  if (puzzleState.status === 'loading') {
    return (
      <div style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f0f0',
        borderRadius: '8px'
      }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          Loading daily puzzle...
        </div>
      </div>
    )
  }

  if (puzzleState.status === 'error') {
    return (
      <div style={{
        width: `${size}px`,
        padding: '20px',
        textAlign: 'center',
        background: '#f0f0f0',
        borderRadius: '8px',
        border: '1px solid #ddd'
      }}>
        <div style={{ color: '#666', marginBottom: '10px' }}>
          Failed to load daily puzzle
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 16px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div style={{
      display: 'inline-block'
    }}>
      {/* Header */}
      <div style={{
        marginBottom: '12px',
        textAlign: 'center'
      }}>
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '18px',
          color: '#333',
          fontWeight: 600
        }}>
          Chess.com
        </h3>
        <div style={{
          fontSize: '13px',
          color: 'white',
          fontWeight: 500
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
      <div style={{
        marginTop: '12px',
        display: 'flex',
        gap: '8px',
        justifyContent: 'center'
      }}>
        <button
          onClick={resetPuzzle}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            background: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Reset
        </button>

        {puzzleState.status !== 'solved' && (
          <button
            onClick={showHint}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              background: '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Hint
          </button>
        )}

      </div>

      {/* Hint Display */}
      {puzzleState.showHint && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          background: '#e9ecef',
          borderRadius: '4px',
          fontSize: '12px',
          textAlign: 'center',
          color: '#495057'
        }}>
          💡 Hint: {getSolutionMoves()[puzzleState.currentMoveIndex] || 'No more hints available'}
        </div>
      )}
    </div>
  )
}

export default DailyPuzzle