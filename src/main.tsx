import React from 'react'
import ReactDOM from 'react-dom/client'
import { createPortal } from 'react-dom'
import ChessBoard from './components/chess-board'
import DailyPuzzle from './components/daily-puzzle'
import LichessDailyPuzzle from './components/lichess-daily-puzzle'
import BuddyBoard from './components/buddy-board'
import FiltersButton from './components/filters-button'
import TopFilters from './components/top-filters'
import GameStation from './components/game-station'
import GamesGrid from './components/games-grid'
import GameResultsChart from './components/game-results-chart'
import MistakesAnalysisChart from './components/mistakes-analysis-chart'
import OpeningAnalysis from './components/opening-analysis'
import BlunderAnalysis from './components/blunder-analysis'
import TimeAnalysis from './components/time-analysis'
import PrinciplesSummary from './components/principles-summary'
import CustomPuzzles from './components/custom-puzzles'
import PrincipleSelector from './components/principle-selector'
import OpeningStatsByElo from './components/opening-stats-by-elo'
import LearnTopicBoard from './components/learn-topic-board'
import LearnBuddyBoard from './components/learn-buddy-board'
import GenerateReport from './components/generate-report'
import { gameFilterManager } from './game-filter-manager'
import { eloDataManager } from './elo-data-manager'

// Make React available globally for template scripts
;(window as any).React = React
;(window as any).ReactDOM = ReactDOM
;(window as any).gameFilterManager = gameFilterManager
;(window as any).eloDataManager = eloDataManager
;(window as any).TopFilters = TopFilters

// This is the main entry point for Vite
console.log('Main Vite entry point loaded')

