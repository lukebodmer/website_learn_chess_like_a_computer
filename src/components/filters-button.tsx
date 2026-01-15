import React, { useState, useEffect } from 'react'
import { gameFilterManager, FilterType, SpeedFilter, ResultFilter } from '../game-filter-manager'

export interface FiltersButtonProps {}

// Slider filters icon SVG component
const FiltersIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Top slider line */}
    <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    {/* Top slider circle */}
    <circle cx="14" cy="6" r="3" fill="currentColor" />

    {/* Middle slider line */}
    <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    {/* Middle slider circle */}
    <circle cx="8" cy="12" r="3" fill="currentColor" />

    {/* Bottom slider line */}
    <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    {/* Bottom slider circle */}
    <circle cx="16" cy="18" r="3" fill="currentColor" />
  </svg>
)

const FiltersButton: React.FC<FiltersButtonProps> = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all')
  const [currentSpeedFilter, setCurrentSpeedFilter] = useState<SpeedFilter>('all')
  const [currentResultFilter, setCurrentResultFilter] = useState<ResultFilter>('all')
  const [availableSpeeds, setAvailableSpeeds] = useState<string[]>([])
  const [activeFilterCount, setActiveFilterCount] = useState<number>(0)

  // Add styles for animation
  useEffect(() => {
    const styleId = 'filters-button-animation-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes expandPanel {
          0% {
            transform: scale(0.2);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes collapsePanel {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0.2);
            opacity: 0;
          }
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  useEffect(() => {
    // Initialize with current filter state
    setCurrentFilter(gameFilterManager.getCurrentFilter())
    setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
    setCurrentResultFilter(gameFilterManager.getCurrentResultFilter())
    setAvailableSpeeds(gameFilterManager.getAvailableSpeeds())
    updateActiveFilterCount()

    // Listen for filter changes
    const handleFilterChange = () => {
      setCurrentFilter(gameFilterManager.getCurrentFilter())
      setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
      setCurrentResultFilter(gameFilterManager.getCurrentResultFilter())
      setAvailableSpeeds(gameFilterManager.getAvailableSpeeds())
      updateActiveFilterCount()
    }

    gameFilterManager.addListener(handleFilterChange)

    return () => {
      gameFilterManager.removeListener(handleFilterChange)
    }
  }, [])

  const updateActiveFilterCount = () => {
    let count = 0

    // Count color filter if not 'all'
    if (gameFilterManager.getCurrentFilter() !== 'all') {
      count++
    }

    // Count speed filter if not 'all'
    if (gameFilterManager.getCurrentSpeedFilter() !== 'all') {
      count++
    }

    // Count result filter if not 'all'
    if (gameFilterManager.getCurrentResultFilter() !== 'all') {
      count++
    }

    setActiveFilterCount(count)
  }

  const handleColorFilterChange = (filter: FilterType) => {
    gameFilterManager.setFilter(filter)
  }

  const handleSpeedToggle = (speed: string) => {
    gameFilterManager.toggleSpeed(speed)
  }

  const handleSpeedAllClick = () => {
    gameFilterManager.setSpeedFilter('all')
  }

  const handleResultFilterChange = (result: ResultFilter) => {
    gameFilterManager.setResultFilter(result)
  }

  const isSpeedSelected = (speed: string): boolean => {
    return gameFilterManager.isSpeedSelected(speed)
  }

  const toggleExpanded = () => {
    if (isExpanded) {
      // Start collapse animation
      setIsAnimatingOut(true)
      setTimeout(() => {
        setIsExpanded(false)
        setIsAnimatingOut(false)
      }, 300) // Match animation duration
    } else {
      // Expand immediately
      setIsExpanded(true)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '110px',
        right: '20px',
        zIndex: 1000
      }}
    >
      {!isExpanded && !isAnimatingOut ? (
        // Collapsed button
        <button
          onClick={toggleExpanded}
          style={{
            width: '80px',
            height: '80px',
            backgroundColor: 'var(--secondary-color)',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            boxShadow: '0 4px 12px var(--shadow-medium)',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--secondary-light)'
            e.currentTarget.style.transform = 'scale(1.05)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--secondary-color)'
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          <div style={{ color: 'var(--text-on-primary)' }}>
            <FiltersIcon size={28} />
          </div>
          <span style={{
            color: 'var(--text-on-primary)',
            fontSize: '10px',
            fontWeight: '600',
            textAlign: 'center',
            lineHeight: '1'
          }}>
            FILTERS{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </span>
        </button>
      ) : (
        // Expanded panel
        <div
          style={{
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 0 0 1px var(--primary-color), 0 0 12px 2px rgba(var(--primary-color-rgb, 59, 130, 246), 0.4), 0 12px 40px var(--shadow-medium)',
            minWidth: '250px',
            maxWidth: '300px',
            transformOrigin: 'bottom right',
            animation: isAnimatingOut
              ? 'collapsePanel 0.3s cubic-bezier(0.4, 0, 0.6, 1) forwards'
              : 'expandPanel 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Filters
            </h3>
            <button
              onClick={toggleExpanded}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--hover-background)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              ×
            </button>
          </div>

          {/* Color Filter */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '8px'
            }}>
              Player Color
            </div>
            <div style={{
              display: 'flex',
              gap: '8px'
            }}>
              {(['all', 'white', 'black'] as FilterType[]).map(filter => (
                <button
                  key={filter}
                  onClick={() => handleColorFilterChange(filter)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: '600',
                    border: currentFilter === filter ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    backgroundColor: currentFilter === filter ? 'var(--primary-color)' : 'var(--background-primary)',
                    color: currentFilter === filter ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textTransform: 'capitalize'
                  }}
                  onMouseEnter={(e) => {
                    if (currentFilter !== filter) {
                      e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentFilter !== filter) {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                    }
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Speed Filter */}
          {availableSpeeds.length > 0 && (
            <div>
              <div style={{
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                marginBottom: '8px'
              }}>
                Time Control
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                {/* All speeds option */}
                <button
                  onClick={handleSpeedAllClick}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: '600',
                    border: currentSpeedFilter === 'all' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    backgroundColor: currentSpeedFilter === 'all' ? 'var(--primary-color)' : 'var(--background-primary)',
                    color: currentSpeedFilter === 'all' ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(e) => {
                    if (currentSpeedFilter !== 'all') {
                      e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentSpeedFilter !== 'all') {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                    }
                  }}
                >
                  All
                </button>

                {/* Individual speed options */}
                {availableSpeeds.map(speed => (
                  <button
                    key={speed}
                    onClick={() => handleSpeedToggle(speed)}
                    style={{
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      border: isSpeedSelected(speed) ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                      borderRadius: '6px',
                      backgroundColor: isSpeedSelected(speed) ? 'var(--primary-color)' : 'var(--background-primary)',
                      color: isSpeedSelected(speed) ? 'var(--text-on-primary)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      textAlign: 'left',
                      textTransform: 'capitalize'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSpeedSelected(speed)) {
                        e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSpeedSelected(speed)) {
                        e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                      }
                    }}
                  >
                    {speed}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Game Result Filter */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '8px'
            }}>
              Game Result
            </div>
            <div style={{
              display: 'flex',
              gap: '8px'
            }}>
              {(['all', 'win', 'loss', 'draw'] as ResultFilter[]).map(result => (
                <button
                  key={result}
                  onClick={() => handleResultFilterChange(result)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: '600',
                    border: currentResultFilter === result ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    backgroundColor: currentResultFilter === result ? 'var(--primary-color)' : 'var(--background-primary)',
                    color: currentResultFilter === result ? 'var(--text-on-primary)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textTransform: 'capitalize'
                  }}
                  onMouseEnter={(e) => {
                    if (currentResultFilter !== result) {
                      e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentResultFilter !== result) {
                      e.currentTarget.style.backgroundColor = 'var(--background-primary)'
                    }
                  }}
                >
                  {result === 'all' ? 'All' : result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw'}
                </button>
              ))}
            </div>
          </div>

          {/* Filter summary */}
          <div style={{
            marginTop: '16px',
            padding: '8px',
            backgroundColor: 'var(--background-primary)',
            borderRadius: '6px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            textAlign: 'center'
          }}>
            {gameFilterManager.getFilterDescription()}
          </div>
        </div>
      )}
    </div>
  )
}

export default FiltersButton
