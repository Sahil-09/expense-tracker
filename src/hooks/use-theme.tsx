import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Colors } from '@/constants/theme';
import { getPref, setPref } from '@/lib/db';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemeMode = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  setMode: () => {},
  isDark: false,
});

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    // A failed read must not take the whole app down with it; 'system' is a fine default.
    void getPref('theme')
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void setPref('theme', next).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, isDark: mode === 'system' ? system === 'dark' : mode === 'dark' }),
    [mode, setMode, system]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeContext);
}

/** The resolved palette. Every component reads colours through here, never from the OS. */
export function useTheme() {
  const { isDark } = useContext(ThemeContext);
  return isDark ? Colors.dark : Colors.light;
}