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
  selectedPrinciple?: string | null
}

interface PuzzleState {
  status: 'ready' | 'solving' | 'solved' | 'failed'
  currentMoveIndex: number
  userMoves: string[]
  showHint: boolean
}

// Mapping of principle areas to puzzle themes (must match backend)
const PRINCIPLE_THEME_MAPPING: { [key: string]: string[] } = {
  'opening_awareness': ['opening', 'advancedPawn', 'kingsideAttack', 'queensideAttack', 'attackingF2F7'],
  'middlegame_planning': ['middlegame', 'kingsideAttack', 'queensideAttack', 'clearance', 'quietMove', 'sacrifice'],
  'endgame_technique': ['endgame', 'pawnEndgame', 'knightEndgame', 'bishopEndgame', 'rookEndgame', 'queenEndgame', 'queenRookEndgame', 'promotion', 'underPromotion'],
  'king_safety': ['exposedKing', 'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate', 'dovetailMate', 'cornerMate', 'hookMate', 'operaMate', 'balestraMate', 'blindSwineMate', 'pillsburysMate', 'morphysMate', 'triangleMate', 'vukovicMate', 'killBoxMate'],
  'checkmate_ability': ['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate', 'dovetailMate'],
  'tactics_vision': ['fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck', 'doubleCheck', 'hangingPiece', 'trappedPiece', 'capturingDefender', 'attraction', 'deflection', 'clearance', 'interference', 'xRayAttack'],
  'defensive_skill': ['defensiveMove', 'equality', 'quietMove', 'intermezzo', 'zugzwang'],
  'big_picture': ['hangingPiece', 'trappedPiece', 'capturingDefender', 'advantage', 'crushing'],
  'precision_move_quality': ['quietMove', 'advantage', 'defensiveMove', 'clearance', 'intermezzo'],
  'planning_calculating': ['quietMove', 'long', 'veryLong', 'sacrifice', 'clearance', 'intermezzo'],
  'time_management': ['short', 'oneMove', 'mateIn1', 'mateIn2']
};

