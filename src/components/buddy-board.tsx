import React, { useState, useEffect, useRef } from 'react'
import BaseChessBoard from './base-chess-board'
import { Chess } from 'chess.js'
import { gameFilterManager, FilterEvent, FilterType } from '../game-filter-manager'

export interface BuddyBoardProps {
  size?: number
  pieceTheme?: string
}

interface AnalysisData {
  eval?: number
  mate?: number
  best?: string
  variation?: string
  judgment?: {
    name: string
    comment: string
  }
}

interface GameData {
  id: string
  moves: string
  players: {
    white: { user: { name: string } }
    black: { user: { name: string } }
  }
  opening?: { name: string }
  winner?: string | null
  analysis?: AnalysisData[]
  clocks?: number[]
  clock?: {
    initial: number
    increment: number
    totalTime: number
  }
  division?: {
    middle?: number
    end?: number
  }
}

const BuddyBoard: React.FC<BuddyBoardProps> = ({
  size = 400,
  pieceTheme
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [games, setGames] = useState<GameData[]>([])
  const [filteredGames, setFilteredGames] = useState<GameData[]>([])
  const [currentGameIndex, setCurrentGameIndex] = useState(0)
  const [displayedMoveIndex, setDisplayedMoveIndex] = useState(0)
  const [targetMoveIndex, setTargetMoveIndex] = useState(0)
  const [chess] = useState(() => new Chess())
  const [position, setPosition] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  const [gameLoaded, setGameLoaded] = useState(false)
  const [currentMoves, setCurrentMoves] = useState<string[]>([])
  const [isAnimating, setIsAnimating] = useState(false)
  const [animationData, setAnimationData] = useState<{ piece: any, from: string, to: string } | null>(null)
  const moveListRef = useRef<HTMLDivElement>(null)
  const buddyBoardRef = useRef<HTMLDivElement>(null)
  const [hoveredMoveIndex, setHoveredMoveIndex] = useState<number | null>(null)
  const [showJudgmentsFor, setShowJudgmentsFor] = useState<'white' | 'black'>('white')
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const [lastMove, setLastMove] = useState<{ from: string, to: string } | null>(null)

  // TimeChart zoom and pan state (moved from TimeChart to persist across re-renders)
  const [timeChartZoom, setTimeChartZoom] = useState(1)
  const [timeChartPan, setTimeChartPan] = useState({ x: 0, y: 0 })
  const [timeChartIsDragging, setTimeChartIsDragging] = useState(false)
  const [timeChartLastMousePos, setTimeChartLastMousePos] = useState({ x: 0, y: 0 })
  const [evaluationChartFlipped, setEvaluationChartFlipped] = useState(false)

  // Buddy Board drag state
  const [boardPosition, setBoardPosition] = useState({ x: window.innerWidth - 820, y: window.innerHeight - 820 }) // Initial position closer to button
  const [isDraggingBoard, setIsDraggingBoard] = useState(false)
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 })

  // Set up filter manager when component mounts
  useEffect(() => {
    // Get username from the report page
    const reportUsernameEl = document.getElementById('report-username')
    const username = reportUsernameEl?.textContent?.trim() || ''

    // Initialize the filter manager
    gameFilterManager.setUsername(username)

    // Listen for filter changes
    const handleFilterChange = (event: FilterEvent) => {
      setFilteredGames(event.filteredGames);

      // If current game index is out of bounds, reset to first game
      if (event.filteredGames.length > 0) {
        // Reset to first game if current selection is out of bounds
        setCurrentGameIndex(0);
        if (isVisible) {
          setTimeout(() => loadGame(0), 50);
        }
      }
    };

    gameFilterManager.addListener(handleFilterChange);

    // Clean up listener on unmount
    return () => {
      gameFilterManager.removeListener(handleFilterChange);
    };
  }, []);

  // Set up dynamic game loading observer (runs once on mount)
  useEffect(() => {
    const enrichedGamesEl = document.getElementById('enriched-games')
    const reportUsernameEl = document.getElementById('report-username')

    const loadGamesFromElement = () => {
      if (enrichedGamesEl && enrichedGamesEl.textContent) {
        try {
          const data = JSON.parse(enrichedGamesEl.textContent)
          if (Array.isArray(data)) {
            setGames(prev => {
              const previousGameCount = prev.length

              if (data.length > 0) {
                // Update filter manager with new games data
                gameFilterManager.updateAllGames(data);

                // Set default board orientation based on report producer (only on first load)
                if (previousGameCount === 0) {
                  const reportUsername = reportUsernameEl?.textContent?.trim()
                  if (reportUsername) {
                    const firstGame = data[0]
                    const isWhitePlayer = firstGame.players?.white?.user?.name === reportUsername
                    const isBlackPlayer = firstGame.players?.black?.user?.name === reportUsername

                    if (isBlackPlayer) {
                      setBoardOrientation('black')
                    } else {
                      setBoardOrientation('white') // Default to white if producer played white or not found
                    }
                  }
                  // First game will be loaded by separate useEffect when board becomes visible
                } else if (data.length > previousGameCount) {
                  // New game(s) added - load the newest one after a small delay
                  setTimeout(() => loadGame(data.length - 1), 0)
                }
              }

              return data
            })
          }
        } catch (error) {
          console.error('Error parsing enriched games data:', error)
        }
      }
    }

    // Initial load
    loadGamesFromElement()

    // Set up MutationObserver to watch for changes to the enriched games element
    if (enrichedGamesEl) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            loadGamesFromElement()
          }
        })
      })

      observer.observe(enrichedGamesEl, {
        childList: true,
        subtree: true,
        characterData: true
      })

      return () => {
        observer.disconnect()
      }
    }
  }, [])

  // Load first game when board becomes visible (with delay for animation)
  useEffect(() => {
    if (isVisible && filteredGames.length > 0 && !gameLoaded) {
      // Delay loading to allow animation to start
      setTimeout(() => loadGame(0), 50)
    }
  }, [isVisible, filteredGames.length, gameLoaded])

  // Update filteredGames when games change initially
  useEffect(() => {
    setFilteredGames(games);
  }, [games]);

  // Animation engine - state-driven approach
  useEffect(() => {
    if (isAnimating) return
    if (displayedMoveIndex === targetMoveIndex) return

    const direction = targetMoveIndex > displayedMoveIndex ? 'next' : 'prev'

    let moveObj

    if (direction === 'next') {
      // For forward: play moves up to current position, then execute next move
      const tempChess = new Chess()
      for (let i = 0; i < displayedMoveIndex; i++) {
        tempChess.move(currentMoves[i])
      }
      moveObj = tempChess.move(currentMoves[displayedMoveIndex])
    } else {
      // For backward: play moves up to current position, then undo the last one
      if (displayedMoveIndex > 0) {
        const tempChess = new Chess()
        for (let i = 0; i < displayedMoveIndex; i++) {
          tempChess.move(currentMoves[i])
        }
        // The last move played is at displayedMoveIndex - 1
        moveObj = tempChess.undo()
      }
    }

    if (!moveObj) return

    setAnimationData({
      piece: { type: moveObj.piece, color: moveObj.color },
      from: direction === 'next' ? moveObj.from : moveObj.to,
      to: direction === 'next' ? moveObj.to : moveObj.from
    })

    setIsAnimating(true)
  }, [displayedMoveIndex, targetMoveIndex, isAnimating, currentMoves])

  // Auto-scroll to keep current move visible
  useEffect(() => {
    if (!moveListRef.current) return

    // Find the current move element
    const currentMoveElement = moveListRef.current.querySelector(`[data-move-index="${displayedMoveIndex}"]`)
    if (currentMoveElement) {
      currentMoveElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [displayedMoveIndex])

  // Prevent wheel events from reaching the page when mouse is over buddy board
  useEffect(() => {
    const buddyBoardElement = buddyBoardRef.current
    if (!buddyBoardElement) return

    const preventWheelOnBuddyBoard = (e: WheelEvent) => {
      // Check if the wheel event is on a scrollable element
      let target = e.target as HTMLElement

      // Walk up the DOM tree to find if we're inside a scrollable container
      while (target && target !== buddyBoardElement) {
        const computedStyle = getComputedStyle(target)
        const overflowY = computedStyle.overflowY

        // If element is scrollable and has content to scroll
        if ((overflowY === 'auto' || overflowY === 'scroll') && target.scrollHeight > target.clientHeight) {
          const deltaY = e.deltaY
          const scrollTop = target.scrollTop
          const maxScrollTop = target.scrollHeight - target.clientHeight

          // Allow scrolling if we're not at the boundaries
          // or if scrolling would move away from the boundary
          if (
            (deltaY < 0 && scrollTop > 0) || // Scrolling up and not at top
            (deltaY > 0 && scrollTop < maxScrollTop) // Scrolling down and not at bottom
          ) {
            // Allow the scroll to happen naturally, don't prevent
            return
          }
        }

        target = target.parentElement as HTMLElement
      }

      // If we get here, prevent the wheel event from reaching the page
      e.preventDefault()
      e.stopPropagation()
    }

    buddyBoardElement.addEventListener('wheel', preventWheelOnBuddyBoard, { passive: false })

    return () => {
      buddyBoardElement.removeEventListener('wheel', preventWheelOnBuddyBoard)
    }
  }, [isVisible]) // Re-register when visibility changes

  // Load a specific game by index
  const loadGame = (gameIndex: number) => {
    if (gameIndex < 0 || gameIndex >= filteredGames.length) return

    const game = filteredGames[gameIndex]
    const moves = game.moves.split(' ').filter(move => move.trim() !== '')

    // Set board orientation based on report producer for this specific game
    const reportUsernameEl = document.getElementById('report-username')
    const reportUsername = reportUsernameEl?.textContent?.trim()
    if (reportUsername) {
      const isWhitePlayer = game.players?.white?.user?.name === reportUsername
      const isBlackPlayer = game.players?.black?.user?.name === reportUsername

      if (isBlackPlayer) {
        setBoardOrientation('black')
      } else {
        setBoardOrientation('white') // Default to white if producer played white or not found
      }
    }

    setCurrentGameIndex(gameIndex)
    setCurrentMoves(moves)
    setDisplayedMoveIndex(0)
    setTargetMoveIndex(0)

    // Reset chess position to starting position
    chess.reset()
    setPosition(chess.fen())
    setLastMove(null) // No last move at start
    setGameLoaded(true)
  }

  // Jump immediately to position without animation
  const goToMoveImmediate = (moveIndex: number) => {
    chess.reset()
    for (let i = 0; i < moveIndex; i++) {
      try {
        chess.move(currentMoves[i])
      } catch (error) {
        console.error('Invalid move:', currentMoves[i], error)
        break
      }
    }

    setDisplayedMoveIndex(moveIndex)
    setTargetMoveIndex(moveIndex)
    setPosition(chess.fen())
    setLastMove(calculateLastMove(moveIndex))
  }

  // Simple navigation functions - just update target
  const nextMove = () => {
    setTargetMoveIndex(prev => Math.min(prev + 1, currentMoves.length))
  }

  const prevMove = () => {
    setTargetMoveIndex(prev => Math.max(prev - 1, 0))
  }

  // Calculate the last move for highlighting
  const calculateLastMove = (moveIndex: number): { from: string, to: string } | null => {
    if (moveIndex === 0 || currentMoves.length === 0) {
      return null // No moves played yet
    }

    try {
      // Create a temp chess instance to get the move object
      const tempChess = new Chess()

      // Play moves up to the move we want to highlight
      for (let i = 0; i < moveIndex - 1; i++) {
        tempChess.move(currentMoves[i])
      }

      // Get the move object for the last played move
      const moveObj = tempChess.move(currentMoves[moveIndex - 1])

      if (moveObj) {
        return { from: moveObj.from, to: moveObj.to }
      }
    } catch (error) {
      console.error('Error calculating last move:', error)
    }

    return null
  }

  // Handle animation completion
  const handleAnimationComplete = () => {

    setTargetMoveIndex(currentTarget => {
      setDisplayedMoveIndex(currentDisplayed => {
        const nextIndex = currentTarget > currentDisplayed
          ? currentDisplayed + 1
          : currentDisplayed - 1

        const tempChess = new Chess()
        for (let i = 0; i < nextIndex; i++) {
          tempChess.move(currentMoves[i])
        }

        setPosition(tempChess.fen())
        setLastMove(calculateLastMove(nextIndex))
        setIsAnimating(false)
        setAnimationData(null)

        return nextIndex // Update displayed
      })
      return currentTarget // Don't change target
    })
  }

  // Start and end functions (immediate, no animation)
  const goToStart = () => {
    setAnimationData(null) // Stop current animation
    setIsAnimating(false)
    setTargetMoveIndex(0)
    goToMoveImmediate(0)
  }
  const goToEnd = () => {
    setAnimationData(null) // Stop current animation
    setIsAnimating(false)
    setTargetMoveIndex(currentMoves.length)
    goToMoveImmediate(currentMoves.length)
  }

  const toggleBoard = () => {
    setIsVisible(!isVisible)
  }

  // Drag handlers for moving the board
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Only start drag on left mouse button
    if (e.button !== 0) return

    setIsDraggingBoard(true)
    setDragStartPos({
      x: e.clientX - boardPosition.x,
      y: e.clientY - boardPosition.y
    })
    e.preventDefault()
  }

  // Global mouse handlers for dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingBoard) return

      const newX = e.clientX - dragStartPos.x
      const newY = e.clientY - dragStartPos.y

      // Keep panel within viewport bounds
      const maxX = window.innerWidth - 700 // Panel width is 700px
      const maxY = window.innerHeight - 600 // Approximate panel height

      setBoardPosition({
        x: Math.max(20, Math.min(maxX, newX)),
        y: Math.max(20, Math.min(maxY, newY))
      })
    }

    const handleMouseUp = () => {
      setIsDraggingBoard(false)
    }

    if (isDraggingBoard) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingBoard, dragStartPos, boardPosition])

  // Function to convert evaluation to win rate percentage using Lichess formula
  const getWinRatePercentage = (analysis: AnalysisData, moveIndex?: number): number => {
    if (analysis.mate !== undefined) {
      if (analysis.mate === 0) {
        // Checkmate has been delivered - need to determine who won based on whose turn it was
        // moveIndex corresponds to the move that was just played
        // If moveIndex is odd (1, 3, 5...), white just moved and delivered checkmate
        // If moveIndex is even (2, 4, 6...), black just moved and delivered checkmate
        if (moveIndex !== undefined) {
          const whiteMoved = moveIndex % 2 === 1
          return whiteMoved ? 100 : 0  // White wins = 100%, Black wins = 0%
        }
        // Fallback: if we can't determine, assume it's bad for the side to move
        return 0
      } else {
        // Mate values: positive mate favors white (100%), negative favors black (0%)
        return analysis.mate > 0 ? 100 : 0
      }
    }
    if (analysis.eval !== undefined) {
      // Convert centipawns to win rate percentage using Lichess formula
      // Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * centipawns)) - 1)
      const centipawns = analysis.eval
      const winRate = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1)
      return Math.max(0, Math.min(100, winRate))
    }
    return 50 // Neutral position = 50% win rate
  }

  // Create evaluation chart component
  const EvaluationChart = () => {
    const currentGame = filteredGames[currentGameIndex]
    if (!currentGame?.analysis) {
      return (
        <div style={{
          width: `${300 + 16}px`,
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          padding: '8px',
          backgroundColor: 'var(--background-primary)'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '8px',
            color: 'var(--text-primary)',
            textAlign: 'center'
          }}>
            Position Evaluation
          </div>
          <div style={{
            width: '300px',
            height: '120px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No game data loaded
          </div>
        </div>
      )
    }

    const chartWidth = 300
    const chartHeight = 120
    const padding = 0

    const analysis = currentGame.analysis
    const maxPoints = analysis.length

    // Add starting position (index 0) with neutral evaluation, then analysis data
    const allEvaluations = [{ eval: 0 }, ...analysis]

    // Convert evaluations to chart coordinates using win rate percentage
    const chartPadding = 8 // Add padding to all sides
    const availableWidth = chartWidth - (2 * chartPadding)
    const availableHeight = chartHeight - (2 * chartPadding)

    const points = allEvaluations.map((item, index) => {
      const x = chartPadding + (index / Math.max(allEvaluations.length - 1, 1)) * availableWidth
      const winRatePercent = getWinRatePercentage(item, index)
      // Convert win rate percentage (0-100) to y coordinate with padding
      // 100% (white winning) = top + padding, 0% (black winning) = bottom - padding
      const y = chartPadding + (availableHeight - (winRatePercent / 100) * availableHeight)
      return { x, y, winRatePercent, index }
    })

    // Create path string
    const pathData = points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    ).join(' ')

    return (
      <div style={{
        width: `${chartWidth + 16}px`, // Add 16px for left + right padding (8px each)
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '8px',
        backgroundColor: 'var(--background-primary)'
      }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '8px',
            color: 'var(--text-primary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer'
          }}
          onClick={() => setEvaluationChartFlipped(!evaluationChartFlipped)}
          title="Click to toggle between chart and player statistics"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Player toggle button */}
            <button
              onClick={(e) => {
                e.stopPropagation() // Prevent triggering the flip when clicking the judgment toggle
                setShowJudgmentsFor(showJudgmentsFor === 'white' ? 'black' : 'white')
              }}
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                border: '2px solid var(--border-dark)',
                backgroundColor: showJudgmentsFor === 'white' ? 'var(--background-secondary)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none'
              }}
              title={`Currently showing ${showJudgmentsFor} judgments. Click to show ${showJudgmentsFor === 'white' ? 'black' : 'white'} judgments.`}
            />
            {/* Evaluation title with mate detection */}
            {(() => {
              // Get current position analysis
              const currentAnalysis = displayedMoveIndex > 0 ? analysis[displayedMoveIndex - 1] : null
              const hasMate = currentAnalysis?.mate !== undefined

              if (hasMate) {
                const mateValue = currentAnalysis.mate
                if (mateValue === 0) {
                  // Checkmate has been delivered
                  const whiteMoved = displayedMoveIndex % 2 === 1
                  return (
                    <span>
                      {whiteMoved ? 'White wins - Checkmate!' : 'Black wins - Checkmate!'}
                    </span>
                  )
                } else {
                  // Mate in X moves
                  const player = mateValue > 0 ? 'White' : 'Black'
                  const movesCount = Math.abs(mateValue)
                  return (
                    <span>
                      {player} has mate in {movesCount}
                    </span>
                  )
                }
              }

              return <span>Position Evaluation</span>
            })()}
          </div>
          {displayedMoveIndex > 0 && analysis[displayedMoveIndex - 1]?.judgment && (
            <span style={{
              fontSize: '10px',
              fontWeight: 'normal',
              color: 'var(--text-secondary)'
            }}>
              {(() => {
                const judgment = analysis[displayedMoveIndex - 1].judgment
                const comment = judgment.comment
                // Get the last sentence of the comment
                const sentences = comment.split('.').filter(s => s.trim().length > 0)
                const lastSentence = sentences[sentences.length - 1]?.trim()

                return `${judgment.name}. ${lastSentence}${lastSentence && !lastSentence.endsWith('.') ? '.' : ''}`
              })()}
            </span>
          )}
        </div>

        {/* Chart content with flip animation */}
        <div style={{
          width: `${chartWidth}px`,
          height: `${chartHeight}px`,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.6s',
          transform: evaluationChartFlipped ? 'rotateX(180deg)' : 'rotateX(0deg)'
        }}>
          {/* Chart view (front) */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden'
          }}>
            <svg width={chartWidth} height={chartHeight} style={{ backgroundColor: 'var(--background-secondary)', borderRadius: '2px' }}>
              {/* Area below the evaluation line (white advantage area) */}
              {points.length > 1 && (
                <path
                  d={`${pathData} L ${points[points.length - 1].x} ${chartPadding + availableHeight} L ${points[0].x} ${chartPadding + availableHeight} Z`}
                  fill="var(--text-primary)"
                  stroke="none"
                />
              )}

              {/* Evaluation line */}
              {points.length > 1 && (
                <path
                  d={pathData}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth="3"
                />
              )}

              {/* Division lines */}
              {(() => {
                const currentGame = filteredGames[currentGameIndex]
                const division = currentGame?.division
                const divisionLines = []

                // Middle game line
                if (division?.middle && division.middle < allEvaluations.length) {
                  const middleX = chartPadding + (division.middle / Math.max(allEvaluations.length - 1, 1)) * availableWidth
                  divisionLines.push(
                    <line
                      key="middle"
                      x1={middleX}
                      y1={0}
                      x2={middleX}
                      y2={chartHeight}
                      stroke="var(--text-muted)"
                      strokeWidth="1"
                      strokeDasharray="3,3"
                      opacity="0.7"
                    />
                  )
                }

                // End game line
                if (division?.end && division.end < allEvaluations.length) {
                  const endX = chartPadding + (division.end / Math.max(allEvaluations.length - 1, 1)) * availableWidth
                  divisionLines.push(
                    <line
                      key="end"
                      x1={endX}
                      y1={0}
                      x2={endX}
                      y2={chartHeight}
                      stroke="var(--text-muted)"
                      strokeWidth="1"
                      strokeDasharray="3,3"
                      opacity="0.7"
                    />
                  )
                }

                return divisionLines
              })()}

              {/* Points */}
              {points.map((point, index) => {
                const isCurrentMove = index === displayedMoveIndex
                const isHovered = hoveredMoveIndex === index
                // For judgments, index 0 = starting position (no judgment), index 1+ = analysis[index-1]
                const rawJudgment = index > 0 ? analysis[index - 1]?.judgment : null

                // Check if this move is by the player we want to show judgments for
                // index 1 = move 1 (white), index 2 = move 2 (black), etc.
                const isWhiteMove = index % 2 === 1
                const isBlackMove = index % 2 === 0 && index > 0
                const shouldShowJudgment = rawJudgment &&
                  ((showJudgmentsFor === 'white' && isWhiteMove) ||
                   (showJudgmentsFor === 'black' && isBlackMove))

                const hasJudgment = shouldShowJudgment ? rawJudgment : null

                let color = 'var(--primary-color)'
                if (hasJudgment) {
                  switch (hasJudgment.name) {
                    case 'Blunder': color = 'var(--danger-color)'; break
                    case 'Mistake': color = 'var(--warning-color)'; break
                    case 'Inaccuracy': color = 'var(--secondary-light)'; break
                    default: color = 'var(--primary-color)'
                  }
                }

                return (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={isCurrentMove ? 6 : (isHovered || hasJudgment) ? 4 : 2}
                    fill={isCurrentMove ? 'var(--success-color)' : (isHovered ? 'var(--secondary-light)' : color)}
                    stroke={isCurrentMove ? 'var(--text-primary)' : (isHovered ? 'var(--text-primary)' : 'none')}
                    strokeWidth={isCurrentMove ? 2 : (isHovered ? 1 : 0)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredMoveIndex(index)}
                    onMouseLeave={() => setHoveredMoveIndex(null)}
                    onClick={() => {
                      setTargetMoveIndex(index)
                      goToMoveImmediate(index)
                    }}
                  />
                )
              })}

              {/* 50% line (equal position) - drawn last to be on top */}
              <line
                x1={chartPadding}
                y1={chartPadding + availableHeight / 2}
                x2={chartPadding + availableWidth}
                y2={chartPadding + availableHeight / 2}
                stroke="var(--text-primary)"
                strokeWidth="1"
                strokeDasharray="2,2"
                opacity="0.7"
              />
            </svg>
          </div>

          {/* Stats view (back) */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateX(180deg)',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '2px',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              flex: 1
            }}>
              {/* White player stats */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '6px',
                  textAlign: 'center'
                }}>
                  {currentGame.players?.white?.user?.name || currentGame.players?.white?.name || 'Unknown'}
                </div>
                <div style={{ fontSize: '12px' }}>
                  <div style={{ color: 'var(--secondary-light)' }}>Inaccuracy: {currentGame.players.white.analysis?.inaccuracy || 0}</div>
                  <div style={{ color: 'var(--warning-color)' }}>Mistakes: {currentGame.players.white.analysis?.mistake || 0}</div>
                  <div style={{ color: 'var(--danger-color)' }}>Blunders: {currentGame.players.white.analysis?.blunder || 0}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>Accuracy: {currentGame.players.white.analysis?.accuracy ? `${currentGame.players.white.analysis.accuracy.toFixed(1)}%` : 'N/A'}</div>
                </div>
              </div>

              {/* Black player stats */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '6px',
                  textAlign: 'center'
                }}>
                  {currentGame.players?.black?.user?.name || currentGame.players?.black?.name || 'Unknown'}
                </div>
                <div style={{ fontSize: '12px' }}>
                  <div style={{ color: 'var(--secondary-light)' }}>Inaccuracy: {currentGame.players.black.analysis?.inaccuracy || 0}</div>
                  <div style={{ color: 'var(--warning-color)' }}>Mistakes: {currentGame.players.black.analysis?.mistake || 0}</div>
                  <div style={{ color: 'var(--danger-color)' }}>Blunders: {currentGame.players.black.analysis?.blunder || 0}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>Accuracy: {currentGame.players.black.analysis?.accuracy ? `${currentGame.players.black.analysis.accuracy.toFixed(1)}%` : 'N/A'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Create time usage chart component
  const TimeChart = ({
    zoomLevel,
    panOffset,
    setZoomLevel,
    setPanOffset,
    isDragging,
    setIsDragging,
    lastMousePos,
    setLastMousePos
  }: {
    zoomLevel: number
    panOffset: { x: number, y: number }
    setZoomLevel: (zoom: number) => void
    setPanOffset: (offset: { x: number, y: number }) => void
    isDragging: boolean
    setIsDragging: (dragging: boolean) => void
    lastMousePos: { x: number, y: number }
    setLastMousePos: (pos: { x: number, y: number }) => void
  }) => {
    const currentGame = filteredGames[currentGameIndex]
    if (!currentGame?.clocks || !currentGame?.clock) {
      return (
        <div style={{
          width: `${300 + 16}px`,
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          padding: '8px',
          backgroundColor: 'var(--background-primary)'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '8px',
            color: 'var(--text-primary)',
            textAlign: 'center'
          }}>
            Time Per Move (seconds)
          </div>
          <div style={{
            width: '300px',
            height: '120px',
            backgroundColor: 'var(--background-tertiary)',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No game data loaded
          </div>
        </div>
      )
    }

    const chartWidth = 300
    const chartHeight = 120

    const svgRef = useRef<SVGSVGElement>(null)

    // Only keep refs needed for wheel zoom
    const zoomLevelRef = useRef(zoomLevel)
    const panOffsetRef = useRef(panOffset)

    // Update refs when state/props change
    useEffect(() => {
      zoomLevelRef.current = zoomLevel
    }, [zoomLevel])

    useEffect(() => {
      panOffsetRef.current = panOffset
    }, [panOffset])

    const { clocks, clock } = currentGame

    // Add padding to prevent text cutoff
    const timePadding = 12 // Padding for text labels
    const availableWidth = chartWidth - (2 * timePadding)
    const availableHeight = chartHeight - (2 * timePadding)

    // Calculate time used per move
    // clocks[0] = white after move 1, clocks[1] = black after move 1, etc.
    const timeUsedPerMove: number[] = []

    // White's first move: initial time - clocks[0]
    const whiteFirstMoveTime = Math.max(0, (clock.initial * 100) - clocks[0])
    timeUsedPerMove.push(whiteFirstMoveTime)

    // Black's first move: initial time - clocks[1] (if black has moved)
    if (clocks.length > 1) {
      const blackFirstMoveTime = Math.max(0, (clock.initial * 100) - clocks[1])
      timeUsedPerMove.push(blackFirstMoveTime)
    }

    // All subsequent moves: previous clock - current clock
    for (let i = 2; i < clocks.length; i++) {
      const timeUsed = Math.max(0, clocks[i - 2] - clocks[i])
      timeUsedPerMove.push(timeUsed)
    }

    // Find max time used for scaling
    const maxTimeUsed = Math.max(...timeUsedPerMove)
    const whiteBarCount = timeUsedPerMove.filter((_, index) => index % 2 === 0).length
    const blackBarCount = timeUsedPerMove.filter((_, index) => index % 2 === 1).length
    const barWidth = availableWidth / Math.max(timeUsedPerMove.length / 2, 1) // Use available width
    const centerY = timePadding + availableHeight / 2

    // Calculate pan limits based on zoom level
    const calculatePanLimits = (currentZoom: number) => {
      // When zoom = 1, no panning should be allowed (pan offset should be 0)
      if (currentZoom <= 1) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      }

      // When zoomed in, we need to ensure the scaled content's edges don't go beyond viewport edges
      // The transform is: translate(panOffset.x, panOffset.y) scale(zoomLevel)
      //
      // To show the leftmost edge of content:
      //   left edge of scaled content = panOffset.x = 0 (at viewport left)
      //   maxX = 0
      //
      // To show the rightmost edge of content:
      //   right edge of scaled content = panOffset.x + chartWidth * zoom = chartWidth (at viewport right)
      //   panOffset.x = chartWidth - chartWidth * zoom = chartWidth * (1 - zoom)
      //   minX = chartWidth * (1 - zoom)

      const scaledWidth = chartWidth * currentZoom
      const scaledHeight = chartHeight * currentZoom

      return {
        minX: chartWidth - scaledWidth,   // Pan left limit (show right edge of content)
        maxX: 0,                          // Pan right limit (show left edge of content)
        minY: chartHeight - scaledHeight, // Pan up limit (show bottom edge of content)
        maxY: 0                           // Pan down limit (show top edge of content)
      }
    }

    // Function to constrain pan offset within limits
    const constrainPanOffset = (offset: { x: number, y: number }, currentZoom: number) => {
      const limits = calculatePanLimits(currentZoom)

      return {
        x: Math.max(limits.minX, Math.min(limits.maxX, offset.x)),
        y: Math.max(limits.minY, Math.min(limits.maxY, offset.y))
      }
    }

    // Right-click drag handling for panning
    const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
      if (zoomLevel > 1) {
        // Prevent context menu when zoomed in - we want to use right-click for dragging
        e.preventDefault()
      }
    }

    const handleRightMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
      if (zoomLevel <= 1) return // Only allow panning when zoomed in
      if (e.button !== 2) return // Only handle right mouse button

      setIsDragging(true)
      setLastMousePos({ x: e.clientX, y: e.clientY })
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDragging) return

      const deltaX = e.clientX - lastMousePos.x
      const deltaY = e.clientY - lastMousePos.y

      setPanOffset(prev => {
        const newOffset = {
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }
        return constrainPanOffset(newOffset, zoomLevel)
      })

      setLastMousePos({ x: e.clientX, y: e.clientY })
    }

    const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
      if (isDragging) {
        setIsDragging(false)
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const handleMouseLeave = () => {
      if (isDragging) {
        setIsDragging(false)
      }
    }

    // Reset zoom and pan function
    const resetZoomPan = () => {
      setZoomLevel(1)
      // Reset to origin, which is always within bounds for zoom level 1
      setPanOffset({ x: 0, y: 0 })
    }

    // Register non-passive wheel event listener to allow preventDefault
    useEffect(() => {
      const svgElement = svgRef.current
      if (!svgElement) return

      const handleWheelNonPassive = (e: WheelEvent) => {
        e.preventDefault()
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const currentZoom = zoomLevelRef.current
        const newZoom = Math.max(1.0, Math.min(5, currentZoom * zoomFactor))

        // Get mouse position relative to SVG
        const rect = svgElement.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        // Calculate new pan offset to zoom towards mouse position
        const scaleDiff = newZoom / currentZoom
        const currentPan = panOffsetRef.current
        const newPanOffset = {
          x: mouseX - (mouseX - currentPan.x) * scaleDiff,
          y: mouseY - (mouseY - currentPan.y) * scaleDiff
        }

        // Apply pan constraints for the new zoom level (inline since function isn't accessible in useEffect)
        let limits
        if (newZoom <= 1) {
          limits = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
        } else {
          const scaledWidth = chartWidth * newZoom
          const scaledHeight = chartHeight * newZoom
          limits = {
            minX: chartWidth - scaledWidth,   // Pan left limit (show right edge of content)
            maxX: 0,                          // Pan right limit (show left edge of content)
            minY: chartHeight - scaledHeight, // Pan up limit (show bottom edge of content)
            maxY: 0                           // Pan down limit (show top edge of content)
          }
        }
        const constrainedOffset = {
          x: Math.max(limits.minX, Math.min(limits.maxX, newPanOffset.x)),
          y: Math.max(limits.minY, Math.min(limits.maxY, newPanOffset.y))
        }
        setPanOffset(constrainedOffset)

        setZoomLevel(newZoom)
      }

      svgElement.addEventListener('wheel', handleWheelNonPassive, { passive: false })

      return () => {
        svgElement.removeEventListener('wheel', handleWheelNonPassive)
      }
    }, []) // Empty dependency array - only run once


    return (
      <div style={{
        width: `${chartWidth + 16}px`,
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '8px',
        backgroundColor: 'var(--background-primary)'
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: '600',
          marginBottom: '8px',
          color: 'var(--text-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Time Per Move (seconds)</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              fontWeight: 'normal'
            }}>
              {(() => {
                const currentGame = filteredGames[currentGameIndex]
                if (!currentGame?.clock) return ''
                const minutes = Math.floor(currentGame.clock.initial / 60)
                const increment = currentGame.clock.increment
                return `${minutes}+${increment}`
              })()}
            </span>
            {zoomLevel > 1 && (
              <button
                onClick={resetZoomPan}
                style={{
                  fontSize: '8px',
                  padding: '1px 6px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '2px',
                  backgroundColor: 'var(--background-tertiary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
                title="Reset zoom and pan"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <svg
          ref={svgRef}
          width={chartWidth}
          height={chartHeight}
          style={{
            backgroundColor: 'var(--background-tertiary)',
            borderRadius: '2px',
            cursor: isDragging ? 'grabbing' : (zoomLevel > 1 ? 'grab' : 'default')
          }}
          onContextMenu={handleContextMenu}
          onMouseDown={handleRightMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoomLevel})`}>
          {/* Center line */}
          <line
            x1={timePadding}
            y1={centerY}
            x2={timePadding + availableWidth}
            y2={centerY}
            stroke="var(--border-dark)"
            strokeWidth="1"
          />

          {/* Division lines */}
          {(() => {
            const currentGame = filteredGames[currentGameIndex]
            const division = currentGame?.division
            const divisionLines = []

            // Middle game line
            if (division?.middle && division.middle <= timeUsedPerMove.length) {
              const middleX = timePadding + (division.middle / Math.max(timeUsedPerMove.length, 1)) * availableWidth
              divisionLines.push(
                <line
                  key="middle"
                  x1={middleX}
                  y1={0}
                  x2={middleX}
                  y2={chartHeight}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                  opacity="0.7"
                />
              )
            }

            // End game line
            if (division?.end && division.end <= timeUsedPerMove.length) {
              const endX = timePadding + (division.end / Math.max(timeUsedPerMove.length, 1)) * availableWidth
              divisionLines.push(
                <line
                  key="end"
                  x1={endX}
                  y1={0}
                  x2={endX}
                  y2={chartHeight}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                  opacity="0.7"
                />
              )
            }

            return divisionLines
          })()}

          {/* Time bars */}
          {timeUsedPerMove.map((timeUsed, index) => {
            const isWhiteMove = index % 2 === 0
            const moveIndex = index + 1
            const isCurrentMove = Math.floor(displayedMoveIndex) === moveIndex
            const isHovered = hoveredMoveIndex === moveIndex
            const barHeight = (timeUsed / maxTimeUsed) * (availableHeight / 2) * 0.9 // 90% of half available height

            // Pack bars tighter: white bars are contiguous, black bars are staggered by half a bar width
            const x = timePadding + (isWhiteMove ? Math.floor(index / 2) * barWidth : Math.floor(index / 2) * barWidth + barWidth / 2)

            // Convert centiseconds to seconds for display
            const timeInSeconds = (timeUsed / 100).toFixed(1)

            return (
              <rect
                key={index}
                x={x}
                y={isWhiteMove ? centerY - barHeight : centerY}
                width={barWidth}
                height={barHeight}
                fill={isWhiteMove ? 'var(--text-primary)' : 'var(--background-secondary)'}
                stroke={isCurrentMove ? 'var(--success-color)' : (isHovered ? 'var(--secondary-light)' : (isWhiteMove ? 'var(--background-secondary)' : 'var(--border-dark)'))}
                strokeWidth={isCurrentMove ? 2 : (isHovered ? 2 : 1)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredMoveIndex(moveIndex)}
                onMouseLeave={() => setHoveredMoveIndex(null)}
                onClick={() => {
                  setTargetMoveIndex(moveIndex)
                  goToMoveImmediate(moveIndex)
                }}
              />
            )
          })}

          {/* Time labels - rendered after bars to ensure they're always on top */}
          {timeUsedPerMove.map((timeUsed, index) => {
            const isWhiteMove = index % 2 === 0
            const moveIndex = index + 1
            const isCurrentMove = Math.floor(displayedMoveIndex) === moveIndex
            const isHovered = hoveredMoveIndex === moveIndex
            const barHeight = (timeUsed / maxTimeUsed) * (availableHeight / 2) * 0.9 // 90% of half available height

            // Pack bars tighter: white bars are contiguous, black bars are staggered by half a bar width
            const x = timePadding + (isWhiteMove ? Math.floor(index / 2) * barWidth : Math.floor(index / 2) * barWidth + barWidth / 2)

            // Convert centiseconds to seconds for display
            const timeInSeconds = (timeUsed / 100).toFixed(1)

            // Only show time label on hover or current move
            if (!(isCurrentMove || isHovered)) return null

            return (
              <text
                key={`label-${index}`}
                x={x + barWidth / 2}
                y={isWhiteMove ? centerY - barHeight - 5 : centerY + barHeight + 15}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-primary)"
                fontWeight="bold"
                stroke="black"
                strokeWidth="1"
                paintOrder="stroke fill"
                style={{ pointerEvents: 'none' }}
              >
                {timeInSeconds}s
              </text>
            )
          })}
          </g>
        </svg>
      </div>
    )
  }


  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={toggleBoard}
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
        <img
          src="/static/images/learn_chess_like_a_computer_logo_icon_white.png"
          alt="Logo"
          style={{
            width: '24px',
            height: '24px'
          }}
        />
        <span style={{
          color: 'var(--text-on-primary)',
          fontSize: '10px',
          fontWeight: '600',
          textAlign: 'center',
          lineHeight: '1'
        }}>
          BUDDY<br />BOARD
        </span>
      </button>

      {/* Board Panel */}
      <div
          ref={buddyBoardRef}
          style={{
            position: 'fixed',
            left: `${boardPosition.x}px`,
            top: `${boardPosition.y}px`,
            width: '700px',
            maxHeight: '80vh',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '12px',
            padding: '10px 20px 20px 20px',
            boxShadow: '0 12px 40px var(--shadow-medium), 0 4px 12px rgba(0, 0, 0, 0.1)',
            zIndex: 2000,
            overflowY: 'auto',
            transform: isVisible ? 'scale(1)' : 'scale(0.1)',
            transformOrigin: `${window.innerWidth - boardPosition.x}px ${window.innerHeight - boardPosition.y}px`,
            transition: isDraggingBoard ? 'none' : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: isVisible ? 1 : 0,
            pointerEvents: isVisible ? 'auto' : 'none',
            cursor: isDraggingBoard ? 'grabbing' : 'default'
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onMouseDown={handleHeaderMouseDown}
        >
            {/* Close button */}
            <button
              onClick={toggleBoard}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '5px',
                right: '5px',
                background: 'none',
                border: 'none',
                fontSize: '20px',
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

            {/* Header with Game Selection */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                position: 'relative',
                margin: '4px',
                cursor: isDraggingBoard ? 'grabbing' : 'grab',
                userSelect: 'none'
              }}
              onMouseDown={handleHeaderMouseDown}
            >
              <h3 style={{
                margin: '0',
                fontSize: '16px',
                color: 'var(--text-primary)',
                fontWeight: '600',
                position: 'absolute',
                left: '0'
              }}>
                Buddy Board
              </h3>

              {filteredGames.length > 0 ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  {filteredGames.length > 1 && (
                    <select
                      value={currentGameIndex}
                      onChange={(e) => loadGame(Number(e.target.value))}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        padding: '6px 10px',
                        fontSize: '11px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        backgroundColor: 'var(--background-secondary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        minWidth: '180px'
                      }}
                    >
                      {filteredGames
                        .map((game, filteredIndex) => ({ game, filteredIndex }))
                        .sort((a, b) => (b.game.createdAt || 0) - (a.game.createdAt || 0))
                        .map(({ game, filteredIndex }, sortedIndex) => {
                          const whiteName = game.players?.white?.user?.name || game.players?.white?.name || 'Unknown';
                          const blackName = game.players?.black?.user?.name || game.players?.black?.name || 'Unknown';
                          return (
                            <option key={filteredIndex} value={filteredIndex}>
                              Game {sortedIndex + 1}: {whiteName} vs {blackName}
                            </option>
                          );
                        })}
                    </select>
                  )}
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap'
                  }}>
{filteredGames.length} of {games.length} games
                  </span>
                </div>
              ) : (
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap'
                }}>
                  No games loaded
                </div>
              )}
            </div>

            {/* Move List and Chess Board Container */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }} onMouseDown={(e) => e.stopPropagation()}>
              {/* Move List or Empty State */}
              {filteredGames.length === 0 || !filteredGames[currentGameIndex] || !gameLoaded || currentMoves.length === 0 ? (
                <div style={{
                  width: '200px',
                  height: `${size}px`,
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '16px',
                  backgroundColor: 'var(--background-primary)',
                  marginTop: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  No game loaded
                </div>
              ) : (
                <div
                  ref={moveListRef}
                  style={{
                    width: '200px',
                    height: `${size}px`,
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '0 8px 8px 8px',
                    backgroundColor: 'var(--background-primary)',
                    marginTop: '20px'
                  }}>
                  {/* Opening - Sticky at top */}
                  {filteredGames[currentGameIndex].opening && (
                    <div style={{
                      position: 'sticky',
                      top: '0',
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                      padding: '8px',
                      backgroundColor: 'var(--background-primary)',
                      borderBottom: '1px solid var(--border-color)',
                      zIndex: 1
                    }}>
                      {filteredGames[currentGameIndex].opening.name}
                    </div>
                  )}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 1fr',
                    gap: '2px',
                    fontSize: '11px'
                  }}>
                    {/* Starting position */}
                    <div
                      data-move-index="0"
                      style={{
                        gridColumn: '1 / -1',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        backgroundColor: displayedMoveIndex === 0 ? 'var(--success-color)' : (hoveredMoveIndex === 0 ? 'var(--hover-background)' : 'transparent'),
                        color: displayedMoveIndex === 0 ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                        fontWeight: displayedMoveIndex === 0 ? '600' : 'normal'
                      }}
                      onMouseEnter={() => setHoveredMoveIndex(0)}
                      onMouseLeave={() => setHoveredMoveIndex(null)}
                      onClick={() => {
                        setTargetMoveIndex(0)
                        goToMoveImmediate(0)
                      }}>
                      Start
                    </div>

                    {/* Helper function to convert ply to move number and determine if indicator should be shown */}
                    {(() => {
                      const currentGame = filteredGames[currentGameIndex]
                      const division = currentGame?.division

                      // Convert plies to move numbers (rounding down)
                      const middleMove = division?.middle ? Math.floor(division.middle / 2) : null
                      const endMove = division?.end ? Math.floor(division.end / 2) : null

                      return (
                        <>
                          {/* Move pairs */}
                          {Array.from({ length: Math.ceil(currentMoves.length / 2) }, (_, pairIndex) => {
                            const showMiddleIndicator = middleMove === pairIndex
                            const showEndIndicator = endMove === pairIndex

                            return (
                              <React.Fragment key={pairIndex}>
                                {/* Division indicators */}
                                {showMiddleIndicator && (
                                  <div style={{
                                    gridColumn: '1 / -1',
                                    margin: '4px 0',
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontSize: '8px',
                                    color: 'var(--text-muted)',
                                    fontWeight: '600'
                                  }}>
                                    <div style={{
                                      height: '1px',
                                      backgroundColor: 'var(--text-muted)',
                                      flex: '1'
                                    }}></div>
                                    <span style={{
                                      padding: '0 6px',
                                      backgroundColor: 'var(--background-primary)'
                                    }}>MIDDLE</span>
                                    <div style={{
                                      height: '1px',
                                      backgroundColor: 'var(--text-muted)',
                                      flex: '1'
                                    }}></div>
                                  </div>
                                )}
                                {showEndIndicator && (
                                  <div style={{
                                    gridColumn: '1 / -1',
                                    margin: '4px 0',
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontSize: '8px',
                                    color: 'var(--text-muted)',
                                    fontWeight: '600'
                                  }}>
                                    <div style={{
                                      height: '1px',
                                      backgroundColor: 'var(--text-muted)',
                                      flex: '1'
                                    }}></div>
                                    <span style={{
                                      padding: '0 6px',
                                      backgroundColor: 'var(--background-primary)'
                                    }}>END</span>
                                    <div style={{
                                      height: '1px',
                                      backgroundColor: 'var(--text-muted)',
                                      flex: '1'
                                    }}></div>
                                  </div>
                                )}

                                {/* Move data for this pair */}
                                {(() => {
                                  const whiteMove = currentMoves[pairIndex * 2]
                                  const blackMove = currentMoves[pairIndex * 2 + 1]
                                  const whiteMoveNumber = pairIndex * 2 + 1
                                  const blackMoveNumber = pairIndex * 2 + 2

                                  return (
                                    <>
                                      {/* Move number */}
                                      <div style={{
                                        padding: '2px 0',
                                        color: 'var(--text-muted)',
                                        fontSize: '10px',
                                        textAlign: 'center'
                                      }}>
                                        {pairIndex + 1}.
                                      </div>

                                      {/* White move */}
                                      <div
                                        data-move-index={whiteMoveNumber}
                                        style={{
                                          padding: '2px 4px',
                                          borderRadius: '2px',
                                          cursor: 'pointer',
                                          backgroundColor: displayedMoveIndex === whiteMoveNumber ? 'var(--success-color)' : (hoveredMoveIndex === whiteMoveNumber ? 'var(--hover-background)' : 'transparent'),
                                          color: displayedMoveIndex === whiteMoveNumber ? 'var(--text-on-primary)' : 'var(--text-primary)',
                                          fontWeight: displayedMoveIndex === whiteMoveNumber ? '600' : 'normal',
                                          fontFamily: 'monospace',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between'
                                        }}
                                        onMouseEnter={() => setHoveredMoveIndex(whiteMoveNumber)}
                                        onMouseLeave={() => setHoveredMoveIndex(null)}
                                        onClick={() => {
                                          setTargetMoveIndex(whiteMoveNumber)
                                          goToMoveImmediate(whiteMoveNumber)
                                        }}
                                      >
                                        <span>{whiteMove}</span>
                                        {(() => {
                                          const analysis = filteredGames[currentGameIndex]?.analysis
                                          if (!analysis || whiteMoveNumber - 1 >= analysis.length) return null
                                          const moveAnalysis = analysis[whiteMoveNumber - 1]
                                          const judgment = moveAnalysis?.judgment
                                          if (!judgment) return null

                                          let symbol, bgColor
                                          switch (judgment.name) {
                                            case 'Inaccuracy':
                                              symbol = '!'
                                              bgColor = 'var(--secondary-light)'
                                              break
                                            case 'Mistake':
                                              symbol = '?'
                                              bgColor = 'var(--warning-color)'
                                              break
                                            case 'Blunder':
                                              symbol = '??'
                                              bgColor = 'var(--danger-color)'
                                              break
                                            default:
                                              return null
                                          }

                                          return (
                                            <span style={{
                                              width: '14px',
                                              height: '14px',
                                              borderRadius: '50%',
                                              backgroundColor: bgColor,
                                              color: 'white',
                                              fontSize: '8px',
                                              fontWeight: 'bold',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              marginLeft: '2px'
                                            }}>
                                              {symbol}
                                            </span>
                                          )
                                        })()}
                                      </div>

                                      {/* Black move */}
                                      {blackMove && (
                                        <div
                                          data-move-index={blackMoveNumber}
                                          style={{
                                            padding: '2px 4px',
                                            borderRadius: '2px',
                                            cursor: 'pointer',
                                            backgroundColor: displayedMoveIndex === blackMoveNumber ? 'var(--success-color)' : (hoveredMoveIndex === blackMoveNumber ? 'var(--hover-background)' : 'transparent'),
                                            color: displayedMoveIndex === blackMoveNumber ? 'var(--text-on-primary)' : 'var(--text-primary)',
                                            fontWeight: displayedMoveIndex === blackMoveNumber ? '600' : 'normal',
                                            fontFamily: 'monospace',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between'
                                          }}
                                          onMouseEnter={() => setHoveredMoveIndex(blackMoveNumber)}
                                          onMouseLeave={() => setHoveredMoveIndex(null)}
                                          onClick={() => {
                                            setTargetMoveIndex(blackMoveNumber)
                                            goToMoveImmediate(blackMoveNumber)
                                          }}
                                        >
                                          <span>{blackMove}</span>
                                          {(() => {
                                            const analysis = filteredGames[currentGameIndex]?.analysis
                                            if (!analysis || blackMoveNumber - 1 >= analysis.length) return null
                                            const moveAnalysis = analysis[blackMoveNumber - 1]
                                            const judgment = moveAnalysis?.judgment
                                            if (!judgment) return null

                                            let symbol, bgColor
                                            switch (judgment.name) {
                                              case 'Inaccuracy':
                                                symbol = '!'
                                                bgColor = 'var(--secondary-light)'
                                                break
                                              case 'Mistake':
                                                symbol = '?'
                                                bgColor = 'var(--warning-color)'
                                                break
                                              case 'Blunder':
                                                symbol = '??'
                                                bgColor = 'var(--danger-color)'
                                                break
                                              default:
                                                return null
                                            }

                                            return (
                                              <span style={{
                                                width: '14px',
                                                height: '14px',
                                                borderRadius: '50%',
                                                backgroundColor: bgColor,
                                                color: 'white',
                                                fontSize: '8px',
                                                fontWeight: 'bold',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                marginLeft: '2px'
                                              }}>
                                                {symbol}
                                              </span>
                                            )
                                          })()}
                                        </div>
                                      )}

                                      {/* Empty cell if no black move */}
                                      {!blackMove && <div></div>}
                                    </>
                                  )
                                })()}
                              </React.Fragment>
                            )
                          })}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Chess Board with Player Names and Flip Button */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* Top Player Name with Game Result */}
                  <div style={{
                    position: 'relative',
                    fontSize: '12px',
                    fontWeight: '600',
                    marginBottom: '4px',
                    width: `${size}px`,
                    textAlign: 'left'
                  }}>
                    <div style={{ color: 'var(--text-primary)' }}>
                      {filteredGames.length > 0 && filteredGames[currentGameIndex]
                        ? (boardOrientation === 'white'
                          ? (filteredGames[currentGameIndex].players?.black?.user?.name || filteredGames[currentGameIndex].players?.black?.name || 'Unknown')
                          : (filteredGames[currentGameIndex].players?.white?.user?.name || filteredGames[currentGameIndex].players?.white?.name || 'Unknown'))
                        : 'Player'}
                    </div>

                    <div style={{
                      position: 'absolute',
                      top: '0',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}>
                      {(() => {
                        if (!filteredGames.length || !filteredGames[currentGameIndex]) {
                          return 'No game loaded'
                        }
                        const currentGame = filteredGames[currentGameIndex]
                        const winner = currentGame.winner
                        const status = currentGame.status

                        // Draw takes precedence
                        if (winner === null) {
                          return 'Draw'
                        }

                        // Determine the winning method based on status
                        let method = ''
                        switch (status) {
                          case 'mate':
                            method = 'by checkmate'
                            break
                          case 'resign':
                            method = 'by resignation'
                            break
                          case 'outoftime':
                            method = 'on time'
                            break
                          default:
                            method = 'by ' + (status || 'resignation')
                        }

                        // Capitalize winner
                        const winnerCapitalized = winner?.charAt(0).toUpperCase() + winner?.slice(1)

                        return `${winnerCapitalized} wins ${method}`
                      })()}
                    </div>

                    {/* Top Player Clock */}
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      right: '0',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}>
                      {(() => {
                        if (!filteredGames.length || !filteredGames[currentGameIndex]) return ''
                        const currentGame = filteredGames[currentGameIndex]
                        if (!currentGame.clocks || !currentGame.clock) return ''

                        // Determine which player's clock to show (top player)
                        const isWhiteOnTop = boardOrientation === 'black'

                        // Get the appropriate clock time based on current move
                        // clocks[0] = white after move 1, clocks[1] = black after move 1, etc.
                        let clockTime

                        if (displayedMoveIndex === 0) {
                          // Starting position - use initial time from game settings
                          clockTime = currentGame.clock.initial * 100 // Convert seconds to centiseconds
                        } else {
                          if (isWhiteOnTop) {
                            // Top player is white
                            // White's moves are at even indices (0, 2, 4...)
                            const whiteMove = Math.floor((displayedMoveIndex - 1) / 2)
                            const whiteClockIndex = whiteMove * 2
                            clockTime = currentGame.clocks[whiteClockIndex] || currentGame.clock.initial * 100
                          } else {
                            // Top player is black
                            // Black's moves are at odd indices (1, 3, 5...)
                            if (displayedMoveIndex === 1) {
                              // After white's first move, black hasn't moved yet
                              clockTime = currentGame.clock.initial * 100
                            } else {
                              const blackMove = Math.floor((displayedMoveIndex - 2) / 2)
                              const blackClockIndex = blackMove * 2 + 1
                              clockTime = currentGame.clocks[blackClockIndex] || currentGame.clock.initial * 100
                            }
                          }
                        }

                        // Convert centiseconds to MM:SS or MM:SS.S format
                        const totalCentiseconds = Math.round(clockTime)
                        const totalSeconds = totalCentiseconds / 100
                        const minutes = Math.floor(totalSeconds / 60)
                        const seconds = totalSeconds % 60

                        if (totalSeconds < 60) {
                          // Under a minute - show tenths with smaller decimal
                          const wholePart = `${minutes}:${Math.floor(seconds).toString().padStart(2, '0')}`
                          const tenthPart = (seconds % 1).toFixed(1).substring(1) // Get ".X" part
                          return (
                            <span>
                              {wholePart}
                              <span style={{ fontSize: '0.8em' }}>{tenthPart}</span>
                            </span>
                          )
                        } else {
                          // Over a minute - round down to nearest second
                          return `${minutes}:${Math.floor(seconds).toString().padStart(2, '0')}`
                        }
                      })()}
                    </div>
                  </div>

                  {/* Chess Board */}
                  <BaseChessBoard
                    size={size}
                    pieceTheme={pieceTheme}
                    orientation={boardOrientation}
                    coordinates={true}
                    showGameEndSymbols={true}
                    showCheckHighlight={true}
                    position={position}
                    interactive={true}
                    allowPieceDragging={false}
                    lastMove={lastMove}
                    animationData={animationData}
                    onAnimationComplete={handleAnimationComplete}
                    animationDuration={150}
                  />

                  {/* Bottom Player Name */}
                  <div style={{
                    position: 'relative',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                    width: `${size}px`
                  }}>
                    {filteredGames.length > 0 && filteredGames[currentGameIndex]
                      ? (boardOrientation === 'white'
                        ? (filteredGames[currentGameIndex].players?.white?.user?.name || filteredGames[currentGameIndex].players?.white?.name || 'Unknown')
                        : (filteredGames[currentGameIndex].players?.black?.user?.name || filteredGames[currentGameIndex].players?.black?.name || 'Unknown'))
                      : 'Player'}

                    {/* Bottom Player Clock */}
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      right: '0',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}>
                      {(() => {
                        if (!filteredGames.length || !filteredGames[currentGameIndex]) return ''
                        const currentGame = filteredGames[currentGameIndex]
                        if (!currentGame.clocks || !currentGame.clock) return ''

                        // Determine which player's clock to show (bottom player)
                        const isWhiteOnBottom = boardOrientation === 'white'

                        // Get the appropriate clock time based on current move
                        // clocks[0] = white after move 1, clocks[1] = black after move 1, etc.
                        let clockTime

                        if (displayedMoveIndex === 0) {
                          // Starting position - use initial time from game settings
                          clockTime = currentGame.clock.initial * 100 // Convert seconds to centiseconds
                        } else {
                          if (isWhiteOnBottom) {
                            // Bottom player is white
                            // White's moves are at even indices (0, 2, 4...)
                            const whiteMove = Math.floor((displayedMoveIndex - 1) / 2)
                            const whiteClockIndex = whiteMove * 2
                            clockTime = currentGame.clocks[whiteClockIndex] || currentGame.clock.initial * 100
                          } else {
                            // Bottom player is black
                            // Black's moves are at odd indices (1, 3, 5...)
                            if (displayedMoveIndex === 1) {
                              // After white's first move, black hasn't moved yet
                              clockTime = currentGame.clock.initial * 100
                            } else {
                              const blackMove = Math.floor((displayedMoveIndex - 2) / 2)
                              const blackClockIndex = blackMove * 2 + 1
                              clockTime = currentGame.clocks[blackClockIndex] || currentGame.clock.initial * 100
                            }
                          }
                        }

                        // Convert centiseconds to MM:SS or MM:SS.S format
                        const totalCentiseconds = Math.round(clockTime)
                        const totalSeconds = totalCentiseconds / 100
                        const minutes = Math.floor(totalSeconds / 60)
                        const seconds = totalSeconds % 60

                        if (totalSeconds < 60) {
                          // Under a minute - show tenths with smaller decimal
                          const wholePart = `${minutes}:${Math.floor(seconds).toString().padStart(2, '0')}`
                          const tenthPart = (seconds % 1).toFixed(1).substring(1) // Get ".X" part
                          return (
                            <span>
                              {wholePart}
                              <span style={{ fontSize: '0.8em' }}>{tenthPart}</span>
                            </span>
                          )
                        } else {
                          // Over a minute - round down to nearest second
                          return `${minutes}:${Math.floor(seconds).toString().padStart(2, '0')}`
                        }
                      })()}
                    </div>
                  </div>
                </div>

                {/* Flip Button */}
                <button
                  onClick={() => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white')}
                  style={{
                    width: '32px',
                    height: '32px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: 'var(--background-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    color: 'var(--text-secondary)',
                    marginTop: '20px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--background-secondary)'
                  }}
                  title="Flip board"
                >
                  ↕
                </button>
              </div>
            </div>

            {/* Charts Row */}
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '16px' }} onMouseDown={(e) => e.stopPropagation()}>
              <EvaluationChart />
              <TimeChart
                zoomLevel={timeChartZoom}
                panOffset={timeChartPan}
                setZoomLevel={setTimeChartZoom}
                setPanOffset={setTimeChartPan}
                isDragging={timeChartIsDragging}
                setIsDragging={setTimeChartIsDragging}
                lastMousePos={timeChartLastMousePos}
                setLastMousePos={setTimeChartLastMousePos}
              />
            </div>


            {/* Navigation Controls */}
            {gameLoaded && filteredGames.length > 0 && filteredGames[currentGameIndex] && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '12px'
              }}
              onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={goToStart}
                  disabled={targetMoveIndex === 0}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: targetMoveIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                    color: targetMoveIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: targetMoveIndex === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  ⏮ Start
                </button>
                <button
                  onClick={prevMove}
                  disabled={targetMoveIndex === 0}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: targetMoveIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                    color: targetMoveIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: targetMoveIndex === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  ⏪ Prev
                </button>
                <button
                  onClick={nextMove}
                  disabled={targetMoveIndex >= currentMoves.length}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: targetMoveIndex >= currentMoves.length ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                    color: targetMoveIndex >= currentMoves.length ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: targetMoveIndex >= currentMoves.length ? 'not-allowed' : 'pointer'
                  }}
                >
                  Next ⏩
                </button>
                <button
                  onClick={goToEnd}
                  disabled={targetMoveIndex >= currentMoves.length}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: targetMoveIndex >= currentMoves.length ? 'var(--background-tertiary)' : 'var(--background-secondary)',
                    color: targetMoveIndex >= currentMoves.length ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: targetMoveIndex >= currentMoves.length ? 'not-allowed' : 'pointer'
                  }}
                >
                  End ⏭
                </button>
              </div>
            )}
        </div>
    </>
  )
}

export default BuddyBoard
