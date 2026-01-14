import React, { useState, useRef, useEffect } from 'react'
import { Chess } from 'chess.js'
import { Character } from '../types/character'
import { getDefaultCharacter } from '../data/characters'
import { useStockfishOpponent } from '../hooks/useStockfishOpponent'
import CharacterSelector from './character-selector'

export interface BlindfoldChessBoardProps {
  initialFen?: string
  onMove?: (move: any, fen: string) => void
  onGameEnd?: (result: any) => void
  selectedCharacter?: Character
  onCharacterChange?: (character: Character) => void
}

const BlindfoldChessBoard: React.FC<BlindfoldChessBoardProps> = ({
  initialFen,
  onMove,
  onGameEnd,
  selectedCharacter: externalCharacter,
  onCharacterChange: externalOnCharacterChange
}) => {
  // Internal character state (if not controlled from parent)
  const [internalCharacter, setInternalCharacter] = useState<Character>(getDefaultCharacter())

  const character = externalCharacter || internalCharacter
  const handleCharacterChange = externalOnCharacterChange || setInternalCharacter

  const chessRef = useRef(new Chess(initialFen))
  const [moveInput, setMoveInput] = useState('')
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [lastAIMove, setLastAIMove] = useState<string | null>(null)
  const [gameResult, setGameResult] = useState<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const moveListRef = useRef<HTMLDivElement>(null)

  const isPlayerTurn = chessRef.current.turn() === 'w'

  // Handle AI opponent moves
  const handleOpponentMove = (from: string, to: string, promotion?: string) => {
    try {
      const moveData = promotion ? { from, to, promotion } : { from, to }
      const move = chessRef.current.move(moveData)

      if (move) {
        const moveSAN = move.san
        setLastAIMove(moveSAN)
        setMoveHistory(prev => [...prev, `${character.name}: ${moveSAN}`])

        // Check for game end
        const result = getGameResult()
        if (result.gameOver) {
          setGameResult(result)
          if (onGameEnd) {
            onGameEnd(result)
          }
        }

        if (onMove) {
          onMove(move, chessRef.current.fen())
        }

        // Announce AI move for screen readers
        announceToScreenReader(`${character.name} played ${moveSAN}`)
      }
    } catch (error) {
      console.error('AI move failed:', error)
    }
  }

  // Use Stockfish opponent
  const { isThinking, isEngineReady } = useStockfishOpponent({
    character,
    chess: chessRef.current,
    isPlayerTurn,
    onOpponentMove: handleOpponentMove
  })

  // Helper to announce to screen readers
  const announceToScreenReader = (message: string) => {
    const announcement = document.createElement('div')
    announcement.setAttribute('role', 'status')
    announcement.setAttribute('aria-live', 'polite')
    announcement.setAttribute('aria-atomic', 'true')
    announcement.className = 'sr-only'
    announcement.textContent = message
    document.body.appendChild(announcement)
    setTimeout(() => document.body.removeChild(announcement), 1000)
  }

  // Get game result
  const getGameResult = () => {
    if (chessRef.current.isCheckmate()) {
      const currentTurn = chessRef.current.turn()
      const winner = currentTurn === 'w' ? 'b' : 'w'
      return { gameOver: true, winner, isCheckmate: true, isDraw: false }
    }
    if (chessRef.current.isStalemate()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'stalemate' }
    }
    if (chessRef.current.isInsufficientMaterial()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'insufficient material' }
    }
    if (chessRef.current.isThreefoldRepetition()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'threefold repetition' }
    }
    if (chessRef.current.isDraw()) {
      return { gameOver: true, winner: null, isCheckmate: false, isDraw: true, drawReason: 'draw' }
    }
    return { gameOver: false, winner: null, isCheckmate: false, isDraw: false }
  }

  // Handle move submission
  const handleSubmitMove = (e: React.FormEvent) => {
    e.preventDefault()

    if (!moveInput.trim()) return
    if (isThinking) return
    if (gameResult?.gameOver) return

    setErrorMessage('')

    try {
      const move = chessRef.current.move(moveInput.trim())

      if (move) {
        setMoveHistory(prev => [...prev, `You: ${move.san}`])
        setMoveInput('')

        // Check for game end
        const result = getGameResult()
        if (result.gameOver) {
          setGameResult(result)
          if (onGameEnd) {
            onGameEnd(result)
          }
        }

        if (onMove) {
          onMove(move, chessRef.current.fen())
        }

        // Announce move for screen readers
        announceToScreenReader(`You played ${move.san}`)
      }
    } catch (error) {
      setErrorMessage(`Invalid move: ${moveInput}. Please enter a valid move in standard algebraic notation (e.g., e4, Nf3, O-O)`)
      announceToScreenReader(`Invalid move: ${moveInput}`)
    }
  }

  // Auto-scroll to bottom of move list
  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight
    }
  }, [moveHistory])

  // Focus input when AI finishes thinking
  useEffect(() => {
    if (!isThinking && isPlayerTurn && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isThinking, isPlayerTurn])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      maxWidth: '600px',
      width: '100%'
    }}>
      {/* Screen reader only styles */}
      <style>
        {`
          .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
          }
        `}
      </style>

      {/* Character selector */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <CharacterSelector
          selectedCharacter={character}
          onCharacterChange={handleCharacterChange}
          disabled={!isEngineReady || isThinking || gameResult?.gameOver}
        />
      </div>

      {/* Game status */}
      <div
        role="status"
        aria-live="polite"
        style={{
          padding: '16px',
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}
      >
        {gameResult?.gameOver ? (
          gameResult.isCheckmate ? (
            <strong>Game Over - {gameResult.winner === 'w' ? 'You win by checkmate!' : `${character.name} wins by checkmate!`}</strong>
          ) : (
            <strong>Game Over - Draw by {gameResult.drawReason}</strong>
          )
        ) : isThinking ? (
          <span>{character.name} is thinking...</span>
        ) : isPlayerTurn ? (
          <span>Your turn (White)</span>
        ) : (
          <span>Waiting for {character.name}...</span>
        )}
      </div>

      {/* Move history */}
      <div style={{
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        backgroundColor: 'var(--background-primary)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '12px 16px',
          backgroundColor: 'var(--background-secondary)',
          borderBottom: '1px solid var(--border-color)',
          fontWeight: '600',
          fontSize: '14px',
          color: 'var(--text-primary)'
        }}>
          Move History
        </div>
        <div
          ref={moveListRef}
          role="log"
          aria-live="polite"
          aria-atomic="false"
          style={{
            padding: '16px',
            maxHeight: '300px',
            overflowY: 'auto',
            fontSize: '14px',
            color: 'var(--text-primary)',
            lineHeight: '1.8'
          }}
        >
          {moveHistory.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              No moves yet. You play as White.
            </div>
          ) : (
            moveHistory.map((move, index) => (
              <div key={index} style={{ marginBottom: '4px' }}>
                {move}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Move input form */}
      <form onSubmit={handleSubmitMove} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label
            htmlFor="move-input"
            style={{
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}
          >
            Enter your move (Standard Algebraic Notation):
          </label>
          <input
            ref={inputRef}
            id="move-input"
            type="text"
            value={moveInput}
            onChange={(e) => setMoveInput(e.target.value)}
            disabled={!isPlayerTurn || isThinking || gameResult?.gameOver}
            placeholder="e.g., e4, Nf3, O-O"
            aria-describedby={errorMessage ? "error-message" : undefined}
            aria-invalid={errorMessage ? true : false}
            style={{
              padding: '12px',
              fontSize: '16px',
              border: `2px solid ${errorMessage ? '#ff4444' : 'var(--border-color)'}`,
              borderRadius: '6px',
              backgroundColor: 'var(--background-primary)',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => {
              if (!errorMessage) {
                e.target.style.borderColor = 'var(--primary-color)'
              }
            }}
            onBlur={(e) => {
              if (!errorMessage) {
                e.target.style.borderColor = 'var(--border-color)'
              }
            }}
          />
          {errorMessage && (
            <div
              id="error-message"
              role="alert"
              style={{
                color: '#ff4444',
                fontSize: '14px',
                padding: '8px',
                backgroundColor: 'rgba(255, 68, 68, 0.1)',
                borderRadius: '4px'
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!isPlayerTurn || isThinking || gameResult?.gameOver || !moveInput.trim()}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: '600',
            backgroundColor: (!isPlayerTurn || isThinking || gameResult?.gameOver || !moveInput.trim())
              ? 'var(--background-secondary)'
              : 'var(--primary-color)',
            color: (!isPlayerTurn || isThinking || gameResult?.gameOver || !moveInput.trim())
              ? 'var(--text-secondary)'
              : 'var(--text-on-primary)',
            border: 'none',
            borderRadius: '6px',
            cursor: (!isPlayerTurn || isThinking || gameResult?.gameOver || !moveInput.trim())
              ? 'not-allowed'
              : 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            if (isPlayerTurn && !isThinking && !gameResult?.gameOver && moveInput.trim()) {
              e.currentTarget.style.backgroundColor = 'var(--primary-light)'
            }
          }}
          onMouseLeave={(e) => {
            if (isPlayerTurn && !isThinking && !gameResult?.gameOver && moveInput.trim()) {
              e.currentTarget.style.backgroundColor = 'var(--primary-color)'
            }
          }}
        >
          Submit Move
        </button>
      </form>

    </div>
  )
}

export default BlindfoldChessBoard
