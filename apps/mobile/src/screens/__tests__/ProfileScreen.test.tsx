/**
 * Tests for ProfileScreen food lists entry point (food-lists Requirement 12).
 *
 * Validates:
 *   - Requirement 12.1: "View your food lists" button on ProfileScreen navigates to MyFoodListsScreen
 *   - Requirement 12.2: Button renders and is functional regardless of owned/saved list count
 *   - Requirement 12.3: Only navigates to MyFoodLists (no alternate routes)
 */
import React from 'react';
import { View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import ProfileScreen from '../ProfileScreen';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import type { FoodListCollectionDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

const Stack = createNativeStackNavigator();

function DummyMyFoodListsScreen(): JSX.Element {
  return <View testID="my-food-lists-target" />;
}

describe('ProfileScreen — Food Lists Entry Point (Requirement 12)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
  });

  function setupApi(collection?: FoodListCollectionDTO): void {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'u1', email: 'u@x.test' },
          profile: { displayName: 'Mickey', avatarPreset: null },
        } as never;
      }
      if (path === '/users/u1/profile') {
        return {
          userId: 'u1',
          displayName: 'Mickey',
          avatarPreset: null,
          overallCompletionPercent: 50.0,
        } as never;
      }
      if (path === '/me/pins') {
        return {
          pins: [],
          tierSummary: [],
          totalUnlocked: 0,
          totalPins: 0,
          overallPercent: 0,
        } as never;
      }
      if (path === '/me/food-lists/collection') {
        return (collection ?? { owned: [], saved: [] }) as never;
      }
      return {} as never;
    });
  }

  it('renders "View your food lists" button with testID profile-view-food-lists when user has zero lists (Requirement 12.1, 12.2)', async () => {
    setupApi({ owned: [], saved: [] });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileMain" component={ProfileScreen} />
            <Stack.Screen name="MyFoodLists" component={DummyMyFoodListsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const btn = await screen.findByTestId('profile-view-food-lists');
    expect(btn).toBeTruthy();
    expect(screen.getByText('View your food lists')).toBeTruthy();
    expect(screen.getByText('Food lists')).toBeTruthy();
  });

  it('renders "View your food lists" button identically when user has multiple owned and saved lists (Requirement 12.2)', async () => {
    setupApi({
      owned: [
        {
          id: 'list-1',
          name: 'My Snacks',
          visibility: 'private',
          itemCount: 5,
          ownerDisplayName: 'Mickey',
          ownerId: 'u1',
          likeCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      saved: [
        {
          id: 'list-2',
          name: 'Favorite Drinks',
          visibility: 'public',
          itemCount: 3,
          ownerDisplayName: 'Goofy',
          available: true,
          ownerId: 'u2',
          likeCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileMain" component={ProfileScreen} />
            <Stack.Screen name="MyFoodLists" component={DummyMyFoodListsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const btn = await screen.findByTestId('profile-view-food-lists');
    expect(btn).toBeTruthy();
    expect(screen.getByText('View your food lists')).toBeTruthy();
  });

  it('navigates to MyFoodLists when "View your food lists" is pressed (Requirement 12.1)', async () => {
    setupApi({ owned: [], saved: [] });
    const navRef = createNavigationContainerRef();

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileMain" component={ProfileScreen} />
            <Stack.Screen name="MyFoodLists" component={DummyMyFoodListsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const btn = await screen.findByTestId('profile-view-food-lists');
    fireEvent.press(btn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('MyFoodLists');
    });
    expect(screen.getByTestId('my-food-lists-target')).toBeTruthy();
  });
});
