export type FilterType = 'all' | 'white' | 'black';

export interface FilterEvent {
  type: 'filter-change';
  filter: FilterType;
  allGames: any[];
  filteredGames: any[];
  username: string;
}

export class GameFilterManager {
  private static instance: GameFilterManager | null = null;
  private allGames: any[] = [];
  private currentFilter: FilterType = 'all';
  private username: string = '';
  private listeners: ((event: FilterEvent) => void)[] = [];

  private constructor() {}

  static getInstance(): GameFilterManager {
    if (!GameFilterManager.instance) {
      GameFilterManager.instance = new GameFilterManager();
    }
    return GameFilterManager.instance;
  }

  // Set the username for filtering
  setUsername(username: string): void {
    this.username = username;
  }

  // Update the full games list (called during streaming or initial load)
  updateAllGames(games: any[]): void {
    this.allGames = games;
    this.notifyListeners();
  }

  // Set the current filter
  setFilter(filter: FilterType): void {
    this.currentFilter = filter;
    this.notifyListeners();
  }

  // Get current filter
  getCurrentFilter(): FilterType {
    return this.currentFilter;
  }

  // Get all games (unfiltered)
  getAllGames(): any[] {
    return this.allGames;
  }

  // Get filtered games based on current filter
  getFilteredGames(): any[] {
    if (this.currentFilter === 'all') {
      return this.allGames;
    }

    return this.allGames.filter(game => {
      // Handle different data structures
      let isWhitePlayer = false;
      let isBlackPlayer = false;

      // Try to extract player info from different possible structures
      if (game.players?.white?.user?.name || game.players?.black?.user?.name) {
        // Lichess format
        isWhitePlayer = game.players?.white?.user?.name?.toLowerCase() === this.username.toLowerCase();
        isBlackPlayer = game.players?.black?.user?.name?.toLowerCase() === this.username.toLowerCase();
      } else if (game.white_player || game.black_player) {
        // Custom format
        isWhitePlayer = game.white_player?.toLowerCase() === this.username.toLowerCase();
        isBlackPlayer = game.black_player?.toLowerCase() === this.username.toLowerCase();
      } else if (game.game) {
        // Nested game structure
        const nestedGame = game.game;
        isWhitePlayer = nestedGame.white_player?.toLowerCase() === this.username.toLowerCase();
        isBlackPlayer = nestedGame.black_player?.toLowerCase() === this.username.toLowerCase();
      }

      // Return based on filter
      if (this.currentFilter === 'white') {
        return isWhitePlayer;
      } else if (this.currentFilter === 'black') {
        return isBlackPlayer;
      }

      return false; // Should not reach here
    });
  }

  // Add listener for filter changes
  addListener(listener: (event: FilterEvent) => void): void {
    this.listeners.push(listener);
  }

  // Remove listener
  removeListener(listener: (event: FilterEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  // Notify all listeners of changes
  private notifyListeners(): void {
    const filteredGames = this.getFilteredGames();
    const event: FilterEvent = {
      type: 'filter-change',
      filter: this.currentFilter,
      allGames: this.allGames,
      filteredGames: filteredGames,
      username: this.username
    };

    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in filter listener:', error);
      }
    });
  }

  // Get filter description for UI
  getFilterDescription(): string {
    switch (this.currentFilter) {
      case 'all':
        return `All games (${this.allGames.length})`;
      case 'white':
        const whiteGames = this.getFilteredGames();
        return `White games (${whiteGames.length})`;
      case 'black':
        const blackGames = this.getFilteredGames();
        return `Black games (${blackGames.length})`;
      default:
        return 'Unknown filter';
    }
  }
}

// Global access
export const gameFilterManager = GameFilterManager.getInstance();