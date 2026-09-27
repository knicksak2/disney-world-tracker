// Feature: food-item-logging, Task 10.8 — MyFoodHistoryScreen component and interaction tests
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, Property 12

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      navigate: jest.fn(),
    }),
  };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import MyFoodHistoryScreen from '../MyFoodHistoryScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_LOGS: readonly FoodItemLogWithContextDTO[] = [
  {
    id: 'log-1',
    userId: 'user-1',
    foodItemId: 'item-1',
    foodItemName: 'Dole Whip Float',
    restaurantName: 'Aloha Isle',
    locationName: null,
    currentlyOnMenu: true,
    visitedOn: '2026-09-10',
    userTz: 'America/New_York',
    loggedAt: '2026-09-10T14:30:00Z',
    rating: 9,
    note: 'Delicious and refreshing pineapple float!',
  },
  {
    id: 'log-2',
    userId: 'user-1',
    foodItemId: 'item-2',
    foodItemName: 'Cheshire Cat Tail',
    restaurantName: 'Cheshire Café',
    locationName: null,
    currentlyOnMenu: true,
    visitedOn: '2026-09-08',
    userTz: 'America/New_York',
    loggedAt: '2026-09-08T10:00:00Z',
    rating: 7,
    note: 'Warm chocolate pastry',
  },
  {
    id: 'log-3',
    userId: 'user-1',
    foodItemId: 'item-3',
    foodItemName: 'Citrus Swirl',
    restaurantName: 'Sunshine Tree Terrace',
    locationName: null,
    currentlyOnMenu: false, // Not currently on menu test
    visitedOn: '2026-08-15',
    userTz: 'America/New_York',
    loggedAt: '2026-08-15T12:00:00Z',
    rating: 10,
    note: 'Orange swirl classic',
  },
  {
    id: 'log-4',
    userId: 'user-1',
    foodItemId: 'item-4',
    foodItemName: 'Spring Roll',
    restaurantName: null,
    locationName: 'Spring Roll Cart',
    currentlyOnMenu: true,
    visitedOn: '2026-07-20',
    userTz: 'America/New_York',
    loggedAt: '2026-07-20T16:00:00Z',
    rating: null, // No rating test
    note: null,
  },
];

function renderWithClient(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MyFoodHistoryScreen />
    </QueryClientProvider>,
  );
}

