/**
 * StatsScreen (Own_Stats_View) loading / error / retry tests (task 9.3).
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.7, 12.8
 *
 * These React Native Testing Library tests drive the Own_Stats_View through
 * its two independent request state machines:
 *
 *   - the view-level `GET /me/stats` read that gates the Own_Stats_Selector
 *     and the three stats modes (R12.1 loading, R12.2 success, R12.3 error +
 *     retry, R12.5 timeout-as-failure), and
 *   - the in-pane Own_Completions_Read that powers only the Own_Experiences
 *     mode (R12.7 loading, R12.8 error + retry, including the real 30-second
 *     `AbortController` timeout).
 *
 * As with the Friend_Profile_View state tests, only the lowest-level
 * `apiRequest` (`api/client`) is mocked; the REAL `api/friendProfile.ts`
 * timeout wrapper and the REAL `hooks/useOwnCompletions.ts` query hook run on
 * top of it. Each backend read is served by a mutable `routeHandlers`
 * registry so a request can be held pending (loading), resolved (success), or
 * rejected (error) independently.
 *
 * Timeout note: `StatsScreen.fetchStats` issues `apiRequest('GET','/me/stats')`
 * with no `AbortController`, so the stats read has no client-side 30-second
 * abort timer — a stalled stats request surfaces as a failure only when the
 * underlying fetch/server rejects, and the screen treats any such failure
 * identically (error message + retry control). R12.5 is therefore exercised at
 * the screen level via a rejection (the same path a timeout takes). The
 * Own_Completions_Read DOES go through `requestWithTimeout`'s real 30-second
 * `AbortController`, so its timeout is driven with Jest fake timers.
 *
 * The test `QueryClient` sets `retry: false` (the stats query surfaces an
 * error promptly) and `retryDelay: 0` (the completions hook's own single
 * retry settles without a real-time wait).
 */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`. `apiRequest` is mocked so the session token
// is never actually read, but the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL. Never read at runtime here (the
// network call is mocked) but provided so any defensive codepath in the real
// client module does not throw on import.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything
// else) so the screen's error checks and the completions hook's retry policy
// resolve against the genuine class. The real `api/friendProfile.ts` timeout
// wrapper and the real `useOwnCompletions` hook run on top of this mock.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useOpenExperience` (which uses React Navigation) to wire
// row taps to the Catalog tab's ExperienceDetail screen. These loading/error
// state tests render the screen standalone (no navigator), so stub the two
// navigation hooks the screen depends on.
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

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Route registry + controllable promises
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';

/** A backend read's behavior for one test: receives the request's abort
 *  signal (used by the completions-timeout test) and returns the promise the
 *  screen will observe. */
type RouteHandler = (signal?: AbortSignal) => Promise<unknown>;

interface RouteHandlers {
  me: RouteHandler;
  stats: RouteHandler;
  completions: RouteHandler;
}

let routeHandlers: RouteHandlers;

/** A promise that never settles — keeps a request in its loading state. */
const pendingForever: RouteHandler = () => new Promise<never>(() => undefined);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

interface Breakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

function breakdown(completed: number, total: number, percent: number): Breakdown {
  return { completed, total, percent };
}

/** A full `GET /me/stats` response with every Park and Category dimension. */
function makeStats(): unknown {
  const zero = breakdown(0, 0, 0);
  const byPark = Object.fromEntries(PARKS.map((park) => [park, zero]));
  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [category, zero]),
  );
  const byParkAndCategory = Object.fromEntries(
    PARKS.map((park) => [park, byCategory]),
  );
  return {
    overall: breakdown(50, 100, 50),
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

/** Count `apiRequest` calls whose path satisfies `pred`. */
function callsMatching(pred: (path: string) => boolean): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && pred(call[1] as string),
  ).length;
}

