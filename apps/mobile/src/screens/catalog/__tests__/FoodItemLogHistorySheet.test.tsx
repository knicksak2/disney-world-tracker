// Feature: food-item-logging, Task 7.7 — FoodItemLogHistorySheet interaction tests
//
// Validates: Requirements 4.1, 4.3, 4.4, 5.5, 5.6, 5.7

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemDTO, FoodItemLogHistoryDTO } from '@dwt/shared';

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

import FoodItemLogHistorySheet from '../FoodItemLogHistorySheet';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_ITEM: FoodItemDTO = {
  id: 'item-1',
  experienceId: 'exp-1',
  locationId: null,
  name: 'Dole Whip Float',
  price: '$6.99',
  source: 'menu_sync',
  currentlyOnMenu: true,
};

const MOCK_STALE_ITEM: FoodItemDTO = {
  ...MOCK_ITEM,
  id: 'item-2',
  name: 'Seasonal Citrus Swirl',
  currentlyOnMenu: false,
};

const MOCK_HISTORY: FoodItemLogHistoryDTO = {
  foodItemId: 'item-1',
  repeatCount: 2,
  logs: [
    {
      id: 'log-1',
      userId: 'user-1',
      foodItemId: 'item-1',
      visitedOn: '2026-09-10',
      userTz: 'America/New_York',
      loggedAt: '2026-09-10T14:30:00Z',
      rating: 9,
      note: 'Delicious as always, very refreshing!',
    },
    {
      id: 'log-2',
      userId: 'user-1',
      foodItemId: 'item-1',
      visitedOn: '2026-08-15',
      userTz: 'America/New_York',
      loggedAt: '2026-08-15T12:00:00Z',
      rating: 8,
      note: null,
    },
  ],
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

describe('FoodItemLogHistorySheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders log history entries with date, rating, and note', async () => {
    apiRequestMock.mockResolvedValueOnce(MOCK_HISTORY);

    renderWithClient(
      <FoodItemLogHistorySheet
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Dole Whip Float')).toBeTruthy();
    expect(screen.getByText('Visit History')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('2026-09-10')).toBeTruthy();
      expect(screen.getByText('9/10')).toBeTruthy();
      expect(screen.getByText('Delicious as always, very refreshing!')).toBeTruthy();
      expect(screen.getByText('2026-08-15')).toBeTruthy();
      expect(screen.getByText('8/10')).toBeTruthy();
    });
  });

  it('renders "Not currently on menu" badge when currentlyOnMenu is false', async () => {
    apiRequestMock.mockResolvedValueOnce({
      foodItemId: 'item-2',
      repeatCount: 0,
      logs: [],
    });

    renderWithClient(
      <FoodItemLogHistorySheet
        foodItem={MOCK_STALE_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('food-item-history-not-on-menu')).toBeTruthy();
    expect(screen.getByText('Not currently on menu')).toBeTruthy();
  });

  it('renders empty state when there are no logs', async () => {
    apiRequestMock.mockResolvedValueOnce({
      foodItemId: 'item-1',
      repeatCount: 0,
      logs: [],
    });

    renderWithClient(
      <FoodItemLogHistorySheet
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('food-item-history-empty')).toBeTruthy();
      expect(screen.getByText('No logs yet.')).toBeTruthy();
    });
  });
  it('deletes a log entry, calling DELETE endpoint and invalidating queries', async () => {
    apiRequestMock.mockResolvedValueOnce(MOCK_HISTORY); // for initial GET
    apiRequestMock.mockResolvedValueOnce(undefined); // for DELETE
    apiRequestMock.mockResolvedValueOnce({
      foodItemId: 'item-1',
      repeatCount: 1,
      logs: [MOCK_HISTORY.logs[1]!],
    }); // for refetch after invalidation

    const onLogDeleted = jest.fn();
    const { queryClient } = renderWithClient(
      <FoodItemLogHistorySheet
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
        onLogDeleted={onLogDeleted}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('food-item-delete-log-log-1')).toBeTruthy();
    });

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    fireEvent.press(screen.getByTestId('food-item-delete-log-log-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-items/item-1/logs/log-1',
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['food-item-logs', 'item-1'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-food-items', 'exp-1'],
      });
      expect(onLogDeleted).toHaveBeenCalled();
    });
  });
});
