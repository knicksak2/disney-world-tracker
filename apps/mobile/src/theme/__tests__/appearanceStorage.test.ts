/**
 * Tests for `theme/appearanceStorage.ts` — the one module touching
 * `@react-native-async-storage/async-storage`.
 *
 * Mocks the package via its own shipped jest mock
 * (`@react-native-async-storage/async-storage/jest/async-storage-mock`),
 * confirmed (task 1.1) to be a **default export** backed by a real
 * in-memory `__INTERNAL_MOCK_STORAGE__` fake, not bare `jest.fn()` stubs.
 *
 * Validates: Requirements 3.1, 3.3
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  APPEARANCE_PREFERENCE_KEY,
  getStoredAppearancePreference,
  setStoredAppearancePreference,
} from '../appearanceStorage';

// The mock's internal store, exposed by the shipped mock for test setup.
type MockAsyncStorage = typeof AsyncStorage & {
  __INTERNAL_MOCK_STORAGE__: Record<string, string>;
};

const mockAsyncStorage = AsyncStorage as MockAsyncStorage;

describe('appearanceStorage', () => {
  beforeEach(() => {
    mockAsyncStorage.__INTERNAL_MOCK_STORAGE__ = {};
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  it('round-trips a set/get', async () => {
    await setStoredAppearancePreference('dark');
    await expect(getStoredAppearancePreference()).resolves.toBe('dark');
    expect(mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY]).toBe('dark');
  });

  describe('Requirement 3.3 — the three named fallback-to-default failure modes', () => {
    it("falls back to 'system' when the key is missing (never set)", async () => {
      await expect(getStoredAppearancePreference()).resolves.toBe('system');
    });

    it("falls back to 'system' when the read throws (unreadable)", async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
        new Error('storage backend unavailable'),
      );
      await expect(getStoredAppearancePreference()).resolves.toBe('system');
    });

    it("falls back to 'system' when the stored string is corrupt (not a valid enum value)", async () => {
      mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY] = 'not-a-real-value';
      await expect(getStoredAppearancePreference()).resolves.toBe('system');
    });
  });
});