describe('MyFoodHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R8.1-R8.5: renders full food history with dish name, place, date, rating, note, and stale badge', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_LOGS]);

    renderWithClient();

    // Verify loading indicator disappears
    await waitFor(() => {
      expect(screen.queryByTestId('food-history-loading')).toBeNull();
    });

    // Check all dishes rendered
    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getAllByText('Aloha Isle').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2026-09-10')).toBeTruthy();
    expect(screen.getByText('9/10')).toBeTruthy();
    expect(screen.getByText('Delicious and refreshing pineapple float!')).toBeTruthy();

    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.getAllByText('Cheshire Café').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('Citrus Swirl')).toBeTruthy();
    expect(screen.getAllByText('Sunshine Tree Terrace').length).toBeGreaterThanOrEqual(1);
    // Stale item badge
    expect(screen.getByTestId('food-history-not-on-menu-log-3')).toBeTruthy();

    expect(screen.getByText('Spring Roll')).toBeTruthy();
    expect(screen.getAllByText('Spring Roll Cart').length).toBeGreaterThanOrEqual(1);
  });

  test('R8.4: delete action calls DELETE /me/food-items/:foodItemId/logs/:logId and removes row', async () => {
    let currentLogs = [...MOCK_LOGS];
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/food-item-logs') {
        return currentLogs;
      }
      if (
        method === 'DELETE' &&
        typeof path === 'string' &&
        path.startsWith('/me/food-items/item-1/logs/log-1')
      ) {
        currentLogs = currentLogs.filter((l) => l.id !== 'log-1');
        return undefined;
      }
      return undefined;
    });

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    });

    const deleteBtn = screen.getByTestId('food-history-delete-log-1');
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/me/food-items/item-1/logs/log-1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Dole Whip Float')).toBeNull();
    });
    // Other dishes still exist
    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
  });

  test('R8.7: sort control re-orders rows (Most Recent, Oldest First, Highest Rated, Lowest Rated)', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    });

    // Default: Most Recent (2026-09-10 first)
    const cardsInitial = screen.getAllByTestId(/^food-history-card-/);
    expect(cardsInitial[0]!.props.testID).toBe('food-history-card-log-1');

    // Tap "Oldest First"
    fireEvent.press(screen.getByTestId('sort-chip-oldest'));
    const cardsOldest = screen.getAllByTestId(/^food-history-card-/);
    // Oldest visit date is log-4 (2026-07-20)
    expect(cardsOldest[0]!.props.testID).toBe('food-history-card-log-4');

    // Tap "Highest Rated First"
    fireEvent.press(screen.getByTestId('sort-chip-ratingDesc'));
    const cardsHighest = screen.getAllByTestId(/^food-history-card-/);
    // Highest rating is log-3 (rating 10)
    expect(cardsHighest[0]!.props.testID).toBe('food-history-card-log-3');
    // Null rating (log-4) must be last
    expect(cardsHighest[cardsHighest.length - 1]!.props.testID).toBe('food-history-card-log-4');

    // Tap "Lowest Rated First"
    fireEvent.press(screen.getByTestId('sort-chip-ratingAsc'));
    const cardsLowest = screen.getAllByTestId(/^food-history-card-/);
    // Lowest rated rated item is log-2 (rating 7)
    expect(cardsLowest[0]!.props.testID).toBe('food-history-card-log-2');
    // Null rating (log-4) still sorts last
    expect(cardsLowest[cardsLowest.length - 1]!.props.testID).toBe('food-history-card-log-4');
  });

  test('R8.8: restaurant filter chips narrow displayed rows by selected place(s)', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    });

    // Filter by "Aloha Isle"
    fireEvent.press(screen.getByTestId('restaurant-filter-Aloha Isle'));

    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.queryByText('Cheshire Cat Tail')).toBeNull();
    expect(screen.queryByText('Citrus Swirl')).toBeNull();

    // Select "Cheshire Café" in addition
    fireEvent.press(screen.getByTestId('restaurant-filter-Cheshire Café'));

    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.queryByText('Citrus Swirl')).toBeNull();

    // Tap "All Places" to clear filter
    fireEvent.press(screen.getByTestId('restaurant-filter-all'));

    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.getByText('Citrus Swirl')).toBeTruthy();
    expect(screen.getByText('Spring Roll')).toBeTruthy();
  });

  test('R8.9: search input matches dish name, restaurant name, or location name', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    });

    const searchInput = screen.getByTestId('food-history-search-input');

    // Search by dish name
    fireEvent.changeText(searchInput, 'whip');
    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.queryByText('Cheshire Cat Tail')).toBeNull();

    // Search by restaurant name
    fireEvent.changeText(searchInput, 'cheshire');
    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.queryByText('Dole Whip Float')).toBeNull();

    // Search by location name
    fireEvent.changeText(searchInput, 'cart');
    expect(screen.getByText('Spring Roll')).toBeTruthy();
    expect(screen.queryByText('Dole Whip Float')).toBeNull();

    // Clear search
    fireEvent.press(screen.getByTestId('food-history-clear-search'));
    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
  });

  test('Property 12: filter, search, and sort compose without clearing each other', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    });

    // 1. Filter to Aloha Isle & Sunshine Tree Terrace
    fireEvent.press(screen.getByTestId('restaurant-filter-Aloha Isle'));
    fireEvent.press(screen.getByTestId('restaurant-filter-Sunshine Tree Terrace'));
    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getByText('Citrus Swirl')).toBeTruthy();
    expect(screen.queryByText('Cheshire Cat Tail')).toBeNull();

    // 2. Search for "swirl" — should narrow within the filtered set
    const searchInput = screen.getByTestId('food-history-search-input');
    fireEvent.changeText(searchInput, 'swirl');
    expect(screen.getByText('Citrus Swirl')).toBeTruthy();
    expect(screen.queryByText('Dole Whip Float')).toBeNull();

    // 3. Change sort to Oldest First — search and filter must remain active!
    fireEvent.press(screen.getByTestId('sort-chip-oldest'));
    expect(screen.getByText('Citrus Swirl')).toBeTruthy();
    expect(screen.queryByText('Dole Whip Float')).toBeNull();
    expect(screen.queryByText('Cheshire Cat Tail')).toBeNull();

    // 4. Clear search only — now both Aloha Isle and Sunshine Tree Terrace appear, in oldest first order
    fireEvent.press(screen.getByTestId('food-history-clear-search'));
    const cards = screen.getAllByTestId(/^food-history-card-/);
    expect(cards).toHaveLength(2);
    // Citrus Swirl (2026-08-15) is older than Dole Whip Float (2026-09-10)
    expect(cards[0]!.props.testID).toBe('food-history-card-log-3');
    expect(cards[1]!.props.testID).toBe('food-history-card-log-1');
  });

  test('R8.2: empty list renders empty state gracefully', async () => {
    apiRequestMock.mockResolvedValueOnce([]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-history-empty')).toBeTruthy();
    });

    expect(screen.getByText('No food logs yet')).toBeTruthy();
  });

  test('R8.11: tapping "+ Add rating" on an unrated log opens prompt and submits rating via PATCH', async () => {
    apiRequestMock.mockResolvedValue([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-history-add-rating-log-4')).toBeTruthy();
      expect(screen.getByText('+ Add rating')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-history-add-rating-log-4'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
      expect(screen.getAllByText('Spring Roll').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-8'));
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-items/item-4/logs/log-4',
        { rating: 8 },
      );
    });
  });

  test('R8.11: tapping existing rating badge opens prompt with initial rating and submits updated rating via PATCH', async () => {
    apiRequestMock.mockResolvedValue([...MOCK_LOGS]);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-history-rating-log-1')).toBeTruthy();
      expect(screen.getByText('9/10')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-history-rating-log-1'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
      expect(screen.getByText('Update rating (1–10)')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-10'));
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-items/item-1/logs/log-1',
        { rating: 10 },
      );
    });
  });
});
