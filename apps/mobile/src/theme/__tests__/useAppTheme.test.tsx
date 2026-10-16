/**
 * Property 10: `useAppTheme()` resolves to `themes[resolveActiveTheme(pref,
 * os)]` (identity) over the full (preference, OS scheme) domain, and
 * `usePalette` picks the matching half of a palette pair.
 *
 * Uses the descriptor-copy `useColorScheme` mock (see
 * `useActiveTheme.test.tsx` for why the spread form can't be used on RN
 * 0.85.3) driven through `setTestOsScheme`.
 *
 * Validates: Requirements 8.1, 8.2
 */

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  descriptors.useColorScheme = {
    value: jest.fn(() => 'light'),
    writable: true,
    enumerable: true,
    configurable: true,
  };
  return Object.defineProperties({}, descriptors);
});

import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import fc from 'fast-check';

import { useThemeStore } from '../../state/themeStore';
import { resetTestScheme, setTestOsScheme, setTestScheme } from '../../test/themeTestUtils';
import { resolveActiveTheme, type AppearancePreference } from '../appearance';
import { definePalette, themes, type AppTheme } from '../theme';
import { useAppTheme, usePalette } from '../useAppTheme';

const PROBE_PALETTE = definePalette({
  light: { chip: '#e8dcfa' },
  dark: { chip: '#392b51' },
});

let seen: AppTheme | null = null;

function Probe(): JSX.Element {
  const t = useAppTheme();
  const pal = usePalette(PROBE_PALETTE);
  seen = t;
  return (
    <Text testID="probe" style={{ color: t.color.textPrimary, backgroundColor: pal.chip }}>
      {t.scheme}
    </Text>
  );
}

afterEach(() => {
  seen = null;
  resetTestScheme();
});

describe('Property 10: active theme resolution is total and consistent', () => {
  // Feature: dark-mode, Property 10: active theme resolution is total and consistent
  it('useAppTheme() === themes[resolveActiveTheme(preference, osScheme)] for every input', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppearancePreference>('system', 'light', 'dark'),
        fc.constantFrom<'light' | 'dark' | null | undefined>('light', 'dark', null, undefined),
        (preference, osScheme) => {
          // `setTestOsScheme` models `null`; `undefined` is set on the mock directly.
          if (osScheme === undefined) {
            (require('react-native').useColorScheme as jest.Mock).mockReturnValue(undefined);
          } else {
            setTestOsScheme(osScheme);
          }
          act(() => {
            useThemeStore.setState({ preference });
          });
          const view = render(<Probe />);
          const expected = resolveActiveTheme(preference, osScheme);
          expect(seen).toBe(themes[expected]);
          expect(seen?.scheme).toBe(expected);
          expect(screen.getByTestId('probe')).toHaveTextContent(expected);
          expect(screen.getByTestId('probe')).toHaveStyle({
            color: themes[expected].color.textPrimary,
            backgroundColor: PROBE_PALETTE[expected].chip,
          });
          view.unmount();
          resetTestScheme();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('re-renders with the dark theme when the preference switches, without remounting', () => {
    render(<Probe />);
    const host = screen.getByTestId('probe');
    expect(seen).toBe(themes.light);

    setTestScheme('dark');
    expect(seen).toBe(themes.dark);
    expect(screen.getByTestId('probe')).toBe(host);
    expect(host).toHaveStyle({ color: themes.dark.color.textPrimary, backgroundColor: '#392b51' });

    setTestScheme('light');
    expect(seen).toBe(themes.light);
    expect(host).toHaveStyle({ color: themes.light.color.textPrimary, backgroundColor: '#e8dcfa' });
  });

  it("follows a dark OS scheme under the 'system' preference", () => {
    setTestOsScheme('dark');
    render(<Probe />);
    expect(seen).toBe(themes.dark);
  });
});
