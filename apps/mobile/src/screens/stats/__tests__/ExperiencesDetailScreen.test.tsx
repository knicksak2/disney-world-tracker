/**
 * ExperiencesDetailScreen tests (task 7.8).
 *
 * Validates: Requirements 14.5
 *
 * `ExperiencesDetailScreen` is the Experiences drill-in of the Stats tab. Unlike
 * the coverage/ratings detail screens — which read the shared
 * `['me-stats', { percentile: true }]` cache entry — this screen reads a SEPARATE
 * query (`useOwnCompletionsQuery`, keyed `['own-completions', ownUserId]`). These
 * React Native Testing Library tests pin the two things R14.5 demands of that
 * arrangement:
 *
 *   - the completions read is SCOPED — the screen drives its view entirely from
 *     `useOwnCompletionsQuery`, never touching the shared stats query, and
 *   - its in-pane loading / error / Retry are ISOLATED — a completions failure
 *     surfaces only this screen's own `experiences-detail-error` + Retry, and
 *     Retry re-issues only the completions read (`query.refetch`), leaving any
 *     coverage / ratings surface untouched.
 *
 * Following the established screen-test convention, the completions query hook
 * (`useOwnCompletions`) is mocked so each request state — loading, error, and
 * success — can be driven deterministically without a real network or
 * `QueryClient`. The two React Navigation affordances the screen reaches for
 * (`useNavigation` and the cross-stack `useOpenExperience`) are stubbed so the
 * screen renders standalone.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { CompletionEntryDTO, FriendCompletionsDTO } from '@dwt/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import {
  makeDefaultActivity,
  makeStatsResponse,
} from '../__testSupport__/statsFixture';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

const mockOpenExperience = jest.fn();

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../../navigation/experienceNavigation', () => ({
  __esModule: true,
  ...jest.requireActual('../../navigation/experienceNavigation'),
  useOpenExperience: () => mockOpenExperience,
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../../hooks/useOwnCompletions', () => ({
  __esModule: true,
  useOwnCompletionsQuery: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import ExperiencesDetailScreen from '../ExperiencesDetailScreen';
import { useOwnCompletionsQuery } from '../../../hooks/useOwnCompletions';

const useOwnCompletionsQueryMock = useOwnCompletionsQuery as jest.MockedFunction<
  typeof useOwnCompletionsQuery
>;
const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

function statsFetchCount(): number {
  return apiRequestMock.mock.calls.filter(
    ([method, path]) => method === 'GET' && path === '/me/stats?percentile=true',
  ).length;
}

// ---------------------------------------------------------------------------
// Fixtures + query-result helper
// ---------------------------------------------------------------------------

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
    repeatCount: 12,
    sharedNote: 'Loved every minute of it.',
    ...overrides,
  };
}

function queryResult(partial: {
  data?: FriendCompletionsDTO | undefined;
  isFetching: boolean;
  refetch?: jest.Mock;
}): UseQueryResult<FriendCompletionsDTO, ApiError> {
  return {
    data: partial.data,
    isFetching: partial.isFetching,
    refetch: partial.refetch ?? jest.fn(),
  } as unknown as UseQueryResult<FriendCompletionsDTO, ApiError>;
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(statsSeed?: StatsResponse): { client: QueryClient } {
  const client = makeClient();
  if (statsSeed !== undefined) {
    client.setQueryData(['me-stats', { percentile: true }], statsSeed);
  }
  render(
    <QueryClientProvider client={client}>
      <ExperiencesDetailScreen />
    </QueryClientProvider>,
  );
  return { client };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperiencesDetailScreen scoped completions read + in-pane isolation (R14.5)', () => {
  beforeEach(() => {
    useOwnCompletionsQueryMock.mockReset();
    mockOpenExperience.mockReset();
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(makeStatsResponse());
  });

  // -------------------------------------------------------------------------
  // Scoped read — the completions list drives its view from the completions query.
  // -------------------------------------------------------------------------
  test('reads its completions data from the scoped Own_Completions query', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: { entries: [] }, isFetching: false }),
    );

    renderScreen();

    expect(useOwnCompletionsQueryMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R14.5 — in-pane loader while the scoped completions read is in flight.
  // -------------------------------------------------------------------------
  test('shows its own in-pane loader while the scoped completions read is in flight with no prior data', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: true }),
    );

    renderScreen();

    expect(screen.getByTestId('experiences-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-screen')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.5 — a failed completions read gates to an in-pane error + Retry.
  // -------------------------------------------------------------------------
  test('a failed completions read shows an in-pane error message and a Retry control', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: false }),
    );

    renderScreen();

    expect(screen.getByTestId('experiences-detail-error')).toBeTruthy();
    expect(screen.getByTestId('experiences-detail-error-retry')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-screen')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-loading')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.5 — Retry re-issues ONLY the scoped completions read (isolation).
  // -------------------------------------------------------------------------
  test('tapping Retry re-issues only the scoped completions read', () => {
    const refetch = jest.fn();
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: false, refetch }),
    );

    renderScreen();

    fireEvent.press(screen.getByTestId('experiences-detail-error-retry'));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R14.5 — success hands the loaded entries to the shared ExperiencesList.
  // -------------------------------------------------------------------------
  test('on success renders the shared ExperiencesList over the loaded completions', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    renderScreen();

    expect(screen.getByTestId('experiences-detail-screen')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-loading')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();

    expect(screen.getByTestId('own-experiences-list')).toBeTruthy();
    expect(screen.getByTestId('own-experience-row-0')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R14.5 — a re-fetch after Retry keeps showing the in-pane loader while any
  // prior data is still absent (isFetching with entries === undefined).
  // -------------------------------------------------------------------------
  test('a re-issued read with no prior data shows the in-pane loader again', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: true }),
    );

    renderScreen();

    expect(screen.getByTestId('experiences-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R18.1 / R18.2: Odometer volume & repeat counters
  // -------------------------------------------------------------------------
  test('renders odometer counters when activity is present in shared stats query', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      activity: makeDefaultActivity({
        totalLogs: 185,
        distinctParkDays: 14,
        averageRidesPerDay: 13.2,
        repeatMultiplier: 2.2,
      }),
    });

    renderScreen(stats);

    expect(screen.getByTestId('odometer-grid')).toBeTruthy();
    expect(screen.getByText('185')).toBeTruthy();
    expect(screen.getByText('Total Rides Logged')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.getByText('Distinct Park Days')).toBeTruthy();
    expect(screen.getByText('13.2')).toBeTruthy();
    expect(screen.getByText('Avg Rides / Day')).toBeTruthy();
    expect(screen.getByText('2.2×')).toBeTruthy();
    expect(screen.getByText('Repeat Multiplier')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R19.1 / R19.2: Hall of Fame Podium
  // -------------------------------------------------------------------------
  test('renders Hall of Fame Podium with top 3 attractions, medals, and counts', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      activity: makeDefaultActivity(),
    });

    renderScreen(stats);

    expect(screen.getByTestId('podium-card')).toBeTruthy();
    expect(screen.getByText('👑 Most Ridden Attractions')).toBeTruthy();
    const step1 = screen.getByTestId('podium-step-1');
    expect(within(step1).getByText('Space Mountain')).toBeTruthy();
    expect(within(step1).getByText('12 rides')).toBeTruthy();
    const step2 = screen.getByTestId('podium-step-2');
    expect(within(step2).getByText('Haunted Mansion')).toBeTruthy();
    expect(within(step2).getByText('8 rides')).toBeTruthy();
    const step3 = screen.getByTestId('podium-step-3');
    expect(within(step3).getByText('Big Thunder Mountain')).toBeTruthy();
    expect(within(step3).getByText('6 rides')).toBeTruthy();

    // Ranks 4 and 5 list
    expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
    expect(screen.getByText('5 rides')).toBeTruthy();
    expect(screen.getByText('Tower of Terror')).toBeTruthy();
    expect(screen.getByText('4 rides')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R20.1 / R20.4: Personal Records & Bests
  // -------------------------------------------------------------------------
  test('renders Personal Records & Bests cards when present', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      activity: makeDefaultActivity(),
    });

    renderScreen(stats);

    expect(screen.getByTestId('record-productive-day')).toBeTruthy();
    expect(screen.getByText('Most Productive Park Day')).toBeTruthy();
    expect(
      screen.getByText('14 rides on 2025-01-15 at Magic Kingdom, EPCOT'),
    ).toBeTruthy();

    expect(screen.getByTestId('record-marathon')).toBeTruthy();
    expect(screen.getByText('Attraction Marathon Record')).toBeTruthy();
    expect(
      screen.getByText('6 rides on Space Mountain (2025-01-15)'),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R21.1: Sort toggle (Most Visited vs Date)
  // -------------------------------------------------------------------------
  test('renders sort toggle and switches sorting between most visited and date', () => {
    const entry1 = completionEntry({
      experienceId: '11111111-1111-1111-1111-111111111111',
      experienceName: 'Alpha Ride',
      completedOn: '2024-05-01',
      repeatCount: 1,
    });
    const entry2 = completionEntry({
      experienceId: '22222222-2222-2222-2222-222222222222',
      experienceName: 'Beta Ride',
      completedOn: '2024-01-01',
      repeatCount: 10,
    });

    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [entry1, entry2] },
        isFetching: false,
      }),
    );

    renderScreen();

    expect(screen.getByTestId('sort-toggle-visits')).toBeTruthy();
    expect(screen.getByTestId('sort-toggle-date')).toBeTruthy();

    // Default sort is 'visits' -> Beta Ride (repeatCount 10) first, Alpha Ride (repeatCount 1) second
    expect(within(screen.getByTestId('own-experience-row-0')).getByText('Beta Ride')).toBeTruthy();
    expect(within(screen.getByTestId('own-experience-row-1')).getByText('Alpha Ride')).toBeTruthy();

    // Switch sort to 'date' -> Alpha Ride (2024-05-01) first, Beta Ride (2024-01-01) second
    fireEvent.press(screen.getByTestId('sort-toggle-date'));
    expect(within(screen.getByTestId('own-experience-row-0')).getByText('Alpha Ride')).toBeTruthy();
    expect(within(screen.getByTestId('own-experience-row-1')).getByText('Beta Ride')).toBeTruthy();

    // Switch back to 'visits' -> Beta Ride first
    fireEvent.press(screen.getByTestId('sort-toggle-visits'));
    expect(within(screen.getByTestId('own-experience-row-0')).getByText('Beta Ride')).toBeTruthy();
    expect(within(screen.getByTestId('own-experience-row-1')).getByText('Alpha Ride')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R7.1 / R7.2: Festival Booths section (lifetime count + per-festival labels)
  // -------------------------------------------------------------------------
  test('renders Festival Booths section with lifetime count and per-festival display labels and counts when non-empty', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      festivals: {
        lifetimeCount: 8,
        byFestival: [
          { slug: 'food-and-wine', count: 5 },
          { slug: 'flower-and-garden', count: 3 },
        ],
      },
    });

    renderScreen(stats);

    expect(screen.getByTestId('festival-section')).toBeTruthy();
    expect(screen.getByText('Festival Booths')).toBeTruthy();

    const lifetimeCard = screen.getByTestId('festival-lifetime');
    expect(within(lifetimeCard).getByText('8')).toBeTruthy();
    expect(
      within(lifetimeCard).getByText('Festival Booths Visited (Lifetime)'),
    ).toBeTruthy();

    const row1 = screen.getByTestId('festival-row-food-and-wine');
    expect(
      within(row1).getByText('EPCOT International Food & Wine Festival'),
    ).toBeTruthy();
    expect(within(row1).getByText('5')).toBeTruthy();

    const row2 = screen.getByTestId('festival-row-flower-and-garden');
    expect(
      within(row2).getByText('EPCOT International Flower & Garden Festival'),
    ).toBeTruthy();
    expect(within(row2).getByText('3')).toBeTruthy();

    // Raw slug is never rendered
    expect(screen.queryByText('food-and-wine')).toBeNull();
    expect(screen.queryByText('flower-and-garden')).toBeNull();

    // Empty-state card is not rendered
    expect(screen.queryByTestId('festival-empty')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R7.3: Festival Booths empty state (lifetimeCount === 0)
  // -------------------------------------------------------------------------
  test('renders empty-state copy when lifetimeCount is 0', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      festivals: {
        lifetimeCount: 0,
        byFestival: [],
      },
    });

    renderScreen(stats);

    expect(screen.getByTestId('festival-empty')).toBeTruthy();
    expect(
      screen.getByText(
        'No festival booths visited yet — check back during the next EPCOT festival!',
      ),
    ).toBeTruthy();

    // Festival count section is not rendered
    expect(screen.queryByTestId('festival-section')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R7.4: No additional network call beyond existing stats fetch
  // -------------------------------------------------------------------------
  test('does not issue any additional network request for festival stats', async () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    const stats = makeStatsResponse({
      festivals: {
        lifetimeCount: 4,
        byFestival: [{ slug: 'food-and-wine', count: 4 }],
      },
    });
    apiRequestMock.mockResolvedValueOnce(stats);

    // Render without pre-seeding queryClient cache to exercise the stats fetch
    renderScreen();

    expect(await screen.findByTestId('festival-section')).toBeTruthy();
    expect(
      screen.getByText('EPCOT International Food & Wine Festival'),
    ).toBeTruthy();

    // Exactly one request was issued, targeting the existing stats endpoint
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/stats?percentile=true');
    expect(statsFetchCount()).toBe(1);
  });
});
