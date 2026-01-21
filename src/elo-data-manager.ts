import { gameFilterManager, SpeedFilter } from './game-filter-manager'

export interface EloAveragesData {
  [timeControl: string]: {
    bracket: string;
    elo: number;
    data: {
      [metric: string]: {
        mean: number;
        std: number;
        skew: number;
      };
    };
  };
}

export interface OpeningStatsData {
  [timeControl: string]: {
    [openingName: string]: {
      eco: string;
      sample_size: number;
      number_of_times_played: number;
      opening_inaccuracies_per_game: { mean: number; std: number; skew: number; };
      opening_mistakes_per_game: { mean: number; std: number; skew: number; };
      opening_blunders_per_game: { mean: number; std: number; skew: number; };
    };
  };
}

export interface FilteredDataEvent {
  type: 'data-change';
  eloAveragesData: any | null;
  openingStatsData: any | null;
}

/**
 * Manages ELO averages and opening stats data filtering based on time control selections
 */
export class EloDataManager {
  private static instance: EloDataManager | null = null;
  private rawEloAveragesData: EloAveragesData | null = null;
  private rawOpeningStatsData: OpeningStatsData | null = null;
  private listeners: ((event: FilteredDataEvent) => void)[] = [];

  private constructor() {
    // Listen to filter changes from the game filter manager
    gameFilterManager.addListener(() => {
      this.notifyListeners();
    });
  }

  static getInstance(): EloDataManager {
    if (!EloDataManager.instance) {
      EloDataManager.instance = new EloDataManager();
    }
    return EloDataManager.instance;
  }

  /**
   * Set the raw ELO averages data loaded from the server
   */
  setEloAveragesData(data: EloAveragesData | null): void {
    console.log('EloDataManager: Setting raw ELO averages data:', data);
    this.rawEloAveragesData = data;
    this.notifyListeners();
  }

  /**
   * Set the raw opening stats data loaded from the server
   */
  setOpeningStatsData(data: OpeningStatsData | null): void {
    this.rawOpeningStatsData = data;
    this.notifyListeners();
  }

  /**
   * Get filtered ELO averages based on current time control selection
   */
  getFilteredEloAverages(): any | null {
    if (!this.rawEloAveragesData) {
      console.log('EloDataManager: No raw ELO averages data available');
      return null;
    }

    const speedFilter = gameFilterManager.getCurrentSpeedFilter();
    console.log('EloDataManager: Getting filtered ELO averages for speed filter:', speedFilter);

    // If 'all' is selected, average across all time controls
    if (speedFilter === 'all') {
      const result = this.averageEloData(Object.keys(this.rawEloAveragesData));
      console.log('EloDataManager: Averaged ELO data (all):', result);
      return result;
    }

    // If specific speeds are selected, average across those
    if (Array.isArray(speedFilter)) {
      const result = this.averageEloData(speedFilter);
      console.log('EloDataManager: Averaged ELO data (specific):', result);
      return result;
    }

    return null;
  }

  /**
   * Get filtered opening stats based on current time control selection
   */
  getFilteredOpeningStats(): any | null {
    if (!this.rawOpeningStatsData) {
      return null;
    }

    const speedFilter = gameFilterManager.getCurrentSpeedFilter();

    // If 'all' is selected, average across all time controls
    if (speedFilter === 'all') {
      return this.averageOpeningStats(Object.keys(this.rawOpeningStatsData));
    }

    // If specific speeds are selected, average across those
    if (Array.isArray(speedFilter)) {
      return this.averageOpeningStats(speedFilter);
    }

    return null;
  }

