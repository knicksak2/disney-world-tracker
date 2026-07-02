/**
 * StatsScreen (Own_Stats_View) request-spy tests (task 9.4).
 *
 * Validates: Requirements 12.4, 12.6, 12.9, 14.4
 *
 * These tests assert the *network discipline* of the Own_Stats_View rather
 * than its rendered content. They drive the screen through the REAL
 * `me-stats` query and the REAL `useOwnCompletionsQuery` hook; only the
 * lowest-level `apiRequest` (`api/client`) and the `fetchFriendCompletions`
 * data-layer helper (`api/friendProfile`) are mocked and spied, matching the
 * convention established by `StatsScreen.modes.test.tsx` and
 * `StatsScreen.states.test.tsx`.
 *
 * The Own_Stats_View issues exactly three reads when it opens, each fetched
 * once and cached by React Query:
 *
 *   - `GET /me/stats` (the `me-stats` query) — powers the three stats modes,
 *   - `GET /me` (the `['me']` query) — resolves the requesting User's id, and
 *   - the Own_Completions_Read — `fetchFriendCompletions(ownUserId)` keyed
 *     `['own-completions', ownUserId]`, which powers the Own_Experiences pane.
 *
 * Every Own_Stats_View_Mode reads from those caches, so:
 *
 *   - **R12.4** — switching through every Own mode (Own_Overview → Own_Parks →
 *     Own_Categories → Own_Experiences → Own_Overview) issues NO additional
 *     reads, because a mode switch is a pure local re-render over cached data.
 *   - **R14.4** — changing the Experience_Filter's Park and Category
 *     selections issues NO additional reads, because the filter is a
 *     synchronous fold over the already-loaded entries.
 *   - **R12.6** — tapping the stats retry after a `GET /me/stats` failure
 *     re-issues ONLY `GET /me/stats`; the Own_Completions_Read is untouched.
 *   - **R12.9** — tapping the Own_Experiences retry after an
 *     Own_Completions_Read failure re-issues ONLY the Own_Completions_Read;
 *     `GET /me/stats` is untouched.
 *
 * The behavior of each backend read is supplied through mutable handlers so a
 * read can be resolved or rejected independently of the others. The test
 * `QueryClient` sets `retry: false` (the stats query surfaces an error
 * promptly) and `retryDelay: 0` (the completions hook's own single retry
 * settles without a real-time wait).
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
  type ExperienceCategory,
  type Park,
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
// so the screen's error checks and the completions hook's retry policy resolve
// against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// Mock the friend-profile data layer so the Own_Completions_Read is a spyable
// `jest.fn` whose resolved / rejected value the test controls, without
// exercising the real 30-second-timeout wrapper.
jest.mock('../../../api/friendProfile', () => ({
  __esModule: true,
  fetchFriendCompletions: jest.fn(),
}));

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

import StatsScreen from '../StatsScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { fetchFriendCompletions as mockedFetchCompletions } from '../../../api/friendProfile';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;
const fetchCompletionsMock = mockedFetchCompletions as jest.MockedFunction<
  typeof mockedFetchCompletions
>;

// ---------------------------------------------------------------------------
// Mutable per-read handlers + fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

type Handler<T> = () => Promise<T>;

let statsHandler: Handler<unknown>;
let completionsHandler: Handler<{ entries: CompletionEntryDTO[] }>;

interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

interface StatsResponse {
  readonly overall: StatsBreakdown;
  readonly byPark: { readonly [park in Park]: StatsBreakdown };
  readonly byCategory: {
    readonly [category in ExperienceCategory]: StatsBreakdown;
  };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: StatsBreakdown;
    };
  };
}

function breakdown(
  completed: number,
  total: number,
  percent: number,
): StatsBreakdown {
  return { completed, total, percent };
}

function makeStats(): StatsResponse {
  const filler = breakdown(2, 10, 20);
  const byPark = Object.fromEntries(
    PARKS.map((park) => [park, filler]),
  ) as StatsResponse['byPark'];
  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [category, filler]),
  ) as StatsResponse['byCategory'];
  const byParkAndCategory = Object.fromEntries(
    PARKS.map((park) => [park, byCategory]),
  ) as StatsResponse['byParkAndCategory'];

  return {
    overall: breakdown(2, 10, 20),
    byPark,
    byCategory,
    byParkAndCategory,
  };
}

function completionEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
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
        experienceName: 'Be Our Guest',
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
// Render helper + spies
// ---------------------------------------------------------------------------

function renderScreen(): ReturnType<typeof render> {
  // `retry: false` keeps the stats query surfacing its error promptly; the
  // completions hook overrides retry with its own single-retry policy, so
  // `retryDelay: 0` is what keeps that retry from introducing a real-time
  // wait. `gcTime: 0` avoids leaking cached entries between tests.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <StatsScreen />
    </QueryClientProvider>,
  );
}

/** Count `apiRequest` calls whose path equals `path`. */
function apiCallsTo(path: string): number {
  return apiRequestMock.mock.calls.filter((call) => call[1] === path).length;
}

