import React from 'react';
import { Share } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TripSummaryDTO } from '@dwt/shared';

import TripSummaryScreen from '../TripSummaryScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';

/** A rich celebratory summary fixture. */
const SUMMARY_RICH: TripSummaryDTO = {
  distinctExperienceCount: 5,
  topRated: [
    {
      experienceId: 'exp-1',
      experienceName: 'Space Mountain',
      meanRating: 9.5,
      ratingCount: 4,
      park: 'Magic Kingdom',
      category: 'Ride',
      imageUrl: 'https://images.unsplash.com/space.jpg',
    },
    {
      experienceId: 'exp-2',
      experienceName: 'Soarin Around the World',
      meanRating: 9.0,
      ratingCount: 3,
      park: 'EPCOT',
      category: 'Ride',
      imageUrl: null,
    },
  ],
  perMember: [
    {
      memberId: 'mem-1',
      displayName: 'Mickey',
      avatarPreset: 'mickey',
      logEntryCount: 5,
      confirmedTagCount: 2,
      totalCompletedCount: 7,
      topRatedExperienceName: 'Space Mountain',
      topRating: 10,
    },
    {
      memberId: 'mem-2',
      displayName: 'Donald',
      avatarPreset: null,
      logEntryCount: 2,
      confirmedTagCount: 4,
      totalCompletedCount: 6,
      topRatedExperienceName: 'Soarin Around the World',
      topRating: 9,
    },
  ],
  plannedTotalCount: 6,
  plannedCompletedCount: 5,
  totalCompletionsCount: 13,
  totalRatingsCount: 7,
  parkBreakdown: [
    { park: 'Magic Kingdom', count: 3 },
    { park: 'EPCOT', count: 2 },
  ],
  categoryBreakdown: [
    { category: 'Ride', count: 5 },
  ],
  superlatives: [
    {
      id: 'group_mvp',
      title: 'Group MVP',
      description: 'Most experiences completed across the entire trip',
      icon: 'trophy',
      memberId: 'mem-1',
      memberDisplayName: 'Mickey',
      value: 7,
    },
    {
      id: 'best_copilot',
      title: 'Best Co-Pilot',
      description: 'Most confirmed rode-with tags on group rides',
      icon: 'people',
      memberId: 'mem-2',
      memberDisplayName: 'Donald',
      value: 4,
    },
    {
      id: 'crowd_favorite',
      title: 'Crowd Favorite',
      description: 'Highest average rating from the group',
      icon: 'sparkles',
      experienceName: 'Space Mountain',
      value: '9.5 ★',
    },
  ],
};

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

describe('Trip_Summary screen — celebratory culmination & stats (R14)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    jest.spyOn(Share, 'share').mockImplementation(async () => ({ action: 'sharedAction' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders the completed-of-total planned line for a non-empty Planned_List', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_WITH_PLANNED);

    renderSummary();

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

  test('renders quick stat grid, superlatives, top rated, parks, and member favorites', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_RICH);

    renderSummary();

    // 1. Hero & Quick Stats
    expect(await screen.findByTestId('trip-summary-hero')).toBeTruthy();
    expect(screen.getByText('A Magical Adventure!')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-distinct-count')).toHaveTextContent('5');
    expect(screen.getByTestId('trip-summary-total-completions')).toBeTruthy();

    // 2. Superlatives
    expect(screen.getByTestId('trip-summary-superlatives')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-superlative-group_mvp')).toBeTruthy();
    expect(screen.getByText('Group MVP')).toBeTruthy();
    expect(screen.getByText('Best Co-Pilot')).toBeTruthy();
    expect(screen.getByText('Crowd Favorite')).toBeTruthy();

    // 3. Top-Rated Moments
    expect(screen.getByTestId('trip-summary-toprated')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-toprated-exp-1')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-toprated-exp-2')).toBeTruthy();
    expect(screen.getByText('Soarin Around the World')).toBeTruthy();

    // 4. Adventures by Park
    expect(screen.getByTestId('trip-summary-parks')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-park-Magic Kingdom')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-park-EPCOT')).toBeTruthy();

    // 5. Member Contributions
    expect(screen.getByTestId('trip-summary-member-mem-1')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-member-mem-1-logs')).toHaveTextContent('5');
    expect(screen.getByTestId('trip-summary-member-mem-1-tags')).toHaveTextContent('2');
    expect(screen.getByTestId('trip-summary-member-mem-1-top')).toHaveTextContent(
      'Top Ride: Space Mountain (10 ★)',
    );

    // 6. Share trigger
    const shareBtn = screen.getByTestId('trip-summary-share-btn');
    fireEvent.press(shareBtn);
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Disney World Trip Highlights'),
      }),
    );
  });
});
