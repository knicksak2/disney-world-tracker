// Feature: food-lists, Task 8.4, 8.7, 8.8, 8.13, 8.15, 8.16 — FoodListDetailScreen interaction tests
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodItemDTO, FoodListDetailDTO } from '@dwt/shared';

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

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockFoodListId = 'list-detail-1';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
    }),
    useRoute: () => ({
      params: { foodListId: mockFoodListId },
    }),
  };
});

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import FoodListDetailScreen from '../FoodListDetailScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(): ReturnType<typeof render> {
  const queryClient = createTestClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <FoodListDetailScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/** Like `renderScreen`, but also returns the `QueryClient` so a test can spy on `invalidateQueries`. */
function renderScreenWithClient(): {
  readonly result: ReturnType<typeof render>;
  readonly queryClient: QueryClient;
} {
  const queryClient = createTestClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <FoodListDetailScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
  return { result, queryClient };
}

const sampleOwnerList: FoodListDetailDTO = {
  id: 'list-detail-1',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'EPCOT Snack Trail',
  visibility: 'private',
  itemCount: 2,
  likeCount: 5,
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  items: [
    {
      foodItemId: 'item-dole',
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
    {
      foodItemId: 'item-churro',
      name: 'Cinnamon Churro',
      experienceId: 'exp-2',
      experienceName: 'Pecos Bill',
      locationId: null,
      locationName: null,
      price: '$5.29',
      addedByUserId: 'user-collaborator',
      addedByDisplayName: 'Sam',
      position: 2000,
    },
  ],
};

const sampleSoloContributorList: FoodListDetailDTO = {
  ...sampleOwnerList,
  items: [
    {
      foodItemId: 'item-dole',
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

const sampleViewerList: FoodListDetailDTO = {
  id: 'list-detail-1',
  ownerId: 'user-alice',
  ownerDisplayName: 'Alice',
  name: "Alice's Secret Eats",
  visibility: 'public',
  itemCount: 1,
  likeCount: 12,
  liked: true,
  saved: false,
  version: 3,
  myRole: 'viewer',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  items: [
    {
      foodItemId: 'item-corn-dog',
      name: 'Hand-dipped Corn Dog',
      experienceId: 'exp-3',
      experienceName: 'Sleepy Hollow',
      locationId: null,
      locationName: null,
      price: '$10.99',
      addedByUserId: 'user-alice',
      addedByDisplayName: 'Alice',
      position: 1000,
    },
  ],
};

describe('FoodListDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFoodListId = 'list-detail-1';
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      return {};
    });
  });

  test('renders list details, items, like count, and Owner badge', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
      expect(screen.getByText('Dole Whip')).toBeTruthy();
      expect(screen.getByText('Cinnamon Churro')).toBeTruthy();
    });

    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy(); // likeCount
  });

  test('attribution label is displayed when list has 2+ distinct contributors (Requirement 11.2)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip')).toBeTruthy();
      expect(screen.getByText('Cinnamon Churro')).toBeTruthy();
    });

    // Both contributors are distinct (user-me, user-collaborator)
    expect(screen.getByTestId('food-list-attribution-item-dole')).toBeTruthy();
    expect(screen.getByText('added by Me')).toBeTruthy();
    expect(screen.getByTestId('food-list-attribution-item-churro')).toBeTruthy();
    expect(screen.getByText('added by Sam')).toBeTruthy();
  });

  test('attribution label is hidden when list has only 1 distinct contributor (Requirement 11.2)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleSoloContributorList;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Dole Whip')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-attribution-item-dole')).toBeNull();
  });

  test('toggles like from false to true via POST /food-lists/:id/like', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-like-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-like-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/food-lists/list-detail-1/like');
    });
  });

  test('toggles like from true to false via DELETE /food-lists/:id/like', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleViewerList;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-like-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-like-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/food-lists/list-detail-1/like');
    });
  });

  test('non-owner can save list via POST /food-lists/:id/save', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleViewerList;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-save-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-save-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/food-lists/list-detail-1/save');
    });
  });

  test('owner does not see save button', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-save-btn')).toBeNull();
  });

  test('owner can delete an item from the list', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-delete-item-dole')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-item-delete-item-dole'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-lists/list-detail-1/items/item-dole',
      );
    });
  });

  test('viewer cannot see add items or delete controls (Requirement 11.1)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleViewerList;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-add-items-btn')).toBeNull();
    expect(screen.queryByTestId('food-list-item-delete-item-corn-dog')).toBeNull();
  });

  test('reordering items submits expectedVersion and handles stale write 409 (Task 8.15, Requirement 11.3, Property 5)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (path === '/me/food-lists/list-detail-1/items/order' && method === 'PUT') {
        const error = new ApiError({
          code: 'food_list_stale_write',
          message: 'Conflict',
          status: 409,
        });
        throw error;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-move-down-item-dole')).toBeTruthy();
    });

    // Move first item down
    fireEvent.press(screen.getByTestId('food-list-item-move-down-item-dole'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        '/me/food-lists/list-detail-1/items/order',
        {
          foodItemIds: ['item-churro', 'item-dole'],
          expectedVersion: 1,
        },
      );
    });

    // Verify stale write banner is shown
    await waitFor(() => {
      expect(screen.getByTestId('food-list-stale-write-message')).toBeTruthy();
      expect(screen.getByText('List was updated by another collaborator. Refreshed.')).toBeTruthy();
    });
  });

  test('displays unavailable notice when list fetch fails (Task 8.13, Requirement 10.2)', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new Error('Not found');
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-unavailable-notice')).toBeTruthy();
      expect(screen.getByText('No longer available')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-unavailable-back-btn'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('Entry Point 2: searches restaurants, opens scoped picker, and adds items (Task 8.7, 8.8)', async () => {
    const sampleDishes: readonly FoodItemDTO[] = [
      {
        id: 'item-lefeus-brew',
        experienceId: 'exp-gaston',
        locationId: null,
        name: "Lefou's Brew",
        price: '$6.49',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
    ];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (path.startsWith('/catalog')) {
        return {
          experiences: [
            {
              id: 'exp-gaston',
              name: "Gaston's Tavern",
              park: 'Magic Kingdom',
              category: 'Restaurant',
            },
          ],
        };
      }
      if (path === '/experiences/exp-gaston/food-items') {
        // The real `GET /experiences/:id/food-items` route wraps the list in
        // an `{ items: [...] }` envelope (see `foodItemRoutes`), not a bare
        // array — mirror that real shape here.
        return { items: sampleDishes };
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        return { id: 'li-new-added' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    // Press "Add items"
    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
      expect(screen.getByText("Gaston's Tavern")).toBeTruthy();
    });

    // Select restaurant
    fireEvent.press(screen.getByTestId('restaurant-select-row-exp-gaston'));

    // FoodItemPickerModal should now be open with scoped items
    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByText("Lefou's Brew")).toBeTruthy();
    });

    // Select dish row
    fireEvent.press(screen.getByTestId('food-item-row-item-lefeus-brew'));

    // Press Done button
    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-done-btn')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    // Should call POST /me/food-lists/list-detail-1/items
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists/list-detail-1/items', {
        foodItemId: 'item-lefeus-brew',
      });
    });
  });

  test('Entry Point 2: adding items invalidates the collection cache, not just the list detail cache', async () => {
    // Regression test: `handleConfirmAddItems` only invalidated
    // ['food-list-detail', foodListId], never ['food-lists-collection'] or
    // ['my-owned-food-lists'] — so after adding dishes here, MyFoodListsScreen's
    // "My Lists" card kept showing the stale itemCount (e.g. "0 items") from
    // before the add, since it reads a separate cached query that was never
    // told anything changed. This asserts all three keys are invalidated,
    // mirroring what AddToListsSheet.tsx (Entry Point 1) already does.
    const sampleDishes: readonly FoodItemDTO[] = [
      {
        id: 'item-lefeus-brew',
        experienceId: 'exp-gaston',
        locationId: null,
        name: "Lefou's Brew",
        price: '$6.49',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
    ];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        return {
          experiences: [
            { id: 'exp-gaston', name: "Gaston's Tavern", park: 'Magic Kingdom', category: 'Restaurant' },
          ],
        };
      }
      if (path === '/experiences/exp-gaston/food-items') {
        return { items: sampleDishes };
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        return { id: 'li-new-added' };
      }
      return {};
    });

    const { queryClient } = renderScreenWithClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
      expect(screen.getByText("Gaston's Tavern")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('restaurant-select-row-exp-gaston'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByText("Lefou's Brew")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-item-row-item-lefeus-brew'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-done-btn')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-lists/list-detail-1/items',
        { foodItemId: 'item-lefeus-brew' },
      );
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['food-list-detail', 'list-detail-1'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['food-lists-collection'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-owned-food-lists'] });
    });
  });

  test('Entry Point 2: restaurant search uses the real /catalog contract (category + q, not search/limit)', async () => {
    // Regression test: `GET /catalog` validates its query params with a
    // `.strict()` Zod schema recognizing only `parkId`, `category`/
    // `categories`, `areaType`, `q`, `land`, `worldShowcaseCountry`. The
    // restaurant search here previously sent `search`/`limit`, which are not
    // recognized keys, so every search request was rejected with
    // `400 validation_failed` and silently rendered "No restaurants found"
    // (the query only branched on `isLoading`, not `isError`). This test
    // asserts the actual outgoing request shape, which would have failed
    // against the pre-fix code (it sent `search=`/`limit=`, never `q=`).
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        return { experiences: [] };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('restaurant-search-input'), 'Aloha');

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(/^\/catalog\?.*\bq=Aloha\b/),
      );
    });

    // Never send the unrecognized `search`/`limit` params that caused the
    // original silent failure.
    const catalogCalls = apiRequestMock.mock.calls.filter(
      (call) => typeof call[1] === 'string' && call[1].startsWith('/catalog'),
    );
    for (const call of catalogCalls) {
      expect(call[1]).not.toMatch(/\bsearch=/);
      expect(call[1]).not.toMatch(/\blimit=/);
    }
  });
});
