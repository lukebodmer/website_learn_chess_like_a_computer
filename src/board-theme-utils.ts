// Board theme color definitions matching the CSS
export const BOARD_THEMES = {
  blue: {
    light: '#f0f0f0',
    dark: '#8b9dc3'
  },
  green: {
    light: '#f0f0f0',
    dark: '#769656'
  },
  brown: {
    light: '#f0d9b5',
    dark: '#b58863'
  }
} as const;

export type BoardTheme = keyof typeof BOARD_THEMES;

/**
 * Gets the current board theme from the HTML element's class
 * Falls back to 'blue' if no theme is found
 */
export function getCurrentBoardTheme(): BoardTheme {
  const htmlElement = document.documentElement;
  const classList = htmlElement.classList;

  // Check for board-theme-* class
  for (const className of classList) {
    if (className.startsWith('board-theme-')) {
      const theme = className.replace('board-theme-', '') as BoardTheme;
      if (theme in BOARD_THEMES) {
        return theme;
      }
    }
  }

  // Default to blue
  return 'blue';
}

/**
 * Gets the colors for a specific board theme
 */
export function getBoardThemeColors(theme: BoardTheme = 'blue') {
  return BOARD_THEMES[theme] || BOARD_THEMES.blue;
}
