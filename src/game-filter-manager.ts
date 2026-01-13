export type FilterType = 'all' | 'white' | 'black';
export type SpeedFilter = 'all' | string[]; // 'all' or array of specific speeds like ['blitz', 'bullet']

export interface FilterEvent {
  type: 'filter-change';
  filter: FilterType;
  speedFilter: SpeedFilter;
  allGames: any[];
  filteredGames: any[];
  username: string;
  availableSpeeds: string[];
}

export class GameFilterManager {
  private static instance: GameFilterManager | null = null;
  private allGames: any[] = [];
  private currentFilter: FilterType = 'all';
  private currentSpeedFilter: SpeedFilter = 'all';
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

  // Set the current speed filter
  setSpeedFilter(speed: SpeedFilter): void {
    this.currentSpeedFilter = speed;
    this.notifyListeners();
  }

  // Get current speed filter
  getCurrentSpeedFilter(): SpeedFilter {
    return this.currentSpeedFilter;
  }

  // Toggle a specific speed in the filter (for multi-select)
  toggleSpeed(speed: string): void {
    // If currently 'all', switch to just this speed
    if (this.currentSpeedFilter === 'all') {
      this.currentSpeedFilter = [speed];
    }
    // If it's an array, toggle the speed
    else if (Array.isArray(this.currentSpeedFilter)) {
      const index = this.currentSpeedFilter.indexOf(speed);
      if (index > -1) {
        // Remove the speed
        const newFilter = this.currentSpeedFilter.filter(s => s !== speed);
        // If no speeds left, reset to 'all'
        this.currentSpeedFilter = newFilter.length === 0 ? 'all' : newFilter;
      } else {
        // Add the speed
        this.currentSpeedFilter = [...this.currentSpeedFilter, speed];
      }
    }
    this.notifyListeners();
  }

  // Check if a specific speed is selected
  isSpeedSelected(speed: string): boolean {
    if (this.currentSpeedFilter === 'all') {
      return false;
    }
    if (Array.isArray(this.currentSpeedFilter)) {
      return this.currentSpeedFilter.includes(speed);
    }
    return false;
  }

  // Get all available speeds from the games
  getAvailableSpeeds(): string[] {
    const speeds = new Set<string>();

    this.allGames.forEach(game => {
      // Try to extract speed from different data structures
      let gameSpeed = null;

      if (game.speed) {
        gameSpeed = game.speed;
      } else if (game.raw_json?.speed) {
        gameSpeed = game.raw_json.speed;
      } else if (game.game?.raw_json?.speed) {
        gameSpeed = game.game.raw_json.speed;
      }

      if (gameSpeed) {
        speeds.add(gameSpeed);
      }
    });

    // Define the preferred order
    const preferredOrder = ['bullet', 'blitz', 'rapid', 'daily', 'custom'];
    const speedsArray = Array.from(speeds);

    // Sort speeds: preferred order first, then alphabetically for the rest
    return speedsArray.sort((a, b) => {
      const indexA = preferredOrder.indexOf(a);
      const indexB = preferredOrder.indexOf(b);

      // Both are in preferred order - sort by their position in the array
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }

      // Only a is in preferred order - a comes first
      if (indexA !== -1) {
        return -1;
      }

      // Only b is in preferred order - b comes first
      if (indexB !== -1) {
        return 1;
      }

      // Neither is in preferred order - sort alphabetically
      return a.localeCompare(b);
    });
  }

  // Get all games (unfiltered)
  getAllGames(): any[] {
    return this.allGames;
  }

  // Get filtered games based on current filter and speed filter
  getFilteredGames(): any[] {
    return this.allGames.filter(game => {
      // Apply color filter
      let passesColorFilter = true;

      if (this.currentFilter !== 'all') {
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

        // Check color filter
        if (this.currentFilter === 'white') {
          passesColorFilter = isWhitePlayer;
        } else if (this.currentFilter === 'black') {
          passesColorFilter = isBlackPlayer;
        }
      }

      // Apply speed filter
      let passesSpeedFilter = true;

      if (this.currentSpeedFilter !== 'all') {
        // Try to extract speed from different data structures
        let gameSpeed = null;

        if (game.speed) {
          gameSpeed = game.speed;
        } else if (game.raw_json?.speed) {
          gameSpeed = game.raw_json.speed;
        } else if (game.game?.raw_json?.speed) {
          gameSpeed = game.game.raw_json.speed;
        }

        // Check if game speed matches any of the selected speeds
        if (Array.isArray(this.currentSpeedFilter)) {
          passesSpeedFilter = this.currentSpeedFilter.includes(gameSpeed);
        } else {
          passesSpeedFilter = gameSpeed === this.currentSpeedFilter;
        }
      }

      // Game must pass both filters
      return passesColorFilter && passesSpeedFilter;
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
    const availableSpeeds = this.getAvailableSpeeds();
    const event: FilterEvent = {
      type: 'filter-change',
      filter: this.currentFilter,
      speedFilter: this.currentSpeedFilter,
      allGames: this.allGames,
      filteredGames: filteredGames,
      username: this.username,
      availableSpeeds: availableSpeeds
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
    const filteredGames = this.getFilteredGames();
    const colorPart = this.currentFilter === 'all' ? 'All' :
                      this.currentFilter === 'white' ? 'White' : 'Black';

    let speedPart = '';
    if (this.currentSpeedFilter !== 'all') {
      if (Array.isArray(this.currentSpeedFilter)) {
        speedPart = ` - ${this.currentSpeedFilter.join(', ')}`;
      } else {
        speedPart = ` - ${this.currentSpeedFilter}`;
      }
    }

    return `${colorPart} games${speedPart} (${filteredGames.length})`;
  }
}

// Global access
export const gameFilterManager = GameFilterManager.getInstance();