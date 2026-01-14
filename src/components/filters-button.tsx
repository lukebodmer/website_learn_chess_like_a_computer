import React, { useState, useEffect } from 'react'
import { gameFilterManager, FilterType, SpeedFilter } from '../game-filter-manager'

export interface FiltersButtonProps {}

const FiltersButton: React.FC<FiltersButtonProps> = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all')
  const [currentSpeedFilter, setCurrentSpeedFilter] = useState<SpeedFilter>('all')
  const [availableSpeeds, setAvailableSpeeds] = useState<string[]>([])

  useEffect(() => {
    // Initialize with current filter state
    setCurrentFilter(gameFilterManager.getCurrentFilter())
    setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
    setAvailableSpeeds(gameFilterManager.getAvailableSpeeds())

    // Listen for filter changes
    const handleFilterChange = () => {
      setCurrentFilter(gameFilterManager.getCurrentFilter())
      setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
      setAvailableSpeeds(gameFilterManager.getAvailableSpeeds())
    }

    gameFilterManager.addListener(handleFilterChange)

    return () => {
      gameFilterManager.removeListener(handleFilterChange)
    }
  }, [])

  const handleColorFilterChange = (filter: FilterType) => {
    gameFilterManager.setFilter(filter)
  }

  const handleSpeedToggle = (speed: string) => {
    gameFilterManager.toggleSpeed(speed)
  }

  const handleSpeedAllClick = () => {
    gameFilterManager.setSpeedFilter('all')
  }

  const isSpeedSelected = (speed: string): boolean => {
    return gameFilterManager.isSpeedSelected(speed)
  }

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '110px',
        right: '20px',
        zIndex: 1000,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {!isExpanded ? (
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
            transition: 'all 0.2s ease'
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
          <span style={{
            fontSize: '24px',
            color: 'var(--text-on-primary)'
          }}>
            ⚙️
          </span>
          <span style={{
            color: 'var(--text-on-primary)',
            fontSize: '10px',
            fontWeight: '600',
            textAlign: 'center',
            lineHeight: '1'
          }}>
            FILTERS
          </span>
        </button>
      ) : (
        // Expanded panel
        <div
          style={{
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 12px 40px var(--shadow-medium), 0 4px 12px rgba(0, 0, 0, 0.1)',
            minWidth: '250px',
            maxWidth: '300px'
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
                  All Speeds
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
