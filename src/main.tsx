import React from 'react'
import ReactDOM from 'react-dom/client'
import BuddyBoard from './components/buddy-board'
import ChessBoard from './components/chess-board'

// This is the main entry point for Vite
console.log('Main Vite entry point loaded')

// Auto-mount components based on DOM elements
document.addEventListener('DOMContentLoaded', () => {
  // Mount BuddyBoard if the widget element exists
  const buddyBoardWidget = document.getElementById('buddy-board-widget')
  if (buddyBoardWidget) {
    const root = ReactDOM.createRoot(buddyBoardWidget.parentElement!)
    root.render(<BuddyBoard />)
  }


  // Mount ChessBoard on games page
  const chessBoardContainer = document.getElementById('chess-board-container')
  if (chessBoardContainer) {
    const root = ReactDOM.createRoot(chessBoardContainer)
    root.render(<ChessBoard size={400} />)
  }
})