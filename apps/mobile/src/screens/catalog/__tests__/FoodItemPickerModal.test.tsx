// Feature: food-item-logging, Task 7.7 — FoodItemPickerModal interaction tests
//
// Validates: Requirements 1.9, 2.1, 2.2, 5.1, 5.2, 5.5, 5.6, 5.7, 6.5

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemDTO, MenuDTO } from '@dwt/shared';

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
function itemsEnvelope(
  items: readonly FoodItemDTO[],
  menus?: readonly MenuDTO[],
): { items: readonly FoodItemDTO[]; menus?: readonly MenuDTO[] } {
  return { items, ...(menus ? { menus } : {}) };
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

  describe('addToLists mode interactions and Done button behavior', () => {
    it('automatically creates custom item and confirms when Done button is pressed with active search', async () => {
      const newItem: FoodItemDTO = {
        id: 'item-custom-99',
        experienceId: 'exp-1',
        locationId: null,
        name: 'Dole Whip Float',
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

      const onConfirmSelection = jest.fn();

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
          onConfirmSelection={onConfirmSelection}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      // Type custom item name into search input
      fireEvent.changeText(screen.getByTestId('food-item-search-input'), 'Dole Whip Float');

      // The Done button should reflect 'Add & Done' and NOT be disabled
      const doneBtn = screen.getByTestId('food-item-picker-done-btn');
      expect(screen.getByText('Add & Done')).toBeTruthy();

      // Press Done button directly
      fireEvent.press(doneBtn);

      await waitFor(() => {
        expect(apiRequestMock).toHaveBeenCalledWith('POST', '/experiences/exp-1/food-items', {
          name: 'Dole Whip Float',
        });
        expect(onConfirmSelection).toHaveBeenCalledWith([newItem]);
      });
    });

    it('automatically resolves and confirms existing item when Done is pressed with exact search match', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      const onConfirmSelection = jest.fn();

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
          onConfirmSelection={onConfirmSelection}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      // Type existing item name into search input
      fireEvent.changeText(screen.getByTestId('food-item-search-input'), 'mickey pretzel');

      const doneBtn = screen.getByTestId('food-item-picker-done-btn');
      fireEvent.press(doneBtn);

      await waitFor(() => {
        expect(onConfirmSelection).toHaveBeenCalledWith([MOCK_ITEMS[1]]);
      });
    });

    it('displays "Already on list" badge and prevents re-selection for existing items', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      const onConfirmSelection = jest.fn();

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          existingItemIds={['item-2']}
          onClose={jest.fn()}
          onConfirmSelection={onConfirmSelection}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-item-already-on-list-item-2')).toBeTruthy();
      });

      // Pressing the already-in-list item does not select it
      fireEvent.press(screen.getByTestId('food-item-row-item-2'));

      // Done button should still show Done (0)
      expect(screen.getByText('Done (0)')).toBeTruthy();

      // Pressing a non-existing item selects it
      fireEvent.press(screen.getByTestId('food-item-row-item-1'));
      expect(screen.getByText('Done (1)')).toBeTruthy();
    });

    it('displays loading state and disables Done button when isSubmittingSelection is true', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          isSubmittingSelection={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-item-picker-done-btn')).toBeTruthy();
      });

      // Done button should not show plain text, should be busy
      expect(screen.queryByText('Done (0)')).toBeNull();
    });

    it('displays submission error message when creating custom item fails', async () => {
      apiRequestMock.mockImplementation((method, path) => {
        if (method === 'GET' && path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        if (method === 'POST' && path === '/experiences/exp-1/food-items') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByTestId('food-item-search-input'), 'Unknown Unique Snack');
      fireEvent.press(screen.getByTestId('food-item-picker-add-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('food-item-submission-error')).toBeTruthy();
      });
    });

    it('submits search text on keyboard submitEditing', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      const searchInput = screen.getByTestId('food-item-search-input');
      fireEvent.changeText(searchInput, 'mickey pretzel');
      fireEvent(searchInput, 'submitEditing');

      // Mickey Pretzel should now be selected
      expect(screen.getByText('Done (1)')).toBeTruthy();
    });

    it('does not fire individual log queries in addToLists mode to prevent rate limit exhaustion', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      // Verify that no individual dish log queries were sent
      const logCalls = apiRequestMock.mock.calls.filter(
        ([_m, path]) => typeof path === 'string' && path.includes('/logs'),
      );
      expect(logCalls).toHaveLength(0);
    });
  });

  describe('Menu tabs and grouping (R5.8, R5.9, R5.10)', () => {
    const MOCK_MULTI_MENUS: readonly MenuDTO[] = [
      {
        menuType: 'Lunch & Dinner',
        groups: [
          {
            name: 'Entrées',
            items: [{ name: 'Angus Cheeseburger', price: '$13.99' }],
          },
          {
            name: 'Sides',
            items: [{ name: 'French Fries', price: '$4.49' }],
          },
        ],
      },
      {
        menuType: 'Lunch & Dinner Allergy-Friendly',
        groups: [
          {
            name: 'Allergy Entrées',
            items: [
              {
                name: 'Angus Cheeseburger - Gluten/Wheat Allergy-Friendly',
                price: '$13.99',
              },
            ],
          },
        ],
      },
    ];

    const MOCK_RESTAURANT_ITEMS: readonly FoodItemDTO[] = [
      {
        id: 'dish-1',
        experienceId: 'exp-1',
        locationId: null,
        name: 'Angus Cheeseburger',
        price: '$13.99',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
      {
        id: 'dish-2',
        experienceId: 'exp-1',
        locationId: null,
        name: 'French Fries',
        price: '$4.49',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
      {
        id: 'dish-3',
        experienceId: 'exp-1',
        locationId: null,
        name: 'Angus Cheeseburger - Gluten/Wheat Allergy-Friendly',
        price: '$13.99',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
    ];

    it('does not render menu tabs when menus are absent or only 1 menu is available', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_ITEMS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      });

      expect(screen.queryByTestId('food-item-menu-tabs')).toBeNull();
    });

    it('renders menu tabs when multiple menus exist and defaults to primary menu with group headers', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_RESTAURANT_ITEMS, MOCK_MULTI_MENUS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-item-menu-tabs')).toBeTruthy();
      });

      // Tabs: All, Lunch & Dinner, Lunch & Dinner Allergy-Friendly
      expect(screen.getByTestId('food-item-menu-tab-All')).toBeTruthy();
      expect(screen.getByTestId('food-item-menu-tab-Lunch & Dinner')).toBeTruthy();
      expect(screen.getByTestId('food-item-menu-tab-Lunch & Dinner Allergy-Friendly')).toBeTruthy();

      // Defaults to primary menu: 'Lunch & Dinner'
      expect(screen.getByTestId('food-item-group-Entrées')).toBeTruthy();
      expect(screen.getByTestId('food-item-group-Sides')).toBeTruthy();
      expect(screen.getByText('Angus Cheeseburger')).toBeTruthy();
      expect(screen.getByText('French Fries')).toBeTruthy();

      // Allergy item is not in Lunch & Dinner tab
      expect(
        screen.queryByText('Angus Cheeseburger - Gluten/Wheat Allergy-Friendly'),
      ).toBeNull();
    });

    it('switches menu tabs when tab pill is pressed and renders appropriate items and group headers', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_RESTAURANT_ITEMS, MOCK_MULTI_MENUS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('food-item-menu-tab-Lunch & Dinner Allergy-Friendly')).toBeTruthy();
      });

      // Switch to allergy tab
      fireEvent.press(screen.getByTestId('food-item-menu-tab-Lunch & Dinner Allergy-Friendly'));

      await waitFor(() => {
        expect(screen.getByTestId('food-item-group-Allergy Entrées')).toBeTruthy();
        expect(
          screen.getByText('Angus Cheeseburger - Gluten/Wheat Allergy-Friendly'),
        ).toBeTruthy();
      });
      expect(screen.queryByText('French Fries')).toBeNull();

      // Switch to All tab
      fireEvent.press(screen.getByTestId('food-item-menu-tab-All'));

      await waitFor(() => {
        expect(screen.getByText('Angus Cheeseburger')).toBeTruthy();
        expect(screen.getByText('French Fries')).toBeTruthy();
        expect(
          screen.getByText('Angus Cheeseburger - Gluten/Wheat Allergy-Friendly'),
        ).toBeTruthy();
      });
    });

    it('filters within active tab on search and offers cross-menu switch when query matches another menu', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_RESTAURANT_ITEMS, MOCK_MULTI_MENUS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Angus Cheeseburger')).toBeTruthy();
      });

      // Search for 'Gluten' while active on 'Lunch & Dinner'
      const searchInput = screen.getByTestId('food-item-search-input');
      fireEvent.changeText(searchInput, 'Gluten');

      // Should show empty message for the active tab and cross-menu search button
      await waitFor(() => {
        expect(screen.getByTestId('food-item-picker-tab-empty')).toBeTruthy();
        expect(screen.getByTestId('food-item-switch-to-all-btn')).toBeTruthy();
      });
      expect(screen.getByText('Search in All dishes (1 match)')).toBeTruthy();

      // Press the switch button
      fireEvent.press(screen.getByTestId('food-item-switch-to-all-btn'));

      // Tab should switch to All and display the matching dish
      await waitFor(() => {
        expect(
          screen.getByText('Angus Cheeseburger - Gluten/Wheat Allergy-Friendly'),
        ).toBeTruthy();
      });
    });

    it('persists selected items across tab switches in addToLists mode', async () => {
      apiRequestMock.mockImplementation((_method, path) => {
        if (path === '/experiences/exp-1/food-items') {
          return Promise.resolve(itemsEnvelope(MOCK_RESTAURANT_ITEMS, MOCK_MULTI_MENUS));
        }
        return Promise.resolve({ repeatCount: 0, logs: [] });
      });

      renderWithClient(
        <FoodItemPickerModal
          experienceId="exp-1"
          mode="addToLists"
          visible={true}
          onClose={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Angus Cheeseburger')).toBeTruthy();
      });

      // Select item on Lunch & Dinner
      fireEvent.press(screen.getByTestId('food-item-row-dish-1'));
      expect(screen.getByText('Done (1)')).toBeTruthy();

      // Switch to allergy tab
      fireEvent.press(screen.getByTestId('food-item-menu-tab-Lunch & Dinner Allergy-Friendly'));

      await waitFor(() => {
        expect(
          screen.getByText('Angus Cheeseburger - Gluten/Wheat Allergy-Friendly'),
        ).toBeTruthy();
      });

      // Select allergy item
      fireEvent.press(screen.getByTestId('food-item-row-dish-3'));
      expect(screen.getByText('Done (2)')).toBeTruthy();

      // Switch back to Lunch & Dinner tab
      fireEvent.press(screen.getByTestId('food-item-menu-tab-Lunch & Dinner'));
      await waitFor(() => {
        expect(screen.getByText('Angus Cheeseburger')).toBeTruthy();
      });

      // Selection count is still preserved
      expect(screen.getByText('Done (2)')).toBeTruthy();
    });
  });
});
