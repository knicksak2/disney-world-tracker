/**
 * FoodStatsScreen component tests (stats-experience-redesign R24–R28, task 23).
 *
 * Validates: Requirements 24.1–24.6, 25.1–25.4, 26.1–26.5, 27.1–27.5, 28.1–28.7
 */

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// In-memory expo-secure-store mock
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// expo-constants mock
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Mock apiRequest
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));

import FoodStatsScreen from '../FoodStatsScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { FoodActivityStatistics } from '../../../api/statsTypes';
import {
  DEFAULT_FOOD_ACTIVITY,
  makeDefaultFoodActivity,
  makeStatsResponse,
} from '../__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const SHARED_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

function renderWithClient(
  client: QueryClient,
  ui: JSX.Element = <FoodStatsScreen />,
) {
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

describe('FoodStatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // R28.2: Odometer
  // -------------------------------------------------------------------------
  test('R28.2: renders food odometer counters (total dishes, restaurants, repeat multiplier)', async () => {
    const client = createClient();
    const foodActivity = makeDefaultFoodActivity({
      totalDishesLogged: 15,
      distinctRestaurantsVisited: 7,
      repeatMultiplier: 1.8,
    });
    client.setQueryData(SHARED_STATS_QUERY_KEY, makeStatsResponse({ foodActivity }));

    renderWithClient(client);

    expect(screen.getByTestId('food-odometer-grid')).toBeTruthy();
    expect(screen.getByTestId('food-odometer-total-logged')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('Total Dishes Logged')).toBeTruthy();

    expect(screen.getByTestId('food-odometer-distinct-restaurants')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Distinct Restaurants')).toBeTruthy();

    expect(screen.getByTestId('food-odometer-repeat-multiplier')).toBeTruthy();
    expect(screen.getByText('1.8×')).toBeTruthy();
    expect(screen.getByText('Repeat Multiplier')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R25 / R28.3: Most Logged Podium
  // -------------------------------------------------------------------------
  test('R25, R28.3: renders Most Logged podium with 1st, 2nd, 3rd steps and runners-up', async () => {
    const client = createClient();
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    renderWithClient(client);

    expect(screen.getByTestId('food-podium-card')).toBeTruthy();
    expect(screen.getByText('👑 Most Logged Dishes')).toBeTruthy();

    // 1st place: Dole Whip
    const step1 = screen.getByTestId('food-podium-step-1');
    expect(step1).toBeTruthy();
    expect(within(step1).getByText('🥇')).toBeTruthy();
    expect(within(step1).getByText('Dole Whip')).toBeTruthy();
    expect(within(step1).getByText('5 logs')).toBeTruthy();

    // 2nd place: Mickey Pretzel
    const step2 = screen.getByTestId('food-podium-step-2');
    expect(step2).toBeTruthy();
    expect(within(step2).getByText('🥈')).toBeTruthy();
    expect(within(step2).getByText('Mickey Pretzel')).toBeTruthy();
    expect(within(step2).getByText('3 logs')).toBeTruthy();

    // 3rd place: Cheeseburger Spring Rolls
    const step3 = screen.getByTestId('food-podium-step-3');
    expect(step3).toBeTruthy();
    expect(within(step3).getByText('🥉')).toBeTruthy();
    expect(within(step3).getByText('Cheeseburger Spring Rolls')).toBeTruthy();
    expect(within(step3).getByText('2 logs')).toBeTruthy();

    // Runners-up (ranks 4 and 5)
    const podium = screen.getByTestId('food-podium-card');
    expect(within(podium).getByText('4.')).toBeTruthy();
    expect(within(podium).getByText('Churro')).toBeTruthy();
    expect(within(podium).getByText('5.')).toBeTruthy();
    expect(within(podium).getByText('Turkey Leg')).toBeTruthy();
  });

  test('R25.4: only renders present ranks on podium when fewer than 3 items', async () => {
    const client = createClient();
    const foodActivity = makeDefaultFoodActivity({
      mostLogged: [
        {
          foodItemId: 'dish-1',
          foodItemName: 'Dole Whip',
          count: 3,
        },
      ],
    });
    client.setQueryData(SHARED_STATS_QUERY_KEY, makeStatsResponse({ foodActivity }));

    renderWithClient(client);

    expect(screen.getByTestId('food-podium-step-1')).toBeTruthy();
    expect(screen.queryByTestId('food-podium-step-2')).toBeNull();
    expect(screen.queryByTestId('food-podium-step-3')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R26, R28.3: Highest Rated Dishes Section (Visually Distinct)
  // -------------------------------------------------------------------------
  test('R26, R28.3: renders Highest Rated Dishes section with ratings and counts', async () => {
    const client = createClient();
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    renderWithClient(client);

    expect(screen.getByTestId('food-highest-rated-section')).toBeTruthy();
    expect(screen.getByText('⭐ Highest Rated Dishes')).toBeTruthy();
    expect(screen.getByText('Min. 2 ratings')).toBeTruthy();

    expect(screen.getByTestId('food-highest-rated-row-1')).toBeTruthy();
    expect(screen.getByText('9.5')).toBeTruthy();
    expect(screen.getByText('(4)')).toBeTruthy();

    expect(screen.getByTestId('food-highest-rated-row-2')).toBeTruthy();
    expect(screen.getByText('9.0')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  test('R26.4: renders empty message in Highest Rated section when no dishes qualify', async () => {
    const client = createClient();
    const foodActivity = makeDefaultFoodActivity({
      highestRated: [],
    });
    client.setQueryData(SHARED_STATS_QUERY_KEY, makeStatsResponse({ foodActivity }));

    renderWithClient(client);

    expect(screen.getByTestId('food-highest-rated-empty')).toBeTruthy();
    expect(
      screen.getByText(
        /No dishes with at least 2 ratings yet — rate your favorite dishes on multiple visits to see them here!/i,
      ),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R27, R28.4: Personal Records & Bests
  // -------------------------------------------------------------------------
  test('R27, R28.4: renders adventurous day and marathon record cards when present', async () => {
    const client = createClient();
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    renderWithClient(client);

    expect(screen.getByTestId('food-record-adventurous-day')).toBeTruthy();
    expect(screen.getByText('Most Adventurous Day')).toBeTruthy();
    expect(
      screen.getByText('6 dishes on 2025-02-14 at Aloha Isle, Pecos Bill'),
    ).toBeTruthy();

    expect(screen.getByTestId('food-record-marathon')).toBeTruthy();
    expect(screen.getByText('Dish Marathon Record')).toBeTruthy();
    expect(screen.getByText('3 dishes of Dole Whip (2025-02-14)')).toBeTruthy();
  });

  test('R27.5: omits personal records cards when records are absent', async () => {
    const client = createClient();
    const foodActivity = makeDefaultFoodActivity({
      personalRecords: {},
    });
    client.setQueryData(SHARED_STATS_QUERY_KEY, makeStatsResponse({ foodActivity }));

    renderWithClient(client);

    expect(screen.queryByTestId('food-record-adventurous-day')).toBeNull();
    expect(screen.queryByTestId('food-record-marathon')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R28.5: Sort Toggle
  // -------------------------------------------------------------------------
  test('R28.5: toggles between Most Logged and Highest Rated dish lists', async () => {
    const client = createClient();
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    renderWithClient(client);

    // Initial state: "Most Logged"
    expect(screen.getByTestId('food-sort-toggle-logged')).toBeTruthy();
    expect(screen.getByTestId('food-sort-toggle-rated')).toBeTruthy();
    expect(screen.getByTestId('food-sort-row-logged-1')).toBeTruthy();
    expect(screen.queryByTestId('food-sort-row-rated-1')).toBeNull();

    // Toggle to "Highest Rated"
    fireEvent.press(screen.getByTestId('food-sort-toggle-rated'));

    expect(screen.getByTestId('food-sort-row-rated-1')).toBeTruthy();
    expect(screen.queryByTestId('food-sort-row-logged-1')).toBeNull();

    // Toggle back to "Most Logged"
    fireEvent.press(screen.getByTestId('food-sort-toggle-logged'));

    expect(screen.getByTestId('food-sort-row-logged-1')).toBeTruthy();
    expect(screen.queryByTestId('food-sort-row-rated-1')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R28.6: Zero-food-log empty state
  // -------------------------------------------------------------------------
  test('R28.6: renders empty state when totalDishesLogged is 0, omitting all stat sections', async () => {
    const client = createClient();
    const emptyActivity: FoodActivityStatistics = {
      totalDishesLogged: 0,
      distinctRestaurantsVisited: 0,
      repeatMultiplier: 1.0,
      mostLogged: [],
      highestRated: [],
      personalRecords: {},
    };
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: emptyActivity }),
    );

    renderWithClient(client);

    expect(screen.getByTestId('food-empty-state')).toBeTruthy();
    expect(screen.getByText('No dishes logged yet')).toBeTruthy();

    // All other sections omitted
    expect(screen.queryByTestId('food-odometer-grid')).toBeNull();
    expect(screen.queryByTestId('food-podium-card')).toBeNull();
    expect(screen.queryByTestId('food-highest-rated-section')).toBeNull();
    expect(screen.queryByTestId('food-record-adventurous-day')).toBeNull();
    expect(screen.queryByTestId('food-record-marathon')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Loading & Error States
  // -------------------------------------------------------------------------
  test('renders loading indicator while fetching with no prior data', async () => {
    apiRequestMock.mockReturnValue(new Promise(() => {}));
    const client = createClient();

    renderWithClient(client);

    expect(screen.getByTestId('food-stats-loading')).toBeTruthy();
  });

  test('renders error state on fetch failure and retries on press', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        message: 'Failed to fetch',
        status: 500,
        code: 'stats_unavailable',
      }),
    );
    const client = createClient();

    renderWithClient(client);

    await waitFor(() => {
      expect(screen.getByTestId('food-stats-error')).toBeTruthy();
    });

    // Provide successful response for retry
    apiRequestMock.mockResolvedValueOnce(
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    fireEvent.press(screen.getByTestId('food-stats-error-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('food-odometer-grid')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // R28.7: Shared Cache Read (no extra fetch)
  // -------------------------------------------------------------------------
  test('R28.7: reads from shared cached query with no network fetch', async () => {
    const client = createClient();
    client.setQueryData(
      SHARED_STATS_QUERY_KEY,
      makeStatsResponse({ foodActivity: DEFAULT_FOOD_ACTIVITY }),
    );

    renderWithClient(client);

    expect(screen.getByTestId('food-odometer-grid')).toBeTruthy();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
