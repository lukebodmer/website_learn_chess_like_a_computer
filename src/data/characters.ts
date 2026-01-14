import { Character } from '../types/character'

/**
 * All available chess opponent characters
 * Each character has a different ELO rating representing their skill level
 */
export const CHARACTERS: Character[] = [
  {
    id: 'ernie',
    name: 'Ernie',
    elo: 400,
    avatarColor: '#FF6B6B',
    personality: 'Friendly and encouraging',
    playStyle: 'Beginner - Learning the basics'
  },
  {
    id: 'xavier',
    name: 'Xavier',
    elo: 700,
    avatarColor: '#4ECDC4',
    personality: 'Patient and methodical',
    playStyle: 'Casual - Developing fundamentals'
  },
  {
    id: 'remsi',
    name: 'Remsi',
    elo: 800,
    avatarColor: '#45B7D1',
    personality: 'Creative and unpredictable',
    playStyle: 'Intermediate - Exploring tactics'
  },
  {
    id: 'ichiro',
    name: 'Ichiro',
    elo: 900,
    avatarColor: '#96CEB4',
    personality: 'Disciplined and focused',
    playStyle: 'Intermediate - Building strategy'
  },
  {
    id: 'anu',
    name: 'Anu',
    elo: 1000,
    avatarColor: '#FFEAA7',
    personality: 'Analytical and precise',
    playStyle: 'Club player - Solid fundamentals'
  },
  {
    id: 'matt',
    name: 'Matt',
    elo: 1200,
    avatarColor: '#DFE6E9',
    personality: 'Competitive and strategic',
    playStyle: 'Advanced - Strong tactics'
  },
  {
    id: 'sanouk',
    name: 'Sanouk',
    elo: 1400,
    avatarColor: '#A29BFE',
    personality: 'Aggressive and bold',
    playStyle: 'Tournament player - Sharp attacks'
  },
  {
    id: 'matilde',
    name: 'Matilde',
    elo: 1600,
    avatarColor: '#FD79A8',
    personality: 'Calm and calculating',
    playStyle: 'Expert - Positional mastery'
  },
  {
    id: 'juanpi',
    name: 'Juanpi',
    elo: 1800,
    avatarColor: '#FDCB6E',
    personality: 'Ambitious and resourceful',
    playStyle: 'Master - Deep calculation'
  },
  {
    id: 'karen',
    name: 'Karen',
    elo: 2100,
    avatarColor: '#6C5CE7',
    personality: 'Brilliant and relentless',
    playStyle: 'Grandmaster level - Uncompromising'
  }
]

/**
 * Get a character by ID
 */
export const getCharacterById = (id: string): Character | undefined => {
  return CHARACTERS.find(char => char.id === id)
}

/**
 * Get the default character (lowest ELO)
 */
export const getDefaultCharacter = (): Character => {
  return CHARACTERS[0]
}