const CustomPuzzles: React.FC<CustomPuzzlesProps> = ({
  puzzles,
  size = 400,
  pieceTheme,
  selectedPrinciple = null
}) => {

  // Filter puzzles based on selected principle
  const filteredPuzzles = React.useMemo(() => {
    if (!selectedPrinciple) {
      return puzzles;
    }

    const themesForPrinciple = PRINCIPLE_THEME_MAPPING[selectedPrinciple] || [];
    if (themesForPrinciple.length === 0) {
      return puzzles;
    }

    return puzzles.filter(puzzle => {
      const puzzleThemes = puzzle.themes.split(' ');
      return puzzleThemes.some(theme => themesForPrinciple.includes(theme));
    });
  }, [puzzles, selectedPrinciple]);

  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0)
  const [chess] = useState(() => new Chess())
  // Initialize position with first puzzle's FEN if available
  const [position, setPosition] = useState<string>(() => {
    if (filteredPuzzles.length > 0 && filteredPuzzles[0].fen) {
      return normalizeFEN(filteredPuzzles[0].fen)
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
  const [lastMoveSquares, setLastMoveSquares] = useState<{ from: string, to: string } | null>(null)
  const [hintLevel, setHintLevel] = useState<number>(0) // 0 = no hint, 1 = highlight piece, 2 = show arrow
  const [highlightedSquares, setHighlightedSquares] = useState<{ square: string, color: string }[]>([])
  const [arrows, setArrows] = useState<{ from: string, to: string, color: string }[]>([])

  // Reset puzzle index when filter changes
  React.useEffect(() => {
    setCurrentPuzzleIndex(0);
  }, [selectedPrinciple]);

  const currentPuzzle = filteredPuzzles[currentPuzzleIndex]

  // Parse solution moves from UCI format - defined before useEffect
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

  // Load current puzzle
  useEffect(() => {
    if (currentPuzzle) {
      const normalizedFEN = normalizeFEN(currentPuzzle.fen)
      chess.load(normalizedFEN)

      // Get solution moves to check if we need to play opponent's first move
      const solutionMoves = getSolutionMoves()

      // If there are solution moves and the first move is the opponent's move,
      // we need to play it to set up the puzzle correctly
      if (solutionMoves.length > 0) {
        try {
          // Make the opponent's first move
          const firstMove = chess.move(solutionMoves[0])
          if (firstMove) {
            setPosition(chess.fen())
            // Highlight the last move (opponent's move)
            setLastMoveSquares({
              from: firstMove.from,
              to: firstMove.to
            })
            setPuzzleState({
              status: 'ready',
              currentMoveIndex: 1, // Start from index 1 since opponent played move 0
              userMoves: [solutionMoves[0]],
              showHint: false
            })
          } else {
            // If first move failed, just use the position as-is
            setPosition(normalizedFEN)
            setLastMoveSquares(null)
            setPuzzleState({
              status: 'ready',
              currentMoveIndex: 0,
              userMoves: [],
              showHint: false
            })
          }
        } catch (e) {
          console.error('Error playing first move:', e)
          setPosition(normalizedFEN)
          setLastMoveSquares(null)
          setPuzzleState({
            status: 'ready',
            currentMoveIndex: 0,
            userMoves: [],
            showHint: false
          })
        }
      } else {
        setPosition(normalizedFEN)
        setLastMoveSquares(null)
        setPuzzleState({
          status: 'ready',
          currentMoveIndex: 0,
          userMoves: [],
          showHint: false
        })
      }

      setSelectedSquare(null)
      setLegalMoves([])
      setAnimationData(null)
      setPendingPositionUpdate(null)
      setPendingStateUpdate(null)
      setHintLevel(0)
      setHighlightedSquares([])
      setArrows([])
    }
  }, [currentPuzzleIndex, currentPuzzle, chess])

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
              // Correct move - clear hints and animate it
              setHintLevel(0)
              setHighlightedSquares([])
              setArrows([])

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

      // Get solution moves and play opponent's first move
      const solutionMoves = getSolutionMoves()
      if (solutionMoves.length > 0) {
        try {
          const firstMove = chess.move(solutionMoves[0])
          if (firstMove) {
            setPosition(chess.fen())
            setLastMoveSquares({
              from: firstMove.from,
              to: firstMove.to
            })
            setPuzzleState({
              status: 'ready',
              currentMoveIndex: 1,
              userMoves: [solutionMoves[0]],
              showHint: false
            })
          } else {
            setPosition(normalizedFEN)
            setLastMoveSquares(null)
            setPuzzleState({
              status: 'ready',
              currentMoveIndex: 0,
              userMoves: [],
              showHint: false
            })
          }
        } catch (e) {
          setPosition(normalizedFEN)
          setLastMoveSquares(null)
          setPuzzleState({
            status: 'ready',
            currentMoveIndex: 0,
            userMoves: [],
            showHint: false
          })
        }
      } else {
        setPosition(normalizedFEN)
        setLastMoveSquares(null)
        setPuzzleState({
          status: 'ready',
          currentMoveIndex: 0,
          userMoves: [],
          showHint: false
        })
      }

      setSelectedSquare(null)
      setLegalMoves([])
      setAnimationData(null)
      setPendingPositionUpdate(null)
      setPendingStateUpdate(null)
      setHintLevel(0)
      setHighlightedSquares([])
      setArrows([])
    }
  }

  const nextPuzzle = () => {
    if (currentPuzzleIndex < filteredPuzzles.length - 1) {
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
    if (solutionMoves.length <= puzzleState.currentMoveIndex) return

    const nextMove = solutionMoves[puzzleState.currentMoveIndex]

    if (hintLevel === 0) {
      // First hint: highlight the piece to move
      try {
        const tempChess = new Chess(chess.fen())
        const move = tempChess.move(nextMove)
        if (move) {
          setHighlightedSquares([
            { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
          ])
          setHintLevel(1)
          setPuzzleState(prev => ({ ...prev, showHint: true }))
        }
      } catch (e) {
        console.error('Error showing hint:', e)
      }
    } else if (hintLevel === 1) {
      // Second hint: show arrow to destination
      try {
        const tempChess = new Chess(chess.fen())
        const move = tempChess.move(nextMove)
        if (move) {
          setHighlightedSquares([
            { square: move.from, color: 'rgba(255, 255, 0, 0.5)' }
          ])
          setArrows([
            { from: move.from, to: move.to, color: '#ffff00' }
          ])
          setHintLevel(2)
        }
      } catch (e) {
        console.error('Error showing hint arrow:', e)
      }
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
    return (
      <div className="empty-state" style={{
        padding: '40px',
        textAlign: 'center',
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

  if (filteredPuzzles.length === 0) {
    return (
      <div className="empty-state" style={{
        padding: '40px',
        textAlign: 'center',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '15px' }}>🔍</div>
        <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
          No puzzles for this principle
        </div>
        <div style={{ fontSize: '14px' }}>
          Try selecting a different principle or view all puzzles
        </div>
      </div>
    )
  }

  // Don't render if position isn't loaded yet
  if (!position) {
    return (
      <div className="puzzle-loading" style={{
        padding: '40px',
        textAlign: 'center'
      }}>
        <div className="loading-spinner" style={{ margin: '0 auto 15px' }}></div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Loading puzzle...
        </div>
      </div>
    )
  }

  const solvedCount = solvedPuzzles.size

  return (
    <div className="puzzle-column" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      maxWidth: '100%'
    }}>
      {/* Header */}
      <div style={{
        width: '100%',
        maxWidth: '500px',
        padding: '12px',
        backgroundColor: 'var(--background-primary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        textAlign: 'center'
      }}>
        <div className="puzzle-title" style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          marginBottom: '4px'
        }}>
          Puzzle {currentPuzzleIndex + 1} of {filteredPuzzles.length}
        </div>
        <div className="puzzle-status" style={{
          fontSize: '13px',
          color: 'var(--text-secondary)'
        }}>
          Rating: {currentPuzzle.rating} • Solved: {solvedCount}/{filteredPuzzles.length}
        </div>
      </div>

      {/* Status Message */}
      <div style={{
        width: '100%',
        maxWidth: '500px',
        padding: '8px',
        backgroundColor: puzzleState.status === 'solved' ? 'rgba(0, 255, 0, 0.1)' : puzzleState.status === 'failed' ? 'rgba(255, 0, 0, 0.1)' : 'var(--background-primary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        textAlign: 'center',
        fontSize: '14px',
        fontWeight: '600',
        color: puzzleState.status === 'solved' ? '#00aa00' : puzzleState.status === 'failed' ? '#cc0000' : 'var(--text-primary)'
      }}>
        {getStatusMessage()}
      </div>

      {/* Chess Board */}
      <div style={{
        width: '100%',
        maxWidth: '500px',
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
          pieceTheme={pieceTheme}
          orientation="white"
          coordinates={true}
          interactive={puzzleState.status === 'ready' || puzzleState.status === 'solving'}
          selectedSquare={selectedSquare}
          legalMoves={legalMoves}
          highlightedSquares={highlightedSquares}
          arrows={arrows}
          lastMove={lastMoveSquares}
          animationData={animationData}
          onSquareClick={handleSquareClick}
          onAnimationComplete={handleAnimationComplete}
        />
      </div>

      {/* Controls */}
      <div className="puzzle-controls" style={{
        display: 'flex',
        gap: '8px',
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
            border: '2px solid var(--border-color)',
            borderRadius: '6px',
            backgroundColor: currentPuzzleIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-primary)',
            color: currentPuzzleIndex === 0 ? 'var(--text-muted)' : 'var(--primary-color)',
            cursor: currentPuzzleIndex === 0 ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            boxShadow: currentPuzzleIndex === 0 ? 'none' : '0 2px 4px var(--shadow-light)',
            opacity: currentPuzzleIndex === 0 ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (currentPuzzleIndex !== 0) {
              e.currentTarget.style.backgroundColor = 'var(--primary-color)';
              e.currentTarget.style.color = 'var(--text-on-primary)';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
            }
          }}
          onMouseLeave={(e) => {
            if (currentPuzzleIndex !== 0) {
              e.currentTarget.style.backgroundColor = 'var(--background-primary)';
              e.currentTarget.style.color = 'var(--primary-color)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
            }
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
          Reset
        </button>

        {puzzleState.status !== 'solved' && (
          <button
            className="btn"
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
        )}

        <button
          className="btn btn-success"
          onClick={nextPuzzle}
          disabled={currentPuzzleIndex === filteredPuzzles.length - 1}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            border: '2px solid var(--border-color)',
            borderRadius: '6px',
            backgroundColor: currentPuzzleIndex === filteredPuzzles.length - 1 ? 'var(--background-tertiary)' : 'var(--primary-color)',
            color: currentPuzzleIndex === filteredPuzzles.length - 1 ? 'var(--text-muted)' : 'var(--text-on-primary)',
            cursor: currentPuzzleIndex === filteredPuzzles.length - 1 ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            boxShadow: currentPuzzleIndex === filteredPuzzles.length - 1 ? 'none' : '0 2px 4px var(--shadow-light)',
            opacity: currentPuzzleIndex === filteredPuzzles.length - 1 ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (currentPuzzleIndex !== filteredPuzzles.length - 1) {
              e.currentTarget.style.backgroundColor = 'var(--primary-color-dark, var(--primary-color))';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)';
            }
          }}
          onMouseLeave={(e) => {
            if (currentPuzzleIndex !== filteredPuzzles.length - 1) {
              e.currentTarget.style.backgroundColor = 'var(--primary-color)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)';
            }
          }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default CustomPuzzles
