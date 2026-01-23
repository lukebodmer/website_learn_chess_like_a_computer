import React, { useState, useEffect } from 'react'
import BaseChessBoard from './base-chess-board'
import { getCurrentBoardTheme, BoardTheme } from '../board-theme-utils'

export interface GamesGridProps {
  onGameSelect: (gameId: string) => void
}

interface GameConfig {
  id: string
  title: string
  position?: string // FEN position for static board display
  pieceTheme?: string
}

const games: GameConfig[] = [
  {
    id: 'classic',
    title: 'Classic Chess',
    position: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  },
  {
    id: 'disguised',
    title: 'Half-Blindfold Chess',
    position: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pieceTheme: '/static/images/chesspieces/disguised/'
  },
  {
    id: 'almost-blindfold',
    title: 'Almost-Blindfold Chess',
    position: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pieceTheme: '/static/images/chesspieces/invisible/'
  },
  {
    id: 'blindfold',
    title: 'Blindfold Chess'
  }
]

const GamesGrid: React.FC<GamesGridProps> = ({ onGameSelect }) => {
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(getCurrentBoardTheme())

  // Listen for board theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      setBoardTheme(getCurrentBoardTheme())
    }

    // Watch for class changes on the HTML element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          handleThemeChange()
        }
      })
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px'
    }}>
      <h1 style={{
        fontSize: '36px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        margin: '0 0 16px 0',
        textAlign: 'center'
      }}>
        Game Station
      </h1>
      <p style={{
        fontSize: '18px',
        color: 'var(--text-secondary)',
        margin: '0 0 48px 0',
        maxWidth: '600px',
        textAlign: 'center'
      }}>
        Select a game to play
      </p>

      {/* Games grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '32px',
        maxWidth: '500px'
      }}>
        {games.map(game => (
          <div
            key={game.id}
            onClick={() => onGameSelect(game.id)}
            style={{
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              transition: 'transform 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {/* Snapshot of board */}
            <div style={{
              width: '200px',
              height: '200px',
              border: '3px solid var(--border-color)',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px var(--shadow-medium)',
              backgroundColor: 'var(--background-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              {game.id === 'blindfold' ? (
                <div style={{
                  fontSize: '48px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  padding: '20px'
                }}>
                  1.e4
                  <br />
                  <span style={{ fontSize: '32px' }}>♟</span>
                </div>
              ) : (
                <BaseChessBoard
                  size={200}
                  position={game.position || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
                  pieceTheme={game.pieceTheme}
                  orientation="white"
                  coordinates={false}
                  interactive={false}
                  allowPieceDragging={false}
                  showGameEndSymbols={false}
                  showCheckHighlight={false}
                  boardTheme={boardTheme}
                />
              )}
            </div>
            {/* Game title */}
            <div style={{
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              {game.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default GamesGrid
export { games }
export type { GameConfig }
