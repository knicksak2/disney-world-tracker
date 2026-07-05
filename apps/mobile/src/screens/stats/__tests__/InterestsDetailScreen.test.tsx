/**
 * InterestsDetailScreen tests (stats-experience-redesign task 7.6).
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 14.3
 *
 * These React Native Testing Library tests drive the Interests drill-in of the
 * Stats tab through its two concerns:
 *
 *   - the interests section it renders from the shared cached snapshot — one
 *     `FacetCoverageTile` per `coverage.byFacetValue` entry (R9.1) in the
 *     `sortFacetsForDisplay` order (percent desc, total desc, case-insensitive
 *     label asc — R9.2), with the compact empty state when there are no facets
 *     (R9.3); and
 *   - the single-source-of-truth query behavior: reading the SAME cached
 *     `['me-stats', { percentile: true }]` entry the Overview hub populates
 *     with no extra network fetch on a warm/fresh cache (P12 / R4.3), and the
 *     cold deep-link loading → error/Retry treatment against that shared query
 *     when no snapshot is cached (R14.3).
 *
 * As with the sibling `StatsScreen` state tests, only the lowest-level
 * `apiRequest` (`api/client`) is mocked; the real `ApiError` class and the real
 * screen/`InterestsSection`/`FacetCoverageTile`/`statsView` transforms run on
 * top of it. The shared cached query is exercised by pre-seeding a test
 * `QueryClient` with the byte-identical query key.
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

// In-memory `expo-secure-store`: the real `api/client` module imports the
// secure-store-backed session storage at load time, so the platform module
// must resolve even though `apiRequest` itself is mocked.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL read at client-module load time.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything else)
// so the screen's `undefined`-data gating resolves against genuine behavior.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useNavigation().goBack` for the header back control; it is
// rendered standalone here (no navigator), so stub the hook.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import InterestsDetailScreen from '../InterestsDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { makeStatsResponse } from '../__testSupport__/statsFixture';
import type { FacetCoverage } from '../../../api/statsTypes';
import { makeCell } from '../__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Shared cached query key — byte-identical to the tuple the screen registers.
// ---------------------------------------------------------------------------

const OWN_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** A promise that never settles — keeps a request in its loading state. */
const pendingForever = (): Promise<never> => new Promise<never>(() => undefined);

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

