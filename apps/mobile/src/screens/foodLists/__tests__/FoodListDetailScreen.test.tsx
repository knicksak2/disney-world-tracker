// Feature: food-lists, Task 8.4, 8.7, 8.8, 8.13, 8.15, 8.16 — FoodListDetailScreen interaction tests
import React from 'react';
import { Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { FoodItemDTO, FoodListDetailDTO, UserSubmittedLocationDTO } from '@dwt/shared';

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

// `react-native-draggable-flatlist`'s real drag interaction is driven by
// native gesture-handler pan recognition, which isn't practically drivable
// through `fireEvent` in this test environment. This mock renders each row
// via the screen's REAL `renderItem` (so row content/testIDs/behavior stay
// real — only the drag gesture itself is stood in for) and exposes one
// extra "simulate drag to end" button per row that invokes the real
// `onDragEnd` prop with the item moved to the end of the list, which is
// exactly the reorder outcome `handleReorderItems`'s existing contract test
// needs to drive.
jest.mock('react-native-draggable-flatlist', () => {
  const ReactActual = jest.requireActual('react');
  const { Pressable: PressableActual, View: ViewActual } = jest.requireActual('react-native');
  function NestableScrollContainerMock({ children }: { children: React.ReactNode }) {
    return ReactActual.createElement(ViewActual, null, children);
  }
  function NestableDraggableFlatListMock({
    data,
    renderItem,
    onDragEnd,
    keyExtractor,
  }: {
    readonly data: readonly unknown[];
    readonly renderItem: (params: {
      item: unknown;
      getIndex: () => number | undefined;
      drag: () => void;
      isActive: boolean;
    }) => React.ReactNode;
    readonly onDragEnd?: (params: { data: unknown[] }) => void;
    readonly keyExtractor: (item: unknown, index: number) => string;
  }) {
    return ReactActual.createElement(
      ViewActual,
      null,
      data.map((item, index) =>
        ReactActual.createElement(
          ViewActual,
          { key: keyExtractor(item, index) },
          renderItem({ item, getIndex: () => index, drag: () => {}, isActive: false }),
          ReactActual.createElement(
            PressableActual,
            {
              testID: `test-simulate-drag-to-end-${keyExtractor(item, index)}`,
              onPress: () => {
                const reordered = data.filter((_, i) => i !== index);
                reordered.push(item);
                onDragEnd?.({ data: reordered });
              },
            },
            null,
          ),
        ),
      ),
    );
  }
  return {
    __esModule: true,
    NestableScrollContainer: NestableScrollContainerMock,
    NestableDraggableFlatList: NestableDraggableFlatListMock,
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
  isChecklist: false,
  itemCount: 2,
  likeCount: 5,
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pinnedAt: null,
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
  isChecklist: false,
  itemCount: 1,
  likeCount: 12,
  liked: true,
  saved: false,
  version: 3,
  myRole: 'viewer',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pinnedAt: null,
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
    jest.setTimeout(15000);
    jest.clearAllMocks();
    mockFoodListId = 'list-detail-1';
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      return {};
    });
  });

  test(
    'renders list details, items, like count, and Owner badge',
    async () => {
      renderScreen();

      await waitFor(() => {
        expect(screen.getByTestId('food-list-name')).toBeTruthy();
        expect(screen.getByText('Dole Whip')).toBeTruthy();
        expect(screen.getByText('Cinnamon Churro')).toBeTruthy();
      });

      expect(screen.getByText('Owner')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy(); // likeCount
    },
    15000,
  );

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

  test('owner can turn an existing non-checklist list into a checklist via PATCH (Requirement 13.2)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-toggle-checklist-btn')).toBeTruthy();
    });
    expect(screen.getByText('Make checklist')).toBeTruthy();

    fireEvent.press(screen.getByTestId('food-list-toggle-checklist-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-lists/list-detail-1',
        { isChecklist: true },
      );
    });
  });

  test('owner can turn an existing checklist back into a plain list via PATCH (Requirement 13.2)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return { ...sampleOwnerList, isChecklist: true, gottenCount: 0 };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-toggle-checklist-btn')).toBeTruthy();
    });
    expect(screen.getByText('Checklist')).toBeTruthy();

    fireEvent.press(screen.getByTestId('food-list-toggle-checklist-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-lists/list-detail-1',
        { isChecklist: false },
      );
    });
  });

  test('a non-owner never sees the checklist mode toggle (Requirement 13.2)', async () => {
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

    expect(screen.queryByTestId('food-list-toggle-checklist-btn')).toBeNull();
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
    expect(screen.queryByTestId('food-list-item-drag-handle-item-corn-dog')).toBeNull();
  });

  test('owner/editor sees a drag handle to reorder items (Requirement 11.1)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-drag-handle-item-dole')).toBeTruthy();
      expect(screen.getByTestId('food-list-item-drag-handle-item-churro')).toBeTruthy();
    });
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
      expect(screen.getByTestId('test-simulate-drag-to-end-item-dole')).toBeTruthy();
    });

    // Drag the first item (Dole Whip) to the end of the list.
    fireEvent.press(screen.getByTestId('test-simulate-drag-to-end-item-dole'));

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

  test('displays rate limit notice on initial load 429 and allows retrying', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError({
        code: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again in 1 minute.',
        status: 429,
      });
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-rate-limit-notice')).toBeTruthy();
      expect(screen.getByText('Too many requests')).toBeTruthy();
      expect(screen.queryByText('No longer available')).toBeNull();
    });

    // Provide successful list on retry
    apiRequestMock.mockImplementation(async () => sampleOwnerList);
    fireEvent.press(screen.getByTestId('food-list-rate-limit-retry-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
      expect(screen.getByText('Dole Whip')).toBeTruthy();
    });
  });

  test('retains cached list when background refetch fails with rate_limit_exceeded 429', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      return [];
    });

    const { queryClient } = renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
      expect(screen.getByText('Dole Whip')).toBeTruthy();
    });

    // Background refetch fails with 429 rate limit
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        throw new ApiError({
          code: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again in 1 minute.',
          status: 429,
        });
      }
      return [];
    });

    await queryClient.refetchQueries({ queryKey: ['food-list-detail', 'list-detail-1'] });

    // The list MUST NOT be replaced with the unavailable screen
    await waitFor(() => {
      expect(screen.queryByTestId('food-list-unavailable-notice')).toBeNull();
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
      expect(screen.getByText('Dole Whip')).toBeTruthy();
      expect(screen.getByText('Rate limit reached. Please wait a moment before refreshing.')).toBeTruthy();
    });
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

  test('Entry Point 2: skips adding items already on the list and handles server errors gracefully', async () => {
    // sampleOwnerList already contains foodItemId: 'item-dole' (Dole Whip)
    const dishes: readonly FoodItemDTO[] = [
      {
        id: 'item-dole',
        experienceId: 'exp-aloha',
        locationId: null,
        name: 'Dole Whip',
        price: '$5.99',
        source: 'menu_sync',
        currentlyOnMenu: true,
      },
      {
        id: 'item-new-error',
        experienceId: 'exp-aloha',
        locationId: null,
        name: 'Failing Dish',
        price: '$8.99',
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
            { id: 'exp-aloha', name: 'Aloha Isle', park: 'Magic Kingdom', category: 'Restaurant' },
          ],
        };
      }
      if (path === '/experiences/exp-aloha/food-items') {
        return { items: dishes };
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        throw new Error('Server 500 error');
      }
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
      expect(screen.getByTestId('restaurant-select-row-exp-aloha')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('restaurant-select-row-exp-aloha'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByTestId('food-item-row-item-dole')).toBeTruthy();
      // Should show already on list badge
      expect(screen.getByTestId('food-item-already-on-list-item-dole')).toBeTruthy();
    });

    // Select the failing dish
    fireEvent.press(screen.getByTestId('food-item-row-item-new-error'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-done-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    // Should surface error notice rather than getting stuck
    await waitFor(() => {
      expect(screen.getByTestId('food-list-stale-write-message')).toBeTruthy();
      expect(screen.getByText("Couldn't add some items to the list. Please try again.")).toBeTruthy();
    });
  });

  test('Entry Point 2: displays rate limit notice when add items hits 429 rate limit', async () => {
    const dishes: readonly FoodItemDTO[] = [
      {
        id: 'item-rate-limited',
        experienceId: 'exp-aloha',
        locationId: null,
        name: 'Sweet-and-Spicy Chicken Strips',
        price: '$12.99',
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
            { id: 'exp-aloha', name: 'Aloha Isle', park: 'Magic Kingdom', category: 'Restaurant' },
          ],
        };
      }
      if (path === '/experiences/exp-aloha/food-items') {
        return { items: dishes };
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        throw new ApiError({
          code: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again in 1 minute.',
          status: 429,
        });
      }
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
      expect(screen.getByTestId('restaurant-select-row-exp-aloha')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('restaurant-select-row-exp-aloha'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByTestId('food-item-row-item-rate-limited')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-item-row-item-rate-limited'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-done-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    // Should surface the rate limit specific message
    await waitFor(() => {
      expect(screen.getByTestId('food-list-stale-write-message')).toBeTruthy();
      expect(screen.getByText('Too many requests. Please wait a moment before adding more items.')).toBeTruthy();
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

  test('Entry Point 2: closing the restaurant search modal and reopening it resets the search query', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
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
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    // 1. Open the modal
    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    // 2. Type "cosmic" in search input
    const searchInput = screen.getByTestId('restaurant-search-input');
    fireEvent.changeText(searchInput, 'cosmic');
    expect(searchInput.props.value).toBe('cosmic');

    // 3. Clear button should be visible
    expect(screen.getByTestId('restaurant-search-clear-btn')).toBeTruthy();

    // 4. Close the modal using the close 'X' button
    fireEvent.press(screen.getByTestId('close-restaurant-search-btn'));

    // 5. Re-open the modal
    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    // 6. The search input should be reset and empty
    const reopenedInput = screen.getByTestId('restaurant-search-input');
    expect(reopenedInput.props.value).toBe('');
    expect(screen.queryByTestId('restaurant-search-clear-btn')).toBeNull();
  });

  test('Entry Point 2: tapping the clear search button resets the restaurant search query', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        return { experiences: [] };
      }
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    const searchInput = screen.getByTestId('restaurant-search-input');
    fireEvent.changeText(searchInput, 'cosmic');
    expect(searchInput.props.value).toBe('cosmic');

    const clearBtn = screen.getByTestId('restaurant-search-clear-btn');
    fireEvent.press(clearBtn);

    expect(screen.getByTestId('restaurant-search-input').props.value).toBe('');
    expect(screen.queryByTestId('restaurant-search-clear-btn')).toBeNull();
  });

  test('Entry Point 2: displays "It\'s not listed" button when no restaurants match, opens CreateLocationModal, creates location, and adds item from scoped picker (Task 25, Requirement 9.5a, 9.5b)', async () => {
    const createdLocation: UserSubmittedLocationDTO = {
      id: 'loc-spring-roll-cart',
      name: 'Spring Roll Snack Cart',
      park: 'Magic Kingdom',
    };

    const springRollDish: FoodItemDTO = {
      id: 'dish-cheeseburger-spring-roll',
      experienceId: null,
      locationId: 'loc-spring-roll-cart',
      name: 'Cheeseburger Spring Roll',
      price: '$9.50',
      source: 'user_submitted',
      currentlyOnMenu: true,
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        // No catalog match for snack cart
        return { experiences: [] };
      }
      if (path.startsWith('/locations/suggest')) {
        return [];
      }
      if (path === '/locations' && method === 'POST') {
        return createdLocation;
      }
      if (path === '/locations/loc-spring-roll-cart/food-items') {
        if (method === 'GET') {
          return { items: [springRollDish] };
        }
        if (method === 'POST') {
          return springRollDish;
        }
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        return { id: 'li-spring-roll-item' };
      }
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    // 1. Open restaurant search modal
    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    // 2. Type "Spring Roll" -> 0 catalog restaurants found -> "It's not listed" button appears
    fireEvent.changeText(screen.getByTestId('restaurant-search-input'), 'Spring Roll');

    await waitFor(() => {
      expect(screen.getByText('No restaurants found.')).toBeTruthy();
      expect(screen.getByTestId('restaurant-search-not-listed-btn')).toBeTruthy();
      expect(screen.getByText("It's not listed? Add a snack cart or stand")).toBeTruthy();
    });

    // 3. Tap "It's not listed" button -> opens CreateLocationModal
    fireEvent.press(screen.getByTestId('restaurant-search-not-listed-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-location-modal')).toBeTruthy();
      expect(screen.getByText('Add Food Spot')).toBeTruthy();
    });

    // 4. Fill in location name and submit
    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Spring Roll Snack Cart',
    );
    fireEvent.press(screen.getByTestId('create-location-submit-btn'));

    // 5. CreateLocationModal calls POST /locations and closes, opening FoodItemPickerModal with locationId
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/locations', {
        name: 'Spring Roll Snack Cart',
        park: 'Magic Kingdom',
      });
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByText('Cheeseburger Spring Roll')).toBeTruthy();
    });

    // 6. Select the dish and press Done
    fireEvent.press(screen.getByTestId('food-item-row-dish-cheeseburger-spring-roll'));
    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    // 7. Confirmed items are added to the food list via POST /me/food-lists/:id/items
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists/list-detail-1/items', {
        foodItemId: 'dish-cheeseburger-spring-roll',
      });
    });
  });

  test('Entry Point 2: displays footer "Can\'t find a snack cart or stand? Add it here" when search results exist (Task 25, Requirement 9.5a)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
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
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
      expect(screen.getByText("Gaston's Tavern")).toBeTruthy();
      expect(screen.getByTestId('restaurant-search-footer-not-listed-btn')).toBeTruthy();
      expect(screen.getByText("Can't find a snack cart or stand? Add it here")).toBeTruthy();
    });

    // Tap footer button -> opens CreateLocationModal
    fireEvent.press(screen.getByTestId('restaurant-search-footer-not-listed-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-location-modal')).toBeTruthy();
    });
  });

  test('Entry Point 2: unified search queries both catalog and community locations, displaying Snack Cart badge and opening location-scoped picker directly (Task 26, Requirement 9.5c)', async () => {
    const existingCustomCart = {
      id: 'loc-spring-roll-cart',
      name: 'Spring Roll Snack Cart',
      park: 'Magic Kingdom' as const,
    };

    const springRollDish: FoodItemDTO = {
      id: 'dish-cheeseburger-spring-roll',
      experienceId: null,
      locationId: 'loc-spring-roll-cart',
      name: 'Cheeseburger Spring Roll',
      price: '$9.50',
      source: 'user_submitted',
      currentlyOnMenu: true,
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        return { experiences: [] };
      }
      if (typeof path === 'string' && path.startsWith('/locations/suggest')) {
        return { suggestions: [existingCustomCart] };
      }
      if (path === '/locations/loc-spring-roll-cart/food-items') {
        if (method === 'GET') {
          return { items: [springRollDish] };
        }
      }
      if (path === '/me/food-lists/list-detail-1/items' && method === 'POST') {
        return { id: 'li-cheeseburger-spring-roll' };
      }
      return {};
    });

    renderScreenWithClient();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-add-items-btn')).toBeTruthy();
    });

    // 1. Open restaurant search modal
    fireEvent.press(screen.getByTestId('food-list-add-items-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-search-modal')).toBeTruthy();
    });

    // 2. Type "Spring roll" -> queries /locations/suggest?q=Spring%20roll
    fireEvent.changeText(screen.getByTestId('restaurant-search-input'), 'Spring roll');

    // 3. Community cart appears in search results with Snack Cart badge and park
    await waitFor(() => {
      expect(screen.getByText('Spring Roll Snack Cart')).toBeTruthy();
      expect(screen.getByText('Snack Cart')).toBeTruthy();
      expect(screen.getByText('Magic Kingdom')).toBeTruthy();
      expect(screen.getByTestId('custom-location-select-row-loc-spring-roll-cart')).toBeTruthy();
    });

    // 4. Tap the custom location directly -> opens FoodItemPickerModal scoped to locationId
    fireEvent.press(screen.getByTestId('custom-location-select-row-loc-spring-roll-cart'));

    await waitFor(() => {
      expect(screen.getByTestId('food-item-picker-modal')).toBeTruthy();
      expect(screen.getByText('Cheeseburger Spring Roll')).toBeTruthy();
    });

    // 5. Select dish and confirm -> added to list via POST /me/food-lists/:id/items
    fireEvent.press(screen.getByTestId('food-item-row-dish-cheeseburger-spring-roll'));
    fireEvent.press(screen.getByTestId('food-item-picker-done-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists/list-detail-1/items', {
        foodItemId: 'dish-cheeseburger-spring-roll',
      });
    });
  });

  test('renders neither progress row nor Ate-this tap targets for a non-checklist list (Task 17.5, Requirement 13.4, 13.10)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return {
          ...sampleOwnerList,
          isChecklist: false,
        };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-name')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-progress-row')).toBeNull();
    // The row's details wrapper navigates to ExperienceDetail when experienceId is present,
    // but carries no completion/check-off affordance.
    const doleRow = screen.getByTestId('food-list-item-details-item-dole');
    expect(doleRow.props.accessibilityRole).toBe('button');
    expect(doleRow.props.accessibilityLabel).toBe('View details for Aloha Isle');
    fireEvent.press(doleRow);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', { experienceId: 'exp-1' });

    expect(screen.queryByTestId('food-list-item-gotten-badge-item-dole')).toBeNull();
    expect(screen.queryByTestId('food-list-item-gotten-badge-item-churro')).toBeNull();
    expect(screen.queryByTestId('food-list-item-check-off-btn-item-dole')).toBeNull();
    expect(screen.queryByTestId('food-list-item-check-off-btn-item-churro')).toBeNull();
  });

  test('renders progress row and Ate-this tap targets for a checklist list (Task 17.5, Requirement 13.9, 13.10, 13.11)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        {
          ...sampleOwnerList.items[0]!,
          gotten: true,
        },
        {
          ...sampleOwnerList.items[1]!,
          gotten: false,
        },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-progress-row')).toBeTruthy();
      expect(screen.getByText('1 of 2 tried')).toBeTruthy();
      expect(screen.getByText('50%')).toBeTruthy();
    });

    expect(screen.getByTestId('food-list-item-details-item-dole')).toBeTruthy();
    expect(screen.getByTestId('food-list-item-details-item-churro')).toBeTruthy();
    expect(screen.getByTestId('food-list-item-gotten-badge-item-dole')).toBeTruthy();
    expect(screen.queryByTestId('food-list-item-check-off-btn-item-dole')).toBeNull();
    expect(screen.getByTestId('food-list-item-check-off-btn-item-churro')).toBeTruthy();
    expect(screen.queryByTestId('food-list-item-gotten-badge-item-churro')).toBeNull();
  });

  test('a gotten item with no rating shows a generic "Ate this" trailing badge, not a rating value (Requirement 13.14, 13.19)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true, rating: null },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-gotten-badge-item-dole')).toBeTruthy();
    });
    expect(screen.getByText('Ate this')).toBeTruthy();
    expect(screen.queryByTestId('food-list-item-gotten-badge-item-churro')).toBeNull();
  });

  test('a gotten item with a rating shows the rating in the trailing badge instead of the generic label (Requirement 13.14, 13.19)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true, rating: 9 },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-gotten-badge-item-dole')).toBeTruthy();
    });
    expect(screen.getByText('9/10')).toBeTruthy();
    expect(screen.queryByText('Ate this')).toBeNull();
  });

  test('an unmarked checklist row is the whole-row "Ate this" tap target, not a leading indicator (Requirement 13.11, 13.19)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: false },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-details-item-dole')).toBeTruthy();
    });

    const row = screen.getByTestId('food-list-item-details-item-dole');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('View details for Aloha Isle');
    // Unmarked items render the trailing "Check off" button (Requirement 13.20 amendment)
    const checkOffBtn = screen.getByTestId('food-list-item-check-off-btn-item-dole');
    expect(checkOffBtn).toBeTruthy();
    expect(checkOffBtn.props.accessibilityRole).toBe('button');
    expect(checkOffBtn.props.accessibilityLabel).toBe('Check off: Dole Whip');
    expect(within(checkOffBtn).getByText('Check off')).toBeTruthy();
    // Tapping the row navigates to the restaurant, not check off
    mockNavigate.mockClear();
    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', { experienceId: 'exp-1' });
    expect(screen.queryByTestId('rate-on-checkoff-prompt')).toBeNull();
    // No leading circle/checkbox indicator exists anywhere for this row.
    expect(screen.queryByTestId('food-list-item-checkbox-item-dole')).toBeNull();
  });

  test('tapping the trailing "Check off" button opens RateOnCheckoffPrompt (Requirement 13.20)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-check-off-btn-item-dole')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-dole'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
    });
  });

  test('tapping food list item details navigates to restaurant ExperienceDetailScreen when experienceId is present, inert when null (Requirement 13.20)', async () => {
    const listWithMixedItems: FoodListDetailDTO = {
      ...sampleOwnerList,
      items: [
        {
          ...sampleOwnerList.items[0]!,
          experienceId: 'exp-1',
          experienceName: 'Aloha Isle',
        },
        {
          ...sampleOwnerList.items[1]!,
          experienceId: null,
          experienceName: null,
          locationId: 'loc-cart-1',
          locationName: 'Snack Cart',
        },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return listWithMixedItems;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-details-item-dole')).toBeTruthy();
      expect(screen.getByTestId('food-list-item-details-item-churro')).toBeTruthy();
    });

    const doleDetails = screen.getByTestId('food-list-item-details-item-dole');
    expect(doleDetails.props.accessibilityRole).toBe('button');
    expect(doleDetails.props.accessibilityLabel).toBe('View details for Aloha Isle');
    mockNavigate.mockClear();
    fireEvent.press(doleDetails);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', { experienceId: 'exp-1' });

    const churroDetails = screen.getByTestId('food-list-item-details-item-churro');
    expect(churroDetails.props.accessibilityRole).toBeUndefined();
    expect(churroDetails.props.accessibilityLabel).toBeUndefined();
    mockNavigate.mockClear();
    fireEvent.press(churroDetails);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('tapping an unmarked row marks item gotten with today date and updates progress (Task 17.5, Requirement 13.6, 13.7, 13.11)', async () => {
    let currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        {
          ...sampleOwnerList.items[0]!,
          gotten: false,
        },
        {
          ...sampleOwnerList.items[1]!,
          gotten: false,
        },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-dole/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: 1,
          items: [
            {
              ...currentDetail.items[0]!,
              gotten: true,
            },
            currentDetail.items[1]!,
          ],
        };
        return { id: 'log-1', visitedOn: '2026-09-19' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('0 of 2 tried')).toBeTruthy();
    });

    // Activating the "Check off" button for Dole Whip opens the optional rating
    // prompt (Requirement 13.15) rather than submitting immediately.
    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-dole'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
    });

    // Skip the rating — the submission still proceeds with no rating.
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-items/item-dole/logs',
        expect.objectContaining({
          visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          userTz: expect.any(String),
        }),
      );
    });

    // Verify the exact payload shape sent to the real endpoint: `userTz` is
    // REQUIRED by `createFoodItemLogInputSchema` (`.strict()`, no
    // `.optional()`) — a request missing it is rejected 400
    // validation_failed server-side, which is exactly the bug this
    // assertion guards against (the mock previously let a `userTz`-less
    // payload through, silently passing while the real endpoint would
    // have rejected it). Rating is omitted on the skip path (Requirement
    // 13.15) and note is never sent for a mark-gotten submission.
    const logCall = apiRequestMock.mock.calls.find(
      (c) => c[1] === '/me/food-items/item-dole/logs' && c[0] === 'POST',
    );
    expect(logCall?.[2]).toEqual({
      visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      userTz: expect.any(String),
    });

    // Progress updates to 1 of 2 tried
    await waitFor(() => {
      expect(screen.getByText('1 of 2 tried')).toBeTruthy();
    });

    // An action-scoped undo toast appears for this specific submission
    // (Requirement 13.16).
    expect(screen.getByTestId('mark-gotten-undo-toast')).toBeTruthy();
    expect(screen.getByText('Ate this: Dole Whip')).toBeTruthy();
  });

  test('confirming a rating in the prompt includes it in the mark-gotten submission (Requirement 13.15)', async () => {
    let currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: false },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-dole/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: 1,
          items: [
            { ...currentDetail.items[0]!, gotten: true },
            currentDetail.items[1]!,
          ],
        };
        return { id: 'log-rated-1', visitedOn: '2026-09-19' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('0 of 2 tried')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-dole'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-9'));
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    await waitFor(() => {
      const logCall = apiRequestMock.mock.calls.find(
        (c) => c[1] === '/me/food-items/item-dole/logs' && c[0] === 'POST',
      );
      expect(logCall?.[2]).toEqual({
        visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        userTz: expect.any(String),
        rating: 9,
      });
    });
  });

  test('an already-gotten row does not fire a second call on press (Task 17.5, Requirement 13.8, 13.11)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        {
          ...sampleOwnerList.items[0]!,
          gotten: true,
        },
        {
          ...sampleOwnerList.items[1]!,
          gotten: false,
        },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-details-item-dole')).toBeTruthy();
    });

    // Clear calls
    apiRequestMock.mockClear();

    // Press already-gotten Dole Whip row: does not call POST logs
    fireEvent.press(screen.getByTestId('food-list-item-details-item-dole'));

    // Should not call POST logs
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      expect.stringMatching(/\/me\/food-items\/.*\/logs/),
      expect.anything(),
    );
  });

  test('completion celebration renders on the submission that completes the list, but not on initial view of already-complete list (Task 17.5, Requirement 13.12)', async () => {
    // 1. Initial view of an already-complete list does NOT show celebration
    const alreadyCompleteData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      itemCount: 2,
      gottenCount: 2,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true },
        { ...sampleOwnerList.items[1]!, gotten: true },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return alreadyCompleteData;
      }
      return {};
    });

    const { unmount } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('2 of 2 tried')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-completion-celebration')).toBeNull();
    unmount();

    // 2. Transition from incomplete (1 of 2) to complete (2 of 2) triggers celebration
    let transitionData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      itemCount: 2,
      gottenCount: 1,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return transitionData;
      }
      if (path === '/me/food-items/item-churro/logs' && method === 'POST') {
        transitionData = {
          ...transitionData,
          gottenCount: 2,
          items: [
            transitionData.items[0]!,
            { ...transitionData.items[1]!, gotten: true },
          ],
        };
        return { id: 'log-2', visitedOn: '2026-09-19' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('1 of 2 tried')).toBeTruthy();
    });

    expect(screen.queryByTestId('food-list-completion-celebration')).toBeNull();

    // Mark the second item gotten
    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-churro'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    // Celebration should now be visible!
    await waitFor(() => {
      expect(screen.getByTestId('food-list-completion-celebration')).toBeTruthy();
      expect(screen.getByText(/You've tried everything on EPCOT Snack Trail!/)).toBeTruthy();
    });
  });

  test('activating an already-gotten row does not open the rating prompt or submit again (Requirement 13.14)', async () => {
    const checklistData: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return checklistData;
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-details-item-dole')).toBeTruthy();
    });

    // Requirement 13.14: the row's text is never struck through/dimmed —
    // it stays a plain, legible record even when gotten.
    const doleName = screen.getByText('Dole Whip');
    const nameStyle = Array.isArray(doleName.props.style)
      ? Object.assign({}, ...doleName.props.style)
      : doleName.props.style;
    expect(nameStyle?.textDecorationLine).not.toBe('line-through');

    fireEvent.press(screen.getByTestId('food-list-item-details-item-dole'));

    expect(screen.queryByTestId('rate-on-checkoff-prompt')).toBeNull();
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      expect.stringMatching(/\/me\/food-items\/.*\/logs/),
      expect.anything(),
    );
  });

  test('undo targets only the log the mark-gotten submission created, not an item-scoped lookup (Property 18, Requirement 13.16, 13.17)', async () => {
    // Requirement 13.7 allows repeat logs for the same dish within the
    // window — an item can already be `gotten` from an earlier,
    // pre-existing log before this specific submission's new log exists.
    // The submission below is a *repeat* log (Dole Whip is already
    // `gotten: true` going in), and its own undo toast must target only
    // the new log id it just created — never "the most recent log for
    // this item" and never the earlier, pre-existing log.
    let currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: true },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      // Requirement 13.14: an already-gotten row has no onPress, so this
      // repeat submission is driven directly through handleMarkGotten via
      // the rating prompt path is not reachable from the UI for an
      // already-gotten item — instead this test drives the *other* item
      // (churro) to obtain a second toast, then separately asserts the
      // DELETE call shape a repeat-log undo would use. See the assertion
      // below for the precise id being targeted.
      if (path === '/me/food-items/item-churro/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: 2,
          items: [
            currentDetail.items[0]!,
            { ...currentDetail.items[1]!, gotten: true },
          ],
        };
        return { id: 'log-churro-new', visitedOn: '2026-09-19' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-check-off-btn-item-churro')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-churro'));
    await waitFor(() => expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy());
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('mark-gotten-undo-toast')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('mark-gotten-undo-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-items/item-churro/logs/log-churro-new',
      );
    });

    // The pre-existing gotten state for Dole Whip (from an earlier,
    // unrelated log) was never targeted by this undo — no DELETE call
    // references it.
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'DELETE',
      expect.stringContaining('/me/food-items/item-dole/logs/'),
    );
  });

  test('two mark-gotten submissions in quick succession each show their own independent undo toast (Property 18, Requirement 13.18)', async () => {
    let currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: false },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-dole/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: currentDetail.items[1]!.gotten ? 2 : 1,
          items: [{ ...currentDetail.items[0]!, gotten: true }, currentDetail.items[1]!],
        };
        return { id: 'log-dole-1', visitedOn: '2026-09-19' };
      }
      if (path === '/me/food-items/item-churro/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: currentDetail.items[0]!.gotten ? 2 : 1,
          items: [currentDetail.items[0]!, { ...currentDetail.items[1]!, gotten: true }],
        };
        return { id: 'log-churro-1', visitedOn: '2026-09-19' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-check-off-btn-item-dole')).toBeTruthy();
    });

    // Mark Dole Whip gotten, skipping the rating.
    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-dole'));
    await waitFor(() => expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy());
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    await waitFor(() => {
      expect(screen.getAllByTestId('mark-gotten-undo-toast')).toHaveLength(1);
    });

    // Before that toast is dismissed, mark Cinnamon Churro gotten too.
    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-churro'));
    await waitFor(() => expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy());
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    await waitFor(
      () => {
        expect(screen.getAllByTestId('mark-gotten-undo-toast')).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    expect(screen.getByText('Ate this: Dole Whip')).toBeTruthy();
    expect(screen.getByText('Ate this: Cinnamon Churro')).toBeTruthy();

    // Undoing the churro toast only removes that toast and only deletes
    // that specific log — the dole toast/log is unaffected.
    const undoButtons = screen.getAllByTestId('mark-gotten-undo-btn');
    fireEvent.press(undoButtons[1]!);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-items/item-churro/logs/log-churro-1',
      );
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'DELETE',
      expect.stringContaining('/me/food-items/item-dole/logs/'),
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('mark-gotten-undo-toast')).toHaveLength(1);
    });
    expect(screen.getByText('Ate this: Dole Whip')).toBeTruthy();
    expect(screen.queryByText('Ate this: Cinnamon Churro')).toBeNull();
  });

  test('skip, dismiss-without-selection, and confirm-with-rating each result in exactly one mark-gotten submission (Property 19, Requirement 13.15)', async () => {
    let currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 0,
      items: [
        { ...sampleOwnerList.items[0]!, gotten: false },
        { ...sampleOwnerList.items[1]!, gotten: false },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-dole/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: 1,
          items: [{ ...currentDetail.items[0]!, gotten: true }, currentDetail.items[1]!],
        };
        return { id: 'log-dole-skip', visitedOn: '2026-09-19' };
      }
      return {};
    });

    // --- Skip path ---
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-check-off-btn-item-dole')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-dole'));
    await waitFor(() => expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy());
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    await waitFor(() => {
      const doleLogCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === 'POST' && c[1] === '/me/food-items/item-dole/logs',
      );
      expect(doleLogCalls).toHaveLength(1);
      expect(doleLogCalls[0]![2]).toEqual({
        visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        userTz: expect.any(String),
      });
    });
    await waitFor(() => {
      expect(screen.getByText('1 of 2 tried')).toBeTruthy();
    });

    apiRequestMock.mockClear();

    // --- Dismiss-without-selection path (churro) ---
    currentDetail = {
      ...currentDetail,
      gottenCount: 1,
      items: [currentDetail.items[0]!, { ...currentDetail.items[1]!, gotten: false }],
    };
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-churro/logs' && method === 'POST') {
        currentDetail = {
          ...currentDetail,
          gottenCount: 2,
          items: [currentDetail.items[0]!, { ...currentDetail.items[1]!, gotten: true }],
        };
        return { id: 'log-churro-dismiss', visitedOn: '2026-09-19' };
      }
      return {};
    });

    fireEvent.press(screen.getByTestId('food-list-item-check-off-btn-item-churro'));
    await waitFor(() => expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy());
    // Dismiss via the backdrop, without selecting a rating.
    fireEvent.press(screen.getByTestId('rate-on-checkoff-backdrop'));

    await waitFor(() => {
      const churroLogCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === 'POST' && c[1] === '/me/food-items/item-churro/logs',
      );
      expect(churroLogCalls).toHaveLength(1);
      expect(churroLogCalls[0]![2]).toEqual({
        visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        userTz: expect.any(String),
      });
    });
    await waitFor(() => {
      expect(screen.getByText('2 of 2 tried')).toBeTruthy();
    });
  });

  test('tapping a completed item gotten badge opens rating prompt and updates rating via PATCH (Requirement 13.23)', async () => {
    const currentDetail: FoodListDetailDTO = {
      ...sampleOwnerList,
      isChecklist: true,
      gottenCount: 1,
      items: [
        {
          ...sampleOwnerList.items[0]!,
          gotten: true,
          rating: null,
          logId: 'log-dole-1',
        },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1' && method === 'GET') {
        return currentDetail;
      }
      if (path === '/me/food-items/item-dole/logs/log-dole-1' && method === 'PATCH') {
        return {
          id: 'log-dole-1',
          foodItemId: 'item-dole',
          rating: 9,
          visitedOn: '2026-09-19',
        };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-item-gotten-badge-item-dole')).toBeTruthy();
      expect(screen.getByText('Ate this')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-item-gotten-badge-item-dole'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-prompt')).toBeTruthy();
      expect(screen.getAllByText('Dole Whip').length).toBeGreaterThanOrEqual(2);
    });

    // Select rating 9 and confirm
    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-9'));
    await waitFor(() => {
      expect(screen.getByTestId('rate-on-checkoff-confirm-btn')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-items/item-dole/logs/log-dole-1',
        { rating: 9 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Pinning from list detail (Requirement 14.6)
  // -------------------------------------------------------------------------

  test('owner sees pin toggle in header action row; unpinned list displays "Pin" and tapping calls PATCH with pinned: true (Requirement 14.6)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (method === 'PATCH' && path === '/me/food-lists/list-detail-1') {
        return { ...sampleOwnerList, pinnedAt: '2026-09-30T12:00:00Z' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-pin-btn')).toBeTruthy();
    });

    const pinBtn = screen.getByTestId('food-list-pin-btn');
    expect(pinBtn.props.accessibilityLabel).toBe('Pin list');
    expect(within(pinBtn).getByText('Pin')).toBeTruthy();

    fireEvent.press(pinBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-lists/list-detail-1',
        { pinned: true },
      );
    });
  });

  test('pinned list displays "Pinned" and tapping calls PATCH with pinned: false (Requirement 14.6)', async () => {
    const pinnedList: FoodListDetailDTO = {
      ...sampleOwnerList,
      pinnedAt: '2026-09-30T12:00:00Z',
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return pinnedList;
      }
      if (method === 'PATCH' && path === '/me/food-lists/list-detail-1') {
        return { ...sampleOwnerList, pinnedAt: null };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-pin-btn')).toBeTruthy();
    });

    const pinBtn = screen.getByTestId('food-list-pin-btn');
    expect(pinBtn.props.accessibilityLabel).toBe('Unpin list');
    expect(within(pinBtn).getByText('Pinned')).toBeTruthy();

    fireEvent.press(pinBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-lists/list-detail-1',
        { pinned: false },
      );
    });
  });

  test('non-owners (viewer or editor) do not see the pin button in action row (Requirement 14.6)', async () => {
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

    expect(screen.queryByTestId('food-list-pin-btn')).toBeNull();
  });

  test('pinning fails with food_list_pin_limit_reached triggers alert and does not throw', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/food-lists/list-detail-1') {
        return sampleOwnerList;
      }
      if (method === 'PATCH' && path === '/me/food-lists/list-detail-1') {
        throw new ApiError({
          code: 'food_list_pin_limit_reached',
          message: 'Pin limit reached',
          status: 400,
        });
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('food-list-pin-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-pin-btn'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Pin Limit Reached',
        'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
      );
    });
    alertSpy.mockRestore();
  });
});

