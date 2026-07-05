/**
 * FriendProfileScreen request-spy tests (task 8.4).
 *
 * Validates: Requirements 6.5, 7.5, 7.6, 14.4
 *
 * These tests assert the *network discipline* of the Friend_Profile_View
 * rather than its rendered content. They drive the screen through the REAL
 * data layer (`api/friendProfile.ts`) and the REAL query hooks
 * (`hooks/useFriendProfile.ts`); only the lowest-level `apiRequest`
 * (`api/client`) is mocked and spied, matching the convention established by
 * `FriendProfileScreen.test.tsx` and `useOwnCompletions.test.tsx`.
 *
 * The three Friend reads are each fetched once when the screen opens, keyed by
 * `friendId`, and cached by React Query. Every Profile_View_Mode reads from
 * that same cache, so:
 *
 *   - **R6.5** — switching through every mode (Overview → Parks → Categories →
 *     Experiences → Overview) issues NO additional `apiRequest` calls, because
 *     a mode switch is a pure local re-render over already-cached data.
 *   - **R14.4** — changing the Experience_Filter's Park and Category selections
 *     issues NO additional `apiRequest` calls, because the filter is a
 *     synchronous fold over the already-loaded entries.
 *   - **R7.5 / R7.6** — when one read (Completions) has failed with a
 *     non-`profile_forbidden` error, tapping its retry re-issues ONLY that read
 *     while the other reads' counts stay fixed; meanwhile the View_Selector
 *     stays usable and the other modes keep rendering their cached data.
 *
 * Each backend read's behavior is supplied through a mutable `routeHandlers`
 * registry so a read can be resolved or rejected independently of the others.
 * The test `QueryClient` sets `retryDelay: 0` so the hooks' single automatic
 * retry settles without a real-time wait.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  type CompletionEntryDTO,
  type ProfileDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`: the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve even though `apiRequest` is mocked.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL. Never read at runtime here (the
// network call is mocked) but provided so the real client module does not throw
// on import.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything else)
// so the screen's `error instanceof ApiError` / `error.code` checks and the
// hooks' retry-unless-forbidden policy resolve against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useOpenExperience` (which uses React Navigation) to wire
// row taps to the Catalog tab's ExperienceDetail screen. These refetch tests
// render the screen standalone (no navigator), so stub the two navigation
// hooks the screen depends on.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import FriendProfileScreen from '../FriendProfileScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Route registry + controllable promises
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

type RouteHandler = (signal?: AbortSignal) => Promise<unknown>;

interface RouteHandlers {
  profile: RouteHandler;
  stats: RouteHandler;
  completions: RouteHandler;
}

let routeHandlers: RouteHandlers;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    userId: FRIEND_ID,
    displayName: DISPLAY_NAME,
    avatarUrl: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

function makeStats(): StatsResponse {
  return makeStatsResponse();
}

function completionEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: 8,
    sharedNote: 'Loved every minute of it.',
    ...overrides,
  };
}

/** A few named entries spanning multiple Parks and Categories so the
 *  Experience_Filter has something to narrow. */
function makeCompletions(): { entries: CompletionEntryDTO[] } {
  return {
    entries: [
      completionEntry({
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
      }),
      completionEntry({
        experienceName: 'Festival of the Lion King',
        park: 'Animal Kingdom',
        category: 'Show',
        rating: null,
        sharedNote: null,
      }),
      completionEntry({
        experienceName: "Be Our Guest",
        park: 'Magic Kingdom',
        category: 'Restaurant',
        rating: 7,
        sharedNote: null,
      }),
    ],
  };
}

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderScreen(
  params: { friendId: string; displayName: string } = {
    friendId: FRIEND_ID,
    displayName: DISPLAY_NAME,
  },
): ReturnType<typeof render> {
  // `retryDelay: 0` keeps the hooks' single automatic retry from introducing a
  // real-time wait; `gcTime: 0` avoids leaking cache entries between tests.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <FriendProfileScreen route={{ params }} />
    </QueryClientProvider>,
  );
}

/** Count `apiRequest` calls whose path satisfies `pred`. */
function callsMatching(pred: (path: string) => boolean): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && pred(call[1] as string),
  ).length;
}

const isProfilePath = (p: string): boolean => p.endsWith('/profile');
const isStatsPath = (p: string): boolean => p.includes('/stats/summary');
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');

