import React, { useState, useRef, useEffect } from 'react'
import { Character } from '../types/character'
import { CHARACTERS } from '../data/characters'
import CharacterAvatar from './character-avatar'

export interface CharacterSelectorProps {
  selectedCharacter: Character
  onCharacterChange: (character: Character) => void
  disabled?: boolean
}

const CharacterSelector: React.FC<CharacterSelectorProps> = ({
  selectedCharacter,
  onCharacterChange,
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleCharacterSelect = (character: Character) => {
    onCharacterChange(character)
    setIsOpen(false)
  }

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        display: 'inline-block'
      }}
    >
      {/* Selected character display / trigger button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          background: 'var(--background-secondary)',
          border: '2px solid var(--border-color)',
          borderRadius: '8px',
          padding: '6px 8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
          opacity: disabled ? 0.5 : 1
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = 'var(--hover-background)'
            e.currentTarget.style.borderColor = 'var(--primary-color)'
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = 'var(--background-secondary)'
            e.currentTarget.style.borderColor = 'var(--border-color)'
          }
        }}
      >
        <CharacterAvatar character={selectedCharacter} size={32} />
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-primary)',
            fontWeight: '600'
          }}
        >
          {selectedCharacter.name}
        </span>
        <span
          style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          ▼
        </span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            backgroundColor: 'var(--background-secondary)',
            border: '2px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px var(--shadow-medium)',
            zIndex: 1000,
            minWidth: '220px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}
        >
          {CHARACTERS.map((character) => (
            <button
              key={character.id}
              onClick={() => handleCharacterSelect(character)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: 'none',
                background: character.id === selectedCharacter.id
                  ? 'var(--primary-color)'
                  : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.2s ease',
                borderBottom: '1px solid var(--border-color)'
              }}
              onMouseEnter={(e) => {
                if (character.id !== selectedCharacter.id) {
                  e.currentTarget.style.backgroundColor = 'var(--hover-background)'
                }
              }}
              onMouseLeave={(e) => {
                if (character.id !== selectedCharacter.id) {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }
              }}
            >
              <CharacterAvatar character={character} size={36} />
              <div
                style={{
                  flex: 1,
                  textAlign: 'left'
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: character.id === selectedCharacter.id
                      ? 'var(--text-on-primary)'
                      : 'var(--text-primary)',
                    marginBottom: '2px'
                  }}
                >
                  {character.name}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: character.id === selectedCharacter.id
                      ? 'rgba(255, 255, 255, 0.8)'
                      : 'var(--text-secondary)'
                  }}
                >
                  {character.playStyle}
                </div>
              </div>
              {character.id === selectedCharacter.id && (
                <span
                  style={{
                    fontSize: '14px',
                    color: 'var(--text-on-primary)'
                  }}
                >
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default CharacterSelector
