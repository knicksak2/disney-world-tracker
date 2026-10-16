/**
 * Property tests for `screens/AppearancePreferenceControl.tsx`.
 *
 * Validates: Requirements 4.2, 4.3, 5.1, 5.2, 5.3
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import React from 'react';
import fc from 'fast-check';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AppearancePreferenceControl from '../AppearancePreferenceControl';
import { useThemeStore } from '../../state/themeStore';
import { DEFAULT_APPEARANCE_PREFERENCE, type AppearancePreference } from '../../theme/appearance';

type MockAsyncStorage = typeof AsyncStorage & {
  __INTERNAL_MOCK_STORAGE__: Record<string, string>;
};

const mockAsyncStorage = AsyncStorage as MockAsyncStorage;

const OPTIONS: readonly AppearancePreference[] = ['system', 'light', 'dark'];

function getChip(value: AppearancePreference): ReturnType<typeof screen.getByTestId> {
  return screen.getByTestId(`appearance-option-${value}`);
}

describe('AppearancePreferenceControl properties', () => {
  // Feature: dark-mode, Property 4: control selection always agrees with store state
  it('after each press in an arbitrary sequence, the rendered control and the store agree', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...OPTIONS), { minLength: 1, maxLength: 10 }),
        async (sequence) => {
          mockAsyncStorage.__INTERNAL_MOCK_STORAGE__ = {};
          useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
          const view = render(<AppearancePreferenceControl />);

          for (const selection of sequence) {
            fireEvent.press(getChip(selection));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => {
              expect(useThemeStore.getState().preference).toBe(selection);
            });

            for (const option of OPTIONS) {
              const expectedSelected = option === selection;
              expect(getChip(option).props.accessibilityState.selected).toBe(expectedSelected);
            }
            expect(useThemeStore.getState().preference).toBe(selection);
          }

          view.unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: dark-mode, Property 5: every option is labeled and operable regardless of selection state
  it('every option renders with accessibilityRole="button" and a label containing its name, regardless of selection state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OPTIONS),
        fc.boolean(),
        (option, isActive) => {
          const preference: AppearancePreference = isActive
            ? option
            : OPTIONS.find((candidate) => candidate !== option) ?? 'system';
          useThemeStore.setState({ preference });
          const view = render(<AppearancePreferenceControl />);

          const chip = getChip(option);
          expect(chip.props.accessibilityRole).toBe('button');
          const expectedName = option.charAt(0).toUpperCase() + option.slice(1);
          expect(String(chip.props.accessibilityLabel)).toContain(expectedName);

          view.unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
