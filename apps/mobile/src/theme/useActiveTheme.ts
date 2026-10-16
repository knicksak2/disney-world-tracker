// Feature: dark-mode — the only module that calls React Native's
// `useColorScheme()`.

import { useColorScheme } from 'react-native';

import { useThemeStore } from '../state/themeStore';
import { resolveActiveTheme, type ActiveTheme } from './appearance';

/**
 * The resolved Active theme (Requirements 1.3, 1.4, 2.1, 2.2). Re-renders
 * automatically on either an OS color-scheme change (`useColorScheme`'s own
 * subscription) or a `themeStore.preference` change (Zustand's own
 * subscription) — no manual listener wiring needed.
 */
export function useActiveTheme(): ActiveTheme {
  const preference = useThemeStore((state) => state.preference);
  const osScheme = useColorScheme();
  // The installed `react-native@0.85.3`'s `useColorScheme()` can return
  // `'unspecified'` (its `ColorSchemeName` type is
  // `'light' | 'dark' | 'unspecified'`, nullable) in addition to `'light'`/
  // `'dark'`/`null`/`undefined` — `resolveActiveTheme`'s domain (design.md)
  // only models the latter four, so normalize `'unspecified'` to `null`
  // here (treated identically: Requirement 1.3's "unknown/null scheme"
  // fallback to `'light'`).
  const normalizedOsScheme = osScheme === 'unspecified' ? null : osScheme;
  return resolveActiveTheme(preference, normalizedOsScheme);
}
