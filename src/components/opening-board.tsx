import React from 'react';
import BaseChessBoard from './base-chess-board';

interface OpeningBoardProps {
  size?: number;
  position?: string; // FEN string
  orientation?: 'white' | 'black';
}

const OpeningBoard: React.FC<OpeningBoardProps> = ({
  size = 300,
  position = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // Starting position by default
  orientation = 'white'
}) => {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      backgroundColor: 'var(--background-primary)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      marginBottom: '1px'
    }}>
      <BaseChessBoard
        size={size}
        position={position}
        orientation={orientation}
        coordinates={true}
        interactive={false}
        allowPieceDragging={false}
        showGameEndSymbols={false}
        showCheckHighlight={true}
      />
    </div>
  );
};

export default OpeningBoard;
