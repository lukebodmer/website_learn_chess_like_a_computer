import React, { useState, useEffect } from 'react';
import BaseChessBoard from './base-chess-board';
import { getCurrentBoardTheme, BoardTheme } from '../board-theme-utils';

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
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(getCurrentBoardTheme());

  // Listen for board theme changes (from settings page)
  useEffect(() => {
    const handleThemeChange = () => {
      setBoardTheme(getCurrentBoardTheme());
    };

    // Watch for class changes on the HTML element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          handleThemeChange();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

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
        boardTheme={boardTheme}
      />
    </div>
  );
};

export default OpeningBoard;
