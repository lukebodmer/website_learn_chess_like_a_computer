import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { StockfishService, StockfishMove } from '../services/stockfish-service'
import { Character } from '../types/character'

export interface UseStockfishOpponentProps {
  character: Character
  chess: Chess
  isPlayerTurn: boolean
  onOpponentMove: (from: string, to: string, promotion?: string) => void
}

/**
 * Hook to manage Stockfish AI opponent
 */
export const useStockfishOpponent = ({
  character,
  chess,
  isPlayerTurn,
  onOpponentMove
}: UseStockfishOpponentProps) => {
  const stockfishRef = useRef<StockfishService | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isEngineReady, setIsEngineReady] = useState(false)

  // Initialize Stockfish engine
  useEffect(() => {
    stockfishRef.current = new StockfishService()

    stockfishRef.current.onReady(() => {
      setIsEngineReady(true)
      if (stockfishRef.current) {
        stockfishRef.current.setElo(character.elo)
      }
    })

    return () => {
      if (stockfishRef.current) {
        stockfishRef.current.terminate()
      }
    }
  }, [])

  // Update ELO when character changes
  useEffect(() => {
    if (stockfishRef.current && isEngineReady) {
      stockfishRef.current.setElo(character.elo)
    }
  }, [character.elo, isEngineReady])

  // Make AI move when it's the opponent's turn
  useEffect(() => {
    if (!isPlayerTurn && !chess.isGameOver() && isEngineReady && !isThinking) {
      // Give a small delay to make it feel more natural
      const thinkingDelay = setTimeout(() => {
        makeAIMove()
      }, 500)

      return () => clearTimeout(thinkingDelay)
    }
  }, [isPlayerTurn, chess.fen(), isEngineReady, isThinking])

  const makeAIMove = () => {
    if (!stockfishRef.current || isThinking) return

    setIsThinking(true)

    // Set current position
    const fen = chess.fen()
    console.log('AI making move for position:', fen)
    stockfishRef.current.setPosition(fen)

    // Calculate search time based on ELO (lower ELO = faster/weaker play)
    const searchTime = Math.min(2000, Math.max(500, character.elo))

    // Get best move
    stockfishRef.current.getBestMove((move: StockfishMove) => {
      console.log('Stockfish returned move:', move)
      setIsThinking(false)

      // Pass the move to the parent component to execute
      // The parent will handle validation and animation
      onOpponentMove(move.from, move.to, move.promotion)
    }, searchTime)
  }

  return {
    isThinking,
    isEngineReady
  }
}
