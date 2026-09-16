// Feature: food-lists, Task 8.4, 8.11 — MyFoodListsScreen component and interaction tests
import React from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodListDTO } from '@dwt/shared';

import { theme } from '../../../theme/theme';

jest.setTimeout(15000);

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
const mockCanGoBack = jest.fn(() => true);
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: mockCanGoBack,
    }),
  };
});

import { apiRequest as mockedApiRequest } from '../../../api/client';
import MyFoodListsScreen from '../MyFoodListsScreen';

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
        <MyFoodListsScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

const sampleOwnedLists: readonly FoodListDTO[] = [
  {
    id: 'list-1',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Best Snacks in EPCOT',
    visibility: 'public',
    itemCount: 4,
    likeCount: 12,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  {
    id: 'list-2',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Secret Drinks',
    visibility: 'private',
    itemCount: 2,
    likeCount: 0,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  },
];

const sampleSavedLists = [
  {
    available: true as const,
    id: 'list-saved-1',
    ownerId: 'user-alice',
    ownerDisplayName: 'Alice',
    name: "Alice's Favorites",
    visibility: 'public' as const,
    itemCount: 5,
    likeCount: 42,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    available: false as const,
    foodListId: 'list-saved-2',
  },
];

describe('MyFoodListsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/food-lists/collection') {
        return {
          owned: sampleOwnedLists,
          saved: sampleSavedLists,
        };
      }
      return {};
    });
  });

  test('renders owned food lists on the default tab', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
      expect(screen.getByText('Secret Drinks')).toBeTruthy();
    });

    // Verify item counts
    expect(screen.getByText('4 items')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  test('tapping an owned list card navigates to FoodListDetail', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Open food list Best Snacks in EPCOT'));
    expect(mockNavigate).toHaveBeenCalledWith('FoodListDetail', {
      foodListId: 'list-1',
    });
  });

  test('switches to Saved tab and handles available: false degraded rows (Task 8.11, Requirement 7a)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Switch to Saved tab
    fireEvent.press(screen.getByTestId('my-food-lists-tab-saved'));

    await waitFor(() => {
      expect(screen.getByText("Alice's Favorites")).toBeTruthy();
      // Requirement 7a: degraded non-interactive "No longer available" row
      expect(screen.getByText('No longer available')).toBeTruthy();
    });

    // Tapping available saved list navigates
    fireEvent.press(screen.getByTestId('saved-food-list-card-list-saved-1'));
    expect(mockNavigate).toHaveBeenCalledWith('FoodListDetail', {
      foodListId: 'list-saved-1',
    });

    // Verify degraded row has no navigation pressable
    expect(screen.queryByTestId('saved-food-list-card-list-saved-2')).toBeNull();
    expect(screen.getByTestId('saved-food-list-unavailable-list-saved-2')).toBeTruthy();

    // Verify saved list card has proper internal padding
    const innerCard = screen.getByTestId('saved-food-list-card-inner-list-saved-1');
    expect(StyleSheet.flatten(innerCard.props.children.props.style).padding).toBe(theme.spacing.md);
  });

  test('creates a new private food list through the modal (sends visibility: "private")', async () => {
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/food-lists' && method === 'POST') {
        return {
          id: 'list-new-1',
          ownerId: 'user-me',
          ownerDisplayName: 'Me',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility,
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      if (path === '/me/food-lists/collection') {
        return { owned: sampleOwnedLists, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Open create modal
    fireEvent.press(screen.getByTestId('my-food-lists-create-btn'));
    expect(screen.getByText('Create Food List')).toBeTruthy();

    // Enter list name
    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Dole Whip Tour');

    // Toggle visibility to private
    fireEvent.press(screen.getByTestId('new-food-list-visibility-private'));

    // Submit
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Dole Whip Tour',
        visibility: 'private',
      });
    });
  });

  test('creates a new public food list through the modal and displays it in owned tab (Task 13.3, Requirement 1a)', async () => {
    const owned = [...sampleOwnedLists];
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/food-lists' && method === 'POST') {
        const newList: FoodListDTO = {
          id: 'list-pub-1',
          ownerId: 'user-me',
          ownerDisplayName: 'Me',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility ?? 'private',
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        owned.unshift(newList);
        return newList;
      }
      if (path === '/me/food-lists/collection') {
        return { owned, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Open create modal
    fireEvent.press(screen.getByTestId('my-food-lists-create-btn'));
    expect(screen.getByText('Create Food List')).toBeTruthy();

    // Enter list name
    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Magic Kingdom Sweets');

    // Select Public visibility
    fireEvent.press(screen.getByTestId('new-food-list-visibility-public'));

    // Submit
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Magic Kingdom Sweets',
        visibility: 'public',
      });
    });

    // Verify the new public list appears in the owned tab
    await waitFor(() => {
      expect(screen.getByText('Magic Kingdom Sweets')).toBeTruthy();
    });
  });

  test('surfaces visible error on create failure and leaves modal open with name intact (Task 13.3, Requirement 1a)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists' && method === 'POST') {
        throw new Error('Network error creating list');
      }
      if (path === '/me/food-lists/collection') {
        return { owned: sampleOwnedLists, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Open create modal
    fireEvent.press(screen.getByTestId('my-food-lists-create-btn'));

    // Enter list name
    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Failed List');

    // Submit
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    // Verify visible error surfaces
    await waitFor(() => {
      expect(screen.getByTestId('create-food-list-error')).toBeTruthy();
      expect(screen.getByText('Network error creating list')).toBeTruthy();
    });

    // Verify modal is still open and input value is intact
    expect(screen.getByTestId('create-food-list-modal')).toBeTruthy();
    const input = screen.getByTestId('new-food-list-name-input');
    expect(input.props.value).toBe('Failed List');
  });

  test('renames a food list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists/collection') {
        return { owned: sampleOwnedLists, saved: sampleSavedLists };
      }
      if (path === '/me/food-lists/list-1' && method === 'PATCH') {
        return { ...sampleOwnedLists[0], name: 'Ultimate Snacks' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Press rename button on list-1
    fireEvent.press(screen.getByTestId('my-food-lists-rename-btn-list-1'));
    expect(screen.getByText('Rename List')).toBeTruthy();

    // Type new name
    fireEvent.changeText(screen.getByTestId('rename-food-list-input'), 'Ultimate Snacks');

    // Submit rename
    fireEvent.press(screen.getByTestId('submit-rename-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', '/me/food-lists/list-1', {
        name: 'Ultimate Snacks',
      });
    });
  });

  test('toggles visibility between public and private', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // List 1 is public, toggle it to private
    fireEvent.press(screen.getByTestId('my-food-lists-visibility-btn-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', '/me/food-lists/list-1', {
        visibility: 'private',
      });
    });
  });

  test('deletes a food list', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Snacks in EPCOT')).toBeTruthy();
    });

    // Trigger delete
    fireEvent.press(screen.getByTestId('my-food-lists-delete-btn-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/me/food-lists/list-1');
    });
  });

  test('navigates to Discover screen from header action', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('my-food-lists-discover-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-food-lists-discover-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('FoodListDiscovery');
  });

  test('renders an accessible back control in the header and activating it invokes navigation.goBack() when history exists (Requirement 12.4, Property 15)', async () => {
    mockCanGoBack.mockReturnValue(true);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
    });

    const backButton = screen.getByRole('button', { name: 'Go back' });
    fireEvent.press(backButton);

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('falls back to navigation.navigate("MainTabs") when activating back control without navigation history (Requirement 12.4, Property 15)', async () => {
    mockCanGoBack.mockReturnValue(false);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
    });

    const backButton = screen.getByRole('button', { name: 'Go back' });
    fireEvent.press(backButton);

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs');
  });
});
