// Feature: food-item-logging, Task 10.8 — RestaurantFoodLogsSheet component and interaction tests
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, Property 11, Property 12

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

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

import RestaurantFoodLogsSheet from '../RestaurantFoodLogsSheet';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_BE_OUR_GUEST_LOGS: readonly FoodItemLogWithContextDTO[] = [
  {
    id: 'log-bog-1',
    userId: 'user-1',
    foodItemId: 'item-bog-1',
    foodItemName: 'French Onion Soup',
    restaurantName: 'Be Our Guest Restaurant',
    locationName: null,
    currentlyOnMenu: true,
    visitedOn: '2026-09-12',
    userTz: 'America/New_York',
    loggedAt: '2026-09-12T18:00:00Z',
    rating: 8,
    note: 'Gruyere cheese was melted to perfection',
  },
  {
    id: 'log-bog-2',
    userId: 'user-1',
    foodItemId: 'item-bog-2',
    foodItemName: 'The Grey Stuff',
    restaurantName: 'Be Our Guest Restaurant',
    locationName: null,
    currentlyOnMenu: false, // Out of menu item
    visitedOn: '2026-08-10',
    userTz: 'America/New_York',
    loggedAt: '2026-08-10T19:30:00Z',
    rating: 10,
    note: "It's delicious! Don't believe me? Ask the dishes!",
  },
  {
    id: 'log-bog-3',
    userId: 'user-1',
    foodItemId: 'item-bog-3',
    foodItemName: 'Filet Mignon',
    restaurantName: 'Be Our Guest Restaurant',
    locationName: null,
    currentlyOnMenu: true,
    visitedOn: '2026-07-04',
    userTz: 'America/New_York',
    loggedAt: '2026-07-04T17:00:00Z',
    rating: null, // Null rating
    note: null,
  },
];

// Log belonging to an entirely different restaurant to test Property 11 isolation
const MOCK_OTHER_RESTAURANT_LOG: FoodItemLogWithContextDTO = {
  id: 'log-other-1',
  userId: 'user-1',
  foodItemId: 'item-other-1',
  foodItemName: 'Cinderella Slipper Dessert',
  restaurantName: "Cinderella's Royal Table",
  locationName: null,
  currentlyOnMenu: true,
  visitedOn: '2026-09-14',
  userTz: 'America/New_York',
  loggedAt: '2026-09-14T20:00:00Z',
  rating: 9,
  note: 'Chocolate slipper',
};

function renderSheet(props: {
  experienceId?: string | undefined;
  locationId?: string | undefined;
  visible?: boolean;
  onClose?: () => void;
  onLogDeleted?: (() => void) | undefined;
}): ReturnType<typeof render> {
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
      <RestaurantFoodLogsSheet
        experienceId={props.experienceId}
        locationId={props.locationId}
        visible={props.visible ?? true}
        onClose={props.onClose ?? jest.fn()}
        onLogDeleted={props.onLogDeleted}
      />
    </QueryClientProvider>,
  );
}

