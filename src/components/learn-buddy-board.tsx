import React, { useState, useRef, useEffect } from 'react'
import BaseChessBoard from './base-chess-board'
import { Chess } from 'chess.js'
import { StartIcon, PrevIcon, NextIcon, EndIcon } from './navigation-icons'

export interface LearnBuddyBoardProps {
  size?: number
  pieceTheme?: string
}

// ELO ranges matching the generate_all_elo_stats.py script
const ELO_RANGES = [
  { label: 'Below 600', value: 'below-600' },
  { label: '600-700', value: '600-700' },
  { label: '700-800', value: '700-800' },
  { label: '800-900', value: '800-900' },
  { label: '900-1000', value: '900-1000' },
  { label: '1000-1100', value: '1000-1100' },
  { label: '1100-1200', value: '1100-1200' },
  { label: '1200-1300', value: '1200-1300' },
  { label: '1300-1400', value: '1300-1400' },
  { label: '1400-1500', value: '1400-1500' },
  { label: '1500-1600', value: '1500-1600' },
  { label: '1600-1700', value: '1600-1700' },
  { label: '1700-1800', value: '1700-1800' },
  { label: '1800-1900', value: '1800-1900' },
  { label: '1900-2000', value: '1900-2000' },
  { label: '2000-2100', value: '2000-2100' },
  { label: '2100-2200', value: '2100-2200' },
  { label: '2200-2300', value: '2200-2300' },
  { label: '2300-2400', value: '2300-2400' },
  { label: '2400+', value: '2400+' },
]

