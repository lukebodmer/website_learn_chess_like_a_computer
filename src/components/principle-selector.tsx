import React from 'react';

export interface PrincipleSelectorProps {
  principlesData: any;
  selectedPrinciple: string | null;
  onSelectPrinciple: (principle: string | null) => void;
}

const PrincipleSelector: React.FC<PrincipleSelectorProps> = ({
  principlesData,
  selectedPrinciple,
  onSelectPrinciple
}) => {
  // Map principle keys to display labels
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

  if (!principlesData || !principlesData.principles) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        background: 'var(--background-primary)',
        borderRadius: '8px'
      }}>
        <p>Loading principles...</p>
      </div>
    );
  }

  const principles = principlesData.principles;

  // Sort principles by percentile (lowest first = most important to improve)
  const sortedPrinciples = Object.entries(principleLabels)
    .map(([key, label]) => {
      const principleData = principles[key];
      const percentile = principleData?.elo_comparison?.percentile || 0;
      return { key, label, percentile };
    })
    .sort((a, b) => a.percentile - b.percentile);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '700px',
      backgroundColor: 'var(--background-primary)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      padding: '20px'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        maxWidth: '280px'
      }}>
        {/* Header */}
        <div style={{
          fontSize: '16px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          marginBottom: '8px',
          textAlign: 'center'
        }}>
          Filter by Principle
        </div>

        {/* Button List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
        {/* All Puzzles button */}
        <button
        onClick={() => onSelectPrinciple(null)}
        style={{
          padding: '12px 16px',
          background: selectedPrinciple === null ? 'var(--primary-color)' : 'var(--background-secondary)',
          color: selectedPrinciple === null ? 'white' : 'var(--text-primary)',
          border: selectedPrinciple === null ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
          borderRadius: '8px',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '14px',
          fontWeight: selectedPrinciple === null ? '600' : '500',
          transition: 'all 0.2s ease',
          width: '100%'
        }}
        onMouseEnter={(e) => {
          if (selectedPrinciple !== null) {
            e.currentTarget.style.background = 'var(--background-tertiary)';
          }
        }}
        onMouseLeave={(e) => {
          if (selectedPrinciple !== null) {
            e.currentTarget.style.background = 'var(--background-secondary)';
          }
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>All Puzzles</span>
        </div>
      </button>

      {/* Individual principle buttons */}
      {sortedPrinciples.map(({ key, label, percentile }, index) => {
        const isSelected = selectedPrinciple === key;

        return (
          <button
            key={key}
            onClick={() => onSelectPrinciple(key)}
            style={{
              padding: '12px 16px',
              background: isSelected ? 'var(--primary-color)' : 'var(--background-secondary)',
              color: isSelected ? 'white' : 'var(--text-primary)',
              border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '14px',
              fontWeight: isSelected ? '600' : '500',
              transition: 'all 0.2s ease',
              width: '100%',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = 'var(--background-tertiary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = 'var(--background-secondary)';
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{label}</span>
              <span style={{
                fontSize: '13px',
                fontWeight: 'bold',
                color: isSelected ? 'white' : percentile < 50 ? 'var(--danger-color)' : 'var(--success-text)',
                opacity: isSelected ? 1 : 0.8
              }}>
                {percentile}
              </span>
            </div>
          </button>
        );
      })}
        </div>
      </div>
    </div>
  );
};

export default PrincipleSelector;
