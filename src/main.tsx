import React from 'react'
import ReactDOM from 'react-dom/client'
import ChessBoard from './components/chess-board'
import DailyPuzzle from './components/daily-puzzle'
import BuddyBoard from './components/buddy-board'
import GameResultsChart from './components/game-results-chart'
import MistakesAnalysisChart from './components/mistakes-analysis-chart'
import OpeningAnalysis from './components/opening-analysis'
import { gameFilterManager } from './game-filter-manager'

// Make React available globally for template scripts
;(window as any).React = React
;(window as any).gameFilterManager = gameFilterManager

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

  // Mount BuddyBoard on report pages (check if we're on a report page)
  if (window.location.pathname.includes('/report/') ||
      document.querySelector('.enriched-games') ||
      document.querySelector('[data-enriched-games]')) {
    const buddyBoardContainer = document.createElement('div')
    buddyBoardContainer.id = 'buddy-board-container'
    document.body.appendChild(buddyBoardContainer)

    const root = ReactDOM.createRoot(buddyBoardContainer)
    root.render(<BuddyBoard size={400} />)
  }

  // Mount GameResultsChart on report pages
  const gameResultsContainer = document.getElementById('game-results-chart-container')
  if (gameResultsContainer) {
    const username = gameResultsContainer.dataset.username || ''
    const root = ReactDOM.createRoot(gameResultsContainer)

    // Try to get existing enriched games data from the page
    let initialGamesData = []
    try {
      const enrichedGamesElement = document.getElementById('enriched-games')
      if (enrichedGamesElement && enrichedGamesElement.textContent) {
        const enrichedText = enrichedGamesElement.textContent.trim()

        // Check if it's actual games data (not a status message)
        if (enrichedText && (enrichedText.startsWith('[') || enrichedText.startsWith('{'))) {
          const parsedData = JSON.parse(enrichedText)

          // Handle both array format and single object format
          if (Array.isArray(parsedData)) {
            initialGamesData = parsedData
          } else if (parsedData && typeof parsedData === 'object') {
            // Check if it's a nested structure with games
            if (parsedData.games && Array.isArray(parsedData.games)) {
              initialGamesData = parsedData.games
            } else {
              initialGamesData = [parsedData]
            }
          }

        } else {
          console.log('Enriched games element contains status message, not actual games')
        }
      } else {
        console.log('No enriched games element found or empty')
      }
    } catch (error) {
      console.log('Error parsing enriched games data:', error.message, error)
    }

    // Render chart with initial data (empty for new reports, populated for completed reports)
    root.render(<GameResultsChart enrichedGames={initialGamesData} username={username} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).gameResultsChartRoot = root
    ;(window as any).GameResultsChart = GameResultsChart

    // If we found initial data, also store it globally for streaming updates
    if (initialGamesData.length > 0) {
      ;(window as any).enrichedGamesArray = initialGamesData
    }
  }

  // Mount MistakesAnalysisChart on report pages
  const mistakesAnalysisContainer = document.getElementById('mistakes-analysis-chart-container')
  if (mistakesAnalysisContainer) {
    const username = mistakesAnalysisContainer.dataset.username || ''
    const root = ReactDOM.createRoot(mistakesAnalysisContainer)

    // Use the same initial games data as the GameResultsChart
    let initialGamesData = []
    try {
      const enrichedGamesElement = document.getElementById('enriched-games')
      if (enrichedGamesElement && enrichedGamesElement.textContent) {
        const enrichedText = enrichedGamesElement.textContent.trim()

        // Check if it's actual games data (not a status message)
        if (enrichedText && (enrichedText.startsWith('[') || enrichedText.startsWith('{'))) {
          const parsedData = JSON.parse(enrichedText)

          // Handle both array format and single object format
          if (Array.isArray(parsedData)) {
            initialGamesData = parsedData
          } else if (parsedData && typeof parsedData === 'object') {
            // Check if it's a nested structure with games
            if (parsedData.games && Array.isArray(parsedData.games)) {
              initialGamesData = parsedData.games
            } else {
              initialGamesData = [parsedData]
            }
          }
        }
      }
    } catch (error) {
      console.log('Error parsing enriched games data for mistakes chart:', error.message)
    }

    // Render chart with initial data
    root.render(<MistakesAnalysisChart enrichedGames={initialGamesData} username={username} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).mistakesAnalysisChartRoot = root
    ;(window as any).MistakesAnalysisChart = MistakesAnalysisChart
  }

  // Mount OpeningAnalysis on report pages
  const openingAnalysisContainer = document.getElementById('opening-analysis-container')
  if (openingAnalysisContainer) {
    const username = openingAnalysisContainer.dataset.username || ''
    const root = ReactDOM.createRoot(openingAnalysisContainer)

    // Use the same initial games data as the other charts
    let initialGamesData = []
    try {
      const enrichedGamesElement = document.getElementById('enriched-games')
      if (enrichedGamesElement && enrichedGamesElement.textContent) {
        const enrichedText = enrichedGamesElement.textContent.trim()

        // Check if it's actual games data (not a status message)
        if (enrichedText && (enrichedText.startsWith('[') || enrichedText.startsWith('{'))) {
          const parsedData = JSON.parse(enrichedText)

          // Handle both array format and single object format
          if (Array.isArray(parsedData)) {
            initialGamesData = parsedData
          } else if (parsedData && typeof parsedData === 'object') {
            // Check if it's a nested structure with games
            if (parsedData.games && Array.isArray(parsedData.games)) {
              initialGamesData = parsedData.games
            } else {
              initialGamesData = [parsedData]
            }
          }
        }
      }
    } catch (error) {
      console.log('Error parsing enriched games data for opening analysis:', error.message)
    }

    // Render chart with initial data
    root.render(<OpeningAnalysis enrichedGames={initialGamesData} username={username} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).openingAnalysisRoot = root
    ;(window as any).OpeningAnalysis = OpeningAnalysis
  }
})