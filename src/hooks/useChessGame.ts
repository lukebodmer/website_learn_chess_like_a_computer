import { useState, useCallback, useRef } from 'react'
import { Chess } from 'chess.js'

export interface UseChessGameOptions {
  initialFen?: string
  onMove?: (move: any, fen: string) => void
  onGameEnd?: (result: any) => void
}

export const useChessGame = (options: UseChessGameOptions = {}) => {
  const { initialFen, onMove, onGameEnd } = options

  // Create chess instance
  const chessRef = useRef(new Chess(initialFen))
  const [position, setPosition] = useState(chessRef.current.fen())
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [legalMoves, setLegalMoves] = useState<string[]>([])
  const [moveHistory, setMoveHistory] = useState<any[]>([])
  const [gameResult, setGameResult] = useState<any>(null)
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null)
  const [pendingPositionUpdate, setPendingPositionUpdate] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<{ from: string, to: string } | null>(null)

  // Get legal moves for a square
  const getLegalMovesForSquare = useCallback((square: string): string[] => {
    const moves = chessRef.current.moves({ square, verbose: true })
    // Remove duplicates in case of pawn promotion
    const uniqueSquares = Array.from(new Set(moves.map(move => move.to)))
    return uniqueSquares
  }, [])

  // Check if piece can be selected
  const canSelectPiece = useCallback((piece: any): boolean => {
    if (!piece) return false
    const currentTurn = chessRef.current.turn()
    return piece.color === currentTurn
  }, [])

  // Make a move (skipTurnCheck allows AI to make moves)
  const makeMove = useCallback((from: string, to: string, promotion?: string, animate: boolean = true, skipTurnCheck: boolean = false): boolean => {
    try {
      const piece = chessRef.current.get(from)
      if (!piece || (!skipTurnCheck && !canSelectPiece(piece))) return false

      // Check for pawn promotion
      if (piece.type === 'p' && !promotion) {
        const toRank = parseInt(to[1])
        const isPromotion = (piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)

        if (isPromotion) {
          // Return false to indicate promotion is needed
          return false
        }
      }

      const moveData = promotion
        ? { from, to, promotion }
        : { from, to }

      // Get piece BEFORE making the move for animation
      const pieceToAnimate = chessRef.current.get(from)

      const move = chessRef.current.move(moveData)
      if (!move) return false

      const newFen = chessRef.current.fen()

      // Trigger animation using the original piece (only if animate is true)
      if (pieceToAnimate && animate) {
        setAnimationData({ piece: pieceToAnimate, from, to })
        // Store position update for when animation completes
        setPendingPositionUpdate(newFen)
      } else {
        // No animation needed, update position immediately
        setPosition(newFen)
      }
      setMoveHistory(prev => [...prev, move])
      setSelectedSquare(null)
      setLegalMoves([])
      setLastMove({ from, to })

      // Check for game end
      const result = getGameResult()
      if (result.gameOver) {
        setGameResult(result)
        if (onGameEnd) {
          onGameEnd(result)
        }
      }

      if (onMove) {
        onMove(move, newFen)
      }

      return true
    } catch (error) {
      console.error('Move failed:', error)
      return false
    }
  }, [canSelectPiece, onMove, onGameEnd])

  // Get game result
  const getGameResult = useCallback(() => {
    if (chessRef.current.isCheckmate()) {
      const currentTurn = chessRef.current.turn()
      const winner = currentTurn === 'w' ? 'b' : 'w'
      return { gameOver: true, winner, isCheckmate: true, isDraw: false }
    }

    // Check all draw conditions explicitly
    if (chessRef.current.isStalemate()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'stalemate' }
    }
    if (chessRef.current.isInsufficientMaterial()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'insufficient material' }
    }
    if (chessRef.current.isThreefoldRepetition()) {
      console.log('Threefold repetition detected in useChessGame!')
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'threefold repetition' }
    }
    // Check for fifty-move rule - first try the specific method, then fall back to general isDraw
    if (typeof chessRef.current.isDrawByFiftyMoves === 'function' && chessRef.current.isDrawByFiftyMoves()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'fifty-move rule' }
    }
    // General draw check (catches fifty-move rule if specific method doesn't exist)
    if (chessRef.current.isDraw()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'fifty-move rule or other draw' }
    }

    return { gameOver: false, winner: null, isCheckmate: false, isDraw: false }
  }, [])

  // Handle square click
  const handleSquareClick = useCallback((square: string) => {
    const piece = chessRef.current.get(square)

    if (selectedSquare) {
      if (selectedSquare === square) {
        // Deselect
        setSelectedSquare(null)
        setLegalMoves([])
      } else {
        // Try to make a move
        const success = makeMove(selectedSquare, square)
        if (!success) {
          // If move failed, select new piece if valid
          if (piece && canSelectPiece(piece)) {
            setSelectedSquare(square)
            setLegalMoves(getLegalMovesForSquare(square))
          } else {
            setSelectedSquare(null)
            setLegalMoves([])
          }
        }
      }
    } else {
      // Select piece if valid
      if (piece && canSelectPiece(piece)) {
        setSelectedSquare(square)
        setLegalMoves(getLegalMovesForSquare(square))
      }
    }
  }, [selectedSquare, makeMove, canSelectPiece, getLegalMovesForSquare])

  // Handle piece drag
  const handlePieceDrag = useCallback((from: string, to: string): boolean => {
    return makeMove(from, to, undefined, false) // Don't animate drag moves
  }, [makeMove])

  // Reset game
  const resetGame = useCallback((fen?: string) => {
    if (fen) {
      chessRef.current.load(fen)
    } else {
      chessRef.current.reset()
    }

    setPosition(chessRef.current.fen())
    setSelectedSquare(null)
    setLegalMoves([])
    setMoveHistory([])
    setGameResult(null)
    setLastMove(null)
  }, [])

  // Load position
  const loadPosition = useCallback((fen: string) => {
    try {
      chessRef.current.load(fen)
      setPosition(fen)
      setSelectedSquare(null)
      setLegalMoves([])
      setLastMove(null)

      // Reset move history when loading new position
      setMoveHistory([])

      const result = getGameResult()
      if (result.gameOver) {
        setGameResult(result)
      } else {
        setGameResult(null)
      }

      return true
    } catch (error) {
      console.error('Failed to load position:', error)
      return false
    }
  }, [getGameResult])

  // Get current turn
  const getCurrentTurn = useCallback(() => {
    return chessRef.current.turn()
  }, [])

  // Check if in check
  const isInCheck = useCallback(() => {
    return chessRef.current.inCheck()
  }, [])

  // Handle animation completion
  const handleAnimationComplete = useCallback(() => {
    if (pendingPositionUpdate) {
      setPosition(pendingPositionUpdate)
      setPendingPositionUpdate(null)
    }
    setAnimationData(null)
  }, [pendingPositionUpdate])

  return {
    // State
    position,
    selectedSquare,
    legalMoves,
    lastMove,
    moveHistory,
    gameResult,
    animationData,

    // Actions
    makeMove,
    handleSquareClick,
    handlePieceDrag,
    resetGame,
    loadPosition,

    // Getters
    getGameResult,
    getCurrentTurn,
    isInCheck,
    getLegalMovesForSquare,
    canSelectPiece,

    // Animation handlers
    handleAnimationComplete,

    // Chess instance (for advanced usage)
    chess: chessRef.current
  }
}