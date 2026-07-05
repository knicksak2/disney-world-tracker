/**
 * CoverageDetailScreen (Own_Surface coverage drill-in) tests
 * (stats-experience-redesign task 7.2; updated for the ranked-bar mockup).
 *
 * Validates: Requirements 4.3, 5.1, 5.2, 5.3, 6.1, 6.3, 6.4, 14.3
 *
 * The coverage detail screen renders an at-a-glance header, a five-lens
 * switcher (Parks default), and the active lens's ranked bars via the shared
 * `CoverageSection`. These React Native Testing Library tests pin:
 *
 *   - **Lens_Switcher (R5.1, R5.2, R5.3)** — exactly the five lenses with
 *     exactly one active, Parks the default, and only the active lens rendered.
 *   - **Ranked bars (R6.1)** — the Parks lens renders every park as a ranked
 *     row most→least complete (via `rankParkRows`), including `total === 0`
 *     parks (never hidden); the Resorts lens renders `coverage.byResort` in the
 *     server's order.
 *   - **Resorts separation (R6.4) + empty state (R6.3)** — the hotels-visited
 *     treatment is kept distinct from the per-resort list, and an empty
 *     `byResort` shows a compact empty state while hotels-visited remains.
 *   - **One source of truth / P12 (R4.3)** — a warm cache renders with NO
 *     network fetch.
 *   - **Cold-cache state machine (R14.3)** — loading, then error + Retry that
 *     re-issues only the shared stats read.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

let mockRouteParams: { focus?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: mockRouteParams }),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import CoverageDetailScreen, { SHARED_STATS_QUERY_KEY } from '../CoverageDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { rankParkRows } from '../statsView';
import {
  DEFAULT_BY_RESORT,
  EMPTY_CELL,
  makeByPark,
  makeCell,
  makeStatsResponse,
} from '../__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const pendingForever = (): Promise<never> => new Promise<never>(() => undefined);

function transientError(): ApiError {
  return new ApiError({ code: 'internal_error', message: 'Something went wrong.', status: 500 });
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(seed?: StatsResponse): { client: QueryClient } {
  const client = makeClient();
  if (seed !== undefined) client.setQueryData(SHARED_STATS_QUERY_KEY, seed);
  render(
    <QueryClientProvider client={client}>
      <CoverageDetailScreen />
    </QueryClientProvider>,
  );
  return { client };
}

function statsFetchCount(): number {
  return apiRequestMock.mock.calls.filter(
    (call) => call[1] === '/me/stats?percentile=true',
  ).length;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CoverageDetailScreen (R4.3, R5.1, R5.2, R5.3, R6.1, R6.3, R6.4, R14.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockRouteParams = undefined;
  });

  test('R4.3 (P12): a warm shared cache renders the glance + parks lens with no additional fetch', async () => {
    apiRequestMock.mockResolvedValue(makeStatsResponse());
    renderScreen(makeStatsResponse());

    expect(await screen.findByTestId('coverage-screen')).toBeTruthy();
    expect(screen.getByTestId('coverage-glance')).toBeTruthy();
    expect(screen.getByTestId('coverage-parks')).toBeTruthy();
    expect(screen.queryByTestId('coverage-loading')).toBeNull();
    expect(screen.queryByTestId('coverage-error')).toBeNull();

    // Fresh cache → no network fetch (P12).
    expect(statsFetchCount()).toBe(0);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  test('R5.1/R5.2: the switcher offers exactly five lenses with Parks active by default', async () => {
    renderScreen(makeStatsResponse());
    expect(await screen.findByTestId('coverage-lens-switcher')).toBeTruthy();

    const lenses = ['parks', 'categories', 'areas', 'lands', 'resorts'] as const;
    for (const lens of lenses) {
      expect(screen.getByTestId(`coverage-lens-${lens}`)).toBeTruthy();
    }
    const active = lenses.filter(
      (lens) =>
        screen.getByTestId(`coverage-lens-${lens}`).props.accessibilityState?.selected === true,
    );
    expect(active).toEqual(['parks']);
    expect(screen.getByTestId('coverage-parks')).toBeTruthy();
  });

  test('R5.3: selecting a lens renders only that lens content', async () => {
    renderScreen(makeStatsResponse());
    expect(await screen.findByTestId('coverage-parks')).toBeTruthy();
    expect(screen.queryByTestId('coverage-categories')).toBeNull();

    fireEvent.press(screen.getByTestId('coverage-lens-categories'));
    expect(screen.getByTestId('coverage-categories')).toBeTruthy();
    expect(screen.queryByTestId('coverage-parks')).toBeNull();
  });

  test('R6.1: the Parks lens renders every park as a ranked row, most→least complete', async () => {
    const seed = makeStatsResponse({
      coverage: {
        byPark: makeByPark(makeCell(3, 8), {
          'Magic Kingdom': makeCell(5, 10), // 50%
          EPCOT: makeCell(9, 10), // 90%
          'Animal Kingdom': makeCell(4, 4), // 100%
        }),
      },
    });
    renderScreen(seed);

    await screen.findByTestId('coverage-parks');

    const renderedIds = screen.getAllByTestId(/^park-row-/).map((n) => String(n.props.testID));
    const expectedIds = rankParkRows(seed.coverage.byPark).map((r) => `park-row-${r.key}`);
    expect(renderedIds).toEqual(expectedIds);
  });

  test('R5.5: a total === 0 park still renders a ranked row (never hidden), showing 0.0%', async () => {
    const seed = makeStatsResponse({
      coverage: { byPark: makeByPark(makeCell(3, 8), { 'Blizzard Beach': EMPTY_CELL }) },
    });
    renderScreen(seed);

    await screen.findByTestId('coverage-parks');
    const emptyRow = screen.getByTestId('park-row-Blizzard Beach');
    expect(emptyRow).toBeTruthy();
    expect(emptyRow.props.accessibilityLabel).toContain('0 of 0, 0.0 percent');
  });

  test('R6.1/R6.4: the Resorts lens renders byResort in server order alongside the distinct hotels-visited treatment', async () => {
    renderScreen(makeStatsResponse());

    fireEvent.press(await screen.findByTestId('coverage-lens-resorts'));
    expect(screen.getByTestId('coverage-resorts')).toBeTruthy();

    // Hotels-visited is present as its own, separate treatment (R6.4).
    const hotels = screen.getByTestId('coverage-hotels-visited');
    const byResort = screen.getByTestId('coverage-by-resort');
    expect(hotels).toBeTruthy();
    expect(byResort).toBeTruthy();
    expect(hotels).not.toBe(byResort);

    // Per-resort rows are in the server's order (R6.1).
    const renderedIds = screen.getAllByTestId(/^resort-row-/).map((n) => String(n.props.testID));
    expect(renderedIds).toEqual(DEFAULT_BY_RESORT.map((e) => `resort-row-${e.resortId}`));
  });

  test('R6.3: an empty byResort renders a compact empty state while keeping hotels-visited', async () => {
    renderScreen(makeStatsResponse({ coverage: { byResort: [] } }));

    fireEvent.press(await screen.findByTestId('coverage-lens-resorts'));
    expect(screen.getByTestId('coverage-by-resort')).toBeTruthy();
    expect(screen.queryAllByTestId(/^resort-row-/)).toHaveLength(0);
    expect(screen.getByText('No resort activity yet')).toBeTruthy();
    // Hotels-visited is unaffected by the empty per-resort list.
    expect(screen.getByTestId('coverage-hotels-visited')).toBeTruthy();
  });

  test('R5.2: a focus="resorts" deep-link hint seeds the Resorts lens on mount', async () => {
    mockRouteParams = { focus: 'resorts' };
    renderScreen(makeStatsResponse());

    expect(await screen.findByTestId('coverage-resorts')).toBeTruthy();
    expect(screen.queryByTestId('coverage-parks')).toBeNull();
    expect(
      screen.getByTestId('coverage-lens-resorts').props.accessibilityState?.selected,
    ).toBe(true);
  });

  test('R14.3: a cold deep-link with no cached snapshot shows the loader', async () => {
    apiRequestMock.mockImplementation(() => pendingForever());
    renderScreen();

    expect(await screen.findByTestId('coverage-loading')).toBeTruthy();
    expect(screen.queryByTestId('coverage-screen')).toBeNull();
    await waitFor(() => {
      expect(statsFetchCount()).toBe(1);
    });
  });

  test('R14.3: a failed cold read shows an error + Retry that re-issues only the shared query', async () => {
    apiRequestMock.mockRejectedValueOnce(transientError());
    renderScreen();

    const retry = await screen.findByTestId('coverage-error-retry');
    expect(screen.getByTestId('coverage-error')).toBeTruthy();

    await waitFor(() => {
      expect(statsFetchCount()).toBe(1);
    });

    apiRequestMock.mockResolvedValueOnce(makeStatsResponse());
    fireEvent.press(retry);

    expect(await screen.findByTestId('coverage-screen')).toBeTruthy();
    expect(statsFetchCount()).toBe(2);
  });
});
