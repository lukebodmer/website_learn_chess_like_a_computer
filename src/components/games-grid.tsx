import React from 'react'
import PlayableChessBoard from './playable-chess-board'

export interface GamesGridProps {
  onGameSelect: (gameId: string) => void
}

interface GameConfig {
  id: string
  title: string
  pieceTheme?: string
}

const games: GameConfig[] = [
  {
    id: 'classic',
    title: 'Classic Chess'
  },
  {
    id: 'disguised',
    title: 'Half-Blindfold Chess',
    pieceTheme: '/static/images/chesspieces/disguised/'
  },
  {
    id: 'almost-blindfold',
    title: 'Almost-Blindfold Chess',
    pieceTheme: '/static/images/chesspieces/invisible/'
  },
  {
    id: 'blindfold',
    title: 'Blindfold Chess'
  }
]

const GamesGrid: React.FC<GamesGridProps> = ({ onGameSelect }) => {
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
              justifyContent: 'center'
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
                <PlayableChessBoard
                  size={200}
                  pieceTheme={game.pieceTheme}
                  coordinates={false}
                  showGameEndSymbols={false}
                  showCheckHighlight={false}
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
