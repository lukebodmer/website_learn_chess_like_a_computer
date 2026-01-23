import React, { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface GenerateReportProps {
  username: string
  platform: 'lichess' | 'chess.com'
}

interface GamesFetchResponse {
  success: boolean
  error?: string
  task_id?: string
  status?: string
  message?: string
  games_count?: number
  game_dataset_id?: number
  created_at?: string
  data_size?: number
  date_range?: string
  oldest_game_date?: string
  newest_game_date?: string
  elo_ratings?: {
    bullet?: number
    blitz?: number
    rapid?: number
  }
  ndjson_data?: string
}

interface TaskStatusResponse {
  state: string
  current?: number
  total?: number
  status?: string
  games_found?: number
  result?: GamesFetchResponse
  error?: string
}

// Color scheme for time controls
const TIME_CONTROL_COLORS: Record<string, string> = {
  bullet: '#FF6B6B',
  blitz: '#4ECDC4',
  rapid: '#45B7D1'
}

export default function GenerateReport({ username, platform }: GenerateReportProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [statusText, setStatusText] = useState('')
  const [progressText, setProgressText] = useState('Fetching games...')
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [gameData, setGameData] = useState<GamesFetchResponse | null>(null)
  const [ndjsonData, setNdjsonData] = useState<string>('')

  useEffect(() => {
    // Set initial loading state based on platform
    const platformName = platform === 'lichess' ? 'Lichess' : 'Chess.com'
    setStatusText(`Finding your most recent ${platformName} games...`)

    // Determine the fetch URL based on platform
    const fetchUrl = platform === 'lichess'
      ? `/fetch-games/${username}/`
      : `/chess-com/fetch-games/${username}/`

    // Both platforms now use Celery task polling
    fetch(fetchUrl)
      .then(response => response.json())
      .then((data: GamesFetchResponse) => {
        if (data.success && data.task_id) {
          // Task started, begin polling for status
          setProgressText(data.message || 'Processing...')
          pollTaskStatus(data.task_id)
        } else {
          // Error starting task
          setStatus('error')
          setStatusText('Error Fetching Games')
          setProgressText('Failed to start fetch')
          setErrorMessage(data.error || 'Unknown error occurred')
        }
      })
      .catch(error => {
        console.error('Error:', error)
        setStatus('error')
        setStatusText('Network Error')
        setProgressText('Network error')
        setErrorMessage('Network error occurred. Please try again.')
      })
  }, [username, platform])

  // Poll for task status (works for both Chess.com and Lichess)
  const pollTaskStatus = (taskId: string) => {
    const pollInterval = setInterval(() => {
      fetch(`/task-status/${taskId}/`)
        .then(response => response.json())
        .then((data: TaskStatusResponse) => {
          if (data.state === 'PENDING') {
            setProgressText(data.status || 'Task is queued...')
            setProgressPercent(0)
          } else if (data.state === 'PROGRESS') {
            // Use games_found for progress if available, otherwise fall back to current/total
            let percent = 0
            let statusMessage = data.status || 'Processing...'

            if (data.games_found !== undefined && data.games_found > 0) {
              // Calculate progress based on games found vs target (default 100)
              const targetGames = 100 // This matches ANALYSIS_GAME_COUNT from backend
              const gamesProgress = Math.min(data.games_found / targetGames, 1.0)

              // If we also have current/total from the backend, use a weighted average
              if (data.total && data.current !== undefined) {
                const taskProgress = data.current / data.total
                // Weight: 70% games found, 30% task progress
                percent = Math.round((gamesProgress * 0.7 + taskProgress * 0.3) * 100)
              } else {
                // Just use games found progress, cap at 90% until complete
                percent = Math.min(90, Math.round(gamesProgress * 100))
              }

              setProgressText(`${statusMessage}`)
            } else if (data.total && data.current !== undefined) {
              // No games_found data, use task progress percentage
              percent = Math.round((data.current / data.total) * 100)
              setProgressText(`${statusMessage}`)
            } else {
              // No progress info available
              setProgressText(statusMessage)
              percent = 10 // Show a small amount of progress
            }

            setProgressPercent(percent)
          } else if (data.state === 'SUCCESS') {
            // Task completed successfully
            clearInterval(pollInterval)
            const result = data.result!
            setStatus('success')
            setStatusText('Games Retrieved Successfully')
            setProgressText(`Found ${result.games_count} games`)
            setProgressPercent(100)
            setGameData(result)
            if (result.ndjson_data) {
              setNdjsonData(result.ndjson_data)
            }
          } else if (data.state === 'FAILURE' || data.state === 'ERROR') {
            // Task failed
            clearInterval(pollInterval)
            setStatus('error')
            setStatusText('Error Fetching Games')
            setProgressText('Failed to fetch games')
            setProgressPercent(0)
            setErrorMessage(data.error || 'Task failed. Please try again.')
          }
        })
        .catch(error => {
          console.error('Polling error:', error)
          clearInterval(pollInterval)
          setStatus('error')
          setStatusText('Network Error')
          setProgressText('Network error during polling')
          setProgressPercent(0)
          setErrorMessage('Network error occurred. Please try again.')
        })
    }, 2000) // Poll every 2 seconds
  }

  // Process NDJSON data to extract ELO over time
  const eloChartData = useMemo(() => {
    if (!ndjsonData) return []

    const lines = ndjsonData.trim().split('\n')
    const dataBySpeed: Record<string, any[]> = {
      bullet: [],
      blitz: [],
      rapid: []
    }

    lines.forEach((line) => {
      if (!line.trim()) return

      try {
        const game = JSON.parse(line)

        // Extract data based on platform
        let rating = null
        let timestamp = null
        let speed = null

        if (platform === 'lichess') {
          // Lichess format
          const isWhite = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase()
          const isBlack = game.players?.black?.user?.name?.toLowerCase() === username.toLowerCase()

          if (isWhite) {
            rating = game.players?.white?.rating
          } else if (isBlack) {
            rating = game.players?.black?.rating
          }

          timestamp = game.createdAt
          speed = game.speed || game.perf
        } else {
          // Chess.com format
          const isWhite = game.white?.username?.toLowerCase() === username.toLowerCase()
          const isBlack = game.black?.username?.toLowerCase() === username.toLowerCase()

          if (isWhite) {
            rating = game.white?.rating
          } else if (isBlack) {
            rating = game.black?.rating
          }

          timestamp = game.end_time ? game.end_time * 1000 : null
          speed = game.time_class
        }

        if (rating && timestamp && speed && dataBySpeed[speed]) {
          dataBySpeed[speed].push({
            rating,
            timestamp,
            date: new Date(timestamp).toLocaleDateString()
          })
        }
      } catch (e) {
        console.error('Error parsing game:', e)
      }
    })

    // Sort each speed by timestamp
    Object.keys(dataBySpeed).forEach(speed => {
      dataBySpeed[speed].sort((a, b) => a.timestamp - b.timestamp)
    })

    // Create unified dataset
    const allTimestamps = new Set<number>()
    Object.values(dataBySpeed).forEach(games => {
      games.forEach(game => allTimestamps.add(game.timestamp))
    })

    const timestamps = Array.from(allTimestamps).sort((a, b) => a - b)

    return timestamps.map(timestamp => {
      const dataPoint: any = { timestamp }

      Object.keys(dataBySpeed).forEach(speed => {
        const game = dataBySpeed[speed].find(g => g.timestamp === timestamp)
        if (game) {
          dataPoint[speed] = game.rating
          dataPoint[`${speed}_date`] = game.date
        }
      })

      return dataPoint
    })
  }, [ndjsonData, username, platform])

  const renderEloTooltip = (props: any) => {
    if (!props.active || !props.payload || !props.payload.length) return null

    return (
      <div style={{
        backgroundColor: 'var(--background-primary)',
        padding: '10px 14px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px var(--shadow-medium)',
        color: 'var(--text-primary)',
        backdropFilter: 'blur(8px)'
      }}>
        {props.payload.map((entry: any, index: number) => (
          <div key={index} style={{ marginBottom: index < props.payload.length - 1 ? '8px' : '0' }}>
            <p style={{
              margin: '0 0 4px 0',
              fontWeight: '600',
              fontSize: '14px',
              color: entry.color,
              textTransform: 'capitalize'
            }}>
              {entry.name || entry.dataKey}
            </p>
            <p style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-secondary)'
            }}>
              Rating: {entry.value}
            </p>
            {entry.payload[`${entry.dataKey}_date`] && (
              <p style={{
                margin: '2px 0 0 0',
                fontSize: '11px',
                color: 'var(--text-muted)'
              }}>
                {entry.payload[`${entry.dataKey}_date`]}
              </p>
            )}
          </div>
        ))}
      </div>
    )
  }

  const handleGenerateReport = async () => {
    if (!gameData?.game_dataset_id || eloChartData.length === 0) {
      window.location.href = `/report/${username}/${gameData?.game_dataset_id}/`
      return
    }

    try {
      // Get CSRF token from cookie
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='))
        ?.split('=')[1]

      // Send ELO chart data to backend before navigating
      await fetch(`/api/store-elo-data/${gameData.game_dataset_id}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken || ''
        },
        body: JSON.stringify({
          elo_chart_data: eloChartData
        })
      })

      // Navigate to report page
      window.location.href = `/report/${username}/${gameData.game_dataset_id}/`
    } catch (error) {
      console.error('Error storing ELO data:', error)
      // Navigate anyway, even if ELO data storage failed
      window.location.href = `/report/${username}/${gameData?.game_dataset_id}/`
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{
        maxWidth: '600px',
        margin: '20px auto',
        background: 'var(--background-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '20px' }}>{statusText}</h3>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={{
            width: '100%',
            height: '20px',
            background: 'var(--background-tertiary)',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              background: status === 'success'
                ? 'linear-gradient(90deg, #4CAF50, #45a049)'
                : status === 'error'
                ? 'linear-gradient(90deg, #f44336, #d32f2f)'
                : 'linear-gradient(90deg, var(--primary-color), var(--primary-light))',
              transition: 'width 0.3s ease',
              width: status === 'loading' ? `${progressPercent}%` : '100%'
            }}></div>
          </div>
        </div>

        {status === 'success' && gameData && (
          <>
            <div style={{
              marginBottom: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              background: 'var(--background-tertiary)',
              borderRadius: '8px',
              padding: '16px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <span style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '15px',
                  letterSpacing: '0.3px'
                }}>Username:</span>
                <span style={{
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  fontWeight: 400
                }}>{username}</span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <span style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '15px',
                  letterSpacing: '0.3px'
                }}>Platform:</span>
                <span style={{
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  fontWeight: 400
                }}>{platform === 'lichess' ? 'Lichess' : 'Chess.com'}</span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <span style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '15px',
                  letterSpacing: '0.3px'
                }}>Total Games:</span>
                <span style={{
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  fontWeight: 400
                }}>{gameData.games_count}</span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: gameData.elo_ratings && Object.keys(gameData.elo_ratings).length > 0 ? '1px solid var(--border-color)' : 'none'
              }}>
                <span style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '15px',
                  letterSpacing: '0.3px'
                }}>Date Range:</span>
                <span style={{
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  fontWeight: 400
                }}>{gameData.date_range || 'Date range unavailable'}</span>
              </div>

              {gameData.elo_ratings && Object.keys(gameData.elo_ratings).length > 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '10px 0'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}>
                    <span style={{
                      color: 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '15px',
                      letterSpacing: '0.3px'
                    }}>Current Ratings:</span>
                    <div style={{
                      display: 'flex',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}>
                      {gameData.elo_ratings.bullet && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'var(--background-secondary)',
                          padding: '10px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)'
                        }}>
                          <span style={{
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                          }}>Bullet:</span>
                          <span style={{
                            color: 'var(--text-primary)',
                            fontSize: '18px',
                            fontWeight: 700
                          }}>{gameData.elo_ratings.bullet}</span>
                        </div>
                      )}
                      {gameData.elo_ratings.blitz && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'var(--background-secondary)',
                          padding: '10px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)'
                        }}>
                          <span style={{
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                          }}>Blitz:</span>
                          <span style={{
                            color: 'var(--text-primary)',
                            fontSize: '18px',
                            fontWeight: 700
                          }}>{gameData.elo_ratings.blitz}</span>
                        </div>
                      )}
                      {gameData.elo_ratings.rapid && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'var(--background-secondary)',
                          padding: '10px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)'
                        }}>
                          <span style={{
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                          }}>Rapid:</span>
                          <span style={{
                            color: 'var(--text-primary)',
                            fontSize: '18px',
                            fontWeight: 700
                          }}>{gameData.elo_ratings.rapid}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ELO Over Time Chart */}
                  {eloChartData.length > 0 && (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart
                        data={eloChartData}
                        margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis
                          dataKey="timestamp"
                          type="number"
                          domain={[
                            eloChartData[0]?.timestamp || 'auto',
                            eloChartData[eloChartData.length - 1]?.timestamp || 'auto'
                          ]}
                          fontSize={11}
                          tick={{ fill: 'var(--text-secondary)' }}
                          tickFormatter={(timestamp) => new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        />
                        <YAxis
                          fontSize={11}
                          tick={{ fill: 'var(--text-secondary)' }}
                          domain={['auto', 'auto']}
                          label={{ value: 'Elo', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)' }}
                        />
                        <Tooltip content={renderEloTooltip} />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', color: 'var(--text-secondary)' }}
                          iconType="line"
                        />
                        {Object.keys(TIME_CONTROL_COLORS).map((timeControl) => {
                          const hasData = eloChartData.some(d => d[timeControl] !== undefined)
                          if (!hasData) return null

                          return (
                            <Line
                              key={timeControl}
                              type="monotone"
                              dataKey={timeControl}
                              name={timeControl.charAt(0).toUpperCase() + timeControl.slice(1)}
                              stroke={TIME_CONTROL_COLORS[timeControl]}
                              strokeWidth={2}
                              dot={{ fill: TIME_CONTROL_COLORS[timeControl], r: 3 }}
                              activeDot={{ r: 5 }}
                              connectNulls
                            />
                          )
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: '15px',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <button
                onClick={handleGenerateReport}
                className="btn btn-primary"
                style={{
                  background: 'var(--success-color)',
                  fontSize: '18px',
                  padding: '15px 30px',
                  textDecoration: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Generate Analysis Report
              </button>
              <a
                href="/"
                className="btn btn-secondary"
                style={{ textDecoration: 'none' }}
              >
                Back to Home
              </a>
            </div>
          </>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center', color: 'var(--danger-color)' }}>
            <p style={{ marginBottom: '20px' }}>{errorMessage}</p>
            <a
              href="/"
              className="btn btn-secondary"
              style={{ textDecoration: 'none' }}
            >
              Back to Home
            </a>
          </div>
        )}
      </div>

    </div>
  )
}
