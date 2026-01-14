/**
 * Represents a chess opponent character
 */
export interface Character {
  id: string
  name: string
  elo: number
  avatarColor: string
  personality?: string
  playStyle?: string
  bio?: string
}

/**
 * Character difficulty level
 */
export enum CharacterDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert'
}