interface GameData {
  id: string
  moves: string
  players: {
    white: { user: { name: string }, rating?: number }
    black: { user: { name: string }, rating?: number }
  }
  opening?: { name: string, eco?: string }
  winner?: string | null
  analysis?: any[]
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

/**
 * LearnBuddyBoard - A simplified, always-visible chess board for learn pages
 * Unlike the main BuddyBoard which has a toggle button and dragging functionality,
 * this component is designed to be embedded directly in the page content.
 */
const LearnBuddyBoard: React.FC<LearnBuddyBoardProps> = ({
  size = 400,
  pieceTheme
}) => {
  const [chess] = useState(() => new Chess())
  const [position, setPosition] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  const [currentMoves, setCurrentMoves] = useState<string[]>([])
  const [displayedMoveIndex, setDisplayedMoveIndex] = useState(0)
  const [hoveredMoveIndex, setHoveredMoveIndex] = useState<number | null>(null)
  const [lastMove, setLastMove] = useState<{ from: string, to: string } | null>(null)
  const [gameLoaded, setGameLoaded] = useState(false)
  const [selectedEloRange, setSelectedEloRange] = useState('1500-1600')
  const [loadedGames, setLoadedGames] = useState<GameData[]>([])
  const [currentGameIndex, setCurrentGameIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const [showJudgmentsFor, setShowJudgmentsFor] = useState<'white' | 'black'>('white')
  const [evaluationChartFlipped, setEvaluationChartFlipped] = useState(false)
  const [timeChartZoom, setTimeChartZoom] = useState(1)
  const [timeChartPan, setTimeChartPan] = useState({ x: 0, y: 0 })
  const [timeChartIsDragging, setTimeChartIsDragging] = useState(false)
  const [timeChartLastMousePos, setTimeChartLastMousePos] = useState({ x: 0, y: 0 })
  const moveListRef = useRef<HTMLDivElement>(null)

  // Auto-load 1500-1600 range on component mount
  useEffect(() => {
    loadGamesFromEloRange('1500-1600')
  }, [])

  // Calculate the last move for highlighting
  const calculateLastMove = (moveIndex: number): { from: string, to: string } | null => {
    if (moveIndex === 0 || currentMoves.length === 0) {
      return null
    }

    // Recreate the game state up to the target move
    const tempChess = new Chess()
    for (let i = 0; i < moveIndex - 1; i++) {
      tempChess.move(currentMoves[i])
    }

    // Get the move object for the last move
    const lastMoveObj = tempChess.move(currentMoves[moveIndex - 1])
    if (lastMoveObj) {
      return { from: lastMoveObj.from, to: lastMoveObj.to }
    }

    return null
  }

  // Navigate to a specific move
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
    setPosition(chess.fen())
    setLastMove(calculateLastMove(moveIndex))
  }

  // Navigation functions
  const goToStart = () => {
    goToMoveImmediate(0)
  }

  const prevMove = () => {
    const newIndex = Math.max(displayedMoveIndex - 1, 0)
    goToMoveImmediate(newIndex)
  }

  const nextMove = () => {
    const newIndex = Math.min(displayedMoveIndex + 1, currentMoves.length)
    goToMoveImmediate(newIndex)
  }

  const goToEnd = () => {
    goToMoveImmediate(currentMoves.length)
  }

  // Load a specific game from the loaded games array
  const loadGame = (gameIndex: number) => {
    if (gameIndex < 0 || gameIndex >= loadedGames.length) return

    const game = loadedGames[gameIndex]
    const moves = game.moves.split(' ').filter(move => move.trim() !== '')

    setCurrentGameIndex(gameIndex)
    setCurrentMoves(moves)
    setDisplayedMoveIndex(0)

    // Reset chess position to starting position
    chess.reset()
    setPosition(chess.fen())
    setLastMove(null)
    setGameLoaded(true)
    setError(null)
  }

  // Load games from the selected ELO range
  const loadGamesFromEloRange = async (eloRange: string) => {
    if (!eloRange) {
      setError('Please select an ELO range')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/static/data/random_games/${eloRange}.json`)

      if (!response.ok) {
        throw new Error(`Failed to load games for ${eloRange}`)
      }

      const games: GameData[] = await response.json()

      if (!Array.isArray(games) || games.length === 0) {
        throw new Error('No games found in the file')
      }

      setLoadedGames(games)
      setCurrentGameIndex(0)

      // Load the first game
      const firstGame = games[0]
      const moves = firstGame.moves.split(' ').filter(move => move.trim() !== '')

      setCurrentMoves(moves)
      setDisplayedMoveIndex(0)
      chess.reset()
      setPosition(chess.fen())
      setLastMove(null)
      setGameLoaded(true)

      console.log(`Loaded ${games.length} games from ${eloRange}`)
    } catch (error) {
      console.error('Error loading games:', error)
      setError(error instanceof Error ? error.message : 'Failed to load games')
      setLoadedGames([])
      setGameLoaded(false)
    } finally {
      setLoading(false)
    }
  }

  // Handle ELO range selection
  const handleEloRangeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const range = e.target.value
    setSelectedEloRange(range)
    if (range) {
      loadGamesFromEloRange(range)
    }
  }

  // Navigate to previous/next game
  const previousGame = () => {
    if (currentGameIndex > 0) {
      loadGame(currentGameIndex - 1)
    }
  }

  const nextGame = () => {
    if (currentGameIndex < loadedGames.length - 1) {
      loadGame(currentGameIndex + 1)
    }
  }

  const currentGame = loadedGames[currentGameIndex]

  // Function to get win rate percentage from precomputed data
  const getWinRatePercentage = (analysis: any, moveIndex?: number): number => {
    // Use precomputed lichess_win_percentage_white if available
    if (analysis.lichess_win_percentage_white !== undefined) {
      return analysis.lichess_win_percentage_white
    }

    // Special case: handle checkmate positions
    if (analysis.mate !== undefined) {
      if (analysis.mate === 0) {
        // Checkmate has been delivered - need to determine who won based on whose turn it was
        if (moveIndex !== undefined) {
          const whiteMoved = moveIndex % 2 === 1
          return whiteMoved ? 100 : 0  // White wins = 100%, Black wins = 0%
        }
        return 0
      } else {
        // Mate values: positive mate favors white (100%), negative favors black (0%)
        return analysis.mate > 0 ? 100 : 0
      }
    }

    return 50 // Neutral position = 50% win rate (fallback)
  }

  // Create evaluation chart component
  const EvaluationChart = () => {
    if (!currentGame?.analysis) {
      return (
        <div style={{
          width: '316px',
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
            height: '150px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No analysis data
          </div>
        </div>
      )
    }

    const chartWidth = 300
    const chartHeight = 150

    const analysis = currentGame.analysis

    // Add starting position (index 0) with neutral evaluation, then analysis data
    const allEvaluations = [{ lichess_win_percentage_white: 50 }, ...analysis]

    // Convert evaluations to chart coordinates using win rate percentage
    const chartPadding = 8
    const availableWidth = chartWidth - (2 * chartPadding)
    const availableHeight = chartHeight - (2 * chartPadding)

    const points = allEvaluations.map((item, index) => {
      const x = chartPadding + (index / Math.max(allEvaluations.length - 1, 1)) * availableWidth
      const winRatePercent = getWinRatePercentage(item, index)
      const y = chartPadding + (availableHeight - (winRatePercent / 100) * availableHeight)
      return { x, y, winRatePercent, index }
    })

    // Create path string
    const pathData = points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    ).join(' ')

    return (
      <div style={{
        width: '316px',
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
                e.stopPropagation()
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
              const currentAnalysis = displayedMoveIndex > 0 ? analysis[displayedMoveIndex - 1] : null
              const hasMate = currentAnalysis?.mate !== undefined

              if (hasMate) {
                const mateValue = currentAnalysis.mate
                if (mateValue === 0) {
                  const whiteMoved = displayedMoveIndex % 2 === 1
                  return (
                    <span>
                      {whiteMoved ? 'White wins - Checkmate!' : 'Black wins - Checkmate!'}
                    </span>
                  )
                } else {
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
                const division = currentGame?.division
                const divisionLines = []

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
                const rawJudgment = index > 0 ? analysis[index - 1]?.judgment : null

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
                    onClick={() => goToMoveImmediate(index)}
                  />
                )
              })}

              {/* 50% line (equal position) */}
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
                  {currentGame.players?.white?.user?.name || 'Unknown'}
                </div>
                <div style={{ fontSize: '10px' }}>
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
                  {currentGame.players?.black?.user?.name || 'Unknown'}
                </div>
                <div style={{ fontSize: '10px' }}>
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
  const TimeChart = () => {
    if (!currentGame?.clocks || !currentGame?.clock) {
      return (
        <div style={{
          width: '316px',
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
            height: '150px',
            backgroundColor: 'var(--background-tertiary)',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No clock data
          </div>
        </div>
      )
    }

    const chartWidth = 300
    const chartHeight = 150

    const svgRef = useRef<SVGSVGElement>(null)

    // Only keep refs needed for wheel zoom
    const zoomLevelRef = useRef(timeChartZoom)
    const panOffsetRef = useRef(timeChartPan)

    // Update refs when state/props change
    useEffect(() => {
      zoomLevelRef.current = timeChartZoom
    }, [timeChartZoom])

    useEffect(() => {
      panOffsetRef.current = timeChartPan
    }, [timeChartPan])

    const { clocks, clock } = currentGame

    // Add padding to prevent text cutoff
    const timePadding = 12
    const availableWidth = chartWidth - (2 * timePadding)
    const availableHeight = chartHeight - (2 * timePadding)

    // Calculate time used per move
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
    const barWidth = availableWidth / Math.max(timeUsedPerMove.length / 2, 1)
    const centerY = timePadding + availableHeight / 2

    // Calculate pan limits based on zoom level
    const calculatePanLimits = (currentZoom: number) => {
      if (currentZoom <= 1) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      }

      const scaledWidth = chartWidth * currentZoom
      const scaledHeight = chartHeight * currentZoom

      return {
        minX: chartWidth - scaledWidth,
        maxX: 0,
        minY: chartHeight - scaledHeight,
        maxY: 0
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
      if (timeChartZoom > 1) {
        e.preventDefault()
      }
    }

    const handleRightMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
      if (timeChartZoom <= 1) return
      if (e.button !== 2) return

      setTimeChartIsDragging(true)
      setTimeChartLastMousePos({ x: e.clientX, y: e.clientY })
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!timeChartIsDragging) return

      const deltaX = e.clientX - timeChartLastMousePos.x
      const deltaY = e.clientY - timeChartLastMousePos.y

      setTimeChartPan(prev => {
        const newOffset = {
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }
        return constrainPanOffset(newOffset, timeChartZoom)
      })

      setTimeChartLastMousePos({ x: e.clientX, y: e.clientY })
    }

    const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
      if (timeChartIsDragging) {
        setTimeChartIsDragging(false)
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const handleMouseLeave = () => {
      if (timeChartIsDragging) {
        setTimeChartIsDragging(false)
      }
    }

    // Reset zoom and pan function
    const resetZoomPan = () => {
      setTimeChartZoom(1)
      setTimeChartPan({ x: 0, y: 0 })
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

        // Apply pan constraints for the new zoom level
        let limits
        if (newZoom <= 1) {
          limits = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
        } else {
          const scaledWidth = chartWidth * newZoom
          const scaledHeight = chartHeight * newZoom
          limits = {
            minX: chartWidth - scaledWidth,
            maxX: 0,
            minY: chartHeight - scaledHeight,
            maxY: 0
          }
        }
        const constrainedOffset = {
          x: Math.max(limits.minX, Math.min(limits.maxX, newPanOffset.x)),
          y: Math.max(limits.minY, Math.min(limits.maxY, newPanOffset.y))
        }
        setTimeChartPan(constrainedOffset)

        setTimeChartZoom(newZoom)
      }

      svgElement.addEventListener('wheel', handleWheelNonPassive, { passive: false })

      return () => {
        svgElement.removeEventListener('wheel', handleWheelNonPassive)
      }
    }, [])

    return (
      <div style={{
        width: '316px',
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
                if (!currentGame?.clock) return ''
                const minutes = Math.floor(currentGame.clock.initial / 60)
                const increment = currentGame.clock.increment
                return `${minutes}+${increment}`
              })()}
            </span>
            {timeChartZoom > 1 && (
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
            cursor: timeChartIsDragging ? 'grabbing' : (timeChartZoom > 1 ? 'grab' : 'default')
          }}
          onContextMenu={handleContextMenu}
          onMouseDown={handleRightMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <g transform={`translate(${timeChartPan.x}, ${timeChartPan.y}) scale(${timeChartZoom})`}>
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
              const division = currentGame?.division
              const divisionLines = []

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
              const barHeight = (timeUsed / maxTimeUsed) * (availableHeight / 2) * 0.9

              const x = timePadding + (isWhiteMove ? Math.floor(index / 2) * barWidth : Math.floor(index / 2) * barWidth + barWidth / 2)

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
                  onClick={() => goToMoveImmediate(moveIndex)}
                />
              )
            })}

            {/* Time labels - rendered after bars to ensure they're always on top */}
            {timeUsedPerMove.map((timeUsed, index) => {
              const isWhiteMove = index % 2 === 0
              const moveIndex = index + 1
              const isCurrentMove = Math.floor(displayedMoveIndex) === moveIndex
              const isHovered = hoveredMoveIndex === moveIndex
              const barHeight = (timeUsed / maxTimeUsed) * (availableHeight / 2) * 0.9

              const x = timePadding + (isWhiteMove ? Math.floor(index / 2) * barWidth : Math.floor(index / 2) * barWidth + barWidth / 2)

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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '20px',
      marginBottom: '30px',
      gap: '20px'
    }}>
      {/* Top bar: ELO range selector */}
      <div style={{
        width: '100%',
        maxWidth: '800px',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '12px'
      }}>
        <label htmlFor="elo-range-select" style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Select ELO Range:
        </label>
        <select
          id="elo-range-select"
          value={selectedEloRange}
          onChange={handleEloRangeChange}
          disabled={loading}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            backgroundColor: 'var(--background-primary)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            cursor: loading ? 'not-allowed' : 'pointer',
            minWidth: '150px'
          }}
        >
          <option value="">-- Select Range --</option>
          {ELO_RANGES.map(range => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
        {loading && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading...</span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: 'var(--danger-color)',
          color: 'white',
          borderRadius: '6px',
          fontSize: '14px',
          maxWidth: '800px',
          width: '100%'
        }}>
          {error}
        </div>
      )}

      {/* Game navigation controls - above the board/move list */}
      {loadedGames.length > 1 && gameLoaded && (
        <div style={{
          width: '100%',
          maxWidth: '800px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: '6px',
          border: '1px solid var(--border-color)'
        }}>
          <button
            onClick={previousGame}
            disabled={currentGameIndex === 0}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: currentGameIndex === 0 ? 'var(--background-tertiary)' : 'var(--background-primary)',
              color: currentGameIndex === 0 ? 'var(--text-muted)' : 'var(--primary-color)',
              cursor: currentGameIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
          >
            ← Previous Game
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>
            Game {currentGameIndex + 1} of {loadedGames.length}
          </span>
          <button
            onClick={nextGame}
            disabled={currentGameIndex === loadedGames.length - 1}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: currentGameIndex === loadedGames.length - 1 ? 'var(--background-tertiary)' : 'var(--background-primary)',
              color: currentGameIndex === loadedGames.length - 1 ? 'var(--text-muted)' : 'var(--primary-color)',
              cursor: currentGameIndex === loadedGames.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
          >
            Next Game →
          </button>
        </div>
      )}

      {/* Main content area - 2x2 Grid Layout */}
      <div style={{
        backgroundColor: 'var(--background-secondary)',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 4px 12px var(--shadow-medium)',
        border: '2px solid var(--border-color)'
      }}>
        {/* Top Row: Move List and Chess Board */}
        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'flex-start'
        }}>
          {/* Move List or Empty State */}
        {!gameLoaded || currentMoves.length === 0 ? (
          <div style={{
            width: '200px',
            height: `${size}px`,
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '16px',
            backgroundColor: 'var(--background-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px',
            textAlign: 'center',
            marginTop: '20px'
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
              cursor: 'default',
              marginTop: '20px'
            }}
          >
            {/* Opening - Sticky at top */}
            {currentGame?.opening && (
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
                {currentGame.opening.name}
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
                onClick={() => goToMoveImmediate(0)}
              >
                Start
              </div>

              {/* Helper function to convert ply to move number and determine if indicator should be shown */}
              {(() => {
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
                                  onClick={() => goToMoveImmediate(whiteMoveNumber)}
                                >
                                  <span>{whiteMove}</span>
                                  {(() => {
                                    const analysis = currentGame?.analysis
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
                                    onClick={() => goToMoveImmediate(blackMoveNumber)}
                                  >
                                    <span>{blackMove}</span>
                                    {(() => {
                                      const analysis = currentGame?.analysis
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
                {gameLoaded && currentGame
                  ? (boardOrientation === 'white'
                    ? (currentGame.players.black.user.name || 'Unknown')
                    : (currentGame.players.white.user.name || 'Unknown'))
                  : 'Player'}
              </div>

              {/* Game Result - centered */}
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
                  if (!gameLoaded || !currentGame) {
                    return 'No game loaded'
                  }
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
                  if (!gameLoaded || !currentGame) return ''
                  if (!currentGame.clocks || !currentGame.clock) return ''

                  // Determine which player's clock to show (top player)
                  const isWhiteOnTop = boardOrientation === 'black'

                  // Get the appropriate clock time based on current move
                  let clockTime

                  if (displayedMoveIndex === 0) {
                    // Starting position - use initial time from game settings
                    clockTime = currentGame.clock.initial * 100 // Convert seconds to centiseconds
                  } else {
                    if (isWhiteOnTop) {
                      // Top player is white
                      const whiteMove = Math.floor((displayedMoveIndex - 1) / 2)
                      const whiteClockIndex = whiteMove * 2
                      clockTime = currentGame.clocks[whiteClockIndex] || currentGame.clock.initial * 100
                    } else {
                      // Top player is black
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
              position={position}
              size={size}
              orientation={boardOrientation}
              lastMove={lastMove}
              animationData={null}
              pieceTheme={pieceTheme}
              onAnimationComplete={() => {}}
            />

            {/* Bottom Player Name and Navigation Controls Row */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginTop: '4px',
              width: `${size}px`
            }}>
              {/* Bottom Player Name */}
              <div style={{
                textAlign: 'left',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                paddingTop: '2px'
              }}>
                {gameLoaded && currentGame
                  ? (boardOrientation === 'white'
                    ? (currentGame.players.white.user.name || 'Unknown')
                    : (currentGame.players.black.user.name || 'Unknown'))
                  : 'Player'}
              </div>

              {/* Navigation Controls */}
              {gameLoaded && currentMoves.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '6px'
                }}>
                  <button
                    onClick={goToStart}
                    style={{
                      padding: '6px 10px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-primary)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px var(--shadow-light)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color)'
                      e.currentTarget.style.color = 'var(--text-on-primary)'
                      e.currentTarget.style.transform = 'translateY(-1px)'
                      e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                      e.currentTarget.style.color = 'var(--primary-color)'
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)'
                    }}
                    aria-label="Go to start"
                  >
                    <StartIcon disabled={false} size={18} />
                  </button>
                  <button
                    onClick={prevMove}
                    style={{
                      padding: '6px 10px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-primary)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px var(--shadow-light)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color)'
                      e.currentTarget.style.color = 'var(--text-on-primary)'
                      e.currentTarget.style.transform = 'translateY(-1px)'
                      e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                      e.currentTarget.style.color = 'var(--primary-color)'
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)'
                    }}
                    aria-label="Previous move"
                  >
                    <PrevIcon disabled={false} size={18} />
                  </button>
                  <button
                    onClick={nextMove}
                    style={{
                      padding: '6px 10px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-primary)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px var(--shadow-light)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color)'
                      e.currentTarget.style.color = 'var(--text-on-primary)'
                      e.currentTarget.style.transform = 'translateY(-1px)'
                      e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                      e.currentTarget.style.color = 'var(--primary-color)'
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)'
                    }}
                    aria-label="Next move"
                  >
                    <NextIcon disabled={false} size={18} />
                  </button>
                  <button
                    onClick={goToEnd}
                    style={{
                      padding: '6px 10px',
                      border: '2px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--background-primary)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px var(--shadow-light)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color)'
                      e.currentTarget.style.color = 'var(--text-on-primary)'
                      e.currentTarget.style.transform = 'translateY(-1px)'
                      e.currentTarget.style.boxShadow = '0 3px 8px var(--shadow-medium)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                      e.currentTarget.style.color = 'var(--primary-color)'
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px var(--shadow-light)'
                    }}
                    aria-label="Go to end"
                  >
                    <EndIcon disabled={false} size={18} />
                  </button>
                </div>
              )}

              {/* Bottom Player Clock */}
              <div style={{
                textAlign: 'right',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                paddingTop: '2px'
              }}>
                {(() => {
                  if (!gameLoaded || !currentGame) return ''
                  if (!currentGame.clocks || !currentGame.clock) return ''

                  // Determine which player's clock to show (bottom player)
                  const isWhiteOnBottom = boardOrientation === 'white'

                  // Get the appropriate clock time based on current move
                  let clockTime

                  if (displayedMoveIndex === 0) {
                    // Starting position - use initial time from game settings
                    clockTime = currentGame.clock.initial * 100 // Convert seconds to centiseconds
                  } else {
                    if (isWhiteOnBottom) {
                      // Bottom player is white
                      const whiteMove = Math.floor((displayedMoveIndex - 1) / 2)
                      const whiteClockIndex = whiteMove * 2
                      clockTime = currentGame.clocks[whiteClockIndex] || currentGame.clock.initial * 100
                    } else {
                      // Bottom player is black
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

        {/* Bottom Row: Evaluation Chart and Time Chart */}
        <div style={{
          display: 'flex',
          gap: '16px',
          marginTop: '16px'
        }}>
          <EvaluationChart />
          <TimeChart />
        </div>
      </div>
    </div>
  )
}

export default LearnBuddyBoard
