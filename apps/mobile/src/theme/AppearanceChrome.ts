// Feature: dark-mode — the exported, testable chrome-derivation that both
// `App.tsx` and `App.appearance.test.tsx` call directly, so the test
// exercises the identical production code path rather than a stand-in.

import { DefaultTheme, type Theme } from '@react-navigation/native';

import { resolveStatusBarStyle, type ActiveTheme } from './appearance';
import { darkTheme, themes, type AppTheme } from './theme';

export interface AppearanceChrome {
  readonly navigationTheme: Theme;
  readonly statusBarStyle: 'light' | 'dark';
  readonly rootBackground: string;
}

/**
 * The dark React Navigation theme, built once from the Twilight tokens so its
 * identity is stable across renders. `BottomTabBar` paints its surface from
 * `colors.card` and its top hairline from `colors.border`, so the tab bar
 * follows the theme without a `tabBarStyle` override.
 */
const DARK_NAVIGATION_THEME: Theme = {
  dark: true,
  colors: {
    // Navigation uses `primary` as a tint on chrome → the text-safe value.
    primary: darkTheme.color.primaryFg,
    background: darkTheme.color.background,
    card: darkTheme.tabBar.background,
    text: darkTheme.color.textPrimary,
    border: darkTheme.tabBar.border,
    notification: darkTheme.color.danger,
  },
};

/**
 * The React Navigation theme for an app theme. Light returns `DefaultTheme`
 * by identity, so light navigation chrome is exactly as before.
 */
export function buildNavigationTheme(t: AppTheme): Theme {
  if (t.scheme === 'light') return DefaultTheme;
  return DARK_NAVIGATION_THEME;
}

/**
 * Derives the full (navigationTheme, statusBarStyle, rootBackground) chrome
 * triple from the Active theme alone (Requirement 6; Correctness Property 3).
 */
export function deriveAppearanceChrome(activeTheme: ActiveTheme): AppearanceChrome {
  const t = themes[activeTheme];
  return {
    navigationTheme: buildNavigationTheme(t),
    statusBarStyle: resolveStatusBarStyle(activeTheme),
    rootBackground: t.color.background,
  };
}