describe('RestaurantFoodLogsSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R9.1, R9.4, R9.6: renders scoped dishes with restaurant name in header and not-on-menu badge', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_BE_OUR_GUEST_LOGS]);

    renderSheet({ experienceId: 'exp-bog' });

    await waitFor(() => {
      expect(screen.queryByTestId('scoped-food-logs-loading')).toBeNull();
    });

    // Header displays restaurant name once
    expect(screen.getByText('Be Our Guest Restaurant')).toBeTruthy();
    expect(screen.getByText('My Logged Items Here')).toBeTruthy();

    // Dish details
    expect(screen.getByText('French Onion Soup')).toBeTruthy();
    expect(screen.getByText('2026-09-12')).toBeTruthy();
    expect(screen.getByText('8/10')).toBeTruthy();
    expect(screen.getByText('Gruyere cheese was melted to perfection')).toBeTruthy();

    expect(screen.getByText('The Grey Stuff')).toBeTruthy();
    expect(screen.getByText('10/10')).toBeTruthy();
    expect(screen.getByTestId('scoped-food-log-not-on-menu-log-bog-2')).toBeTruthy();

    expect(screen.getByText('Filet Mignon')).toBeTruthy();
  });

  test('Property 11: isolation across restaurants — foreign restaurant log never renders in scoped sheet', async () => {
    // Backend API route returns only the scoped items for exp-bog
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path.includes('/experiences/exp-bog/food-item-logs/mine')) {
        return MOCK_BE_OUR_GUEST_LOGS;
      }
      return [MOCK_OTHER_RESTAURANT_LOG];
    });

    renderSheet({ experienceId: 'exp-bog' });

    await waitFor(() => {
      expect(screen.getByText('French Onion Soup')).toBeTruthy();
    });

    // Foreign restaurant's dish MUST NOT appear
    expect(screen.queryByText('Cinderella Slipper Dessert')).toBeNull();
    expect(screen.queryByText("Cinderella's Royal Table")).toBeNull();
  });

  test('R9.5: delete action calls DELETE /me/food-items/:foodItemId/logs/:logId and removes row', async () => {
    let currentLogs = [...MOCK_BE_OUR_GUEST_LOGS];
    const onLogDeleted = jest.fn();

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && typeof path === 'string' && path.includes('/experiences/exp-bog/')) {
        return currentLogs;
      }
      if (
        method === 'DELETE' &&
        typeof path === 'string' &&
        path.startsWith('/me/food-items/item-bog-1/logs/log-bog-1')
      ) {
        currentLogs = currentLogs.filter((l) => l.id !== 'log-bog-1');
        return undefined;
      }
      return undefined;
    });

    renderSheet({ experienceId: 'exp-bog', onLogDeleted });

    await waitFor(() => {
      expect(screen.getByText('French Onion Soup')).toBeTruthy();
    });

    const deleteBtn = screen.getByTestId('scoped-food-log-delete-log-bog-1');
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-items/item-bog-1/logs/log-bog-1',
      );
    });

    await waitFor(() => {
      expect(screen.queryByText('French Onion Soup')).toBeNull();
    });
    expect(onLogDeleted).toHaveBeenCalled();
  });

  test('R9.7: sort control re-orders scoped rows properly', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_BE_OUR_GUEST_LOGS]);

    renderSheet({ experienceId: 'exp-bog' });

    await waitFor(() => {
      expect(screen.getByText('French Onion Soup')).toBeTruthy();
    });

    // Default: Most Recent (2026-09-12 first)
    const cardsInitial = screen.getAllByTestId(/^scoped-food-log-card-/);
    expect(cardsInitial[0]!.props.testID).toBe('scoped-food-log-card-log-bog-1');

    // Tap "Oldest First"
    fireEvent.press(screen.getByTestId('scoped-sort-chip-oldest'));
    const cardsOldest = screen.getAllByTestId(/^scoped-food-log-card-/);
    // Oldest is Filet Mignon (2026-07-04)
    expect(cardsOldest[0]!.props.testID).toBe('scoped-food-log-card-log-bog-3');

    // Tap "Highest Rated First"
    fireEvent.press(screen.getByTestId('scoped-sort-chip-ratingDesc'));
    const cardsHighest = screen.getAllByTestId(/^scoped-food-log-card-/);
    // Highest is The Grey Stuff (rating 10)
    expect(cardsHighest[0]!.props.testID).toBe('scoped-food-log-card-log-bog-2');
    // Null rating is last
    expect(cardsHighest[cardsHighest.length - 1]!.props.testID).toBe(
      'scoped-food-log-card-log-bog-3',
    );
  });

  test('R9.8: search input matches dish name only', async () => {
    apiRequestMock.mockResolvedValueOnce([...MOCK_BE_OUR_GUEST_LOGS]);

    renderSheet({ experienceId: 'exp-bog' });

    await waitFor(() => {
      expect(screen.getByText('French Onion Soup')).toBeTruthy();
    });

    const searchInput = screen.getByTestId('scoped-food-search-input');

    // Matches dish name
    fireEvent.changeText(searchInput, 'grey');
    expect(screen.getByText('The Grey Stuff')).toBeTruthy();
    expect(screen.queryByText('French Onion Soup')).toBeNull();

    // Clear search
    fireEvent.press(screen.getByTestId('scoped-clear-search'));
    expect(screen.getByText('French Onion Soup')).toBeTruthy();
    expect(screen.getByText('The Grey Stuff')).toBeTruthy();
  });

  test('R9.3: empty list renders empty state gracefully', async () => {
    apiRequestMock.mockResolvedValueOnce([]);

    renderSheet({ experienceId: 'exp-empty' });

    await waitFor(() => {
      expect(screen.getByTestId('scoped-food-logs-empty')).toBeTruthy();
    });

    expect(screen.getByText('No logged items here yet')).toBeTruthy();
  });
});
