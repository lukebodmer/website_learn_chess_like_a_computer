import React from 'react'
import PlayableChessBoard from './playable-chess-board'

interface ChessBoardProps {
  size?: number
}

const ChessBoard: React.FC<ChessBoardProps> = ({ size = 400 }) => {
  return (
    <PlayableChessBoard
      size={size}
      coordinates={true}
      showGameEndSymbols={true}
      showCheckHighlight={true}
    />
  )
}

export default ChessBoard