/** Build a fresh test `QueryClient`. `retry: false` surfaces errors promptly;
 *  `gcTime: 0` avoids leaking cached entries between tests. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(client: QueryClient): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={client}>
      <InterestsDetailScreen />
    </QueryClientProvider>,
  );
}

/** Count `apiRequest` calls to the shared stats endpoint. */
function statsFetchCount(): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && call[1] === '/me/stats?percentile=true',
  ).length;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('InterestsDetailScreen (Requirements 9.1, 9.2, 9.3, 14.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // R9.1 / R9.2 — one tile per facet in display order (percent desc, total
  // desc, case-insensitive label asc), read from the warm shared cache.
  // -------------------------------------------------------------------------
  test('R9.1/R9.2: renders one facet tile per byFacetValue entry in display order', async () => {
    // Deliberately out of display order on the wire.
    const facets: readonly FacetCoverage[] = [
      { key: 'water', label: 'Water Rides', cell: makeCell(0, 5) }, // 0%
      { key: 'dark-ride', label: 'Dark Rides', cell: makeCell(10, 10) }, // 100%
      { key: 'thrill', label: 'Thrill Rides', cell: makeCell(6, 15) }, // 40%
    ];
    const client = makeClient();
    client.setQueryData(
      OWN_STATS_QUERY_KEY,
      makeStatsResponse({ coverage: { byFacetValue: facets } }),
    );

    renderScreen(client);

    // The section renders from the cached snapshot.
    expect(await screen.findByTestId('interests-detail-section')).toBeTruthy();

    const tiles = screen.getAllByTestId(/^facet-tile-/);
    // One tile per facet (R9.1)...
    expect(tiles).toHaveLength(3);
    // ...ordered percent desc (R9.2): dark-ride (100) → thrill (40) → water (0).
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'facet-tile-dark-ride',
      'facet-tile-thrill',
      'facet-tile-water',
    ]);
  });

  test('R9.2: breaks percent ties by total desc, then case-insensitive label asc', async () => {
    const facets: readonly FacetCoverage[] = [
      // All 50% — tie on percent.
      { key: 'beta', label: 'beta', cell: makeCell(2, 4) }, // total 4
      { key: 'alpha', label: 'Alpha', cell: makeCell(4, 8) }, // total 8
      { key: 'gamma', label: 'Gamma', cell: makeCell(2, 4) }, // total 4
    ];
    const client = makeClient();
    client.setQueryData(
      OWN_STATS_QUERY_KEY,
      makeStatsResponse({ coverage: { byFacetValue: facets } }),
    );

    renderScreen(client);

    await screen.findByTestId('interests-detail-section');
    const tiles = screen.getAllByTestId(/^facet-tile-/);
    // Alpha first (largest total 8); then the two total-4 facets by
    // case-insensitive label asc: "beta" < "Gamma".
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'facet-tile-alpha',
      'facet-tile-beta',
      'facet-tile-gamma',
    ]);
  });

  // -------------------------------------------------------------------------
  // R9.3 — compact empty state when there are no facets.
  // -------------------------------------------------------------------------
  test('R9.3: renders the compact empty state when byFacetValue is empty', async () => {
    const client = makeClient();
    client.setQueryData(
      OWN_STATS_QUERY_KEY,
      makeStatsResponse({ coverage: { byFacetValue: [] } }),
    );

    renderScreen(client);

    expect(await screen.findByText('No interests yet')).toBeTruthy();
    // No facet tiles render in the empty branch.
    expect(screen.queryAllByTestId(/^facet-tile-/)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // P12 / R4.3 — a warm/fresh shared cache renders with no extra network fetch.
  // -------------------------------------------------------------------------
  test('P12: reads the shared cached query and issues no additional fetch on a warm cache', async () => {
    const client = makeClient();
    // Simulate the Overview hub having populated the shared cache entry within
    // its freshness window (setQueryData stamps `dataUpdatedAt = now`, and the
    // screen's 30s staleTime keeps it fresh).
    client.setQueryData(OWN_STATS_QUERY_KEY, makeStatsResponse());

    renderScreen(client);

    // Content renders from the identical cached snapshot...
    expect(await screen.findByTestId('interests-detail-section')).toBeTruthy();
    // ...and no network fetch was issued (P12): the loading/error gates never
    // appeared and the endpoint was never hit.
    expect(statsFetchCount()).toBe(0);
    expect(screen.queryByTestId('interests-detail-loading')).toBeNull();
    expect(screen.queryByTestId('interests-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.3 — cold deep-link with no cached snapshot: view-level loading.
  // -------------------------------------------------------------------------
  test('R14.3: shows the loading indicator while the shared query is in flight with no cache', async () => {
    apiRequestMock.mockImplementation(pendingForever);
    const client = makeClient();

    renderScreen(client);

    expect(await screen.findByTestId('interests-detail-loading')).toBeTruthy();
    // The section and error gates are withheld while loading.
    expect(screen.queryByTestId('interests-detail-section')).toBeNull();
    expect(screen.queryByTestId('interests-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.3 — cold-cache failure shows the error card + Retry control.
  // -------------------------------------------------------------------------
  test('R14.3: a failed shared query shows the error message and a Retry control', async () => {
    apiRequestMock.mockRejectedValue(transientError());
    const client = makeClient();

    renderScreen(client);

    expect(await screen.findByTestId('interests-detail-error')).toBeTruthy();
    expect(screen.getByTestId('interests-detail-error-retry')).toBeTruthy();
    // The section stays withheld while in error.
    expect(screen.queryByTestId('interests-detail-section')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.3 — Retry re-issues the shared stats query and recovers the view.
  // -------------------------------------------------------------------------
  test('R14.3: tapping Retry re-issues the shared query and renders the section on success', async () => {
    apiRequestMock.mockRejectedValueOnce(transientError());
    const client = makeClient();

    renderScreen(client);

    const retry = await screen.findByTestId('interests-detail-error-retry');
    await waitFor(() => {
      expect(statsFetchCount()).toBe(1);
    });

    // The re-issued request now succeeds.
    apiRequestMock.mockResolvedValue(makeStatsResponse());
    fireEvent.press(retry);

    expect(await screen.findByTestId('interests-detail-section')).toBeTruthy();
    // The shared stats query was re-fetched by the Retry.
    expect(statsFetchCount()).toBe(2);
  });
});
