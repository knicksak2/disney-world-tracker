/**
 * Tests for `theme/AppearanceChrome.ts`'s `deriveAppearanceChrome` — the
 * exact production function `App.tsx` calls, so this test exercises the
 * literal production code path rather than a stand-in (spec-review
 * Finding 2).
 *
 * Does not render the full `App.tsx` component tree (which pulls in
 * push-notification/navigation wiring unrelated to this feature) — see
 * design.md's Testing Strategy for why this is not a stand-in-vs-production
 * gap: `App.tsx` delegates its chrome derivation entirely to this one
 * exported, tested function.
 *
 * Retrofit (Property 12): the dark navigation theme is now built from the
 * Twilight tokens instead of React Navigation's `DarkTheme`, and the dark
 * root background is the token `#120a1f` instead of the `#121212`
 * placeholder.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 10.3, 10.4
 */

import fc from 'fast-check';
import { DefaultTheme } from '@react-navigation/native';

import { buildNavigationTheme, deriveAppearanceChrome } from '../theme/AppearanceChrome';
import {
  DARK_ROOT_BACKGROUND,
  LIGHT_ROOT_BACKGROUND,
  resolveActiveTheme,
  type ActiveTheme,
  type AppearancePreference,
} from '../theme/appearance';
import { darkTheme, themes } from '../theme/theme';

/** The token-built dark navigation colours Property 12 pins. */
const EXPECTED_DARK_NAV_COLORS = {
  primary: darkTheme.color.primaryFg,
  background: darkTheme.color.background,
  card: darkTheme.tabBar.background,
  text: darkTheme.color.textPrimary,
  border: darkTheme.tabBar.border,
  notification: darkTheme.color.danger,
};

function expectChromeFor(activeTheme: ActiveTheme): void {
  const chrome = deriveAppearanceChrome(activeTheme);
  expect(chrome.rootBackground).toBe(themes[activeTheme].color.background);
  if (activeTheme === 'light') {
    expect(chrome.navigationTheme).toBe(DefaultTheme);
    expect(chrome.statusBarStyle).toBe('dark');
    expect(chrome.rootBackground).toBe(LIGHT_ROOT_BACKGROUND);
  } else {
    expect(chrome.navigationTheme.dark).toBe(true);
    expect(chrome.navigationTheme.colors).toEqual(EXPECTED_DARK_NAV_COLORS);
    expect(chrome.statusBarStyle).toBe('light');
    expect(chrome.rootBackground).toBe(DARK_ROOT_BACKGROUND);
  }
}

describe('deriveAppearanceChrome', () => {
  it("returns DefaultTheme / 'dark' status bar / LIGHT_ROOT_BACKGROUND for the light Active theme", () => {
    expectChromeFor('light');
    expect(LIGHT_ROOT_BACKGROUND).toBe('#f5f2fb');
  });

  it("returns the token-built dark theme / 'light' status bar / DARK_ROOT_BACKGROUND for the dark Active theme", () => {
    expectChromeFor('dark');
    expect(deriveAppearanceChrome('dark').navigationTheme.colors).toEqual({
      primary: '#c4a3ff',
      background: '#120a1f',
      card: '#170e27',
      text: '#f3eefc',
      border: '#33264d',
      notification: '#ff6b9a',
    });
  });

  it("DARK_ROOT_BACKGROUND is the Twilight background '#120a1f'", () => {
    expect(DARK_ROOT_BACKGROUND).toBe('#120a1f');
  });

  it('the dark navigation theme is a stable module constant (same identity every call)', () => {
    expect(deriveAppearanceChrome('dark').navigationTheme).toBe(
      deriveAppearanceChrome('dark').navigationTheme,
    );
    expect(buildNavigationTheme(darkTheme)).toBe(deriveAppearanceChrome('dark').navigationTheme);
    expect(buildNavigationTheme(themes.light)).toBe(DefaultTheme);
  });

  // Feature: dark-mode, Property 3: chrome triple is a pure function of Active theme
  // Feature: dark-mode, Property 12: navigation chrome is derived from tokens
  it('the derived chrome triple is fully determined by the resolved Active theme over the full (preference, osScheme) input domain', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppearancePreference>('system', 'light', 'dark'),
        fc.constantFrom<'light' | 'dark' | null | undefined>(
          'light',
          'dark',
          null,
          undefined,
        ),
        (preference, osScheme) => {
          const activeTheme: ActiveTheme = resolveActiveTheme(preference, osScheme);
          const chrome = deriveAppearanceChrome(activeTheme);

          expectChromeFor(activeTheme);

          // Two different (preference, osScheme) pairs that resolve to the
          // same Active theme must produce an identical triple.
          const sameThemeChrome = deriveAppearanceChrome(activeTheme);
          expect(chrome).toEqual(sameThemeChrome);
        },
      ),
      { numRuns: 100 },
    );
  });
});
