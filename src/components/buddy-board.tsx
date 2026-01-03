import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Chess } from 'chess.js'

// TODO: Replace chessboard.js with React chess engine component

interface Game {
  white: string
  black: string
  date: string
  result?: string
  pgn?: string
  moves?: string | string[]
  opening?: string
}

interface BuddyBoardProps {
  gamesData?: Game[]
}

export const BuddyBoard: React.FC<BuddyBoardProps> = ({ gamesData = [] }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [currentGame, setCurrentGame] = useState<Game | null>(null)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0)
  const [moves, setMoves] = useState<string[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [allGames, setAllGames] = useState<Game[]>([])
  const [analysisVisible, setAnalysisVisible] = useState(true)
  const [status, setStatus] = useState('Ready')

  const boardRef = useRef<HTMLDivElement>(null)
  const chessRef = useRef<Chess | null>(null)
  const boardInstanceRef = useRef<any>(null)

  // Initialize games data
  useEffect(() => {
    try {
      const gamesDataElement = document.getElementById('buddy-board-games-data')
      if (gamesDataElement) {
        const gamesJson = gamesDataElement.textContent?.trim()
        const loadedGames = JSON.parse(gamesJson || '[]')
        setAllGames(loadedGames)
        setGames([...loadedGames])
        setStatus(`Ready - ${loadedGames.length} games available`)
      } else if (gamesData.length > 0) {
        setAllGames(gamesData)
        setGames([...gamesData])
        setStatus(`Ready - ${gamesData.length} games available`)
      }
    } catch (error) {
      console.error('Error loading games data:', error)
      setStatus('Error loading games data')
    }
  }, [gamesData])

  // Initialize chess board
  useEffect(() => {
    try {
      chessRef.current = new Chess()
      setStatus('Chess logic initialized - waiting for React chess engine integration')
      console.log('Chess.js initialized, board rendering will be handled by React chess engine')
    } catch (error) {
      console.error('Error initializing chess logic:', error)
      setStatus('Error initializing chess logic')
    }
  }, [])

  const loadGame = useCallback((gameIndex: string | number) => {
    if (gameIndex === '' || !games[Number(gameIndex)]) {
      setCurrentGame(null)
      setMoves([])
      setCurrentMoveIndex(0)
      resetBoard()
      setStatus('No game selected')
      return
    }

    try {
      const game = games[Number(gameIndex)]
      setCurrentGame(game)
      loadGameMoves(game)
      setStatus('Game loaded successfully')
    } catch (error) {
      console.error('Error loading game:', error)
      setStatus('Error loading game')
    }
  }, [games])

  const loadGameMoves = (game: Game) => {
    if (!chessRef.current || !boardInstanceRef.current) return

    try {
      chessRef.current.reset()
      let gameMoves: string[] = []

      if (game.pgn) {
        try {
          chessRef.current.loadPgn(game.pgn)
          gameMoves = chessRef.current.history()
        } catch (error) {
          console.error('Error loading PGN:', error)
          gameMoves = []
        }
      } else if (game.moves) {
        const moveList = Array.isArray(game.moves) ? game.moves : game.moves.split(' ')
        gameMoves = moveList.filter(move => move.trim() && !move.includes('.'))
      }

      setMoves(gameMoves)
      chessRef.current.reset()
      boardInstanceRef.current.start()
      setCurrentMoveIndex(0)
    } catch (error) {
      console.error('Error parsing game moves:', error)
      setStatus('Error parsing game moves')
    }
  }

  const resetBoard = () => {
    if (chessRef.current && boardInstanceRef.current) {
      chessRef.current.reset()
      boardInstanceRef.current.start()
      setCurrentMoveIndex(0)
    }
  }

  const goToMove = (targetMoveIndex: number) => {
    if (!currentGame || !chessRef.current || !boardInstanceRef.current) return
    if (targetMoveIndex < 0 || targetMoveIndex > moves.length) return
    if (currentMoveIndex === targetMoveIndex) return

    chessRef.current.reset()
    for (let i = 0; i < targetMoveIndex; i++) {
      if (i < moves.length) {
        chessRef.current.move(moves[i])
      }
    }

    boardInstanceRef.current.position(chessRef.current.fen())
    setCurrentMoveIndex(targetMoveIndex)
  }

  const nextMove = () => {
    if (currentMoveIndex >= moves.length || !chessRef.current || !boardInstanceRef.current) return

    const move = moves[currentMoveIndex]
    try {
      const result = chessRef.current.move(move)
      if (result) {
        boardInstanceRef.current.position(chessRef.current.fen())
        setCurrentMoveIndex(prev => prev + 1)
      }
    } catch (error) {
      console.error('Invalid move:', move, error)
    }
  }

  const previousMove = () => {
    if (currentMoveIndex <= 0 || !chessRef.current || !boardInstanceRef.current) return

    chessRef.current.undo()
    boardInstanceRef.current.position(chessRef.current.fen())
    setCurrentMoveIndex(prev => prev - 1)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      if (!isExpanded || !currentGame) return

      const activeElement = document.activeElement
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT')) {
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          previousMove()
          break
        case 'ArrowRight':
          e.preventDefault()
          nextMove()
          break
        case 'Home':
          e.preventDefault()
          goToMove(0)
          break
        case 'End':
          e.preventDefault()
          goToMove(moves.length)
          break
        case 'Escape':
          if (isExpanded) setIsExpanded(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyboard)
    return () => document.removeEventListener('keydown', handleKeyboard)
  }, [isExpanded, currentGame, moves, currentMoveIndex])

  // Generate moves list JSX
  const renderMovesList = () => {
    if (!moves.length) {
      return <div className="no-moves">No moves available</div>
    }

    const moveRows = []
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1
      const whiteMove = moves[i]
      const blackMove = moves[i + 1]

      moveRows.push(
        <div key={i} className="move-row">
          <span className="move-number">{moveNumber}.</span>
          <span
            className={`move-notation white-move ${currentMoveIndex === i + 1 ? 'current-move' : ''}`}
            onClick={() => goToMove(i + 1)}
          >
            {whiteMove}
          </span>
          {blackMove && (
            <span
              className={`move-notation black-move ${currentMoveIndex === i + 2 ? 'current-move' : ''}`}
              onClick={() => goToMove(i + 2)}
            >
              {blackMove}
            </span>
          )}
        </div>
      )
    }

    return moveRows
  }

  const calculateBasicEvaluation = () => {
    if (!chessRef.current) return 0

    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
    let evaluation = 0

    const board = chessRef.current.board()
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const piece = board[i][j]
        if (piece) {
          const value = pieceValues[piece.type as keyof typeof pieceValues] || 0
          evaluation += piece.color === 'w' ? value : -value
        }
      }
    }

    return evaluation
  }

  const evaluation = calculateBasicEvaluation()
  const clampedEval = Math.max(-5, Math.min(5, evaluation))
  const percentage = (clampedEval + 5) / 10
  const whiteHeight = percentage * 100
  const blackHeight = 100 - whiteHeight

  return (
    <>
      {/* Widget (minimized state) */}
      {!isExpanded && (
        <div id="buddy-board-widget" className="buddy-board-widget">
          <button
            id="buddy-board-toggle"
            onClick={() => setIsExpanded(true)}
            title="Open Buddy Board"
          >
            <i className="ph ph-chess-piece"></i>
            Buddy Board
          </button>
        </div>
      )}

      {/* Overlay for mobile */}
      {isExpanded && (
        <div
          id="buddy-board-overlay"
          className="buddy-board-overlay"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Panel (expanded state) */}
      {isExpanded && (
        <div id="buddy-board-panel" className={`buddy-board-panel ${currentGame ? 'has-moves' : ''} ${analysisVisible ? 'has-evaluation' : ''}`}>
          <div className="buddy-board-header">
            <h3>Buddy Board</h3>
            <div className="buddy-board-controls">
              <button
                id="buddy-board-minimize"
                onClick={() => setIsExpanded(false)}
                title="Minimize"
              >
                <i className="ph ph-minus"></i>
              </button>
              <button
                id="buddy-board-close"
                onClick={() => setIsExpanded(false)}
                title="Close"
              >
                <i className="ph ph-x"></i>
              </button>
            </div>
          </div>

          <div className="buddy-board-content">
            <div className="buddy-board-main">
              <div className="game-selector">
                <label htmlFor="buddy-game-select">Select Game:</label>
                <select
                  id="buddy-game-select"
                  onChange={(e) => loadGame(e.target.value)}
                  defaultValue=""
                >
                  <option value="">Choose a game...</option>
                  {games.map((game, index) => (
                    <option key={index} value={index}>
                      {game.white} vs {game.black} ({game.date})
                    </option>
                  ))}
                </select>
              </div>

              {currentGame && (
                <div id="buddy-game-info" className="game-info">
                  <div id="buddy-game-details" className="game-details">
                    {currentGame.white} vs {currentGame.black} • {currentGame.date || 'Unknown date'}
                  </div>
                  <div
                    id="buddy-game-result"
                    className="game-result"
                    style={{
                      color: currentGame.result === '1-0' ? '#28a745' :
                             currentGame.result === '0-1' ? '#dc3545' : '#fd7e14'
                    }}
                  >
                    {currentGame.result || '1-0'}
                  </div>
                </div>
              )}

              <div ref={boardRef} id="buddy-chess-board" className="chess-board-container"></div>

              {currentGame && (
                <div className="navigation-controls">
                  <button
                    id="buddy-first-move"
                    onClick={() => goToMove(0)}
                    disabled={currentMoveIndex === 0}
                    title="First Move"
                  >
                    <i className="ph ph-skip-back"></i>
                  </button>
                  <button
                    id="buddy-prev-move"
                    onClick={previousMove}
                    disabled={currentMoveIndex === 0}
                    title="Previous Move"
                  >
                    <i className="ph ph-caret-left"></i>
                  </button>
                  <span id="buddy-move-counter" className="move-counter">
                    Move {currentMoveIndex} of {moves.length}
                  </span>
                  <button
                    id="buddy-next-move"
                    onClick={nextMove}
                    disabled={currentMoveIndex >= moves.length}
                    title="Next Move"
                  >
                    <i className="ph ph-caret-right"></i>
                  </button>
                  <button
                    id="buddy-last-move"
                    onClick={() => goToMove(moves.length)}
                    disabled={currentMoveIndex >= moves.length}
                    title="Last Move"
                  >
                    <i className="ph ph-skip-forward"></i>
                  </button>
                </div>
              )}
            </div>

            {currentGame && (
              <div id="buddy-board-moves" className="moves-section">
                <h4>Moves</h4>
                <div id="buddy-moves-list" className="moves-list">
                  {renderMovesList()}
                </div>
              </div>
            )}

            {analysisVisible && (
              <div id="buddy-evaluation-sidebar" className="evaluation-sidebar">
                <div className="analysis-header">
                  <h4>Analysis</h4>
                </div>
                <div id="buddy-eval-bar" className="eval-bar">
                  <div className="eval-black" style={{ height: `${blackHeight}%` }}></div>
                  <div className="eval-white" style={{ height: `${whiteHeight}%` }}></div>
                </div>
                <div id="buddy-eval-text" className="eval-text">
                  {evaluation >= 0 ? '+' : ''}{evaluation.toFixed(1)}
                </div>
              </div>
            )}
          </div>

          <div className="buddy-board-status">
            <span id="buddy-status-text">{status}</span>
          </div>
        </div>
      )}
    </>
  )
}

// Export component methods for external use if needed
export const useBuddyBoard = () => {
  // This hook can be used by parent components to control the buddy board
  return {
    loadGame: (gameIndex: number) => {
      console.log('loadBuddyBoardGame called with:', gameIndex)
    },
    loadByOpening: (openingName: string): boolean => {
      console.log('loadBuddyBoardByOpening called with:', openingName)
      return false
    },
    showAllGames: () => {
      console.log('showAllBuddyBoardGames called')
    }
  }
}

export default BuddyBoard