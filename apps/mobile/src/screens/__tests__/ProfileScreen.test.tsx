/**
 * Tests for trimmed ProfileScreen identity block (Requirements 7.3, 7.4).
 *
 * Validates:
 *   - Renders avatar placeholder / preset and display name
 *   - Tapping "Edit display name" opens inline editor
 *   - Validates display name and persists via PATCH /me/profile
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
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

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

const Stack = createNativeStackNavigator();

describe('ProfileScreen — Identity Block (Requirements 7.3, 7.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
  });

  function setupApi(displayName = 'Mickey'): void {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'u1', email: 'u@x.test' },
          profile: { displayName, avatarPreset: null },
        } as never;
      }
      if (path === '/users/u1/profile') {
        return {
          userId: 'u1',
          displayName,
          avatarPreset: null,
        } as never;
      }
      if (path === '/me/profile') {
        return {
          userId: 'u1',
          displayName: 'Mickey Mouse',
          avatarPreset: null,
        } as never;
      }
      return {} as never;
    });
  }

  it('renders user display name and avatar placeholder', async () => {
    setupApi('Donald');

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileMain" component={ProfileScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const nameText = await screen.findByTestId('profile-display-name');
    expect(nameText).toHaveTextContent('Donald');
    expect(screen.getByTestId('profile-avatar-placeholder')).toBeTruthy();
  });

  it('edits and saves display name via PATCH /me/profile', async () => {
    setupApi('Mickey');

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileMain" component={ProfileScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const editBtn = await screen.findByTestId('edit-display-name-button');
    fireEvent.press(editBtn);

    const input = screen.getByTestId('edit-display-name-input');
    fireEvent.changeText(input, 'Mickey Mouse');

    const saveBtn = screen.getByTestId('save-display-name-button');
    fireEvent.press(saveBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', '/me/profile', {
        displayName: 'Mickey Mouse',
      });
    });
  });
});
