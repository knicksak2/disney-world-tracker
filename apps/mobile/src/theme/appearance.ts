/**
 * Appearance preference — pure, I/O-free domain module (dark-mode spec).
 *
 * Defines the three-state `AppearancePreference` the User can select
 * (`'system' | 'light' | 'dark'`), the resolved `ActiveTheme` the App
 * actually renders with, and the pure functions that derive one from the
 * other plus the OS color scheme. No React, no AsyncStorage — this module
 * is property-testable in isolation (see `__tests__/appearance.test.ts` /
 * `appearance.prop.test.ts`).
 */

import { darkTheme, lightTheme } from './theme';

/** The three persisted/selectable preference states (Requirement 1.1). */
export type AppearancePreference = 'system' | 'light' | 'dark';

/** The resolved theme the App actually renders with at any moment. */
export type ActiveTheme = 'light' | 'dark';

export const APPEARANCE_PREFERENCE_VALUES: readonly AppearancePreference[] = [
  'system',
  'light',
  'dark',
];

/** Default when never set, and fallback when stored/corrupt (Requirements 1.2, 3.3). */
export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'system';

/**
 * Root safe-area background in the light Active theme — identical to the
 * light `color.background` token (`#f5f2fb`), so light mode is visually
 * unchanged from today.
 */
export const LIGHT_ROOT_BACKGROUND: string = lightTheme.color.background;

/**
 * Root safe-area background in the dark Active theme — the "Twilight" dark
 * `color.background` token (`#120a1f`), replacing the earlier neutral
 * `#121212` placeholder.
 */
export const DARK_ROOT_BACKGROUND: string = darkTheme.color.background;

/** Narrows an arbitrary value (e.g. a raw AsyncStorage read) to a valid preference. */
export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return (
    typeof value === 'string' &&
    (APPEARANCE_PREFERENCE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Resolve the Active theme from the preference and the OS color scheme
 * (Requirements 1.3, 1.4). `osScheme` is RN `useColorScheme()`'s return type
 * (`'light' | 'dark' | null | undefined`); an unknown/null OS scheme falls
 * back to `'light'`.
 */
export function resolveActiveTheme(
  preference: AppearancePreference,
  osScheme: 'light' | 'dark' | null | undefined,
): ActiveTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

/**
 * OS status bar content style for the given Active theme (Requirement 6.2).
 * `expo-status-bar`'s real `StatusBarStyle` type is
 * `'auto' | 'inverted' | 'light' | 'dark'`; this function intentionally never
 * produces `'auto'` or `'inverted'` — the Active theme is always resolved to
 * exactly one of two concrete styles, never deferred to the OS or inverted.
 *
 * `'auto'` (the status quo today, via `<StatusBar style="auto" />`) is
 * deliberately dropped rather than kept as a `'system'`-preference
 * passthrough: `'auto'` would make `expo-status-bar` perform its own,
 * second, independent OS-scheme read, which could in principle disagree with
 * `resolveActiveTheme`'s OS-scheme read on the exact render where the OS
 * scheme is changing — two sources of truth for one visual outcome. Resolving
 * to a concrete style here means the status bar always agrees with the same
 * Active theme every other chrome surface derives from, with zero risk of a
 * one-frame mismatch between the two reads.
 */
export function resolveStatusBarStyle(activeTheme: ActiveTheme): 'light' | 'dark' {
  return activeTheme === 'dark' ? 'light' : 'dark';
}
