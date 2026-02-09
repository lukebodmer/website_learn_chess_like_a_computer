import React, { useState, useEffect } from 'react'
import { gameFilterManager, FilterType, SpeedFilter, ResultFilter } from '../game-filter-manager'

export interface TopFiltersProps {
  username?: string
}

const TopFilters: React.FC<TopFiltersProps> = ({ username }) => {
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all')
  const [currentSpeedFilter, setCurrentSpeedFilter] = useState<SpeedFilter>('all')
  const [currentResultFilter, setCurrentResultFilter] = useState<ResultFilter>('all')
  const [availableSpeeds, setAvailableSpeeds] = useState<string[]>([])

  useEffect(() => {
    // Set username if provided
    if (username) {
      gameFilterManager.setUsername(username)
    }

    // Initialize with current filter state
    setCurrentFilter(gameFilterManager.getCurrentFilter())
    setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
    setCurrentResultFilter(gameFilterManager.getCurrentResultFilter())
    setAvailableSpeeds(gameFilterManager.getAvailableSpeeds())

    // Listen for filter changes
    const handleFilterChange = () => {
      setCurrentFilter(gameFilterManager.getCurrentFilter())
      setCurrentSpeedFilter(gameFilterManager.getCurrentSpeedFilter())
      setCurrentResultFilter(gameFilterManager.getCurrentResultFilter())
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

  const handleSpeedDoubleClick = (speed: string) => {
    gameFilterManager.setSingleSpeed(speed)
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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      padding: '20px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '12px',
      border: '2px solid var(--primary-color)',
      marginBottom: '20px'
    }}>
      {/* Color Filter */}
      <div style={{ maxWidth: '800px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            minWidth: '120px',
            textAlign: 'right'
          }}>
            Player Color
          </div>
          <div style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
          {(['all', 'white', 'black'] as FilterType[]).map(filter => (
            <button
              key={filter}
              onClick={() => handleColorFilterChange(filter)}
              style={{
                width: '100px',
                height: '100px',
                padding: '0',
                fontSize: '14px',
                fontWeight: '600',
                border: currentFilter === filter ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                backgroundColor: currentFilter === filter ? 'var(--primary-color)' : 'var(--background-primary)',
                color: currentFilter === filter ? 'var(--text-on-primary)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textTransform: 'capitalize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
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
      </div>

      {/* Speed Filter */}
      {availableSpeeds.length > 0 && (
        <div style={{ maxWidth: '800px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              minWidth: '120px',
              textAlign: 'right'
            }}>
              Time Control
            </div>
            <div style={{
              display: 'flex',
              gap: '8px',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
            {/* All speeds option */}
            <button
              onClick={handleSpeedAllClick}
              style={{
                width: '100px',
                height: '100px',
                padding: '0',
                fontSize: '14px',
                fontWeight: '600',
                border: currentSpeedFilter === 'all' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                backgroundColor: currentSpeedFilter === 'all' ? 'var(--primary-color)' : 'var(--background-primary)',
                color: currentSpeedFilter === 'all' ? 'var(--text-on-primary)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
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
                onDoubleClick={() => handleSpeedDoubleClick(speed)}
                style={{
                  width: '100px',
                  height: '100px',
                  padding: '0',
                  fontSize: '14px',
                  fontWeight: '600',
                  border: isSpeedSelected(speed) ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: isSpeedSelected(speed) ? 'var(--primary-color)' : 'var(--background-primary)',
                  color: isSpeedSelected(speed) ? 'var(--text-on-primary)' : 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textTransform: 'capitalize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
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
        </div>
      )}

      {/* Game Result Filter */}
      <div style={{ maxWidth: '800px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            minWidth: '120px',
            textAlign: 'right'
          }}>
            Game Result
          </div>
          <div style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
          {(['all', 'win', 'loss', 'draw'] as ResultFilter[]).map(result => (
            <button
              key={result}
              onClick={() => handleResultFilterChange(result)}
              style={{
                width: '100px',
                height: '100px',
                padding: '0',
                fontSize: '14px',
                fontWeight: '600',
                border: currentResultFilter === result ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                backgroundColor: currentResultFilter === result ? 'var(--primary-color)' : 'var(--background-primary)',
                color: currentResultFilter === result ? 'var(--text-on-primary)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textTransform: 'capitalize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
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
      </div>
    </div>
  )
}

export default TopFilters
