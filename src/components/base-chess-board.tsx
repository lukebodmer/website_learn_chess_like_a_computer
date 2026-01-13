import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Chess } from 'chess.js'

export interface BaseChessBoardProps {
  size?: number
  position: string // FEN string
  pieceTheme?: string // path to piece images (default: '/static/images/chesspieces/default/')
  symbolTheme?: string // path to symbol images (default: '/static/images/symbols/default/')
  orientation?: 'white' | 'black'
  coordinates?: boolean
  interactive?: boolean
  allowPieceDragging?: boolean // Separate control for piece dragging (defaults to interactive value if not specified)
  selectedSquare?: string
  legalMoves?: string[]
  lastMove?: { from: string, to: string } | null
  highlightedSquares?: { square: string, color: string }[]
  arrows?: { from: string, to: string, color: string }[]
  showGameEndSymbols?: boolean
  showCheckHighlight?: boolean
  currentTurn?: 'w' | 'b' // Add current turn to determine piece selection
  gameResult?: { winner?: string | null, isCheckmate?: boolean, isDraw?: boolean, drawReason?: string } | null // External game result
  animationData?: { piece: any, from: string, to: string } | null // External animation control
  onSquareClick?: (square: string) => void
  onSquareRightClick?: (square: string) => void
  onPieceDrag?: (from: string, to: string) => boolean
  onPieceDragStart?: (square: string) => void
  onPieceDragEnd?: () => void
  onMove?: (move: any) => void
  onAnimationComplete?: () => void
  animationDuration?: number
  customOverlays?: React.ReactNode
}

interface AnimationData {
  piece: any
  from: string
  to: string
  startTime: number
  duration: number
}

