import React, { useState, useEffect, useMemo } from 'react';
import OpeningBoard from './opening-board';
import { Chess } from 'chess.js';
import { StartIcon, PrevIcon, NextIcon, EndIcon } from './navigation-icons';

interface EloRangeData {
  [timeControl: string]: {
    [openingName: string]: {
      eco: string;
      sample_size: number;
      number_of_times_played: number;
      opening_inaccuracies_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
      opening_mistakes_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
      opening_blunders_per_game: {
        mean: number;
        std: number;
        skew: number;
      };
    };
  };
}

interface OpeningStatsData {
  name: string;
  eco: string;
  sampleSize: number;
  timesPlayed: number;
  popularity: number; // percentage of total games
  avgInaccuracies: number;
  avgMistakes: number;
  avgBlunders: number;
  errorRate: number; // 1 * inaccuracies + 2 * mistakes + 3 * blunders
  timeControl: string;
}

const ELO_RANGES = [
  '800-900',
  '1200-1300',
  '1300-1400'
];

const TIME_CONTROLS = ['bullet', 'blitz', 'rapid'];

export const OpeningStatsByElo: React.FC = () => {
  const [selectedEloRange, setSelectedEloRange] = useState<string>('1200-1300');
  const [selectedTimeControl, setSelectedTimeControl] = useState<string>('blitz');
  const [eloData, setEloData] = useState<EloRangeData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedOpening, setSelectedOpening] = useState<OpeningStatsData | null>(null);
  const [selectedOpeningFen, setSelectedOpeningFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(0);
  const [openingMoves, setOpeningMoves] = useState<string[]>([]);
  const [canonicalOpenings, setCanonicalOpenings] = useState<Map<string, { name: string, pgn: string, fen: string }>>(new Map());
  const [boardSize, setBoardSize] = useState<number>(320);
  const [sortBy, setSortBy] = useState<'name' | 'sample' | 'performance'>('sample');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Handle column header clicks
  const handleSortClick = (column: 'name' | 'sample' | 'performance') => {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default sort order
      setSortBy(column);
      // Default sort orders for each column
      if (column === 'name') {
        setSortOrder('asc'); // A-Z by default
      } else if (column === 'performance') {
        setSortOrder('asc'); // Best (lowest error) first by default
      } else {
        setSortOrder('desc'); // Most popular first by default
      }
    }
  };

  // Responsive board size based on window width
  useEffect(() => {
    const updateBoardSize = () => {
      if (window.innerWidth < 768) {
        setBoardSize(240);
      } else if (window.innerWidth < 1024) {
        setBoardSize(280);
      } else {
        setBoardSize(320);
      }
    };

    updateBoardSize();
    window.addEventListener('resize', updateBoardSize);
    return () => window.removeEventListener('resize', updateBoardSize);
  }, []);

  // Fetch canonical openings file once on mount
  useEffect(() => {
    const fetchCanonicalOpenings = async () => {
      try {
        const response = await fetch('/static/data/openings/lichess_openings_canonical.tsv');
        const text = await response.text();
        const lines = text.split('\n');

        const openingsMap = new Map<string, { name: string, pgn: string, fen: string }>();

        // Skip header line and parse all openings
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split('\t');
          if (parts.length >= 5) {
            const [eco, name, pgn, uci, epd] = parts;
            // Key by name only for matching
            openingsMap.set(name, { name, pgn, fen: epd });
          }
        }

        setCanonicalOpenings(openingsMap);
      } catch (error) {
        console.error('Error fetching canonical openings:', error);
      }
    };

    fetchCanonicalOpenings();
  }, []);

  // Fetch ELO range data when selection changes
  useEffect(() => {
    const fetchEloData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/static/data/opening_stats/${selectedEloRange}.json`);
        const data: EloRangeData = await response.json();
        setEloData(data);
      } catch (error) {
        console.error('Error fetching ELO data:', error);
        setEloData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchEloData();
  }, [selectedEloRange]);

  // Process openings data
  const openingsData = useMemo(() => {
    if (!eloData || !eloData[selectedTimeControl]) {
      return [];
    }

    const openings: OpeningStatsData[] = [];
    const timeControlData = eloData[selectedTimeControl];

    // First, calculate total times played across all openings
    let totalTimesPlayed = 0;
    for (const stats of Object.values(timeControlData)) {
      totalTimesPlayed += stats.number_of_times_played;
    }

    // Then create the openings data with popularity percentage and error rate
    for (const [name, stats] of Object.entries(timeControlData)) {
      const popularity = totalTimesPlayed > 0
        ? (stats.number_of_times_played / totalTimesPlayed) * 100
        : 0;

      const avgInaccuracies = stats.opening_inaccuracies_per_game.mean;
      const avgMistakes = stats.opening_mistakes_per_game.mean;
      const avgBlunders = stats.opening_blunders_per_game.mean;
      const errorRate = 1 * avgInaccuracies + 2 * avgMistakes + 3 * avgBlunders;

      openings.push({
        name,
        eco: stats.eco,
        sampleSize: stats.sample_size,
        timesPlayed: stats.number_of_times_played,
        popularity,
        avgInaccuracies,
        avgMistakes,
        avgBlunders,
        errorRate,
        timeControl: selectedTimeControl
      });
    }

    return openings;
  }, [eloData, selectedTimeControl]);

  // Calculate min and max error rates for normalization
  const { minErrorRate, maxErrorRate } = useMemo(() => {
    if (openingsData.length === 0) {
      return { minErrorRate: 0, maxErrorRate: 1 };
    }

    const errorRates = openingsData.map(o => o.errorRate);
    return {
      minErrorRate: Math.min(...errorRates),
      maxErrorRate: Math.max(...errorRates)
    };
  }, [openingsData]);

  // Sort openings based on selected sort method
  const sortedOpeningsData = useMemo(() => {
    const sorted = [...openingsData];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => {
          const comparison = a.name.localeCompare(b.name);
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
      case 'sample':
        sorted.sort((a, b) => {
          const comparison = a.popularity - b.popularity;
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
      case 'performance':
        sorted.sort((a, b) => {
          const comparison = a.errorRate - b.errorRate;
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        break;
    }

    return sorted;
  }, [openingsData, sortBy, sortOrder]);

  // Auto-select the first opening when data changes
  useEffect(() => {
    if (sortedOpeningsData.length > 0) {
      const firstOpening = sortedOpeningsData[0];
      setSelectedOpening(firstOpening);

      // Try to find the opening in canonical data
      const canonicalData = canonicalOpenings.get(firstOpening.name);
      if (canonicalData) {
        const pgnMoves = canonicalData.pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
        setOpeningMoves(pgnMoves);
        setCurrentMoveIndex(pgnMoves.length);

        const chess = new Chess();
        for (let i = 0; i < pgnMoves.length; i++) {
          chess.move(pgnMoves[i]);
        }
        setSelectedOpeningFen(chess.fen());
      } else {
        setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        setOpeningMoves([]);
        setCurrentMoveIndex(0);
      }
    }
  }, [sortedOpeningsData, canonicalOpenings]);

  const handleOpeningClick = (opening: OpeningStatsData) => {
    setSelectedOpening(opening);

    // Try to find the opening in canonical data
    const canonicalData = canonicalOpenings.get(opening.name);
    if (canonicalData) {
      const pgnMoves = canonicalData.pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
      setOpeningMoves(pgnMoves);
      setCurrentMoveIndex(pgnMoves.length);

      const chess = new Chess();
      for (let i = 0; i < pgnMoves.length; i++) {
        chess.move(pgnMoves[i]);
      }
      setSelectedOpeningFen(chess.fen());
    } else {
      setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      setOpeningMoves([]);
      setCurrentMoveIndex(0);
    }
  };

  return (
    <div className="opening-stats-by-elo" style={{
      padding: '12px',
      backgroundColor: 'var(--background-secondary)',
      borderRadius: '6px',
      border: '2px solid var(--primary-color)',
      boxShadow: '0 2px 4px var(--shadow-light)'
    }}>
      {/* Header Row with Dropdowns */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        padding: '10px',
        backgroundColor: 'var(--background-primary)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        {/* Left: Dropdowns */}
        <div style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '3px',
              textTransform: 'uppercase'
            }}>
              ELO Range
            </label>
            <select
              value={selectedEloRange}
              onChange={(e) => setSelectedEloRange(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '2px solid var(--border-color)',
                borderRadius: '4px',
                backgroundColor: 'var(--background-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                minWidth: '120px'
              }}
            >
              {ELO_RANGES.map(range => (
                <option key={range} value={range}>{range}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '3px',
              textTransform: 'uppercase'
            }}>
              Time Control
            </label>
            <select
              value={selectedTimeControl}
              onChange={(e) => setSelectedTimeControl(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '2px solid var(--border-color)',
                borderRadius: '4px',
                backgroundColor: 'var(--background-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                minWidth: '100px'
              }}
            >
              {TIME_CONTROLS.map(tc => (
                <option key={tc} value={tc}>{tc.charAt(0).toUpperCase() + tc.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: Selected Opening Name */}
        <div style={{
          flex: '1',
          textAlign: 'center',
          minWidth: '150px'
        }}>
          <h2 style={{
            margin: '0',
            fontSize: '1.1rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            lineHeight: '1.2'
          }}>
            {selectedOpening ? selectedOpening.name : 'Select an Opening'}
          </h2>
          {selectedOpening && (
            <div style={{
              marginTop: '2px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              fontStyle: 'italic'
            }}>
              Based on {selectedOpening.sampleSize.toLocaleString()} games
            </div>
          )}
        </div>
      </div>

      {/* Opening Board and Stats */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        {/* Left Column: Mistake Chart */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minWidth: '250px',
          maxWidth: '320px',
          flex: '1'
        }}>
          {/* Mistake Bar Chart */}
          <div style={{
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '12px'
          }}>
            <h4 style={{
              margin: '0 0 10px 0',
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              textAlign: 'center'
            }}>
              Average Opening Mistakes
            </h4>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {selectedOpening ? (
                <>
                  {/* Inaccuracies */}
                  <div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                      fontSize: '11px'
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Inaccuracies</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                        {selectedOpening.avgInaccuracies.toFixed(2)}
                      </span>
                    </div>
                    <div style={{
                      height: '14px',
                      backgroundColor: 'var(--background-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        height: '100%',
                        backgroundColor: '#FFA726',
                        width: `${Math.min((selectedOpening.avgInaccuracies / 5) * 100, 100)}%`,
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>

                  {/* Mistakes */}
                  <div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                      fontSize: '11px'
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Mistakes</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                        {selectedOpening.avgMistakes.toFixed(2)}
                      </span>
                    </div>
                    <div style={{
                      height: '14px',
                      backgroundColor: 'var(--background-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        height: '100%',
                        backgroundColor: '#FF7043',
                        width: `${Math.min((selectedOpening.avgMistakes / 5) * 100, 100)}%`,
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>

                  {/* Blunders */}
                  <div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                      fontSize: '11px'
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Blunders</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                        {selectedOpening.avgBlunders.toFixed(2)}
                      </span>
                    </div>
                    <div style={{
                      height: '14px',
                      backgroundColor: 'var(--background-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        height: '100%',
                        backgroundColor: '#EF5350',
                        width: `${Math.min((selectedOpening.avgBlunders / 5) * 100, 100)}%`,
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>
                </>
              ) : (
                <div style={{
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontStyle: 'italic',
                  padding: '12px'
                }}>
                  {loading ? 'Loading...' : 'No opening selected'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Opening Board with Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <OpeningBoard size={boardSize} position={selectedOpeningFen} />

          {/* Navigation Controls */}
          {openingMoves.length > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '8px',
            }}>
              <button
                onClick={() => {
                  if (currentMoveIndex > 0) {
                    setCurrentMoveIndex(0);
                    setSelectedOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                  }
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 2px 6px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px var(--shadow-light)';
                }}
                aria-label="Go to start"
              >
                <StartIcon disabled={false} size={14} />
              </button>
              <button
                onClick={() => {
                  if (currentMoveIndex > 0) {
                    const newIndex = currentMoveIndex - 1;
                    setCurrentMoveIndex(newIndex);

                    const chess = new Chess();
                    for (let i = 0; i < newIndex; i++) {
                      chess.move(openingMoves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  }
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 2px 6px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px var(--shadow-light)';
                }}
                aria-label="Previous move"
              >
                <PrevIcon disabled={false} size={14} />
              </button>
              <button
                onClick={() => {
                  if (currentMoveIndex < openingMoves.length) {
                    const newIndex = currentMoveIndex + 1;
                    setCurrentMoveIndex(newIndex);

                    const chess = new Chess();
                    for (let i = 0; i < newIndex; i++) {
                      chess.move(openingMoves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  }
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 2px 6px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px var(--shadow-light)';
                }}
                aria-label="Next move"
              >
                <NextIcon disabled={false} size={14} />
              </button>
              <button
                onClick={() => {
                  if (currentMoveIndex < openingMoves.length) {
                    setCurrentMoveIndex(openingMoves.length);

                    const chess = new Chess();
                    for (let i = 0; i < openingMoves.length; i++) {
                      chess.move(openingMoves[i]);
                    }
                    setSelectedOpeningFen(chess.fen());
                  }
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--background-primary)',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px var(--shadow-light)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  e.currentTarget.style.color = 'var(--text-on-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 2px 6px var(--shadow-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background-primary)';
                  e.currentTarget.style.color = 'var(--primary-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px var(--shadow-light)';
                }}
                aria-label="Go to end"
              >
                <EndIcon disabled={false} size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Openings List */}
      <div style={{
        backgroundColor: 'var(--background-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '10px',
        marginTop: '12px'
      }}>
        <h4 style={{
          margin: '0 0 10px 0',
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          textAlign: 'center'
        }}>
          All Openings ({openingsData.length})
        </h4>

        {loading ? (
          <div style={{
            minHeight: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <p style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              margin: 0,
              fontStyle: 'italic',
              fontSize: '12px'
            }}>
              Loading...
            </p>
          </div>
        ) : openingsData.length === 0 ? (
          <div style={{
            minHeight: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <p style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              margin: 0,
              fontStyle: 'italic',
              fontSize: '12px'
            }}>
              No opening data found for this ELO range and time control
            </p>
          </div>
        ) : (
          <>
            {/* Column Headers */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 10px',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '6px'
            }}>
              <div
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('name')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'name' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Opening Name {sortBy === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              <div
                style={{
                  minWidth: '120px',
                  textAlign: 'center',
                  marginRight: '10px',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('performance')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'performance' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Performance {sortBy === 'performance' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
              <div
                style={{
                  minWidth: '80px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSortClick('sample')}
              >
                <span style={{
                  fontSize: '10px',
                  fontWeight: '700',
                  color: sortBy === 'sample' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Popularity {sortBy === 'sample' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              minHeight: '200px',
              maxHeight: '320px',
              overflowY: 'auto',
              paddingRight: '6px'
            }}>
              {sortedOpeningsData.map((opening, index) => (
                <div
                  key={`${opening.eco}-${opening.name}-${index}`}
                  onClick={() => handleOpeningClick(opening)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    backgroundColor: selectedOpening?.name === opening.name ? 'var(--primary-color)' : 'var(--background-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedOpening?.name !== opening.name) {
                      e.currentTarget.style.backgroundColor = 'var(--primary-color-light)';
                    }
                    e.currentTarget.style.transform = 'translateX(3px)';
                  }}
                  onMouseLeave={(e) => {
                    const isSelected = selectedOpening?.name === opening.name;
                    e.currentTarget.style.backgroundColor = isSelected ? 'var(--primary-color)' : 'var(--background-secondary)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontWeight: '600',
                      color: selectedOpening?.name === opening.name ? 'var(--text-on-primary)' : 'var(--text-primary)',
                      fontSize: '12px',
                      marginBottom: '3px'
                    }}>
                      <span style={{
                        backgroundColor: selectedOpening?.name === opening.name ? 'var(--background-primary)' : 'var(--primary-color)',
                        color: selectedOpening?.name === opening.name ? 'var(--primary-color)' : 'var(--text-on-primary)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        marginRight: '6px'
                      }}>
                        {opening.eco}
                      </span>
                      {opening.name}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: selectedOpening?.name === opening.name ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                      marginTop: '2px'
                    }}>
                      Inac: {opening.avgInaccuracies.toFixed(1)} | Mist: {opening.avgMistakes.toFixed(1)} | Blun: {opening.avgBlunders.toFixed(1)}
                    </div>
                  </div>

                  {/* Performance Bar */}
                  <div style={{
                    minWidth: '120px',
                    marginRight: '10px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      width: '100%',
                      height: '16px',
                      backgroundColor: 'var(--background-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)'
                    }}>
                      {(() => {
                        // Normalize error rate: 0% = worst (highest error), 100% = best (lowest error)
                        // Invert the scale so lower error rate = fuller bar
                        const range = maxErrorRate - minErrorRate;
                        const normalizedPerformance = range > 0
                          ? ((maxErrorRate - opening.errorRate) / range) * 100
                          : 50;

                        return (
                          <div style={{
                            height: '100%',
                            width: `${normalizedPerformance}%`,
                            backgroundColor: '#4CAF50',
                            transition: 'width 0.3s ease'
                          }} />
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '80px'
                  }}>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: 'bold',
                      color: selectedOpening?.name === opening.name ? 'var(--text-on-primary)' : 'var(--primary-color)'
                    }}>
                      {opening.popularity.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OpeningStatsByElo;