const totalCalls = (): number => apiRequestMock.mock.calls.length;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FriendProfileScreen request discipline (R6.5, R7.5, R7.6, R14.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();

    routeHandlers = {
      profile: () => Promise.resolve(makeProfile()),
      stats: () => Promise.resolve(makeStats()),
      completions: () => Promise.resolve(makeCompletions()),
    };

    apiRequestMock.mockImplementation(async (_method, path, _body, signal) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (isStatsPath(path)) return routeHandlers.stats(signal);
      if (isCompletionsPath(path)) return routeHandlers.completions(signal);
      if (isProfilePath(path)) return routeHandlers.profile(signal);
      throw new Error(`unexpected call to ${path}`);
    });
  });

  // -------------------------------------------------------------------------
  // R6.5 — no refetch when switching through every mode
  // -------------------------------------------------------------------------
  test('R6.5: switching through every mode issues no additional apiRequest calls', async () => {
    renderScreen();

    // Each of the three reads fires exactly once on open.
    await waitFor(() => {
      expect(callsMatching(isProfilePath)).toBe(1);
      expect(callsMatching(isStatsPath)).toBe(1);
      expect(callsMatching(isCompletionsPath)).toBe(1);
    });
    // Overview content is present, confirming the initial load settled.
    expect(await screen.findByTestId('friend-profile-summary')).toBeTruthy();

    const callsAfterLoad = totalCalls();

    // Cycle through every other mode and back to Overview.
    fireEvent.press(screen.getByTestId('tab-Parks'));
    expect(await screen.findByTestId('friend-mode-parks')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Categories'));
    expect(await screen.findByTestId('friend-mode-categories')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Experiences'));
    expect(await screen.findByTestId('friend-experiences-list')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Overview'));
    expect(await screen.findByTestId('friend-mode-overview')).toBeTruthy();

    // Not one additional read was issued by any mode switch (R6.5).
    expect(totalCalls()).toBe(callsAfterLoad);
    expect(callsMatching(isProfilePath)).toBe(1);
    expect(callsMatching(isStatsPath)).toBe(1);
    expect(callsMatching(isCompletionsPath)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // R14.4 — no refetch when changing filter selections
  // -------------------------------------------------------------------------
  test('R14.4: changing Experience_Filter selections issues no additional apiRequest calls', async () => {
    renderScreen();

    await waitFor(() => {
      expect(callsMatching(isCompletionsPath)).toBe(1);
    });

    // Open the Experiences mode (the Experience_Filter lives here).
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    expect(await screen.findByTestId('friend-experiences-list')).toBeTruthy();

    const callsBeforeFiltering = totalCalls();

    // Narrow by Park, then by Category, then clear both back to All. Each is a
    // synchronous re-derivation over already-loaded entries (R14.4).
    fireEvent.press(screen.getByTestId('friend-filter-park-option-Magic Kingdom'));
    fireEvent.press(screen.getByTestId('friend-filter-category-option-Ride'));
    fireEvent.press(screen.getByTestId('friend-filter-category-option-Restaurant'));
    fireEvent.press(screen.getByTestId('friend-filter-park-option-All'));
    fireEvent.press(screen.getByTestId('friend-filter-category-option-All'));

    // The list is still mounted and no read was issued by any selection change.
    expect(screen.getByTestId('friend-experiences-list')).toBeTruthy();
    expect(totalCalls()).toBe(callsBeforeFiltering);
    expect(callsMatching(isProfilePath)).toBe(1);
    expect(callsMatching(isStatsPath)).toBe(1);
    expect(callsMatching(isCompletionsPath)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // R7.5 / R7.6 — scoped retry; other modes keep cached data; tabs stay usable
  // -------------------------------------------------------------------------
  test('R7.5/R7.6: retry re-issues only the failed read while other modes keep cached data and tabs stay selectable', async () => {
    routeHandlers.profile = () => Promise.resolve(makeProfile());
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.reject(transientError());

    renderScreen();

    // Profile and stats settle as ready; completions fails.
    await waitFor(() => {
      expect(callsMatching(isProfilePath)).toBe(1);
      expect(callsMatching(isStatsPath)).toBe(1);
    });

    // The View_Selector stays usable even while a read is in error (R7.6):
    // switch to the Experiences mode to reach the failed read's retry control.
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    const retry = await screen.findByTestId('friend-completions-error-retry');

    // Profile/stats are each fetched exactly once; completions has failed
    // (including its single automatic retry).
    const completionsBeforeRetry = callsMatching(isCompletionsPath);
    expect(completionsBeforeRetry).toBeGreaterThanOrEqual(1);
    expect(callsMatching(isProfilePath)).toBe(1);
    expect(callsMatching(isStatsPath)).toBe(1);

    // The other modes still render their cached data and tabs stay selectable
    // (R7.6): Overview shows the loaded Profile summary.
    fireEvent.press(screen.getByTestId('tab-Overview'));
    expect(await screen.findByTestId('friend-profile-summary')).toBeTruthy();

    // Back to Experiences; the re-issued completions read now succeeds.
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    routeHandlers.completions = () => Promise.resolve(makeCompletions());
    fireEvent.press(await screen.findByTestId('friend-completions-error-retry'));

    expect(await screen.findByTestId('friend-experiences-list')).toBeTruthy();

    // Retry re-issued ONLY the completions read (R7.5): profile/stats counts
    // are unchanged, completions increased.
    expect(callsMatching(isProfilePath)).toBe(1);
    expect(callsMatching(isStatsPath)).toBe(1);
    expect(callsMatching(isCompletionsPath)).toBeGreaterThan(
      completionsBeforeRetry,
    );

    // Suppress an unused-variable lint on the first `retry` handle, which we
    // intentionally re-query after the mode round-trip.
    expect(retry).toBeTruthy();
  });
});
