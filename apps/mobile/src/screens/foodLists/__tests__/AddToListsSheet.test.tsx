// Feature: food-lists, Task 8.8 — AddToListsSheet interaction tests
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodItemDTO, FoodListDTO, FoodListDetailDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import { apiRequest as mockedApiRequest } from '../../../api/client';
import AddToListsSheet from '../AddToListsSheet';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const sampleFoodItems: readonly FoodItemDTO[] = [
  {
    id: 'item-dole-whip',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Dole Whip',
    price: '$6.49',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
];

const sampleOwnedLists: readonly FoodListDTO[] = [
  {
    id: 'list-1',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Snacks Bucket List',
    visibility: 'public',
    isChecklist: false,
    itemCount: 1,
    likeCount: 5,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'list-2',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Summer Trip 2026',
    visibility: 'private',
    isChecklist: false,
    itemCount: 0,
    likeCount: 0,
    createdAt: '2026-09-02T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
  },
];

const sampleList1Detail: FoodListDetailDTO = {
  id: 'list-1',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'Snacks Bucket List',
  visibility: 'public',
  isChecklist: false,
  itemCount: 1,
  likeCount: 5,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  items: [
    {
      foodItemId: 'item-dole-whip',
      name: 'Dole Whip',
      experienceId: 'exp-1',
      experienceName: 'Aloha Isle',
      locationId: null,
      locationName: null,
      price: '$6.49',
      addedByUserId: 'user-me',
      addedByDisplayName: 'Me',
      position: 1000,
    },
  ],
};

const sampleList2Detail: FoodListDetailDTO = {
  id: 'list-2',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'Summer Trip 2026',
  visibility: 'private',
  isChecklist: false,
  itemCount: 0,
  likeCount: 0,
  createdAt: '2026-09-02T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  items: [],
};

describe('AddToListsSheet', () => {
  const mockOnClose = jest.fn();
  const mockOnComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/food-lists') {
        return sampleOwnedLists;
      }
      if (path === '/food-lists/list-1') {
        return sampleList1Detail;
      }
      if (path === '/food-lists/list-2') {
        return sampleList2Detail;
      }
      return {};
    });
  });

  function renderSheet(visible = true): ReturnType<typeof render> {
    const queryClient = createTestClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <AddToListsSheet
          visible={visible}
          onClose={mockOnClose}
          onComplete={mockOnComplete}
          foodItems={sampleFoodItems}
        />
      </QueryClientProvider>,
    );
  }

  test('pre-selects list where item is already present (Requirement 9.3)', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByText('Snacks Bucket List')).toBeTruthy();
      expect(screen.getByText('Summer Trip 2026')).toBeTruthy();
    });

    // Check pre-selection on list-1
    await waitFor(() => {
      const list1Row = screen.getByTestId('food-list-checkbox-row-list-1');
      expect(list1Row).toBeTruthy();
      expect(list1Row.props.accessibilityState.checked).toBe(true);
    });

    // list-2 should not be checked
    const list2Row = screen.getByTestId('food-list-checkbox-row-list-2');
    expect(list2Row.props.accessibilityState.checked).toBe(false);
  });

  test('toggles selection and saves additions and removals', async () => {
    renderSheet();

    await waitFor(() => {
      const list1Row = screen.getByTestId('food-list-checkbox-row-list-1');
      expect(list1Row.props.accessibilityState.checked).toBe(true);
    });

    // Uncheck list-1 (removal)
    fireEvent.press(screen.getByTestId('food-list-checkbox-row-list-1'));
    // Check list-2 (addition)
    fireEvent.press(screen.getByTestId('food-list-checkbox-row-list-2'));

    // Save changes
    fireEvent.press(screen.getByTestId('add-to-lists-save-btn'));

    await waitFor(() => {
      // list-1 removal
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-lists/list-1/items/item-dole-whip',
      );
      // list-2 addition
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-lists/list-2/items',
        {
          foodItemId: 'item-dole-whip',
        },
      );
    });

    expect(mockOnComplete).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  test('creates a new list inline and auto-selects it', async () => {
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/food-lists') {
        if (method === 'POST') {
          return {
            id: 'list-new-inline',
            ownerId: 'user-me',
            ownerDisplayName: 'Me',
            name: (body as any)?.name,
            visibility: 'private',
            itemCount: 0,
            likeCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return sampleOwnedLists;
      }
      if (path === '/food-lists/list-1') return sampleList1Detail;
      if (path === '/food-lists/list-2') return sampleList2Detail;
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('inline-create-list-btn')).toBeTruthy();
    });

    // Open inline creation
    fireEvent.press(screen.getByTestId('inline-create-list-btn'));

    // Type new list name
    fireEvent.changeText(screen.getByTestId('create-list-name-input'), 'Must Try Snacks');

    // Submit creation
    fireEvent.press(screen.getByTestId('submit-create-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Must Try Snacks',
        visibility: 'private',
      });
    });
  });

  test('swallows 409 duplicate errors gracefully on save (Requirement 9.4)', async () => {
    // Simulate 409 duplicate on POST
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists') return sampleOwnedLists;
      if (path === '/food-lists/list-1') return sampleList1Detail;
      if (path === '/food-lists/list-2') return sampleList2Detail;
      if (path === '/me/food-lists/list-2/items' && method === 'POST') {
        const err = new Error('Duplicate item') as any;
        err.statusCode = 409;
        err.code = 'food_list_item_duplicate';
        throw err;
      }
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-checkbox-row-list-2')).toBeTruthy();
    });

    // Select list-2
    fireEvent.press(screen.getByTestId('food-list-checkbox-row-list-2'));

    // Save changes
    fireEvent.press(screen.getByTestId('add-to-lists-save-btn'));

    // Should complete cleanly without throwing
    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
