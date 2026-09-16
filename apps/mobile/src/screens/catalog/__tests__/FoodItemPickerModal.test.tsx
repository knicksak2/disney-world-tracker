// Feature: food-item-logging, Task 7.7 — FoodItemPickerModal interaction tests
//
// Validates: Requirements 1.9, 2.1, 2.2, 5.1, 5.2, 5.5, 5.6, 5.7, 6.5

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemDTO } from '@dwt/shared';

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

import FoodItemPickerModal from '../FoodItemPickerModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_ITEMS: readonly FoodItemDTO[] = [
  {
    id: 'item-1',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Churro with Chocolate Sauce',
    price: '$6.50',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'item-2',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Mickey Pretzel',
    price: '$7.75',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'item-3',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Discontinued Cupcake',
    price: '$5.50',
    source: 'user_submitted',
    currentlyOnMenu: false,
  },
];

/**
 * The real `GET /experiences/:id/food-items` and `GET /locations/:id/food-items`
 * routes wrap the list in an `{ items: [...] }` envelope (see
 * `apps/api/src/services/foodLog/routes.ts`), not a bare array. Mocks below
 * must mirror that real shape, since `FoodItemPickerModal` unwraps `.items`
 * from the response.
 */
function itemsEnvelope(items: readonly FoodItemDTO[]): { items: readonly FoodItemDTO[] } {
  return { items };
}

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

describe('FoodItemPickerModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dish list with names, prices, and repeat count', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
      }
      if (path === '/me/food-items/item-1/logs') {
        return Promise.resolve({ foodItemId: 'item-1', repeatCount: 3, logs: [] });
      }
      if (path === '/me/food-items/item-2/logs') {
        return Promise.resolve({ foodItemId: 'item-2', repeatCount: 0, logs: [] });
      }
      if (path === '/me/food-items/item-3/logs') {
        return Promise.resolve({ foodItemId: 'item-3', repeatCount: 1, logs: [] });
      }
      return Promise.resolve([]);
    });

    renderWithClient(
      <FoodItemPickerModal
        experienceId="exp-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Churro with Chocolate Sauce')).toBeTruthy();
      expect(screen.getByText('$6.50')).toBeTruthy();
      expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      expect(screen.getByText('$7.75')).toBeTruthy();
      expect(screen.getByText('Discontinued Cupcake')).toBeTruthy();
      expect(screen.getByTestId('food-item-not-on-menu-item-3')).toBeTruthy();
      expect(screen.getByText('Logged 3x')).toBeTruthy();
    });
  });

  it('supports locationId scope', async () => {
    const mockLocationItems: readonly FoodItemDTO[] = [
      {
        id: 'item-loc-1',
        experienceId: null,
        locationId: 'loc-1',
        name: 'Spring Roll Special',
        price: '$9.50',
        source: 'user_submitted',
        currentlyOnMenu: true,
      },
    ];

    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/locations/loc-1/food-items') {
        return Promise.resolve(itemsEnvelope(mockLocationItems));
      }
      return Promise.resolve({ foodItemId: 'item-loc-1', repeatCount: 0, logs: [] });
    });

    renderWithClient(
      <FoodItemPickerModal
        locationId="loc-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Spring Roll Special')).toBeTruthy();
    });

    // Requirement 9.4: location-scoped affordance renders and opens RestaurantFoodLogsSheet
    const loggedBtn = screen.getByTestId('location-my-logged-items-btn');
    expect(loggedBtn).toBeTruthy();
    fireEvent.press(loggedBtn);

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-food-logs-sheet')).toBeTruthy();
    });
  });

  it('filters items as user types in search input', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path.includes('/food-items')) {
        return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
      }
      return Promise.resolve({ foodItemId: 'item-1', repeatCount: 0, logs: [] });
    });

    renderWithClient(
      <FoodItemPickerModal
        experienceId="exp-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Churro with Chocolate Sauce')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('food-item-search-input'), 'pretzel');

    expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
    expect(screen.queryByText('Churro with Chocolate Sauce')).toBeNull();
  });

  it('shows "Add [name]" row when item does not exist and submits newly created item', async () => {
    const newItem: FoodItemDTO = {
      id: 'item-new-1',
      experienceId: 'exp-1',
      locationId: null,
      name: 'Loaded Buffalo Chicken Tater Tots',
      price: null,
      source: 'user_submitted',
      currentlyOnMenu: true,
    };

    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path === '/experiences/exp-1/food-items') {
        return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
      }
      if (method === 'POST' && path === '/experiences/exp-1/food-items') {
        return Promise.resolve(newItem);
      }
      return Promise.resolve({ repeatCount: 0, logs: [] });
    });

    const onSelectFoodItem = jest.fn();

    renderWithClient(
      <FoodItemPickerModal
        experienceId="exp-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={onSelectFoodItem}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
    });

    fireEvent.changeText(
      screen.getByTestId('food-item-search-input'),
      'Loaded Buffalo Chicken Tater Tots',
    );

    expect(screen.getByTestId('food-item-picker-add-btn')).toBeTruthy();
    expect(screen.getByText('Add "Loaded Buffalo Chicken Tater Tots"')).toBeTruthy();

    fireEvent.press(screen.getByTestId('food-item-picker-add-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/experiences/exp-1/food-items',
        { name: 'Loaded Buffalo Chicken Tater Tots' },
      );
      expect(onSelectFoodItem).toHaveBeenCalledWith(newItem);
    });
  });

  it('collapses to existing item on food_item_duplicate 409 error without showing error', async () => {
    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path === '/experiences/exp-1/food-items') {
        return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
      }
      if (method === 'POST' && path === '/experiences/exp-1/food-items') {
        return Promise.reject(
          new ApiError({
            code: 'food_item_duplicate',
            message: 'A food item with that name already exists',
            status: 409,
            details: { existingId: 'item-1' },
          }),
        );
      }
      return Promise.resolve({ repeatCount: 0, logs: [] });
    });

    const onSelectFoodItem = jest.fn();

    renderWithClient(
      <FoodItemPickerModal
        experienceId="exp-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={onSelectFoodItem}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
    });

    fireEvent.changeText(
      screen.getByTestId('food-item-search-input'),
      'Churro With Chocolate Sauce Extra',
    );

    fireEvent.press(screen.getByTestId('food-item-picker-add-btn'));

    await waitFor(() => {
      // Must collapse to existing item-1
      expect(onSelectFoodItem).toHaveBeenCalledWith(MOCK_ITEMS[0]);
    });
  });

  it('selects existing item when row is pressed', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
      }
      return Promise.resolve({ repeatCount: 0, logs: [] });
    });

    const onSelectFoodItem = jest.fn();

    renderWithClient(
      <FoodItemPickerModal
        experienceId="exp-1"
        visible={true}
        onClose={jest.fn()}
        onSelectFoodItem={onSelectFoodItem}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('food-item-row-item-2')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-item-row-item-2'));

    expect(onSelectFoodItem).toHaveBeenCalledWith(MOCK_ITEMS[1]);
  });
});
