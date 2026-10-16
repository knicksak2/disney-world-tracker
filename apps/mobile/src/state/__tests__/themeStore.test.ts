/**
 * Tests for `state/themeStore.ts`.
 *
 * Validates: Requirements 1.2, 3.1, 3.2, 3.3, 3.4
 */

import fc from 'fast-check';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// `sessionStore.ts` imports `api/sessionStorage.ts`, which imports
// `expo-secure-store` — stub it so the Property 6 test (below) can drive
// `useSessionStore` without touching the platform Keychain, following the
// in-memory-map pattern already used elsewhere in this suite (e.g.
// `__tests__/navigation.test.tsx`).
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { useThemeStore } from '../themeStore';
import { useSessionStore } from '../sessionStore';
import { APPEARANCE_PREFERENCE_KEY } from '../../theme/appearanceStorage';
import { DEFAULT_APPEARANCE_PREFERENCE, type AppearancePreference } from '../../theme/appearance';

type MockAsyncStorage = typeof AsyncStorage & {
  __INTERNAL_MOCK_STORAGE__: Record<string, string>;
};

const mockAsyncStorage = AsyncStorage as MockAsyncStorage;

describe('useThemeStore', () => {
  beforeEach(() => {
    mockAsyncStorage.__INTERNAL_MOCK_STORAGE__ = {};
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
    useSessionStore.setState({ token: null, hydrated: false });
  });

  it("loadFromStorage() with nothing stored yields 'system' and hydrated: true", async () => {
    await useThemeStore.getState().loadFromStorage();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it("loadFromStorage() with a corrupt stored value yields 'system' (fallback-on-corrupt-storage)", async () => {
    mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY] = 'bogus';
    await useThemeStore.getState().loadFromStorage();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it("setPreference('dark') updates preference synchronously and persists", async () => {
    const promise = useThemeStore.getState().setPreference('dark');
    // Synchronous: the in-memory state updates before the storage write
    // resolves (design.md: "Update in-memory state even if the write fails").
    expect(useThemeStore.getState().preference).toBe('dark');
    await promise;
    expect(mockAsyncStorage.__INTERNAL_MOCK_STORAGE__[APPEARANCE_PREFERENCE_KEY]).toBe('dark');
  });

  it('a simulated storage-write failure still leaves preference updated in memory', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await useThemeStore.getState().setPreference('light');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  // Feature: dark-mode, Property 6: Appearance_Preference is invariant under any session token change
  it('preference is unchanged across any sequence of session token mutations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppearancePreference>('system', 'light', 'dark'),
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant<'setToken'>('setToken'), token: fc.string({ minLength: 1 }) }),
            fc.record({ kind: fc.constant<'clearToken'>('clearToken') }),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (startingPreference, mutations) => {
          useThemeStore.setState({ preference: startingPreference, hydrated: true });
          for (const mutation of mutations) {
            if (mutation.kind === 'setToken') {
              void useSessionStore.getState().setToken(mutation.token);
            } else {
              void useSessionStore.getState().clearToken();
            }
            expect(useThemeStore.getState().preference).toBe(startingPreference);
          }
          expect(useThemeStore.getState().preference).toBe(startingPreference);
        },
      ),
      { numRuns: 100 },
    );
  });
});
