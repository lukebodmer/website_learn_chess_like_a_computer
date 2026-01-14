import React from 'react'
import ReactDOM from 'react-dom/client'
import ChessBoard from './components/chess-board'
import DailyPuzzle from './components/daily-puzzle'
import LichessDailyPuzzle from './components/lichess-daily-puzzle'
import BuddyBoard from './components/buddy-board'
import FiltersButton from './components/filters-button'
import GameStation from './components/game-station'
import GamesGrid from './components/games-grid'
import GameResultsChart from './components/game-results-chart'
import MistakesAnalysisChart from './components/mistakes-analysis-chart'
import OpeningAnalysis from './components/opening-analysis'
import BlunderAnalysis from './components/blunder-analysis'
import TimeAnalysis from './components/time-analysis'
import PrinciplesSummary from './components/principles-summary'
import CustomPuzzles from './components/custom-puzzles'
import { gameFilterManager } from './game-filter-manager'

// Make React available globally for template scripts
;(window as any).React = React
;(window as any).gameFilterManager = gameFilterManager

// This is the main entry point for Vite
console.log('Main Vite entry point loaded')

// Auto-mount components based on DOM elements
document.addEventListener('DOMContentLoaded', () => {
  // Mount GamesGrid on games page
  const chessBoardContainer = document.getElementById('chess-board-container')
  if (chessBoardContainer) {
    // Mount GamesGrid in the main content area
    const gamesGridContainer = document.getElementById('games-grid-container')
    if (gamesGridContainer) {
      const gridRoot = ReactDOM.createRoot(gamesGridContainer)

      // Handler to emit game selection event
      const handleGameSelect = (gameId: string) => {
        const event = new CustomEvent('gameSelected', { detail: { gameId } })
        window.dispatchEvent(event)
      }

      gridRoot.render(<GamesGrid onGameSelect={handleGameSelect} />)
    }
  }

  // Mount GameStation globally (on all pages)
  const gameStationContainer = document.createElement('div')
  gameStationContainer.id = 'game-station-container'
  document.body.appendChild(gameStationContainer)

  const stationRoot = ReactDOM.createRoot(gameStationContainer)
  stationRoot.render(<GameStation />)

  // Mount DailyPuzzle on home page
  const dailyPuzzleContainer = document.getElementById('daily-puzzle-container')
  if (dailyPuzzleContainer) {
    const root = ReactDOM.createRoot(dailyPuzzleContainer)
    root.render(<DailyPuzzle size={320} />)
  }

  // Mount LichessDailyPuzzle on home page
  const lichessDailyPuzzleContainer = document.getElementById('lichess-daily-puzzle-container')
  if (lichessDailyPuzzleContainer) {
    const root = ReactDOM.createRoot(lichessDailyPuzzleContainer)
    root.render(<LichessDailyPuzzle size={320} />)
  }

  // Mount BuddyBoard and FiltersButton on report pages (check if we're on a report page)
  if (window.location.pathname.includes('/report/') ||
      document.querySelector('.enriched-games') ||
      document.querySelector('[data-enriched-games]')) {
    const buddyBoardContainer = document.createElement('div')
    buddyBoardContainer.id = 'buddy-board-container'
    document.body.appendChild(buddyBoardContainer)

    const root = ReactDOM.createRoot(buddyBoardContainer)
    root.render(<BuddyBoard size={400} />)

    // Mount FiltersButton
    const filtersButtonContainer = document.createElement('div')
    filtersButtonContainer.id = 'filters-button-container'
    document.body.appendChild(filtersButtonContainer)

    const filtersRoot = ReactDOM.createRoot(filtersButtonContainer)
    filtersRoot.render(<FiltersButton />)
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

  // Mount BlunderAnalysis on report pages
  const blunderAnalysisContainer = document.getElementById('blunder-analysis-container')
  if (blunderAnalysisContainer) {
    const username = blunderAnalysisContainer.dataset.username || ''
    const root = ReactDOM.createRoot(blunderAnalysisContainer)

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
      console.log('Error parsing enriched games data for blunder analysis:', error.message)
    }

    // Render component with initial data
    root.render(<BlunderAnalysis enrichedGames={initialGamesData} username={username} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).blunderAnalysisRoot = root
    ;(window as any).BlunderAnalysis = BlunderAnalysis
  }

  // Mount TimeAnalysis on report pages
  const timeAnalysisContainer = document.getElementById('time-analysis-container')
  if (timeAnalysisContainer) {
    const username = timeAnalysisContainer.dataset.username || ''
    const root = ReactDOM.createRoot(timeAnalysisContainer)

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
      console.log('Error parsing enriched games data for time analysis:', error.message)
    }

    // Get time management data from stockfish_analysis
    let timeManagementData = null
    try {
      const stockfishAnalysisElement = document.getElementById('stockfish-analysis')
      if (stockfishAnalysisElement && stockfishAnalysisElement.textContent) {
        const stockfishText = stockfishAnalysisElement.textContent.trim()

        if (stockfishText && (stockfishText.startsWith('{') || stockfishText.startsWith('['))) {
          const parsedData = JSON.parse(stockfishText)
          // Time management is nested under principles.principles.time_management
          timeManagementData = parsedData.principles?.principles?.time_management || null
          console.log('Time management data loaded:', timeManagementData ? 'Yes' : 'No')
        }
      }
    } catch (error) {
      console.log('Error parsing stockfish analysis data for time management:', error.message)
    }

    // Render component with initial data
    root.render(<TimeAnalysis enrichedGames={initialGamesData} username={username} timeManagementData={timeManagementData} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).timeAnalysisRoot = root
    ;(window as any).TimeAnalysis = TimeAnalysis
  }

  // Mount PrinciplesSummary on report pages
  const principlesSummaryContainer = document.getElementById('principles-summary-container')
  if (principlesSummaryContainer) {
    const root = ReactDOM.createRoot(principlesSummaryContainer)

    // Get principles data from stockfish_analysis
    let principlesData = null
    try {
      const stockfishAnalysisElement = document.getElementById('stockfish-analysis')
      if (stockfishAnalysisElement && stockfishAnalysisElement.textContent) {
        const stockfishText = stockfishAnalysisElement.textContent.trim()

        if (stockfishText && (stockfishText.startsWith('{') || stockfishText.startsWith('['))) {
          const parsedData = JSON.parse(stockfishText)
          principlesData = parsedData.principles || null
        }
      }
    } catch (error) {
      console.log('Error parsing stockfish analysis data for principles summary:', error.message)
    }

    // Render component with initial data
    root.render(<PrinciplesSummary principlesData={principlesData} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).principlesSummaryRoot = root
    ;(window as any).PrinciplesSummary = PrinciplesSummary
  }

  // Mount CustomPuzzles on report pages
  const customPuzzlesContainer = document.getElementById('custom-puzzles-container')
  console.log('🧩 CustomPuzzles container found:', !!customPuzzlesContainer)

  if (customPuzzlesContainer) {
    const root = ReactDOM.createRoot(customPuzzlesContainer)

    // Get puzzle data from dedicated custom-puzzles-data element
    let puzzlesData = []
    try {
      const customPuzzlesElement = document.getElementById('custom-puzzles-data')
      console.log('🧩 Custom puzzles data element found:', !!customPuzzlesElement)

      if (customPuzzlesElement && customPuzzlesElement.textContent) {
        const puzzlesText = customPuzzlesElement.textContent.trim()
        console.log('🧩 Puzzles text length:', puzzlesText.length)
        console.log('🧩 Puzzles text starts with [:', puzzlesText.startsWith('['))

        if (puzzlesText && puzzlesText.startsWith('[')) {
          puzzlesData = JSON.parse(puzzlesText)
          console.log('🧩 Successfully parsed puzzles, count:', puzzlesData.length)
          console.log('🧩 First puzzle:', puzzlesData[0])
        } else {
          console.log('🧩 Puzzles text does not start with [')
        }
      } else {
        console.log('🧩 No custom puzzles element or empty content')
      }
    } catch (error) {
      console.error('🧩 Error parsing custom puzzles data:', error)
    }

    console.log('🧩 Rendering CustomPuzzles with', puzzlesData.length, 'puzzles')

    // Render component with puzzle data
    root.render(<CustomPuzzles puzzles={puzzlesData} size={400} />)

    // Store the root reference globally
    ;(window as any).customPuzzlesRoot = root
    ;(window as any).CustomPuzzles = CustomPuzzles
  }
})