/** Count Own_Completions_Read invocations (the `fetchFriendCompletions` spy). */
const completionsCalls = (): number => fetchCompletionsMock.mock.calls.length;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StatsScreen request discipline (R12.4, R12.6, R12.9, R14.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();

    statsHandler = () => Promise.resolve(makeStats());
    completionsHandler = () => Promise.resolve(makeCompletions());

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      // `/me/stats` must be matched before `/me` since the former contains it.
      if (path === '/me/stats') return statsHandler();
      if (path === '/me') return ME_RESPONSE as unknown;
      throw new Error(`unexpected apiRequest path: ${path}`);
    });

    fetchCompletionsMock.mockImplementation(() => completionsHandler());
  });

  // -------------------------------------------------------------------------
  // R12.4 — no refetch when switching through every Own mode
  // -------------------------------------------------------------------------
  test('R12.4: switching through every Own mode issues no additional reads', async () => {
    renderScreen();

    // Each of the three reads fires exactly once on open.
    await waitFor(() => {
      expect(apiCallsTo('/me/stats')).toBe(1);
      expect(apiCallsTo('/me')).toBe(1);
      expect(completionsCalls()).toBe(1);
    });
    // Own_Overview is the default mode (R8.3), confirming the load settled.
    expect(await screen.findByTestId('own-overview')).toBeTruthy();

    // Cycle through every other mode and back to Own_Overview.
    fireEvent.press(screen.getByTestId('tab-Own_Parks'));
    expect(screen.getByTestId('own-parks')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));
    expect(screen.getByTestId('own-categories')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Own_Experiences'));
    expect(await screen.findByTestId('own-experiences-list')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Own_Overview'));
    expect(screen.getByTestId('own-overview')).toBeTruthy();

    // Not one additional read was issued by any mode switch (R12.4).
    expect(apiCallsTo('/me/stats')).toBe(1);
    expect(apiCallsTo('/me')).toBe(1);
    expect(completionsCalls()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // R14.4 — no refetch when changing filter selections
  // -------------------------------------------------------------------------
  test('R14.4: changing Experience_Filter selections issues no additional reads', async () => {
    renderScreen();

    await waitFor(() => {
      expect(completionsCalls()).toBe(1);
    });

    // Open the Own_Experiences mode (the Experience_Filter lives here).
    fireEvent.press(await screen.findByTestId('tab-Own_Experiences'));
    expect(await screen.findByTestId('own-experiences-list')).toBeTruthy();

    // Narrow by Park, then by Category, then clear both back to All. Each is a
    // synchronous re-derivation over already-loaded entries (R14.4).
    fireEvent.press(screen.getByTestId('own-filter-park-option-Magic Kingdom'));
    fireEvent.press(screen.getByTestId('own-filter-category-option-Ride'));
    fireEvent.press(screen.getByTestId('own-filter-category-option-Restaurant'));
    fireEvent.press(screen.getByTestId('own-filter-park-option-All'));
    fireEvent.press(screen.getByTestId('own-filter-category-option-All'));

    // The list is still mounted and no read was issued by any selection change.
    expect(screen.getByTestId('own-experiences-list')).toBeTruthy();
    expect(apiCallsTo('/me/stats')).toBe(1);
    expect(apiCallsTo('/me')).toBe(1);
    expect(completionsCalls()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // R12.6 — stats retry re-issues ONLY GET /me/stats
  // -------------------------------------------------------------------------
  test('R12.6: tapping the stats retry re-issues only GET /me/stats', async () => {
    statsHandler = () => Promise.reject(transientError());

    renderScreen();

    const retry = await screen.findByTestId('stats-error-retry');

    // Stats failed once; the Own_Completions_Read still fired once at the
    // screen level (it does not depend on the stats read).
    await waitFor(() => {
      expect(apiCallsTo('/me/stats')).toBe(1);
      expect(completionsCalls()).toBe(1);
    });
    const completionsBeforeRetry = completionsCalls();

    // The re-issued stats request now succeeds.
    statsHandler = () => Promise.resolve(makeStats());
    fireEvent.press(retry);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();

    // Stats was re-fetched; the Own_Completions_Read was NOT re-issued by the
    // stats retry (R12.6).
    expect(apiCallsTo('/me/stats')).toBe(2);
    expect(completionsCalls()).toBe(completionsBeforeRetry);
  });

  // -------------------------------------------------------------------------
  // R12.9 — Own_Experiences retry re-issues ONLY the Own_Completions_Read
  // -------------------------------------------------------------------------
  test('R12.9: tapping the Own_Experiences retry re-issues only the Own_Completions_Read', async () => {
    statsHandler = () => Promise.resolve(makeStats());
    completionsHandler = () => Promise.reject(transientError());

    renderScreen();

    // Stats loaded → selector available; switch to the Own_Experiences mode.
    fireEvent.press(await screen.findByTestId('tab-Own_Experiences'));

    const retry = await screen.findByTestId('own-experiences-error-retry');

    // Stats fetched exactly once; the completions read has failed (including
    // the hook's single automatic retry).
    const statsBeforeRetry = apiCallsTo('/me/stats');
    const completionsBeforeRetry = completionsCalls();
    expect(statsBeforeRetry).toBe(1);
    expect(completionsBeforeRetry).toBeGreaterThanOrEqual(1);

    // The re-issued completions read now succeeds.
    completionsHandler = () => Promise.resolve(makeCompletions());
    fireEvent.press(retry);

    expect(await screen.findByTestId('own-experiences-list')).toBeTruthy();

    // Only the Own_Completions_Read was re-issued; the stats read was
    // untouched (R12.9).
    expect(apiCallsTo('/me/stats')).toBe(statsBeforeRetry);
    expect(completionsCalls()).toBeGreaterThan(completionsBeforeRetry);
  });
});