const isStatsPath = (p: string): boolean => p === '/me/stats';
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StatsScreen Own_Stats_View state machine (R12.1, R12.2, R12.3, R12.5, R12.7, R12.8)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();

    // Default: every read resolves with a sensible fixture; individual tests
    // override only the read they care about.
    routeHandlers = {
      me: () => Promise.resolve(ME_RESPONSE),
      stats: () => Promise.resolve(makeStats()),
      completions: () => Promise.resolve({ entries: [] }),
    };

    apiRequestMock.mockImplementation(async (_method, path, _body, signal) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      // `/me/stats` must be matched before `/me` since the former contains it.
      if (path === '/me/stats') return routeHandlers.stats(signal);
      if (path === '/me') return routeHandlers.me(signal);
      if (isCompletionsPath(path)) return routeHandlers.completions(signal);
      throw new Error(`unexpected call to ${path}`);
    });
  });

  // -------------------------------------------------------------------------
  // R12.1 — view-level loading indicator while GET /me/stats is in flight
  // -------------------------------------------------------------------------
  test('R12.1: shows the view-level loading indicator while GET /me/stats is in flight with no prior data', async () => {
    routeHandlers.stats = pendingForever;
    routeHandlers.completions = pendingForever;

    renderScreen();

    expect(await screen.findByTestId('stats-loading')).toBeTruthy();
    // The selector and the modes are gated until stats resolves.
    expect(screen.queryByTestId('stats-screen')).toBeNull();
    expect(screen.queryByTestId('tab-selector')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R12.2 — successful GET /me/stats renders the selector + selected mode
  // -------------------------------------------------------------------------
  test('R12.2: a successful GET /me/stats renders the Own_Stats_Selector and the Own_Overview content', async () => {
    routeHandlers.stats = () => Promise.resolve(makeStats());

    renderScreen();

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
    // Default mode is Own_Overview.
    expect(screen.getByTestId('own-overview')).toBeTruthy();
    // The gating loading / error states are gone.
    expect(screen.queryByTestId('stats-loading')).toBeNull();
    expect(screen.queryByTestId('stats-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R12.3 / R12.5 — GET /me/stats failure shows error + retry
  // -------------------------------------------------------------------------
  test('R12.3/R12.5: a failed GET /me/stats shows the view-level error message and a retry control', async () => {
    // A rejection covers both an explicit failure (R12.3) and a 30-second
    // timeout surfacing as a failed request (R12.5): the stats read has no
    // client-side abort timer, so the screen treats any failure identically.
    routeHandlers.stats = () => Promise.reject(transientError());

    renderScreen();

    expect(await screen.findByTestId('stats-error')).toBeTruthy();
    expect(screen.getByTestId('stats-error-retry')).toBeTruthy();
    // The selector and modes remain withheld while stats is in error.
    expect(screen.queryByTestId('stats-screen')).toBeNull();
    expect(screen.queryByTestId('tab-selector')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R12.3 — stats retry re-issues ONLY GET /me/stats and recovers the view
  // -------------------------------------------------------------------------
  test('R12.3: tapping the stats retry re-issues only GET /me/stats and renders the selector on success', async () => {
    routeHandlers.stats = () => Promise.reject(transientError());

    renderScreen();

    const retry = await screen.findByTestId('stats-error-retry');

    await waitFor(() => {
      expect(callsMatching(isStatsPath)).toBe(1);
    });
    const completionsCallsBeforeRetry = callsMatching(isCompletionsPath);

    // The re-issued stats request now succeeds.
    routeHandlers.stats = () => Promise.resolve(makeStats());
    fireEvent.press(retry);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();

    // Stats was re-fetched; the completions read was not re-issued by the
    // stats retry.
    expect(callsMatching(isStatsPath)).toBe(2);
    expect(callsMatching(isCompletionsPath)).toBe(completionsCallsBeforeRetry);
  });

  // -------------------------------------------------------------------------
  // R12.7 — in-pane loader while the Own_Completions_Read is in flight
  // -------------------------------------------------------------------------
  test('R12.7: the Own_Experiences pane shows its own loader while the Own_Completions_Read is in flight', async () => {
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = pendingForever;

    renderScreen();

    // Stats loaded → selector available; switch to the Own_Experiences mode.
    fireEvent.press(await screen.findByTestId('tab-Own_Experiences'));

    expect(await screen.findByTestId('own-experiences-loading')).toBeTruthy();
    expect(screen.queryByTestId('own-experiences-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R12.8 — Own_Completions_Read failure shows in-pane error + retry
  // -------------------------------------------------------------------------
  test('R12.8: a failed Own_Completions_Read shows an in-pane error message and a retry control', async () => {
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.reject(transientError());

    renderScreen();

    fireEvent.press(await screen.findByTestId('tab-Own_Experiences'));

    expect(await screen.findByTestId('own-experiences-error')).toBeTruthy();
    expect(screen.getByTestId('own-experiences-error-retry')).toBeTruthy();
    // A completions failure must not disturb the view-level stats success.
    expect(screen.getByTestId('stats-screen')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R12.8 — Own_Experiences retry re-issues ONLY the Own_Completions_Read
  // -------------------------------------------------------------------------
  test('R12.8: tapping the Own_Experiences retry re-issues only the Own_Completions_Read and renders the list on success', async () => {
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.reject(transientError());

    renderScreen();

    fireEvent.press(await screen.findByTestId('tab-Own_Experiences'));

    const retry = await screen.findByTestId('own-experiences-error-retry');

    const statsCallsBeforeRetry = callsMatching(isStatsPath);
    const completionsCallsBeforeRetry = callsMatching(isCompletionsPath);
    expect(completionsCallsBeforeRetry).toBeGreaterThanOrEqual(1);

    // The re-issued completions read now succeeds.
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry()] });
    fireEvent.press(retry);

    expect(await screen.findByTestId('own-experiences-list')).toBeTruthy();

    // Only the completions read was re-issued; stats was untouched.
    expect(callsMatching(isStatsPath)).toBe(statsCallsBeforeRetry);
    expect(callsMatching(isCompletionsPath)).toBeGreaterThan(
      completionsCallsBeforeRetry,
    );
  });

  // -------------------------------------------------------------------------
  // R12.8 — the Own_Completions_Read 30-second timeout surfaces as an error
  // -------------------------------------------------------------------------
  test('R12.8: an Own_Completions_Read that stalls for 30 seconds becomes an in-pane retryable error', async () => {
    jest.useFakeTimers();
    try {
      routeHandlers.stats = () => Promise.resolve(makeStats());
      // The completions read never responds but honors the AbortController
      // armed by `api/friendProfile.ts`'s `requestWithTimeout`: when the 30s
      // timer fires, the controller aborts and this promise rejects, flowing
      // through the data layer's synthetic non-`profile_forbidden` timeout
      // error.
      routeHandlers.completions = (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });

      renderScreen();

      // Under fake timers, react-query schedules its re-render notifications
      // through timers, so the `/me` + `/me/stats` resolutions only surface
      // after the scheduled flush runs. Advance a step and flush microtasks
      // until the selector renders, then switch to the Own_Experiences mode.
      for (
        let i = 0;
        i < 10 && screen.queryByTestId('tab-Own_Experiences') === null;
        i += 1
      ) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(1);
          await Promise.resolve();
        });
      }
      fireEvent.press(screen.getByTestId('tab-Own_Experiences'));

      // In-pane loader while the read is in flight (R12.7).
      expect(screen.getByTestId('own-experiences-loading')).toBeTruthy();

      // Advance past the 30s deadline (and the hook's single zero-delay retry
      // cycle, which arms a fresh 30s timer) until the error surfaces.
      for (
        let i = 0;
        i < 6 && screen.queryByTestId('own-experiences-error') === null;
        i += 1
      ) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(screen.getByTestId('own-experiences-error')).toBeTruthy();
      expect(screen.getByTestId('own-experiences-error-retry')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
