import React from 'react'
import { Character } from '../types/character'

export interface CharacterAvatarProps {
  character: Character
  size?: number
  showName?: boolean
}

const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  character,
  size = 40,
  showName = false
}) => {
  const initial = character.name.charAt(0).toUpperCase()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
    >
      {/* Avatar circle */}
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          backgroundColor: character.avatarColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: `${size * 0.5}px`,
          fontWeight: '700',
          color: '#FFFFFF',
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
        }}
        title={`${character.name} (${character.elo} ELO)`}
      >
        {initial}
      </div>

      {/* Character name (optional) */}
      {showName && (
        <span
          style={{
            fontSize: `${size * 0.35}px`,
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}
        >
          {character.name}
        </span>
      )}
    </div>
  )
}

export default CharacterAvatar
