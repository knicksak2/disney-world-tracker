// Feature: food-item-logging, Task 7.7 — LogFoodItemModal interaction tests
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4, 5.7

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemDTO, FoodItemLogDTO } from '@dwt/shared';

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

import LogFoodItemModal from '../LogFoodItemModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_ITEM: FoodItemDTO = {
  id: 'item-100',
  experienceId: 'exp-100',
  locationId: null,
  name: 'Cheshire Cat Tail',
  price: '$5.79',
  source: 'menu_sync',
  currentlyOnMenu: true,
};

const MOCK_STALE_ITEM: FoodItemDTO = {
  ...MOCK_ITEM,
  id: 'item-200',
  name: 'Discontinued Pastry',
  currentlyOnMenu: false,
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

describe('LogFoodItemModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dish name, visit date field, rating buttons 1-10, and note input', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.getByText('Log Dish Visit')).toBeTruthy();
    expect(screen.getByText('Visit Date')).toBeTruthy();
    expect(screen.getByTestId('log-food-item-note-input')).toBeTruthy();

    // Check all rating buttons 1-10 exist
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByTestId(`rating-btn-${i}`)).toBeTruthy();
    }
  });

  it('renders "Not currently on menu" indicator when item is not on current menu', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_STALE_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('log-food-item-not-on-menu')).toBeTruthy();
    expect(screen.getByText('Not currently on menu')).toBeTruthy();
  });

  it('toggles rating selection and clears rating', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    const btn8 = screen.getByTestId('rating-btn-8');
    fireEvent.press(btn8);

    expect(screen.getByText('Rating (8/10)')).toBeTruthy();
    expect(screen.getByTestId('clear-rating-btn')).toBeTruthy();

    // Tapping clear button clears the rating
    fireEvent.press(screen.getByTestId('clear-rating-btn'));
    expect(screen.getByText('Rating (Optional)')).toBeTruthy();

    // Tapping rating button 7 selects 7, tapping it again deselects
    const btn7 = screen.getByTestId('rating-btn-7');
    fireEvent.press(btn7);
    expect(screen.getByText('Rating (7/10)')).toBeTruthy();
    fireEvent.press(btn7);
    expect(screen.getByText('Rating (Optional)')).toBeTruthy();
  });

  it('submits a food log successfully and invalidates relevant queries', async () => {
    const mockCreatedLog: FoodItemLogDTO = {
      id: 'log-999',
      userId: 'user-1',
      foodItemId: 'item-100',
      visitedOn: '2026-09-14',
      userTz: 'America/New_York',
      loggedAt: '2026-09-14T20:00:00Z',
      rating: 9,
      note: 'Super flaky and warm!',
    };

    apiRequestMock.mockResolvedValueOnce(mockCreatedLog);

    const onClose = jest.fn();
    const onLogged = jest.fn();

    const { queryClient } = renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={onClose}
        onLogged={onLogged}
      />,
    );

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    // Select rating 9
    fireEvent.press(screen.getByTestId('rating-btn-9'));

    // Enter note
    fireEvent.changeText(
      screen.getByTestId('log-food-item-note-input'),
      'Super flaky and warm!',
    );

    // Press submit
    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-items/item-100/logs',
        expect.objectContaining({
          rating: 9,
          note: 'Super flaky and warm!',
        }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['food-item-logs', 'item-100'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-food-items', 'exp-100'],
      });
      expect(onLogged).toHaveBeenCalledWith(mockCreatedLog);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays error when server returns food_log_future_date', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        code: 'food_log_future_date',
        message: 'Visit date cannot be in the future',
        status: 400,
      }),
    );

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('log-food-item-error')).toBeTruthy();
      expect(screen.getByText('Visit date cannot be in the future')).toBeTruthy();
    });
  });
});
