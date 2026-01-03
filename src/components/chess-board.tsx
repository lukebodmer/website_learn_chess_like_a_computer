import React, { useRef, useEffect, useState } from 'react'
import { Chess } from 'chess.js'

interface ChessBoardProps {
  size?: number
}

const ChessBoard: React.FC<ChessBoardProps> = ({ size = 400 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const animationDataRef = useRef<{
    piece: any,
    from: string,
    to: string,
    startTime: number,
    duration: number
  }[]>([])
  const [chess] = useState(new Chess())
  const [pieceImages, setPieceImages] = useState<{[key: string]: HTMLImageElement}>({})
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [legalMoves, setLegalMoves] = useState<string[]>([])
  const [draggedPiece, setDraggedPiece] = useState<{square: string, piece: any} | null>(null)
  const [mousePos, setMousePos] = useState<{x: number, y: number}>({x: 0, y: 0})
  const [isDragging, setIsDragging] = useState(false)
  const [animatingPiece, setAnimatingPiece] = useState<{
    piece: any,
    from: string,
    to: string,
    startTime: number,
    duration: number
  } | null>(null)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [promotionData, setPromotionData] = useState<{
    from: string,
    to: string,
    color: 'w' | 'b'
  } | null>(null)

  // Mapping chess.js piece notation to SVG filenames
  const pieceToFilename: {[key: string]: string} = {
    'wP': 'wP.svg', 'wR': 'wR.svg', 'wN': 'wN.svg', 'wB': 'wB.svg', 'wQ': 'wQ.svg', 'wK': 'wK.svg',
    'bP': 'bP.svg', 'bR': 'bR.svg', 'bN': 'bN.svg', 'bB': 'bB.svg', 'bQ': 'bQ.svg', 'bK': 'bK.svg'
  }

  // Helper functions
  const getSquareFromCoords = (x: number, y: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const squareSize = size / 8
    const col = Math.floor((x - rect.left) / (rect.width / 8))
    const row = Math.floor((y - rect.top) / (rect.height / 8))

    if (col < 0 || col > 7 || row < 0 || row > 7) return null

    return String.fromCharCode(97 + col) + (8 - row)
  }

  const getSquareCoords = (square: string): {x: number, y: number} => {
    const col = square.charCodeAt(0) - 97
    const row = 8 - parseInt(square[1])
    const squareSize = size / 8
    return {
      x: col * squareSize,
      y: row * squareSize
    }
  }

  const getLegalMovesForSquare = (square: string): string[] => {
    const moves = chess.moves({ square, verbose: true })
    return moves.map(move => move.to)
  }

  const canSelectPiece = (piece: any): boolean => {
    if (!piece) return false
    const currentTurn = chess.turn()
    return piece.color === currentTurn
  }

  const isInCheck = (): boolean => {
    return chess.inCheck()
  }

  const getKingSquare = (color: 'w' | 'b'): string | null => {
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
  }


  // Easing function for smooth animation
  const easeOutQuart = (t: number): number => {
    return 1 - Math.pow(1 - t, 4)
  }

  // Animation function
  const animate = () => {
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
      // All animations complete - clear all states
      animationDataRef.current = []
      setAnimatingPiece(null)
      setAnimationProgress(0)
      setSelectedSquare(null)
      setLegalMoves([])
      setDraggedPiece(null)
      setIsDragging(false)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    } else {
      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }

  const startAnimation = (piece: any, from: string, to: string) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const animationData = {
      piece,
      from,
      to,
      startTime: Date.now(),
      duration: 300
    }

    animationDataRef.current = [animationData]
    setAnimatingPiece({
      piece,
      from,
      to,
      startTime: animationData.startTime,
      duration: 300
    })
    animationFrameRef.current = requestAnimationFrame(animate)
  }

  const startCastlingAnimation = (moveDetails: any) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const startTime = Date.now()
    const animations = []

    // Animate the king
    const kingPiece = chess.get(moveDetails.to) // King is now at destination
    animations.push({
      piece: kingPiece,
      from: moveDetails.from,
      to: moveDetails.to,
      startTime,
      duration: 300
    })

    // Determine rook positions for castling
    const isKingSide = moveDetails.flags.includes('k')
    const isQueenSide = moveDetails.flags.includes('q')
    const rank = moveDetails.from[1] // '1' for white, '8' for black

    if (isKingSide) {
      // King-side castling: rook moves from h-file to f-file
      const rookFrom = `h${rank}`
      const rookTo = `f${rank}`
      const rookPiece = chess.get(rookTo)
      animations.push({
        piece: rookPiece,
        from: rookFrom,
        to: rookTo,
        startTime,
        duration: 300
      })
    } else if (isQueenSide) {
      // Queen-side castling: rook moves from a-file to d-file
      const rookFrom = `a${rank}`
      const rookTo = `d${rank}`
      const rookPiece = chess.get(rookTo)
      animations.push({
        piece: rookPiece,
        from: rookFrom,
        to: rookTo,
        startTime,
        duration: 300
      })
    }

    animationDataRef.current = animations
    setAnimatingPiece({
      piece: kingPiece,
      from: moveDetails.from,
      to: moveDetails.to,
      startTime,
      duration: 300
    })
    animationFrameRef.current = requestAnimationFrame(animate)
  }


  const makeMove = (from: string, to: string, animate: boolean = false): boolean => {
    // Get the piece before making the move
    const piece = chess.get(from)
    if (!piece) {
      return false
    }

    // Check if this is a pawn promotion
    if (piece.type === 'p') {
      const toRank = parseInt(to[1])
      const isPromotion = (piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)

      if (isPromotion) {
        // Test if the move is legal before showing promotion popup
        try {
          const testChess = new Chess(chess.fen())
          const testMove = testChess.move({ from, to, promotion: 'q' }) // Test with queen
          if (!testMove) {
            return false
          }
        } catch (error) {
          return false
        }

        // Show promotion popup
        setPromotionData({ from, to, color: piece.color })
        setSelectedSquare(null)
        setLegalMoves([])
        return true
      }
    }

    try {
      // Test move to get details before executing
      const testChess = new Chess(chess.fen())
      const moveDetails = testChess.move({ from, to })
      if (!moveDetails) {
        return false
      }

      // Now make the actual move
      const move = chess.move({ from, to })
      if (!move) {
        return false
      }

      if (animate) {
        // Check if this is a castling move
        if (moveDetails.flags.includes('k') || moveDetails.flags.includes('q')) {
          // Castling move - animate both king and rook
          startCastlingAnimation(moveDetails)
        } else {
          // Regular move - animate just the piece
          startAnimation(piece, from, to)
        }
        // Clear legal moves immediately so they don't show during animation
        setLegalMoves([])
      } else {
        // For non-animated moves, clear state immediately
        setSelectedSquare(null)
        setLegalMoves([])
        setDraggedPiece(null)
        setIsDragging(false)
      }
      return true
    } catch (error) {
      return false
    }
  }

  const handlePromotion = (promotionPiece: 'q' | 'r' | 'b' | 'n') => {
    if (!promotionData) return

    try {
      const move = chess.move({
        from: promotionData.from,
        to: promotionData.to,
        promotion: promotionPiece
      })

      if (move) {
        // Animate the promoted piece
        const promotedPiece = chess.get(promotionData.to)
        startAnimation(promotedPiece, promotionData.from, promotionData.to)
        setPromotionData(null)
      }
    } catch (error) {
      console.log('Promotion failed:', error)
      setPromotionData(null)
    }
  }

  const getPromotionSquareFromCoords = (x: number, y: number): string | null => {
    if (!promotionData) return null

    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const centerX = size / 2
    const centerY = size / 2
    const pieceSize = (size * 0.2) * 0.6

    // Calculate relative position from promotion popup center
    const relX = x - rect.left - centerX
    const relY = y - rect.top - centerY

    // Check if click is within any of the 4 pieces (single row)
    for (let col = 0; col < 4; col++) {
      const pieceX = (col - 1.5) * pieceSize * 1.1
      const pieceY = 0

      if (Math.abs(relX - pieceX) < pieceSize / 2 && Math.abs(relY - pieceY) < pieceSize / 2) {
        const pieces = ['q', 'r', 'b', 'n']
        return pieces[col]
      }
    }

    return null
  }

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const square = getSquareFromCoords(e.clientX, e.clientY)
    if (!square) return

    const piece = chess.get(square)
    if (piece && canSelectPiece(piece)) {
      setSelectedSquare(square)
      setLegalMoves(getLegalMovesForSquare(square))
      setDraggedPiece({ square, piece })
      setMousePos({ x: e.clientX, y: e.clientY })
      setIsDragging(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setMousePos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && draggedPiece) {
      const targetSquare = getSquareFromCoords(e.clientX, e.clientY)
      if (targetSquare && targetSquare !== draggedPiece.square) {
        makeMove(draggedPiece.square, targetSquare)
      }
    }
    setIsDragging(false)
    setDraggedPiece(null)
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) return

    // Check if promotion popup is active
    if (promotionData) {
      const promotionPiece = getPromotionSquareFromCoords(e.clientX, e.clientY)
      if (promotionPiece) {
        handlePromotion(promotionPiece as 'q' | 'r' | 'b' | 'n')
      }
      return
    }

    const square = getSquareFromCoords(e.clientX, e.clientY)
    if (!square) return

    if (selectedSquare && selectedSquare !== square) {
      // Try to make a move with animation
      if (!makeMove(selectedSquare, square, true)) {
        // If move failed, select the new square if it has a piece that belongs to current player
        const piece = chess.get(square)
        if (piece && canSelectPiece(piece)) {
          setSelectedSquare(square)
          setLegalMoves(getLegalMovesForSquare(square))
        } else {
          setSelectedSquare(null)
          setLegalMoves([])
        }
      }
    } else {
      // Select/deselect piece - only allow selecting current player's pieces
      const piece = chess.get(square)
      if (piece && canSelectPiece(piece)) {
        setSelectedSquare(square)
        setLegalMoves(getLegalMovesForSquare(square))
      } else {
        setSelectedSquare(null)
        setLegalMoves([])
      }
    }
  }

  // Load piece images
  useEffect(() => {
    const loadImages = async () => {
      const images: {[key: string]: HTMLImageElement} = {}
      const loadPromises: Promise<void>[] = []

      for (const [piece, filename] of Object.entries(pieceToFilename)) {
        const promise = new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => resolve()
          img.src = `/static/images/chesspieces/default/${filename}`
          images[piece] = img
        })
        loadPromises.push(promise)
      }

      await Promise.all(loadPromises)
      setPieceImages(images)
    }

    loadImages()
  }, [])

  // Draw board and pieces
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set up high DPI scaling for crisp rendering
    const dpr = window.devicePixelRatio || 1
    const displaySize = size
    canvas.width = displaySize * dpr
    canvas.height = displaySize * dpr
    canvas.style.width = displaySize + 'px'
    canvas.style.height = displaySize + 'px'
    ctx.scale(dpr, dpr)

    // Enable crisp image rendering
    ctx.imageSmoothingEnabled = false

    const squareSize = displaySize / 8

    // Clear canvas
    ctx.clearRect(0, 0, displaySize, displaySize)

    // Draw board squares
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const isLightSquare = (row + col) % 2 === 0
        ctx.fillStyle = isLightSquare ? '#f0d9b5' : '#b58863'

        ctx.fillRect(
          col * squareSize,
          row * squareSize,
          squareSize,
          squareSize
        )
      }
    }

    // Highlight king in check with red glow
    if (isInCheck()) {
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

    // Highlight selected square
    if (selectedSquare) {
      const coords = getSquareCoords(selectedSquare)
      ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'
      ctx.fillRect(coords.x, coords.y, squareSize, squareSize)
    }

    // Draw legal move indicators
    if (legalMoves.length > 0) {
      // Reset canvas state to ensure proper transparency
      ctx.globalAlpha = 1.0
      ctx.globalCompositeOperation = 'source-over'

      for (const moveSquare of legalMoves) {
        const coords = getSquareCoords(moveSquare)
        const centerX = coords.x + squareSize / 2
        const centerY = coords.y + squareSize / 2

        // Check if there's a piece on this square (capture)
        const targetPiece = chess.get(moveSquare)

        if (targetPiece) {
          // Draw outline circle for capturable pieces
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

        // Skip drawing the piece being dragged or at destination during animation
        const isAnimatingToThisSquare = animationDataRef.current.some(anim => anim.to === square)
        if (piece &&
            (!isDragging || draggedPiece?.square !== square) &&
            !isAnimatingToThisSquare) {
          const pieceKey = piece.color + piece.type.toUpperCase()
          const img = pieceImages[pieceKey]

          if (img && img.complete) {
            const padding = squareSize * 0.1
            ctx.drawImage(
              img,
              col * squareSize + padding,
              row * squareSize + padding,
              squareSize - 2 * padding,
              squareSize - 2 * padding
            )
          }
        }
      }
    }

    // Draw animating pieces
    const animations = animationDataRef.current
    if (animations.length > 0 && animationProgress > 0) {
      for (const animData of animations) {
        const fromCoords = getSquareCoords(animData.from)
        const toCoords = getSquareCoords(animData.to)

        const easedProgress = easeOutQuart(animationProgress)

        // Interpolate position
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

    // Draw dragged piece at mouse position
    if (isDragging && draggedPiece) {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const pieceKey = draggedPiece.piece.color + draggedPiece.piece.type.toUpperCase()
        const img = pieceImages[pieceKey]

        if (img && img.complete) {
          const padding = squareSize * 0.1
          const pieceSize = squareSize - 2 * padding
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
    // Draw promotion popup
    if (promotionData) {
      // Semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(0, 0, displaySize, displaySize)

      // Popup positioning (no background box)
      const popupWidth = displaySize * 0.5
      const popupHeight = displaySize * 0.2
      const popupX = (displaySize - popupWidth) / 2
      const popupY = (displaySize - popupHeight) / 2

      // Draw the 4 promotion pieces in a single row
      const pieceSize = popupHeight * 0.6
      const pieces = ['q', 'r', 'b', 'n']
      const pieceNames = ['Queen', 'Rook', 'Bishop', 'Knight']

      for (let col = 0; col < 4; col++) {
        const piece = pieces[col]
        const pieceKey = promotionData.color + piece.toUpperCase()
        const img = pieceImages[pieceKey]

        const x = popupX + popupWidth / 2 + (col - 1.5) * pieceSize * 1.1 - pieceSize / 2
        const y = popupY + popupHeight / 2 - pieceSize / 2

          // Hover effect background
          ctx.fillStyle = 'rgba(200, 200, 200, 0.5)'
          ctx.fillRect(x, y, pieceSize, pieceSize)

          if (img && img.complete) {
            const padding = pieceSize * 0.1
            ctx.drawImage(
              img,
              x + padding,
              y + padding,
              pieceSize - 2 * padding,
              pieceSize - 2 * padding
            )
          }
      }

      // Title text
      ctx.fillStyle = 'white'
      ctx.font = `${displaySize / 30}px Arial`
      ctx.textAlign = 'center'
      ctx.fillText('Choose promotion piece:', displaySize / 2, popupY - displaySize / 40)
    }
  }, [size, pieceImages, chess, selectedSquare, legalMoves, isDragging, draggedPiece, mousePos, animatingPiece, animationProgress, promotionData])

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        border: '2px solid #8b4513',
        borderRadius: '4px',
        display: 'block',
        cursor: isDragging ? 'grabbing' : 'pointer'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    />
  )
}

export default ChessBoard