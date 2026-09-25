import { createContext } from 'react';

// Split from ThemeContext.tsx for the same Fast Refresh reason as
// authContextValue.ts.
export type Theme = 'dark' | 'light';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
