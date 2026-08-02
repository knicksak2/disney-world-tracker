/**
 * Trip_Summary screen tests.
 *
 * Planned List Completion Sync task 4.4 — the planned-vs-completed line.
 *
 * Validates: Requirements 5.4
 *
 * The Trip_Summary section reads `GET /trips/:id/summary` and renders the two
 * additive `TripSummaryDTO` fields — `plannedCompletedCount` and
 * `plannedTotalCount` — as a "planned Experiences completed" line showing
 * `{plannedCompletedCount} of {plannedTotalCount}`. For an empty Planned_List
 * the DTO reports `0`/`0`, so the line reads `0 of 0` (R5.4).
 *
 * The screen consumes `navigation`/`route` from props (no navigation-context
 * hooks), so it renders directly with a stubbed navigation object; only
 * `apiRequest` is mocked, dispatched by method + path.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import TripSummaryScreen from '../TripSummaryScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripSummaryDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';

/** A summary with a non-empty Planned_List: 2 of 3 planned Experiences done. */
const SUMMARY_WITH_PLANNED: TripSummaryDTO = {
  distinctExperienceCount: 2,
  topRated: [],
  perMember: [],
  plannedTotalCount: 3,
  plannedCompletedCount: 2,
};

/** A summary for an empty Planned_List: the DTO reports 0/0 (R5.4). */
const SUMMARY_EMPTY_PLANNED: TripSummaryDTO = {
  distinctExperienceCount: 0,
  topRated: [],
  perMember: [],
  plannedTotalCount: 0,
  plannedCompletedCount: 0,
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): {
  navigate: jest.Mock;
  goBack: jest.Mock;
  canGoBack: jest.Mock;
} {
  return { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
}

function renderSummary(): void {
  const props = {
    navigation: makeNavigation(),
    route: { key: 'TripSummary-1', name: 'TripSummary', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripSummaryScreen>;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripSummaryScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Summary screen — planned-vs-completed line (R5.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('renders the completed-of-total planned line for a non-empty Planned_List', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_WITH_PLANNED);

    renderSummary();

    // The planned counts card and its value render from the DTO fields.
    expect(await screen.findByTestId('trip-summary-planned')).toBeTruthy();
    const plannedCount = screen.getByTestId('trip-summary-planned-count');
    expect(plannedCount).toHaveTextContent('2 of 3');
    expect(screen.getByText('planned Experiences completed')).toBeTruthy();
  });

  test('R5.4: renders 0 of 0 for an empty Planned_List', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_EMPTY_PLANNED);

    renderSummary();

    expect(await screen.findByTestId('trip-summary-planned')).toBeTruthy();
    const plannedCount = screen.getByTestId('trip-summary-planned-count');
    expect(plannedCount).toHaveTextContent('0 of 0');
  });
});