  /**
   * Average ELO data across specified time controls
   */
  private averageEloData(timeControls: string[]): any {
    if (!this.rawEloAveragesData || timeControls.length === 0) {
      return null;
    }

    // Filter to only include time controls that exist in the data
    const validTimeControls = timeControls.filter(tc => this.rawEloAveragesData![tc]);

    if (validTimeControls.length === 0) {
      return null;
    }

    // If only one time control, return its data directly
    if (validTimeControls.length === 1) {
      const tc = validTimeControls[0];
      return this.rawEloAveragesData[tc].data;
    }

    // Average across multiple time controls
    const allMetrics = new Set<string>();
    validTimeControls.forEach(tc => {
      const data = this.rawEloAveragesData![tc].data;
      Object.keys(data).forEach(metric => allMetrics.add(metric));
    });

    const result: any = {};
    allMetrics.forEach(metric => {
      const values: Array<any> = [];

      validTimeControls.forEach(tc => {
        const data = this.rawEloAveragesData![tc].data;
        if (data[metric] !== undefined && data[metric] !== null) {
          values.push(data[metric]);
        }
      });

      if (values.length > 0) {
        // Check if values are numbers or objects
        const firstValue = values[0];
        if (typeof firstValue === 'number') {
          // Simple average for plain numbers
          result[metric] = values.reduce((sum, v) => sum + v, 0) / values.length;
        } else if (typeof firstValue === 'object' && 'mean' in firstValue) {
          // Average the mean, std, skew for objects
          result[metric] = {
            mean: values.reduce((sum, v) => sum + (v.mean || 0), 0) / values.length,
            std: values.reduce((sum, v) => sum + (v.std || 0), 0) / values.length,
            skew: values.reduce((sum, v) => sum + (v.skew || 0), 0) / values.length
          };
        } else {
          // Unknown format, just use the first value
          result[metric] = firstValue;
        }
      }
    });

    return result;
  }

  /**
   * Average opening stats across specified time controls
   */
  private averageOpeningStats(timeControls: string[]): any {
    if (!this.rawOpeningStatsData || timeControls.length === 0) {
      return null;
    }

    // Filter to only include time controls that exist in the data
    const validTimeControls = timeControls.filter(tc => this.rawOpeningStatsData![tc]);

    if (validTimeControls.length === 0) {
      return null;
    }

    // If only one time control, return its data directly
    if (validTimeControls.length === 1) {
      return this.rawOpeningStatsData[validTimeControls[0]];
    }

    // Average across multiple time controls
    const allOpenings = new Set<string>();
    validTimeControls.forEach(tc => {
      const data = this.rawOpeningStatsData![tc];
      Object.keys(data).forEach(opening => allOpenings.add(opening));
    });

    const result: any = {};
    allOpenings.forEach(opening => {
      const openingData: Array<any> = [];

      validTimeControls.forEach(tc => {
        const data = this.rawOpeningStatsData![tc];
        if (data[opening]) {
          openingData.push(data[opening]);
        }
      });

      if (openingData.length > 0) {
        // Use the first occurrence for eco code (should be same across time controls)
        const eco = openingData[0].eco;

        // Sum sample_size and number_of_times_played across time controls
        const totalSampleSize = openingData.reduce((sum, d) => sum + d.sample_size, 0);
        const totalTimesPlayed = openingData.reduce((sum, d) => sum + d.number_of_times_played, 0);

        // Average the error metrics
        result[opening] = {
          eco,
          sample_size: totalSampleSize,
          number_of_times_played: totalTimesPlayed,
          opening_inaccuracies_per_game: {
            mean: openingData.reduce((sum, d) => sum + d.opening_inaccuracies_per_game.mean, 0) / openingData.length,
            std: openingData.reduce((sum, d) => sum + d.opening_inaccuracies_per_game.std, 0) / openingData.length,
            skew: openingData.reduce((sum, d) => sum + d.opening_inaccuracies_per_game.skew, 0) / openingData.length
          },
          opening_mistakes_per_game: {
            mean: openingData.reduce((sum, d) => sum + d.opening_mistakes_per_game.mean, 0) / openingData.length,
            std: openingData.reduce((sum, d) => sum + d.opening_mistakes_per_game.std, 0) / openingData.length,
            skew: openingData.reduce((sum, d) => sum + d.opening_mistakes_per_game.skew, 0) / openingData.length
          },
          opening_blunders_per_game: {
            mean: openingData.reduce((sum, d) => sum + d.opening_blunders_per_game.mean, 0) / openingData.length,
            std: openingData.reduce((sum, d) => sum + d.opening_blunders_per_game.std, 0) / openingData.length,
            skew: openingData.reduce((sum, d) => sum + d.opening_blunders_per_game.skew, 0) / openingData.length
          }
        };
      }
    });

    return result;
  }

  /**
   * Add listener for data changes
   */
  addListener(listener: (event: FilteredDataEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove listener
   */
  removeListener(listener: (event: FilteredDataEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of data changes
   */
  private notifyListeners(): void {
    const event: FilteredDataEvent = {
      type: 'data-change',
      eloAveragesData: this.getFilteredEloAverages(),
      openingStatsData: this.getFilteredOpeningStats()
    };

    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in data listener:', error);
      }
    });
  }
}

// Global access
export const eloDataManager = EloDataManager.getInstance();
