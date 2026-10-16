// Feature: dark-mode — runtime access to the active full theme.
//
// Lives in its own module (not `theme.ts`) so `theme.ts` stays pure and the
// `theme → useActiveTheme → themeStore → appearanceStorage → appearance →
// theme` runtime cycle can't form.

import { useActiveTheme } from './useActiveTheme';
import { themes, type AppTheme, type ThemedPalette } from './theme';

/**
 * The full theme for the resolved Active theme. Re-renders the caller on an
 * OS scheme change or an Appearance preference change (via `useActiveTheme`).
 */
export function useAppTheme(): AppTheme {
  return themes[useActiveTheme()];
}

/** The active scheme's half of a co-located `*.palette.ts` pair. */
export function usePalette<K extends string>(
  palette: ThemedPalette<K>,
): Readonly<Record<K, string>> {
  return palette[useActiveTheme()];
}