const BaseChessBoard: React.FC<BaseChessBoardProps> = ({
  size = 400,
  position,
  pieceTheme = '/static/images/chesspieces/default/',
  symbolTheme = '/static/images/symbols/default/',
  orientation = 'white',
  coordinates = false,
  interactive = true,
  allowPieceDragging,
  selectedSquare,
  legalMoves = [],
  lastMove,
  highlightedSquares = [],
  arrows = [],
  showGameEndSymbols = true,
  showCheckHighlight = true,
  currentTurn,
  gameResult,
  animationData,
  onSquareClick,
  onSquareRightClick,
  onPieceDrag,
  onPieceDragStart,
  onPieceDragEnd,
  onMove,
  onAnimationComplete,
  animationDuration = 300,
  customOverlays
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const animationDataRef = useRef<AnimationData[]>([])

  // Create chess instance from position
  const [chess] = useState(() => new Chess(position))
  const [pieceImages, setPieceImages] = useState<{[key: string]: HTMLImageElement}>({})
  const [symbolImages, setSymbolImages] = useState<{[key: string]: HTMLImageElement}>({})
  const [draggedPiece, setDraggedPiece] = useState<{square: string, piece: any} | null>(null)
  const [mousePos, setMousePos] = useState<{x: number, y: number}>({x: 0, y: 0})
  const [isDragging, setIsDragging] = useState(false)
  const [animatingPiece, setAnimatingPiece] = useState<AnimationData | null>(null)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [rightClickHighlights, setRightClickHighlights] = useState<Set<string>>(new Set())
  const [rightClickDragging, setRightClickDragging] = useState<{from: string} | null>(null)
  const [rightClickStart, setRightClickStart] = useState<{square: string, pos: {x: number, y: number}} | null>(null)
  const [userArrows, setUserArrows] = useState<{ from: string, to: string, color: string }[]>([])

  // Determine if piece dragging should be enabled (defaults to interactive if not specified)
  const pieceDraggingEnabled = allowPieceDragging !== undefined ? allowPieceDragging : interactive

  // Update chess position when position prop changes
  useEffect(() => {
    try {
      chess.load(position)
    } catch (error) {
      console.error('Invalid FEN position:', position, error)
    }
  }, [position, chess])

  // Mapping chess.js piece notation to SVG filenames
  const pieceToFilename: {[key: string]: string} = {
    'wP': 'wP.svg', 'wR': 'wR.svg', 'wN': 'wN.svg', 'wB': 'wB.svg', 'wQ': 'wQ.svg', 'wK': 'wK.svg',
    'bP': 'bP.svg', 'bR': 'bR.svg', 'bN': 'bN.svg', 'bB': 'bB.svg', 'bQ': 'bQ.svg', 'bK': 'bK.svg'
  }

  // Helper functions
  const getSquareFromCoords = useCallback((x: number, y: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const relativeX = x - rect.left
    const relativeY = y - rect.top

    const squareSize = size / 8
    const col = Math.floor(relativeX / squareSize)
    const row = Math.floor(relativeY / squareSize)

    if (col < 0 || col > 7 || row < 0 || row > 7) return null

    // Adjust for orientation
    if (orientation === 'black') {
      return String.fromCharCode(97 + (7 - col)) + (row + 1)
    } else {
      return String.fromCharCode(97 + col) + (8 - row)
    }
  }, [size, orientation])

  const getSquareCoords = useCallback((square: string): { x: number, y: number } => {
    const file = square.charCodeAt(0) - 97 // a=0, b=1, etc.
    const rank = parseInt(square[1]) - 1    // 1=0, 2=1, etc.
    const squareSize = size / 8

    let col, row
    if (orientation === 'black') {
      col = 7 - file
      row = rank
    } else {
      col = file
      row = 7 - rank
    }

    return {
      x: col * squareSize,
      y: row * squareSize
    }
  }, [size, orientation])

  const getKingSquare = useCallback((color: 'w' | 'b'): string | null => {
    const board = chess.board()
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col]
        if (piece && piece.type === 'k' && piece.color === color) {
          return String.fromCharCode(97 + col) + (8 - row)
        }
      }
    }
    return null
  }, [chess])

  const getGameResult = useCallback(() => {
    if (chess.isCheckmate()) {
      const currentTurn = chess.turn()
      const winner = currentTurn === 'w' ? 'b' : 'w'
      return { winner, isCheckmate: true, isDraw: false }
    }

    // Check all draw conditions explicitly
    if (chess.isStalemate()) {
      return { winner: null, isCheckmate: false, isDraw: true, drawReason: 'stalemate' }
    }
    if (chess.isInsufficientMaterial()) {
      return { winner: null, isCheckmate: false, isDraw: true, drawReason: 'insufficient material' }
    }
    if (chess.isThreefoldRepetition()) {
      console.log('Threefold repetition detected!')
      return { winner: null, isCheckmate: false, isDraw: true, drawReason: 'threefold repetition' }
    }
    // Check for fifty-move rule - first try the specific method, then fall back to general isDraw
    if (typeof chess.isDrawByFiftyMoves === 'function' && chess.isDrawByFiftyMoves()) {
      return { winner: null, isCheckmate: false, isDraw: true, drawReason: 'fifty-move rule' }
    }
    // General draw check (catches fifty-move rule if specific method doesn't exist)
    if (chess.isDraw()) {
      return { winner: null, isCheckmate: false, isDraw: true, drawReason: 'fifty-move rule or other draw' }
    }

    return { winner: null, isCheckmate: false, isDraw: false }
  }, [chess])

  // Animation functions
  const easeOutQuart = (t: number): number => {
    return 1 - Math.pow(1 - t, 4)
  }

  const animate = useCallback(() => {
    const animations = animationDataRef.current
    if (animations.length === 0) return

    const currentTime = Date.now()
    let allComplete = true

    for (const anim of animations) {
      const elapsed = currentTime - anim.startTime
      const progress = Math.min(elapsed / anim.duration, 1)

      if (progress < 1) {
        allComplete = false
        setAnimationProgress(progress)
        break
      }
    }

    if (allComplete) {
      animationDataRef.current = []
      setAnimatingPiece(null)
      setAnimationProgress(0)
      setDraggedPiece(null)
      setIsDragging(false)

      // Notify parent that animation is complete
      if (onAnimationComplete) {
        onAnimationComplete()
      }
    } else {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }, [onAnimationComplete])

  const startAnimation = useCallback((piece: any, from: string, to: string) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const animData: AnimationData = {
      piece,
      from,
      to,
      startTime: Date.now(),
      duration: animationDuration
    }

    animationDataRef.current = [animData]
    setAnimatingPiece(animData)
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [animationDuration, animate])

  // Trigger animation when animationData prop changes
  useEffect(() => {
    if (animationData) {
      startAnimation(animationData.piece, animationData.from, animationData.to)
    }
  }, [animationData])

  // Helper to check if piece can be selected
  const canSelectPiece = useCallback((piece: any): boolean => {
    if (!piece) return false
    // Use provided currentTurn or fallback to chess instance turn
    const turn = currentTurn || chess.turn()
    return piece.color === turn
  }, [chess, currentTurn])

  // Event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return

    const square = getSquareFromCoords(e.clientX, e.clientY)
    if (!square) return

    if (e.button === 2) {
      // Right mouse button - prepare for potential arrow drawing
      setRightClickStart({ square, pos: { x: e.clientX, y: e.clientY } })
      setMousePos({ x: e.clientX, y: e.clientY })
    } else if (e.button === 0 && pieceDraggingEnabled) {
      // Left mouse button - piece dragging (only if enabled)
      const piece = chess.get(square)
      if (piece && canSelectPiece(piece)) {
        setDraggedPiece({ square, piece })
        setMousePos({ x: e.clientX, y: e.clientY })
        setIsDragging(true)

        // Notify parent that drag has started
        if (onPieceDragStart) {
          onPieceDragStart(square)
        }
      }
    }
  }, [interactive, pieceDraggingEnabled, getSquareFromCoords, chess, canSelectPiece, onPieceDragStart])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging || rightClickDragging) {
      setMousePos({ x: e.clientX, y: e.clientY })
    } else if (rightClickStart) {
      // Check if we've moved enough to start arrow dragging
      const distance = Math.sqrt(
        Math.pow(e.clientX - rightClickStart.pos.x, 2) +
        Math.pow(e.clientY - rightClickStart.pos.y, 2)
      )

      if (distance > 10) {
        // Start arrow dragging
        setRightClickDragging({ from: rightClickStart.square })
        setRightClickStart(null)
      }
      setMousePos({ x: e.clientX, y: e.clientY })
    }
  }, [isDragging, rightClickDragging, rightClickStart])

  // Add mouse leave handler to cancel arrow dragging and piece dragging when mouse leaves the board
  const handleMouseLeave = useCallback(() => {
    if (rightClickDragging) {
      setRightClickDragging(null)
    }
    if (rightClickStart) {
      setRightClickStart(null)
    }
    if (isDragging && pieceDraggingEnabled) {
      // Cancel piece dragging and return piece to original position (only if enabled)
      setIsDragging(false)
      setDraggedPiece(null)

      // Notify parent that drag has ended
      if (onPieceDragEnd) {
        onPieceDragEnd()
      }
    }
  }, [rightClickDragging, rightClickStart, isDragging, pieceDraggingEnabled, onPieceDragEnd])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return

    if (rightClickStart && !rightClickDragging) {
      // Simple right-click without dragging - toggle highlight
      const square = rightClickStart.square
      setRightClickHighlights(prev => {
        const newHighlights = new Set(prev)
        if (newHighlights.has(square)) {
          newHighlights.delete(square)
        } else {
          newHighlights.add(square)
        }
        return newHighlights
      })

      // Also call the prop callback if provided
      if (onSquareRightClick) {
        onSquareRightClick(square)
      }

      setRightClickStart(null)
    } else if (rightClickDragging) {
      // Handle arrow creation/deletion
      const targetSquare = getSquareFromCoords(e.clientX, e.clientY)
      if (targetSquare && targetSquare !== rightClickDragging.from) {
        // Check if arrow already exists
        const existingArrowIndex = userArrows.findIndex(
          arrow => arrow.from === rightClickDragging.from && arrow.to === targetSquare
        )

        if (existingArrowIndex >= 0) {
          // Remove existing arrow
          setUserArrows(prev => prev.filter((_, index) => index !== existingArrowIndex))
        } else {
          // Add new arrow
          setUserArrows(prev => [...prev, {
            from: rightClickDragging.from,
            to: targetSquare,
            color: '#9933ff' // Purple arrows
          }])
        }
      }
      setRightClickDragging(null)
    } else if (isDragging && draggedPiece && pieceDraggingEnabled) {
      // Handle piece dragging (only if enabled)
      const targetSquare = getSquareFromCoords(e.clientX, e.clientY)
      if (targetSquare && targetSquare !== draggedPiece.square) {
        if (onPieceDrag) {
          onPieceDrag(draggedPiece.square, targetSquare)
        }
      }

      setIsDragging(false)
      setDraggedPiece(null)

      // Notify parent that drag has ended
      if (onPieceDragEnd) {
        onPieceDragEnd()
      }
    }
  }, [interactive, isDragging, draggedPiece, rightClickDragging, rightClickStart, userArrows, pieceDraggingEnabled, getSquareFromCoords, onPieceDrag, onPieceDragEnd, onSquareRightClick])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive || isDragging) return

    // Clear all user-drawn arrows and highlights on left click
    setUserArrows([])
    setRightClickHighlights(new Set())

    const square = getSquareFromCoords(e.clientX, e.clientY)
    if (square && onSquareClick) {
      onSquareClick(square)
    }
  }, [interactive, isDragging, getSquareFromCoords, onSquareClick])

  const handleRightClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    // Right-click handling is now done in handleMouseUp
  }, [])

  // Load images
  useEffect(() => {
    const loadImages = async () => {
      const images: {[key: string]: HTMLImageElement} = {}
      const loadPromises: Promise<void>[] = []

      for (const [piece, filename] of Object.entries(pieceToFilename)) {
        const promise = new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => resolve() // Continue even if image fails to load
          img.src = `${pieceTheme}${filename}`
          images[piece] = img
        })
        loadPromises.push(promise)
      }

      await Promise.all(loadPromises)
      setPieceImages(images)
    }

    const loadSymbols = async () => {
      const symbols: {[key: string]: HTMLImageElement} = {}
      const symbolPromises: Promise<void>[] = []

      const symbolFiles = ['win', 'lose', 'tie']
      for (const symbol of symbolFiles) {
        const promise = new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => resolve() // Continue even if symbol fails to load
          img.src = `${symbolTheme}${symbol}.svg`
          symbols[symbol] = img
        })
        symbolPromises.push(promise)
      }

      await Promise.all(symbolPromises)
      setSymbolImages(symbols)
    }

    loadImages()
    if (showGameEndSymbols) {
      loadSymbols()
    }
  }, [pieceTheme, symbolTheme, showGameEndSymbols])

  // Main rendering effect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set up high DPI scaling
    const dpr = window.devicePixelRatio || 1
    const displaySize = size
    canvas.width = displaySize * dpr
    canvas.height = displaySize * dpr
    canvas.style.width = `${displaySize}px`
    canvas.style.height = `${displaySize}px`
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, displaySize, displaySize)

    const squareSize = displaySize / 8

    // Draw board squares
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const isLightSquare = (row + col) % 2 === 0
        ctx.fillStyle = isLightSquare ? '#f0d9b5' : '#b58863'
        ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize)
      }
    }

    // Draw coordinate labels if enabled
    if (coordinates) {
      ctx.font = `${displaySize / 40}px Arial`

      // Define square colors
      const lightSquareColor = '#f0d9b5'
      const darkSquareColor = '#b58863'

      // File labels (a-h)
      for (let col = 0; col < 8; col++) {
        const file = orientation === 'white'
          ? String.fromCharCode(97 + col)
          : String.fromCharCode(97 + (7 - col))

        // Bottom row is row 7, check if the square at (col, 7) is light or dark
        const isLightSquare = (7 + col) % 2 === 0
        ctx.fillStyle = isLightSquare ? darkSquareColor : lightSquareColor
        ctx.fillText(file, col * squareSize + squareSize * 0.05, displaySize - squareSize * 0.05)
      }

      // Rank labels (1-8)
      for (let row = 0; row < 8; row++) {
        const rank = orientation === 'white' ? (8 - row).toString() : (row + 1).toString()

        // Right column is col 7, check if the square at (7, row) is light or dark
        const isLightSquare = (row + 7) % 2 === 0
        ctx.fillStyle = isLightSquare ? darkSquareColor : lightSquareColor
        ctx.fillText(rank, displaySize - squareSize * 0.15, row * squareSize + squareSize * 0.2)
      }
    }

    // Draw highlighted squares
    for (const highlight of highlightedSquares) {
      const coords = getSquareCoords(highlight.square)
      ctx.fillStyle = highlight.color
      ctx.fillRect(coords.x, coords.y, squareSize, squareSize)
    }

    // Draw right-click highlights
    for (const square of rightClickHighlights) {
      const coords = getSquareCoords(square)
      ctx.fillStyle = 'rgba(153, 51, 255, 0.4)' // Purple highlight with transparency
      ctx.fillRect(coords.x, coords.y, squareSize, squareSize)
    }

    // Draw selected square
    if (selectedSquare) {
      const coords = getSquareCoords(selectedSquare)
      ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'
      ctx.fillRect(coords.x, coords.y, squareSize, squareSize)
    }

    // Draw last move highlight
    if (lastMove) {
      // Highlight the "from" square
      const fromCoords = getSquareCoords(lastMove.from)
      ctx.fillStyle = 'rgba(255, 255, 100, 0.4)'
      ctx.fillRect(fromCoords.x, fromCoords.y, squareSize, squareSize)

      // Highlight the "to" square
      const toCoords = getSquareCoords(lastMove.to)
      ctx.fillStyle = 'rgba(255, 255, 100, 0.4)'
      ctx.fillRect(toCoords.x, toCoords.y, squareSize, squareSize)
    }

    // Draw check highlight with glowing circle
    if (showCheckHighlight && chess.inCheck()) {
      const currentTurn = chess.turn()
      const kingSquare = getKingSquare(currentTurn)
      if (kingSquare) {
        const coords = getSquareCoords(kingSquare)
        const centerX = coords.x + squareSize / 2
        const centerY = coords.y + squareSize / 2

        // Create radial gradient for glow effect
        const gradient = ctx.createRadialGradient(
          centerX, centerY, 0,  // Inner circle (center)
          centerX, centerY, squareSize * 0.5  // Outer circle
        )
        gradient.addColorStop(0, 'rgba(200, 0, 0, 0.9)')  // Darker red at center
        gradient.addColorStop(0.7, 'rgba(255, 0, 0, 0.3)') // Semi-transparent
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)')     // Fully transparent at edges

        // Draw glowing circle behind the king
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(centerX, centerY, squareSize * 0.5, 0, 2 * Math.PI)
        ctx.fill()
      }
    }

    // Draw legal moves
    if (legalMoves.length > 0) {
      ctx.globalAlpha = 1.0
      ctx.globalCompositeOperation = 'source-over'

      for (const moveSquare of legalMoves) {
        const coords = getSquareCoords(moveSquare)
        const centerX = coords.x + squareSize / 2
        const centerY = coords.y + squareSize / 2

        const targetPiece = chess.get(moveSquare)
        if (targetPiece) {
          // Draw outline circle for captures
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
          ctx.lineWidth = 4
          ctx.beginPath()
          ctx.arc(centerX, centerY, squareSize * 0.35, 0, 2 * Math.PI)
          ctx.stroke()
        } else {
          // Draw filled circle for empty squares
          ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
          ctx.beginPath()
          ctx.arc(centerX, centerY, squareSize * 0.15, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
    }

    // Draw pieces
    const board = chess.board()
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col]
        const square = String.fromCharCode(97 + col) + (8 - row)

        // Skip piece being dragged or animated
        if (isDragging && draggedPiece?.square === square) continue
        if (animatingPiece && animatingPiece.from === square) continue
        if (animatingPiece && animatingPiece.to === square) continue

        if (piece) {
          const pieceKey = piece.color + piece.type.toUpperCase()
          const img = pieceImages[pieceKey]

          if (img && img.complete) {
            const coords = getSquareCoords(square)
            const padding = squareSize * 0.1
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(
              img,
              coords.x + padding,
              coords.y + padding,
              squareSize - 2 * padding,
              squareSize - 2 * padding
            )
          }
        }
      }
    }

    // Draw animated pieces
    if (animatingPiece && animationProgress > 0) {
      for (const animData of animationDataRef.current) {
        const fromCoords = getSquareCoords(animData.from)
        const toCoords = getSquareCoords(animData.to)
        const easedProgress = easeOutQuart(animationProgress)

        const x = fromCoords.x + (toCoords.x - fromCoords.x) * easedProgress
        const y = fromCoords.y + (toCoords.y - fromCoords.y) * easedProgress

        const pieceKey = animData.piece.color + animData.piece.type.toUpperCase()
        const img = pieceImages[pieceKey]

        if (img && img.complete) {
          const padding = squareSize * 0.1
          ctx.drawImage(
            img,
            x + padding,
            y + padding,
            squareSize - 2 * padding,
            squareSize - 2 * padding
          )
        }
      }
    }

    // Draw dragged piece
    if (isDragging && draggedPiece) {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const pieceKey = draggedPiece.piece.color + draggedPiece.piece.type.toUpperCase()
        const img = pieceImages[pieceKey]

        if (img && img.complete) {
          const pieceSize = squareSize * 0.8
          ctx.drawImage(
            img,
            mousePos.x - rect.left - pieceSize / 2,
            mousePos.y - rect.top - pieceSize / 2,
            pieceSize,
            pieceSize
          )
        }
      }
    }

    // Draw game end symbols
    if (showGameEndSymbols && gameResult) {
      const symbolSize = squareSize * 0.4

      // Debug game result
      if (gameResult.isDraw || gameResult.isCheckmate) {
        console.log('Game end detected:', gameResult)
      }

      if (gameResult.isCheckmate && gameResult.winner) {
        const winnerKingSquare = getKingSquare(gameResult.winner)
        const loserKingSquare = getKingSquare(gameResult.winner === 'w' ? 'b' : 'w')

        if (winnerKingSquare && symbolImages.win && symbolImages.win.complete) {
          const coords = getSquareCoords(winnerKingSquare)
          const x = coords.x + squareSize - symbolSize - (squareSize * 0.1)
          const y = coords.y + (squareSize * 0.1)
          ctx.drawImage(symbolImages.win, x, y, symbolSize, symbolSize)
        }

        if (loserKingSquare && symbolImages.lose && symbolImages.lose.complete) {
          const coords = getSquareCoords(loserKingSquare)
          const x = coords.x + squareSize - symbolSize - (squareSize * 0.1)
          const y = coords.y + (squareSize * 0.1)
          ctx.drawImage(symbolImages.lose, x, y, symbolSize, symbolSize)
        }
      } else if (gameResult.isDraw) {
        const whiteKingSquare = getKingSquare('w')
        const blackKingSquare = getKingSquare('b')

        if (whiteKingSquare && symbolImages.tie && symbolImages.tie.complete) {
          const coords = getSquareCoords(whiteKingSquare)
          const x = coords.x + squareSize - symbolSize - (squareSize * 0.1)
          const y = coords.y + (squareSize * 0.1)
          ctx.drawImage(symbolImages.tie, x, y, symbolSize, symbolSize)
        }

        if (blackKingSquare && symbolImages.tie && symbolImages.tie.complete) {
          const coords = getSquareCoords(blackKingSquare)
          const x = coords.x + squareSize - symbolSize - (squareSize * 0.1)
          const y = coords.y + (squareSize * 0.1)
          ctx.drawImage(symbolImages.tie, x, y, symbolSize, symbolSize)
        }
      }
    }

    // Draw arrows (both prop arrows and user-created arrows)
    const allArrows = [...arrows, ...userArrows]
    for (const arrow of allArrows) {
      const fromCoords = getSquareCoords(arrow.from)
      const toCoords = getSquareCoords(arrow.to)

      ctx.strokeStyle = arrow.color
      ctx.lineWidth = 6
      ctx.lineCap = 'round'

      const fromX = fromCoords.x + squareSize / 2
      const fromY = fromCoords.y + squareSize / 2
      const toX = toCoords.x + squareSize / 2
      const toY = toCoords.y + squareSize / 2

      ctx.beginPath()
      ctx.moveTo(fromX, fromY)
      ctx.lineTo(toX, toY)
      ctx.stroke()

      // Draw arrowhead
      const angle = Math.atan2(toY - fromY, toX - fromX)
      const headLength = 15

      ctx.beginPath()
      ctx.moveTo(toX, toY)
      ctx.lineTo(
        toX - headLength * Math.cos(angle - Math.PI / 6),
        toY - headLength * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(toX, toY)
      ctx.lineTo(
        toX - headLength * Math.cos(angle + Math.PI / 6),
        toY - headLength * Math.sin(angle + Math.PI / 6)
      )
      ctx.stroke()
    }

    // Draw preview arrow while right-click dragging
    if (rightClickDragging) {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const fromCoords = getSquareCoords(rightClickDragging.from)
        const fromX = fromCoords.x + squareSize / 2
        const fromY = fromCoords.y + squareSize / 2
        const toX = mousePos.x - rect.left
        const toY = mousePos.y - rect.top

        // Only draw if we've moved a reasonable distance
        const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2))
        if (distance > 20) {
          ctx.strokeStyle = 'rgba(153, 51, 255, 0.7)' // Semi-transparent purple
          ctx.lineWidth = 6
          ctx.lineCap = 'round'

          ctx.beginPath()
          ctx.moveTo(fromX, fromY)
          ctx.lineTo(toX, toY)
          ctx.stroke()

          // Draw arrowhead
          const angle = Math.atan2(toY - fromY, toX - fromX)
          const headLength = 15

          ctx.beginPath()
          ctx.moveTo(toX, toY)
          ctx.lineTo(
            toX - headLength * Math.cos(angle - Math.PI / 6),
            toY - headLength * Math.sin(angle - Math.PI / 6)
          )
          ctx.moveTo(toX, toY)
          ctx.lineTo(
            toX - headLength * Math.cos(angle + Math.PI / 6),
            toY - headLength * Math.sin(angle + Math.PI / 6)
          )
          ctx.stroke()
        }
      }
    }

  }, [
    size, position, chess, selectedSquare, legalMoves, lastMove, highlightedSquares, arrows,
    pieceImages, symbolImages, isDragging, draggedPiece, mousePos, animatingPiece,
    animationProgress, coordinates, orientation, showGameEndSymbols, showCheckHighlight,
    gameResult, rightClickHighlights, userArrows, rightClickDragging, rightClickStart, getSquareCoords, getKingSquare, getGameResult
  ])

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleRightClick}
        style={{
          cursor: interactive ? 'pointer' : 'default',
          userSelect: 'none'
        }}
      />
      {customOverlays}
    </div>
  )
}

export default BaseChessBoard