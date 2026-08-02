/**
 * Navigation example tests for the Disney World Tracker mobile app.
 *
 * Validates: Requirements R6.10, R11.6, R11.12
 *
 * Three scenarios are exercised:
 *
 *   1. (R11.6) Tapping a leaderboard row on the Home_Screen navigates
 *      into the Catalog tab's `ExperienceDetail` screen for the
 *      tapped Experience.
 *
 *   2. (R11.12) When the leaderboard is in its empty state ("No
 *      leaderboard yet — keep exploring!"), tap gestures within the
 *      section do NOT navigate anywhere — the empty-state body is a
 *      plain `Text`, not a `Pressable`, so any tap simply has nowhere
 *      to go.
 *
 *   3. (R6.10) When `apiRequest` rejects with a 401 `ApiError`, the
 *      registered unauthorized callback fires and the navigator flips
 *      back to the auth stack (Login screen).
 *
 * Implementation notes:
 *
 *   - We render the App's real `RootNavigator` inside a real
 *     `NavigationContainer` so the Tab + native Stack navigators
 *     actually exercise their cross-stack `navigate({ screen, params })`
 *     dispatch. No mock navigators.
 *
 *   - `apiRequest` is stubbed via `jest.mock` so each test can supply
 *     its own response (success leaderboard, empty leaderboard, 401
 *     rejection). The real `setOnUnauthorizedCallback`,
 *     `notifyUnauthorized`, and `ApiError` exports are kept by
 *     re-exporting them via `jest.requireActual`.
 *
 *   - `expo-secure-store` is stubbed with an in-memory map so the
 *     session store and the API client agree on whether a token is
 *     present without touching the platform Keychain.
 *
 *   - `expo-constants` provides a fake `extra.apiBaseUrl` so any
 *     codepath that resolves the base URL (none should run because
 *     `apiRequest` is mocked, but defense-in-depth) does not blow up.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (must be declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory replacement for `expo-secure-store`. The session store and the
// API client both read/write through this module; we drive its contents
// from each test setup.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __reset: () => {
      store.clear();
    },
    __seed: (key: string, value: string) => {
      store.set(key, value);
    },
  };
});

// `expo-constants` supplies the API base URL via `Constants.expoConfig.extra`.
// The real client throws if the value is missing; we provide a fake value so
// any defensive codepath (the `apiRequest` mock itself never resolves the
// URL) keeps working.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Mock the API client module: `apiRequest` is a `jest.fn` so each test can
// supply its own response. Everything else (`ApiError`, the unauthorized-
// callback registry) is preserved from the real module so a stubbed 401 can
// still drive the navigator back to the auth stack via the real
// `notifyUnauthorized` plumbing.
jest.mock('../api/client', () => {
  const actual = jest.requireActual('../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import RootNavigator from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';
import {
  ApiError,
  apiRequest as mockedApiRequest,
  notifyUnauthorized,
} from '../api/client';
import type { LeaderboardEntryDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const SAMPLE_ENTRY: LeaderboardEntryDTO = {
  experienceId: 'exp-001',
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  value: 9.4,
  count: 12,
};

function makeQueryClient(): QueryClient {
  // Disable retries so a stubbed rejection propagates without the default
  // exponential backoff turning a quick test into a multi-second wait.
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderApp(): ReturnType<typeof render> {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/**
 * Force the session store into a "signed-in with token" state so the
 * navigator renders the main tabs. The store's `setToken` writes through
 * to the mocked SecureStore as well, keeping the API client in sync.
 */
