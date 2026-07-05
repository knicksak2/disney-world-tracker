/**
 * RatingsDetailScreen tests (stats-experience-redesign task 7.4).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 14.3
 *
 * `RatingsDetailScreen` is the Ratings drill-in of the Stats tab. It reads the
 * SAME shared, cached `['me-stats', { percentile: true }]` query the Overview
 * hub issues and renders the shared `RatingsSection` (rich vs. unlock). These
 * React Native Testing Library tests pin the four behaviours called out by the
 * task:
 *
 *   - **Rich vs. unlock states (R8.1, R8.2).** A `sufficient` snapshot renders
 *     the rich ratings story (average dial + 1–10 distribution + high/low hero
 *     cards + per-park/category averages); an under-threshold snapshot renders
 *     the unlock empty state.
 *   - **No gated-field read when insufficient (R8.3).** With a spy
 *     `RatingStatistics` whose gated properties record any access, none may be
 *     touched while rendering the unlock branch; only `ratedCompletionsCount`
 *     is read.
 *   - **Shared-cache read / P12.** When the shared cache entry is already warm
 *     and fresh (as the hub leaves it), mounting the screen renders from the
 *     cached snapshot with NO additional network fetch.
 *   - **Cold-cache treatment (R14.3).** Entered as a cold deep-link with no
 *     cached snapshot, the screen issues the query itself and shows the
 *     loading → error/Retry treatment against the shared query.
 *
 * Following the existing stats-screen state-test conventions, only the
 * lowest-level `apiRequest` (`api/client`) is mocked; the real `ApiError` and
 * the real `RatingsSection` run on top of it. The screen's navigation hooks
 * (`useNavigation`, plus `useFocusEffect` used by `useOpenExperience`) are
 * stubbed so the screen renders standalone without a navigator.
 */

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store` — the real `api/client` module (kept via
// `requireActual`) imports secure-store-backed session storage at load time.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL (never read at runtime here since
// the network call is mocked, but referenced defensively on import).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything
// else) so the screen's error checks resolve against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen uses `useNavigation` (for the back control) and `useOpenExperience`
// (which uses `useNavigation` + `useFocusEffect`). Render standalone without a
// navigator by stubbing the two hooks the screen tree depends on.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import RatingsDetailScreen from '../RatingsDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { MINIMUM_RATINGS_THRESHOLD } from '../../../api/statsTypes';
import type { RatingStatistics } from '../../../api/statsTypes';
import {
  makeInsufficientRatings,
  makeStatsResponse,
  makeSufficientRatings,
} from '../__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Shared query key (byte-identical to the one the screen registers).
// ---------------------------------------------------------------------------

const SHARED_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** The stats path the screen fetches (opt-in percentile variant, R10.1). */
const STATS_PATH = '/me/stats?percentile=true';
const isStatsPath = (p: string): boolean => p === STATS_PATH;

/** A promise that never settles — keeps the request in its loading state. */
const pendingForever = (): Promise<never> => new Promise<never>(() => undefined);

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
}

/** Count `apiRequest` calls whose path satisfies `pred`. */
function callsMatching(pred: (path: string) => boolean): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && pred(call[1] as string),
  ).length;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

/**
 * Render the screen. When `seed` is supplied it is written into the shared
 * cache entry BEFORE mount (freshly, within the staleTime window) so the
 * screen reads a warm cache — mirroring the hub having already populated it.
 */
function renderScreen(seed?: ReturnType<typeof makeStatsResponse>): {
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  if (seed !== undefined) {
    client.setQueryData(SHARED_STATS_QUERY_KEY, seed);
  }
  render(
    <QueryClientProvider client={client}>
      <RatingsDetailScreen />
    </QueryClientProvider>,
  );
  return { client };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RatingsDetailScreen (Requirements 8.1, 8.2, 8.3, 14.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    // Default: the stats read resolves with a sufficient snapshot. Individual
    // tests override this or seed the cache directly.
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return makeStatsResponse();
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  // -------------------------------------------------------------------------
  // Rich state (R8.1)
  // -------------------------------------------------------------------------
  test('R8.1: renders the rich ratings story when the snapshot is sufficient', async () => {
    const ratings = makeSufficientRatings();
    renderScreen(makeStatsResponse({ ratings }));

    expect(await screen.findByTestId('ratings-detail-screen')).toBeTruthy();
    expect(screen.getByTestId('ratings-detail-section')).toBeTruthy();

    // Rich visuals present (dial + histogram + high/low + averages).
    expect(screen.getByText('Average rating')).toBeTruthy();
    expect(screen.getByText('Rating distribution')).toBeTruthy();
    // The screen wires `onOpenExperience`, so the hero cards are buttons whose
    // spoken label carries the ". Opens the experience." action suffix (R15.2).
    expect(
      screen.getByLabelText(
        `Highest rated: ${ratings.highest!.name}, rated ${ratings.highest!.value} out of 10. Opens the experience.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Lowest rated: ${ratings.lowest!.name}, rated ${ratings.lowest!.value} out of 10. Opens the experience.`,
      ),
    ).toBeTruthy();

    // Not the unlock state.
    expect(screen.queryByText('Unlock your ratings')).toBeNull();
    // Loading / error gates are gone.
    expect(screen.queryByTestId('ratings-detail-loading')).toBeNull();
    expect(screen.queryByTestId('ratings-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Unlock state (R8.2)
  // -------------------------------------------------------------------------
  test('R8.2: renders the unlock empty state when the snapshot is insufficient', async () => {
    renderScreen(makeStatsResponse({ ratings: makeInsufficientRatings(2) }));

    expect(await screen.findByTestId('ratings-detail-screen')).toBeTruthy();
    // Unlock CTA showing count-of-threshold progress (2 of 3 → 1 more).
    expect(screen.getByText('Unlock your ratings')).toBeTruthy();
    expect(
      screen.getByText(
        `Rate 1 more experience to unlock your ratings (2/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();

    // No rich visuals in the unlock branch.
    expect(screen.queryByText('Average rating')).toBeNull();
    expect(screen.queryByText('Rating distribution')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Gated-field discipline while insufficient (R8.3)
  // -------------------------------------------------------------------------
  test('R8.3: never reads a gated field while insufficient', async () => {
    const GATED_FIELDS = [
      'average',
      'distribution',
      'highest',
      'lowest',
      'averageByPark',
      'averageByCategory',
    ] as const;

    const reads: string[] = [];
    const spyRatings: Record<string, unknown> = {
      sufficient: false,
      ratedCompletionsCount: 2,
    };
    for (const field of GATED_FIELDS) {
      Object.defineProperty(spyRatings, field, {
        enumerable: false,
        configurable: true,
        get() {
          reads.push(field);
          return undefined;
        },
      });
    }

    renderScreen(
      makeStatsResponse({ ratings: spyRatings as unknown as RatingStatistics }),
    );

    expect(await screen.findByTestId('ratings-detail-screen')).toBeTruthy();
    // The unlock branch reads ONLY ratedCompletionsCount.
    expect(reads).toEqual([]);
    expect(
      screen.getByText(
        `Rate 1 more experience to unlock your ratings (2/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Shared-cache read — P12
  // -------------------------------------------------------------------------
  test('P12: reads a warm, fresh shared-cache snapshot with no additional fetch', async () => {
    renderScreen(makeStatsResponse({ ratings: makeSufficientRatings() }));

    // Renders straight from the cached snapshot.
    expect(await screen.findByTestId('ratings-detail-screen')).toBeTruthy();
    expect(screen.getByTestId('ratings-detail-section')).toBeTruthy();

    // The cache was fresh within the staleTime window, so no network read was
    // issued for the shared stats query.
    expect(callsMatching(isStatsPath)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cold-cache loading (R14.3)
  // -------------------------------------------------------------------------
  test('R14.3: shows the view-level loader on a cold deep-link while the shared query is in flight', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return pendingForever();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    expect(await screen.findByTestId('ratings-detail-loading')).toBeTruthy();
    // The section is gated until the shared query resolves.
    expect(screen.queryByTestId('ratings-detail-screen')).toBeNull();
    expect(screen.queryByTestId('ratings-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cold-cache error + Retry (R14.3)
  // -------------------------------------------------------------------------
  test('R14.3: a failed shared query shows the error message and a Retry control', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) throw transientError();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    expect(await screen.findByTestId('ratings-detail-error')).toBeTruthy();
    expect(screen.getByTestId('ratings-detail-error-retry')).toBeTruthy();
    // The section stays withheld while the shared query is in error.
    expect(screen.queryByTestId('ratings-detail-screen')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cold-cache Retry recovers the view (R14.3)
  // -------------------------------------------------------------------------
  test('R14.3: tapping Retry re-issues the shared query and renders the section on success', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) throw transientError();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    const retry = await screen.findByTestId('ratings-detail-error-retry');

    await waitFor(() => {
      expect(callsMatching(isStatsPath)).toBe(1);
    });

    // The re-issued request now succeeds.
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return makeStatsResponse();
      throw new Error(`unexpected call to ${String(path)}`);
    });
    fireEvent.press(retry);

    expect(await screen.findByTestId('ratings-detail-screen')).toBeTruthy();
    expect(callsMatching(isStatsPath)).toBe(2);
  });
});
