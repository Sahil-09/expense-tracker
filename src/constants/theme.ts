/**
 * "Veda Ledger" — the design system generated in the Stitch project 3660606977987035662.
 * Type sizes, letter-spacing, radii and both palettes come straight from Stitch's token
 * set; change them there, not here, or the app and the designs drift apart.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    background: '#F8F9FD',
    surface: '#FFFFFF',
    surfaceAlt: '#EDEFF4',
    surfaceHigh: '#E7E9EF',
    border: '#E1E3EB',
    borderStrong: '#C7C4D7',
    text: '#191C1F',
    textSecondary: '#464554',
    textMuted: '#767586',
    accent: '#4B41E1',
    onAccent: '#FFFFFF',
    danger: '#DC2626',
    positive: '#15803D',
  },
  dark: {
    background: '#0B0F17',
    surface: '#131926',
    surfaceAlt: '#1C2028',
    surfaceHigh: '#262A33',
    border: '#232838',
    borderStrong: '#31353E',
    text: '#DFE2EE',
    textSecondary: '#C7C4D7',
    textMuted: '#908FA0',
    accent: '#6366F1',
    onAccent: '#FFFFFF',
    danger: '#F43F5E',
    positive: '#22C55E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Inter ships as one family per weight, so pairing a named face with a numeric weight
 * makes the platform fake-bold it. Always pair a face with `fontWeight: '400'`.
 */
export const Fonts = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
  mono: Platform.select({ ios: 'ui-monospace', default: 'monospace', web: 'var(--font-mono)' }),
} as const;

/** `{ fontFamily: Fonts[600], fontWeight: '400' }` — Inter's Semibold. */
export function face(weight: 400 | 500 | 600 | 700) {
  return { fontFamily: Fonts[weight], fontWeight: '400' } as const;
}

/** The design system aligns every currency column with tabular figures; Android has no equivalent. */
export const Tabular = Platform.select({ ios: { fontVariant: ['tabular-nums' as const] }, default: {} });

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** rounded: sm 4 / md 12 / lg 16 / xl 24 / full. */
export const Radii = {
  sm: 4,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;