import React, { useState, useEffect } from 'react'
import AIChessBoard from './ai-chess-board'
import BlindfoldChessBoard from './blindfold-chess-board'
import BaseChessBoard from './base-chess-board'
import { games } from './games-grid'
import { Character } from '../types/character'
import { getDefaultCharacter, getCharacterById } from '../data/characters'
import { getCurrentBoardTheme, BoardTheme } from '../board-theme-utils'

export interface GameStationProps {}

const STORAGE_KEY_GAME = 'gameStationSelectedGame'
const STORAGE_KEY_FEN = 'gameStationFenPosition'
const STORAGE_KEY_CHARACTER = 'gameStationSelectedCharacter'

const GameStation: React.FC<GameStationProps> = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => {
    // Initialize from localStorage
    try {
      return localStorage.getItem(STORAGE_KEY_GAME)
    } catch {
      return null
    }
  })
  const [savedFen, setSavedFen] = useState<string | undefined>(() => {
    // Initialize FEN from localStorage
    try {
      return localStorage.getItem(STORAGE_KEY_FEN) || undefined
    } catch {
      return undefined
    }
  })
  const [selectedCharacter, setSelectedCharacter] = useState<Character>(() => {
    // Initialize character from localStorage
    try {
      const savedCharacterId = localStorage.getItem(STORAGE_KEY_CHARACTER)
      if (savedCharacterId) {
        return getCharacterById(savedCharacterId) || getDefaultCharacter()
      }
    } catch {
      // Ignore errors
    }
    return getDefaultCharacter()
  })
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(getCurrentBoardTheme())

  // Check if we're on a report page
  const isReportPage = window.location.pathname.includes('/report/') || window.location.pathname.includes('/reports/')

  // Listen for board theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      setBoardTheme(getCurrentBoardTheme())
    }

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

  // Listen for game selection events from the games grid
  useEffect(() => {
    const handleGameSelect = (event: CustomEvent) => {
      const gameId = event.detail.gameId
      setSelectedGameId(gameId)
      setIsVisible(true)
      setSavedFen(undefined) // Reset FEN when selecting a new game

      // Persist to localStorage
      try {
        localStorage.setItem(STORAGE_KEY_GAME, gameId)
        localStorage.removeItem(STORAGE_KEY_FEN) // Clear old FEN
      } catch (error) {
        console.error('Failed to save game selection:', error)
      }
    }

    window.addEventListener('gameSelected' as any, handleGameSelect)

    return () => {
      window.removeEventListener('gameSelected' as any, handleGameSelect)
    }
  }, [])

  const selectedGame = games.find(g => g.id === selectedGameId)

  const toggleStation = () => {
    setIsVisible(!isVisible)
  }

  const handleGameSelect = (gameId: string) => {
    setSelectedGameId(gameId)
    setSavedFen(undefined) // Reset FEN when selecting a new game

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY_GAME, gameId)
      localStorage.removeItem(STORAGE_KEY_FEN) // Clear old FEN
    } catch (error) {
      console.error('Failed to save game selection:', error)
    }
  }

  const handleExitGame = () => {
    setSelectedGameId(null)
    setSavedFen(undefined)
    setIsVisible(false)

    // Clear game and FEN from localStorage, but keep character selection
    try {
      localStorage.removeItem(STORAGE_KEY_GAME)
      localStorage.removeItem(STORAGE_KEY_FEN)
    } catch (error) {
      console.error('Failed to clear game selection:', error)
    }
  }

  // Handle move updates to save FEN position
  const handleMove = (move: any, fen: string) => {
    setSavedFen(fen)
    try {
      localStorage.setItem(STORAGE_KEY_FEN, fen)
    } catch (error) {
      console.error('Failed to save FEN position:', error)
    }
  }

  // Handle character change
  const handleCharacterChange = (character: Character) => {
    setSelectedCharacter(character)
    try {
      localStorage.setItem(STORAGE_KEY_CHARACTER, character.id)
    } catch (error) {
      console.error('Failed to save character selection:', error)
    }
  }

  // Don't render anything on report pages
  if (isReportPage) {
    return null
  }

  return (
    <>
      {/* Toggle Button - always visible (except on report pages) */}
      <button
        onClick={toggleStation}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '80px',
          height: '80px',
          backgroundColor: 'var(--primary-color)',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          boxShadow: '0 4px 12px var(--shadow-medium)',
          zIndex: 1000,
          transition: 'all 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--primary-light)'
          e.currentTarget.style.transform = 'scale(1.05)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--primary-color)'
          e.currentTarget.style.transform = 'scale(1)'
        }}
      >
        <span style={{
          fontSize: '24px',
          color: 'var(--text-on-primary)'
        }}>
          ♟
        </span>
        <span style={{
          color: 'var(--text-on-primary)',
          fontSize: '10px',
          fontWeight: '600',
          textAlign: 'center',
          lineHeight: '1'
        }}>
          GAME<br />STATION
        </span>
      </button>

      {/* Overlay when visible - not clickable */}
      {isVisible && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 1999,
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.3s ease',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Game Station Panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: isVisible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.1)',
          width: '600px',
          maxHeight: '80vh',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 12px 40px var(--shadow-medium), 0 4px 12px rgba(0, 0, 0, 0.1)',
          zIndex: 2000,
          overflowY: 'auto',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? 'auto' : 'none'
        }}
      >
        {/* Close button */}
        <button
          onClick={toggleStation}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--hover-background)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          ×
        </button>

        {selectedGameId ? (
          // Game content when a game is selected
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            paddingTop: '10px'
          }}>
            {/* Game title with Exit button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              paddingRight: '40px'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '20px',
                color: 'var(--text-primary)',
                fontWeight: '600',
                flex: 1,
                textAlign: 'center'
              }}>
                {selectedGame?.title}
              </h3>
              <button
                onClick={handleExitGame}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                Exit Game
              </button>
            </div>

            {/* Game component */}
            {selectedGameId === 'blindfold' ? (
              <BlindfoldChessBoard
                key={selectedGameId} // Force remount when game changes
                initialFen={savedFen}
                onMove={handleMove}
                selectedCharacter={selectedCharacter}
                onCharacterChange={handleCharacterChange}
              />
            ) : (
              <AIChessBoard
                key={selectedGameId} // Force remount when game changes
                size={500}
                pieceTheme={selectedGame?.pieceTheme}
                initialFen={savedFen}
                coordinates={true}
                showGameEndSymbols={true}
                showCheckHighlight={true}
                onMove={handleMove}
                selectedCharacter={selectedCharacter}
                onCharacterChange={handleCharacterChange}
              />
            )}
          </div>
        ) : (
          // Mini games grid when no game is selected
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '20px 20px 40px',
            gap: '24px'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '24px',
              color: 'var(--text-primary)',
              fontWeight: '600',
              textAlign: 'center'
            }}>
              Select a Game
            </h3>

            {/* Mini games grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '20px',
              maxWidth: '450px'
            }}>
              {games.map(game => (
                <div
                  key={game.id}
                  onClick={() => handleGameSelect(game.id)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'transform 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  {/* Board preview */}
                  <div style={{
                    width: '160px',
                    height: '160px',
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
                        fontSize: '38px',
                        color: 'var(--text-secondary)',
                        fontFamily: 'monospace',
                        textAlign: 'center',
                        padding: '16px'
                      }}>
                        1.e4
                        <br />
                        <span style={{ fontSize: '28px' }}>♟</span>
                      </div>
                    ) : (
                      <BaseChessBoard
                        size={160}
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
                    fontSize: '14px',
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
        )}
      </div>
    </>
  )
}

export default GameStation