async function signInWithToken(token: string): Promise<void> {
  await useSessionStore.getState().setToken(token);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('navigation (R6.10, R11.6, R11.12)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    // Reset zustand store between tests.
    useSessionStore.setState({ token: null, hydrated: true });
    // Reset SecureStore state.
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  test('R11.6: tapping a leaderboard row navigates to ExperienceDetail', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/home/highest-rated') {
        return { entries: [SAMPLE_ENTRY] };
      }
      // The detail screen's live read hits `/catalog/:id/live`. It must be
      // matched before the generic `/catalog/` branch below (which would
      // otherwise return the catalog-detail shape and make the live section
      // throw). Serve a minimal, valid `LiveDetailResponseDTO`.
      if (typeof path === 'string' && path.endsWith('/live')) {
        return {
          liveDetail: {
            status: 'Unknown',
            showtimes: [],
            operatingHours: [],
            diningAvailability: [],
          },
          retrievedAt: '2024-05-01T19:30:00Z',
          stale: false,
        };
      }
      if (typeof path === 'string' && path.startsWith('/catalog/')) {
        return {
          id: SAMPLE_ENTRY.experienceId,
          name: SAMPLE_ENTRY.name,
          park: SAMPLE_ENTRY.park,
          category: SAMPLE_ENTRY.category,
          description: 'A thrilling indoor coaster.',
        };
      }
      if (typeof path === 'string' && path.endsWith('/aggregate-rating')) {
        return { value: 9.4, count: 12 };
      }
      // Personal completion / rating / note return null-equivalents — we
      // surface the corresponding `*_not_found` ApiError so the detail
      // screen falls into its empty-state branches.
      if (typeof path === 'string' && path.endsWith('/completion')) {
        throw new ApiError({
          code: 'completion_not_found',
          message: 'no completion',
          status: 404,
        });
      }
      if (typeof path === 'string' && path.endsWith('/rating')) {
        throw new ApiError({
          code: 'rating_not_found',
          message: 'no rating',
          status: 404,
        });
      }
      if (typeof path === 'string' && path.endsWith('/note')) {
        throw new ApiError({
          code: 'note_not_found',
          message: 'no note',
          status: 404,
        });
      }
      return undefined;
    });

    await signInWithToken('token-abc');
    renderApp();

    // The leaderboard row is rendered with a deterministic testID;
    // wait for it to appear (the leaderboard query resolves async).
    const row = await screen.findByTestId(
      `home-leaderboard-row-${SAMPLE_ENTRY.experienceId}`,
    );
    expect(row).toBeTruthy();

    fireEvent.press(row);

    // The ExperienceDetailScreen renders a unique `experience-detail`
    // testID once the catalog detail query resolves; assert it appears.
    await waitFor(() => {
      expect(screen.getByTestId('experience-detail')).toBeTruthy();
    });
  });

  test('R11.12: tap on empty-state leaderboard does not navigate', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      // Tab-bar chrome fetches its own data in the background: the Profile
      // tab icon reads `/me`, and the Friends tab icon reads the unread
      // indicator's two sources. These are unrelated to the empty-state tap
      // under test, so answer them benignly rather than throwing.
      if (path === '/me') {
        return { user: { id: 'u1', email: 'u@x.test' }, profile: { displayName: 'U', avatarPreset: null } };
      }
      if (path === '/me/inbox/unread-count') {
        return { count: 0 };
      }
      if (path === '/me/friends') {
        return { friends: [], incomingRequests: [], outgoingRequests: [] };
      }
      // Detail-screen / aggregate calls must not happen for an empty-state
      // tap — fail loudly if one ever does.
      throw new Error(`unexpected call to ${String(path)}`);
    });

    await signInWithToken('token-abc');
    renderApp();

    const empty = await screen.findByTestId('home-leaderboard-empty');
    expect(empty).toBeTruthy();
    expect(screen.getByText(/no leaderboard yet/i)).toBeTruthy();

    // Try to fire a press on the empty-state body. The empty state is a
    // plain View + Text (no `onPress`), so this should be a no-op — RNTL's
    // `fireEvent.press` simply does nothing when no `onPress` handler is
    // present in the tree.
    fireEvent.press(empty);

    // ExperienceDetail must NOT have been rendered.
    expect(screen.queryByTestId('experience-detail')).toBeNull();
    // The leaderboard was read, but no catalog-detail or aggregate fetch
    // fired off the empty-state tap (the mock throws for any such path).
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/home/highest-rated');
    const requestedPaths = apiRequestMock.mock.calls.map(([, path]) => path);
    expect(requestedPaths).not.toContain(`/catalog/${SAMPLE_ENTRY.experienceId}`);
  });

  test('R6.10: a 401 from the API routes back to the Login screen', async () => {
    // Stub `apiRequest` to behave like the real client when it observes a
    // 401: it clears the persisted token, fires the unauthorized callback
    // (which the navigator subscribes to), and throws an ApiError. We
    // mirror that contract here so the navigator's auth/main split flips
    // exactly as in production.
    apiRequestMock.mockImplementation(async () => {
      const secureStore = jest.requireMock('expo-secure-store') as {
        deleteItemAsync: (key: string) => Promise<void>;
      };
      await secureStore.deleteItemAsync('dwt.session.token');
      // Also clear the in-memory session store so the navigator
      // re-renders into the auth stack on the next tick — the real
      // `notifyUnauthorized` triggers `clearToken`, which does this
      // through zustand.
      notifyUnauthorized();
      throw new ApiError({
        code: 'unauthorized',
        message: 'unauthorized',
        status: 401,
      });
    });

    await signInWithToken('token-abc');
    renderApp();

    // The Profile tab's screen issues `GET /me` on mount via react-query;
    // that's the request that returns 401 and triggers the auth flip.
    // (Stats is no longer a top-level tab — it is re-hosted under Profile.)
    fireEvent.press(screen.getByText('Profile'));

    // After the 401 settles, the navigator should re-render into the
    // auth stack. LoginScreen renders a unique `login-submit` testID.
    await waitFor(() => {
      expect(screen.getByTestId('login-submit')).toBeTruthy();
    });
    expect(useSessionStore.getState().token).toBeNull();
  });
});
