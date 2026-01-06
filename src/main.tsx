import React from 'react'
import ReactDOM from 'react-dom/client'
import ChessBoard from './components/chess-board'
import DailyPuzzle from './components/daily-puzzle'

// This is the main entry point for Vite
console.log('Main Vite entry point loaded')

// Auto-mount components based on DOM elements
document.addEventListener('DOMContentLoaded', () => {
  // Mount ChessBoard on games page
  const chessBoardContainer = document.getElementById('chess-board-container')
  if (chessBoardContainer) {
    const root = ReactDOM.createRoot(chessBoardContainer)
    root.render(<ChessBoard size={400} />)
  }

  // Mount DailyPuzzle on home page
  const dailyPuzzleContainer = document.getElementById('daily-puzzle-container')
  if (dailyPuzzleContainer) {
    const root = ReactDOM.createRoot(dailyPuzzleContainer)
    root.render(<DailyPuzzle size={320} />)
  }
})