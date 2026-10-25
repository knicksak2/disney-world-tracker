import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import * as clientModule from '../../api/client';
import CollectionStack from '../CollectionStack';
import { MainTabsNavigator } from '../RootNavigator';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const apiRequestMock = clientModule.apiRequest as jest.MockedFunction<
  typeof clientModule.apiRequest
>;

describe('CollectionStack MyPhotos route & MainTabs integrity (Task 25.7, Requirement 29.1, 29.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/photos/all') {
        return { items: [], nextCursor: null };
      }
      return {};
    });
  });

  it('renders MyPhotosScreen for the MyPhotos route in CollectionStack', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer
          initialState={{
            routes: [{ name: 'MyPhotos' }],
          }}
        >
          <CollectionStack />
        </NavigationContainer>
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('my-photos-screen')).toBeTruthy();
    expect(screen.getByText('My Photos')).toBeTruthy();
  });

  it('MainTabs still has no extra tab; MyPhotos is only in the Vault stack', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    // Render MainTabsNavigator inside NavigationContainer
    const { getByTestId, queryByText } = render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <MainTabsNavigator />
        </NavigationContainer>
      </QueryClientProvider>
    );

    // MainTabs root view is present
    expect(getByTestId('main-tabs-root')).toBeTruthy();
    // No tab named "My Photos" or "Photos" exists on the bottom tab bar
    expect(queryByText('My Photos')).toBeNull();
    expect(queryByText('Photos')).toBeNull();
  });
});