// Auto-mount components based on DOM elements
document.addEventListener('DOMContentLoaded', () => {
  // Initialize EloDataManager with data from the page (if available)
  try {
    // Load ELO averages data
    const eloAveragesElement = document.getElementById('elo-averages-data')
    if (eloAveragesElement && eloAveragesElement.textContent) {
      const eloAveragesText = eloAveragesElement.textContent.trim()
      if (eloAveragesText && eloAveragesText.startsWith('{')) {
        const eloAveragesData = JSON.parse(eloAveragesText)
        eloDataManager.setEloAveragesData(eloAveragesData)
      }
    }

    // Load opening stats data
    const openingStatsElement = document.getElementById('opening-stats-data')
    if (openingStatsElement && openingStatsElement.textContent) {
      const openingStatsText = openingStatsElement.textContent.trim()
      if (openingStatsText && openingStatsText.startsWith('{')) {
        const openingStatsData = JSON.parse(openingStatsText)
        eloDataManager.setOpeningStatsData(openingStatsData)
      }
    }
  } catch (error) {
    console.log('Error initializing EloDataManager:', (error as Error).message)
  }

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
    // Check if BuddyBoard is already mounted to prevent duplicates
    let buddyBoardContainer = document.getElementById('buddy-board-container')
    if (!buddyBoardContainer) {
      buddyBoardContainer = document.createElement('div')
      buddyBoardContainer.id = 'buddy-board-container'
      document.body.appendChild(buddyBoardContainer)

      const root = ReactDOM.createRoot(buddyBoardContainer)
      root.render(<BuddyBoard size={400} />)
    }

    // Mount FiltersButton - check if already mounted
    let filtersButtonContainer = document.getElementById('filters-button-container')
    if (!filtersButtonContainer) {
      filtersButtonContainer = document.createElement('div')
      filtersButtonContainer.id = 'filters-button-container'
      document.body.appendChild(filtersButtonContainer)

      const filtersRoot = ReactDOM.createRoot(filtersButtonContainer)
      filtersRoot.render(<FiltersButton />)
    }
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
        if (enrichedText && enrichedText.startsWith('[')) {
          const parsedData = JSON.parse(enrichedText)

          // Handle both array format and single object format
          if (Array.isArray(parsedData)) {
            initialGamesData = parsedData
          } else if (parsedData && typeof parsedData === 'object') {
            // Check if it's a nested structure with games
            if (parsedData.games && Array.isArray(parsedData.games)) {
              initialGamesData = parsedData.games
            } else if (!parsedData.status) {
              // Not a status message, treat as single game
              initialGamesData = [parsedData]
            }
          }
        }
      }

      // If no enriched games found, try to get raw game data for initial ELO display
      if (initialGamesData.length === 0) {
        const rawGameDataElement = document.getElementById('raw-game-data')
        if (rawGameDataElement && rawGameDataElement.textContent) {
          const rawText = rawGameDataElement.textContent.trim()

          if (rawText && rawText !== 'Loading...' && rawText.startsWith('[')) {
            const parsedData = JSON.parse(rawText)
            if (Array.isArray(parsedData)) {
              initialGamesData = parsedData
              console.log('Using raw game data for initial ELO chart:', initialGamesData.length, 'games')
            }
          }
        }
      }
    } catch (error) {
      console.log('Error parsing games data:', (error as Error).message, error)
    }

    // Try to get ELO averages data from the page
    let eloAveragesData = null
    try {
      const eloAveragesElement = document.getElementById('elo-averages-data')
      if (eloAveragesElement && eloAveragesElement.textContent) {
        const eloAveragesText = eloAveragesElement.textContent.trim()
        if (eloAveragesText && eloAveragesText.startsWith('{')) {
          eloAveragesData = JSON.parse(eloAveragesText)
        }
      }
    } catch (error) {
      console.log('Error parsing ELO averages data:', (error as Error).message)
    }

    // Load initial games into the filter manager
    if (initialGamesData.length > 0) {
      gameFilterManager.updateAllGames(initialGamesData)
    }

    // Render chart with initial data
    root.render(<GameResultsChart enrichedGames={initialGamesData} username={username} eloAveragesData={eloAveragesData} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).gameResultsChartRoot = root
    ;(window as any).GameResultsChart = GameResultsChart
  }

  // Mount MistakesAnalysisChart on report pages
  const mistakesAnalysisContainer = document.getElementById('mistakes-analysis-chart-container')
  if (mistakesAnalysisContainer) {
    const username = mistakesAnalysisContainer.dataset.username || ''
    const root = ReactDOM.createRoot(mistakesAnalysisContainer)

    // Try to get existing enriched games data from the page
    let initialGamesData = []
    try {
      const enrichedGamesElement = document.getElementById('enriched-games')
      if (enrichedGamesElement && enrichedGamesElement.textContent) {
        const enrichedText = enrichedGamesElement.textContent.trim()

        // Check if it's actual games data (not a status message)
        if (enrichedText && enrichedText.startsWith('[')) {
          const parsedData = JSON.parse(enrichedText)

          // Handle both array format and single object format
          if (Array.isArray(parsedData)) {
            initialGamesData = parsedData
          } else if (parsedData && typeof parsedData === 'object') {
            // Check if it's a nested structure with games
            if (parsedData.games && Array.isArray(parsedData.games)) {
              initialGamesData = parsedData.games
            } else if (!parsedData.status) {
              // Not a status message, treat as single game
              initialGamesData = [parsedData]
            }
          }
        }
      }
    } catch (error) {
      console.log('Error parsing enriched games data for mistakes chart:', (error as Error).message)
    }

    // Try to get ELO averages data from the page
    let eloAveragesData = null
    try {
      const eloAveragesElement = document.getElementById('elo-averages-data')
      if (eloAveragesElement && eloAveragesElement.textContent) {
        const eloAveragesText = eloAveragesElement.textContent.trim()
        if (eloAveragesText && eloAveragesText.startsWith('{')) {
          eloAveragesData = JSON.parse(eloAveragesText)
        }
      }
    } catch (error) {
      console.log('Error parsing ELO averages data for mistakes chart:', (error as Error).message)
    }

    // Render chart with initial data
    root.render(<MistakesAnalysisChart enrichedGames={initialGamesData} username={username} eloAveragesData={eloAveragesData} />)

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
      console.log('Error parsing enriched games data for opening analysis:', (error as Error).message)
    }

    // Try to get ELO averages data from the page
    let eloAveragesData = null
    try {
      const eloAveragesElement = document.getElementById('elo-averages-data')
      if (eloAveragesElement && eloAveragesElement.textContent) {
        const eloAveragesText = eloAveragesElement.textContent.trim()
        if (eloAveragesText && eloAveragesText.startsWith('{')) {
          eloAveragesData = JSON.parse(eloAveragesText)
        }
      }
    } catch (error) {
      console.log('Error parsing ELO averages data for opening analysis:', (error as Error).message)
    }

    // Try to get opening stats data from the page
    let openingStatsData = null
    try {
      const openingStatsElement = document.getElementById('opening-stats-data')
      if (openingStatsElement && openingStatsElement.textContent) {
        const openingStatsText = openingStatsElement.textContent.trim()
        if (openingStatsText && openingStatsText.startsWith('{')) {
          openingStatsData = JSON.parse(openingStatsText)
        }
      }
    } catch (error) {
      console.log('Error parsing opening stats data for opening analysis:', (error as Error).message)
    }

    // Render chart with initial data
    root.render(<OpeningAnalysis enrichedGames={initialGamesData} username={username} eloAveragesData={eloAveragesData} openingStatsData={openingStatsData} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).openingAnalysisRoot = root
    ;(window as any).OpeningAnalysis = OpeningAnalysis
  }

  // Mount BlunderAnalysis on report pages
  const blunderAnalysisContainer = document.getElementById('blunder-analysis-container')
  if (blunderAnalysisContainer) {
    const username = blunderAnalysisContainer.dataset.username || ''
    const reportId = blunderAnalysisContainer.dataset.reportId ? parseInt(blunderAnalysisContainer.dataset.reportId) : undefined
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
      console.log('Error parsing enriched games data for blunder analysis:', (error as Error).message)
    }

    // Render component with initial data
    root.render(<BlunderAnalysis enrichedGames={initialGamesData} username={username} reportId={reportId} />)

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
      console.log('Error parsing enriched games data for time analysis:', (error as Error).message)
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
        }
      }
    } catch (error) {
      console.log('Error parsing stockfish analysis data for time management:', (error as Error).message)
    }

    // Get ELO averages data
    let eloAveragesData = null
    try {
      const eloAveragesElement = document.getElementById('elo-averages-data')
      if (eloAveragesElement && eloAveragesElement.textContent) {
        const eloAveragesText = eloAveragesElement.textContent.trim()

        if (eloAveragesText && (eloAveragesText.startsWith('{') || eloAveragesText.startsWith('['))) {
          eloAveragesData = JSON.parse(eloAveragesText)
        }
      }
    } catch (error) {
      console.log('Error parsing ELO averages data for time analysis:', (error as Error).message)
    }

    // Render component with initial data
    root.render(<TimeAnalysis enrichedGames={initialGamesData} username={username} timeManagementData={timeManagementData} eloAveragesData={eloAveragesData} />)

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
          // The stockfish-analysis element contains principles data with by_time_control and aggregated
          principlesData = JSON.parse(stockfishText)
        }
      }
    } catch (error) {
      console.log('Error parsing stockfish analysis data for principles summary:', (error as Error).message)
    }

    // Get ELO averages data
    let eloAveragesData = null
    try {
      const eloAveragesElement = document.getElementById('elo-averages-data')
      if (eloAveragesElement && eloAveragesElement.textContent) {
        const eloAveragesText = eloAveragesElement.textContent.trim()
        if (eloAveragesText && eloAveragesText.startsWith('{')) {
          eloAveragesData = JSON.parse(eloAveragesText)
        }
      }
    } catch (error) {
      console.log('Error parsing ELO averages data for principles summary:', (error as Error).message)
    }

    // Render component with initial data
    root.render(<PrinciplesSummary principlesData={principlesData} eloAveragesData={eloAveragesData} />)

    // Store the root reference globally so we can update it from the streaming handler
    ;(window as any).principlesSummaryRoot = root
    ;(window as any).PrinciplesSummary = PrinciplesSummary
  }

  // Mount CustomPuzzles and PrincipleSelector on report pages
  const customPuzzlesContainer = document.getElementById('custom-puzzles-container')

  if (customPuzzlesContainer) {
    // Get report ID from data attribute
    const reportId = customPuzzlesContainer.dataset.reportId ? parseInt(customPuzzlesContainer.dataset.reportId) : undefined

    // Store reportId globally for the template's updateCustomPuzzles function
    ;(window as any).reportId = reportId

    // Get puzzle data from dedicated custom-puzzles-data element
    let puzzlesData = []
    try {
      const customPuzzlesElement = document.getElementById('custom-puzzles-data')

      if (customPuzzlesElement && customPuzzlesElement.textContent) {
        const puzzlesText = customPuzzlesElement.textContent.trim()

        if (puzzlesText && puzzlesText.startsWith('[')) {
          puzzlesData = JSON.parse(puzzlesText)
        }
      }
    } catch (error) {
      console.error('🧩 Error parsing custom puzzles data:', error)
    }

    // Get principles data - extract aggregated for PrincipleSelector
    let aggregatedPrinciplesData = null
    try {
      const stockfishAnalysisEl = document.getElementById('stockfish-analysis')
      if (stockfishAnalysisEl && stockfishAnalysisEl.textContent) {
        const analysisText = stockfishAnalysisEl.textContent.trim()
        if (analysisText && analysisText !== '{}') {
          const principlesData = JSON.parse(analysisText)

          // For PrincipleSelector, use aggregated data (averaged across all time controls)
          // This ensures puzzle selection is based on overall performance, not specific time controls
          // The principles data structure has: { by_time_control: {...}, aggregated: { elo_range, games_analyzed, principles: {...} } }
          aggregatedPrinciplesData = principlesData.aggregated || principlesData
        }
      }
    } catch (error) {
      console.error('Error parsing principles data:', error)
    }

    // Create a wrapper component to manage shared state
    const PuzzlesWithSelector = () => {
      const [selectedPrinciple, setSelectedPrinciple] = React.useState<string | null>(null)

      return (
        <div style={{
          display: 'flex',
          gap: '20px',
          alignItems: 'flex-start',
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          {/* Render PrincipleSelector on the left */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minWidth: '320px',
            maxWidth: '400px',
            flex: '1'
          }}>
            <PrincipleSelector
              principlesData={aggregatedPrinciplesData}
              selectedPrinciple={selectedPrinciple}
              onSelectPrinciple={setSelectedPrinciple}
            />
          </div>

          {/* Render CustomPuzzles on the right */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            flex: '1',
            minWidth: '320px',
            maxWidth: '550px'
          }}>
            <CustomPuzzles
              puzzles={puzzlesData}
              size={480}
              selectedPrinciple={selectedPrinciple}
              reportId={reportId}
            />
          </div>
        </div>
      )
    }

    const root = ReactDOM.createRoot(customPuzzlesContainer)
    root.render(<PuzzlesWithSelector />)

    // Store the root reference globally
    ;(window as any).customPuzzlesRoot = root
    ;(window as any).CustomPuzzles = CustomPuzzles
    ;(window as any).PrincipleSelector = PrincipleSelector
  }

  // Mount OpeningStatsByElo on openings page
  const openingStatsByEloContainer = document.getElementById('opening-stats-by-elo-root')
  if (openingStatsByEloContainer) {
    const root = ReactDOM.createRoot(openingStatsByEloContainer)
    root.render(<OpeningStatsByElo />)

    // Store the root reference globally
    ;(window as any).openingStatsByEloRoot = root
    ;(window as any).OpeningStatsByElo = OpeningStatsByElo
  }

  // Mount LearnBuddyBoard on learn pages (e.g., evaluations)
  const learnBuddyBoardContainer = document.getElementById('learn-buddy-board-root')
  if (learnBuddyBoardContainer) {
    const root = ReactDOM.createRoot(learnBuddyBoardContainer)
    root.render(<LearnBuddyBoard size={400} />)

    // Store the root reference globally
    ;(window as any).learnBuddyBoardRoot = root
  }

  // Mount LearnTopicBoard instances on learn page
  const learnTopicBoards = document.querySelectorAll('[data-learn-topic-board]')
  learnTopicBoards.forEach((container) => {
    const position = container.getAttribute('data-position')
    const size = parseInt(container.getAttribute('data-size') || '200')

    if (position) {
      const root = ReactDOM.createRoot(container)
      root.render(<LearnTopicBoard position={position} size={size} />)
    }
  })

  // Mount GenerateReport component on generate-report page
  const generateReportContainer = document.getElementById('generate-report-root')
  if (generateReportContainer) {
    const username = generateReportContainer.dataset.username || ''
    const platform = (generateReportContainer.dataset.platform || 'lichess') as 'lichess' | 'chess.com'
    const root = ReactDOM.createRoot(generateReportContainer)
    root.render(<GenerateReport username={username} platform={platform} />)
  }
})
