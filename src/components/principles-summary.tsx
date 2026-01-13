import React, { useState, useMemo } from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface PrinciplesSummaryProps {
  principlesData: any;
}

export const PrinciplesSummary: React.FC<PrinciplesSummaryProps> = ({
  principlesData
}) => {
  // Extract principles data
  const radarData = useMemo(() => {
    if (!principlesData || !principlesData.principles) {
      return [];
    }

    const principles = principlesData.principles;

    // Map principle names to display labels
    const principleLabels: { [key: string]: string } = {
      'opening_awareness': 'Opening Awareness',
      'middlegame_planning': 'Middlegame Planning',
      'endgame_technique': 'Endgame Technique',
      'king_safety': 'King Safety',
      'checkmate_ability': 'Checkmate Ability',
      'tactics_vision': 'Tactics Vision',
      'defensive_skill': 'Defensive Skill',
      'big_picture': 'Big Picture',
      'precision_move_quality': 'Precision & Quality',
      'planning_calculating': 'Planning & Calculating',
      'time_management': 'Time Management'
    };

    // Build data array for radar chart
    const data = Object.entries(principleLabels).map(([key, label]) => {
      const principleData = principles[key];
      const percentile = principleData?.eco_comparison?.percentile || 0;

      // Use percentile directly (0-100)
      return {
        principle: label,
        score: percentile,
        rawScore: percentile
      };
    });

    return data;
  }, [principlesData]);

  // Get ECO range for display
  const ecoRange = principlesData?.eco_range || 'Unknown';
  const totalGames = principlesData?.total_games_analyzed || 0;

  // Find top 3 areas to work on (lowest percentiles = need most improvement)
  const topAreasToImprove = useMemo(() => {
    return [...radarData]
      .sort((a, b) => a.score - b.score) // Lower percentile = more important to improve
      .slice(0, 3)
      .filter(item => item.score < 100); // Don't show areas where you're already perfect
  }, [radarData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: 'var(--background-secondary)',
          padding: '10px',
          border: '1px solid var(--border-color)',
          borderRadius: '4px'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--text-primary)' }}>{data.principle}</p>
          <p style={{ margin: '5px 0 0 0', color: 'var(--primary-color)' }}>
            Percentile: {data.score}
          </p>
        </div>
      );
    }
    return null;
  };

  if (!principlesData || !principlesData.principles) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Principles analysis not available yet.</p>
      </div>
    );
  }

  return (
    <div className="section">
      <h2 style={{ marginTop: 0, marginBottom: '10px' }}>Chess Principles Summary</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Rating Range: <strong>{ecoRange}</strong> | Games Analyzed: <strong>{totalGames}</strong>
      </p>

      {/* Radar Chart */}
      <div style={{ marginBottom: '30px' }}>
        <ResponsiveContainer width="100%" height={500}>
          <RadarChart data={radarData}>
            <PolarGrid strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="principle"
              tick={{ fill: 'var(--text-primary)', fontSize: 12 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: 'var(--text-secondary)' }}
            />
            <Radar
              name="Performance Percentile"
              dataKey="score"
              stroke="var(--primary-color)"
              fill="var(--primary-color)"
              fillOpacity={0.8}
              strokeWidth={2}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Top Areas to Improve */}
      {topAreasToImprove.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px' }}>Top Areas to Improve</h3>
          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
            {topAreasToImprove.map((area, index) => (
              <div
                key={area.principle}
                style={{
                  flex: '1 1 200px',
                  padding: '15px',
                  backgroundColor: 'var(--background-tertiary)',
                  borderRadius: '8px',
                  border: `2px solid ${index === 0 ? 'var(--danger-color)' : index === 1 ? 'var(--secondary-color)' : 'var(--primary-color)'}`,
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '5px'
                }}>
                  <span style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text-primary)' }}>
                    #{index + 1}
                  </span>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: index === 0 ? 'var(--danger-color)' : index === 1 ? 'var(--secondary-color)' : 'var(--primary-color)'
                  }}>
                    {area.score}
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {area.principle}
                </div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: '15px', fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            Lower percentiles indicate areas where you're underperforming compared to players in your rating range ({ecoRange}).
            Focus on improving these skills to reach the average level for your rating.
          </p>
        </div>
      )}

      {/* Explanation */}
      <div style={{
        marginTop: '30px',
        padding: '15px',
        backgroundColor: 'var(--background-tertiary)',
        borderRadius: '8px',
        fontSize: '14px',
        color: 'var(--text-primary)'
      }}>
        <h4 style={{ marginTop: 0, marginBottom: '10px', color: 'var(--text-primary)' }}>How to Read This Chart</h4>
        <ul style={{ marginBottom: 0, paddingLeft: '20px' }}>
          <li style={{ marginBottom: '8px' }}>
            <strong>Percentiles (0-100):</strong> Show how you rank compared to players in your rating range. Higher percentiles mean better performance.
          </li>
          <li style={{ marginBottom: '8px' }}>
            <strong>50th Percentile:</strong> You're performing at the average for your rating in this area.
          </li>
          <li style={{ marginBottom: '8px' }}>
            <strong>Lower Percentiles:</strong> Indicate areas where you're underperforming and should focus your practice.
          </li>
          <li>
            <strong>Your Rating Range ({ecoRange}):</strong> Your performance is compared to thousands of players with similar ratings using statistical distributions.
          </li>
        </ul>
      </div>
    </div>
  );
};

export default PrinciplesSummary;
