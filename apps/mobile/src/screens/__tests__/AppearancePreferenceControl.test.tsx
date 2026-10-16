/**
 * Tests for `screens/AppearancePreferenceControl.tsx`.
 *
 * Renders the real component (no mocked child primitives); mocks only
 * `@react-native-async-storage/async-storage` (the one I/O boundary this
 * feature introduces — this spec's reasoned addition to the repo's "mock
 * only the network/query layer" convention, since AsyncStorage stands in
 * for that layer here).
 *
 * Validates: Requirements 1.1, 2.1, 2.2, 3.1, 4.2, 4.3, 5.1, 5.2, 5.3
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AppearancePreferenceControl from '../AppearancePreferenceControl';
import { StyleSheet } from 'react-native';
import { useThemeStore } from '../../state/themeStore';
import { themes } from '../../theme/theme';
import { APPEARANCE_PREFERENCE_KEY } from '../../theme/appearanceStorage';
import { DEFAULT_APPEARANCE_PREFERENCE, type AppearancePreference } from '../../theme/appearance';

type MockAsyncStorage = typeof AsyncStorage & {
  __INTERNAL_MOCK_STORAGE__: Record<string, string>;
};

const mockAsyncStorage = AsyncStorage as MockAsyncStorage;

function getChip(value: AppearancePreference): ReturnType<typeof screen.getByTestId> {
  return screen.getByTestId(`appearance-option-${value}`);
}

describe('AppearancePreferenceControl', () => {
  beforeEach(() => {
    mockAsyncStorage.__INTERNAL_MOCK_STORAGE__ = {};
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
  });

  it('renders all three options', () => {
    render(<AppearancePreferenceControl />);
    expect(getChip('system')).toBeTruthy();
    expect(getChip('light')).toBeTruthy();
    expect(getChip('dark')).toBeTruthy();
  });

  describe.each<AppearancePreference>(['system', 'light', 'dark'])(
    'when preference is %s',
    (selected) => {
      it(`marks only the ${selected} chip as accessibilityState.selected: true`, () => {
        useThemeStore.setState({ preference: selected });
        render(<AppearancePreferenceControl />);

        for (const option of ['system', 'light', 'dark'] as const) {
          const expectedSelected = option === selected;
          expect(getChip(option).props.accessibilityState.selected).toBe(expectedSelected);
        }
      });
    },
  );

  it('pressing a different option updates the store and persists to AsyncStorage', async () => {
    useThemeStore.setState({ preference: 'system' });
    render(<AppearancePreferenceControl />);

    fireEvent.press(getChip('dark'));

    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('dark');
    });
    await waitFor(() => {
      expect(mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY]).toBe('dark');
    });
  });

  it('pressing "light" from "dark" updates the store and persists', async () => {
    useThemeStore.setState({ preference: 'dark' });
    render(<AppearancePreferenceControl />);

    fireEvent.press(getChip('light'));

    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('light');
    });
    await waitFor(() => {
      expect(mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY]).toBe('light');
    });
  });

  // Feature: dark-mode — choosing Dark repaints the control itself live.
  describe('dark mode', () => {
    const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

    it('pressing Dark repaints the title and chips with the dark tokens without remounting', async () => {
      useThemeStore.setState({ preference: 'light' });
      render(<AppearancePreferenceControl />);
      const title = screen.getByText('Appearance');
      expect(flat(title).color).toBe(themes.light.color.textPrimary);
      expect(flat(getChip('light')).backgroundColor).toBe(themes.light.color.primary);

      fireEvent.press(getChip('dark'));

      await waitFor(() => {
        expect(flat(screen.getByText('Appearance')).color).toBe(themes.dark.color.textPrimary);
      });
      expect(screen.getByText('Appearance')).toBe(title);
      expect(flat(getChip('dark')).backgroundColor).toBe(themes.dark.color.primary);
      expect(flat(getChip('light')).backgroundColor).toBe(themes.dark.color.surfaceAlt);
      expect(flat(screen.getByText(/Choose how the app looks/)).color).toBe(
        themes.dark.color.textSecondary,
      );
      await waitFor(() => {
        expect(mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY]).toBe('dark');
      });
    });
  });
});
