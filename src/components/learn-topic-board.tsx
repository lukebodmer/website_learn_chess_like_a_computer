import React, { useState, useEffect } from 'react';
import BaseChessBoard from './base-chess-board';
import { getCurrentBoardTheme, BoardTheme } from '../board-theme-utils';

interface LearnTopicBoardProps {
  position: string; // FEN string
  size?: number;
}

/**
 * A static chessboard component for displaying positions on the learn page
 * Shows a fixed position without any interaction
 */
const LearnTopicBoard: React.FC<LearnTopicBoardProps> = ({
  position,
  size = 200
}) => {
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(getCurrentBoardTheme());

  // Listen for board theme changes
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
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <BaseChessBoard
        size={size}
        position={position}
        orientation="white"
        coordinates={false}
        interactive={false}
        allowPieceDragging={false}
        showGameEndSymbols={false}
        showCheckHighlight={false}
        boardTheme={boardTheme}
      />
    </div>
  );
};

export default LearnTopicBoard;
