import React from 'react';
import { View } from 'react-native';
import {
  NavigationContainer,
  type NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as clientModule from '../../../api/client';
import CollectionScreen from '../CollectionScreen';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const apiRequestMock = clientModule.apiRequest as jest.MockedFunction<
  typeof clientModule.apiRequest
>;

const Stack = createNativeStackNavigator();

function DummyMyPhotosScreen() {
  return <View testID="screen-my-photos" />;
}

describe('CollectionScreen My Photos entry (Task 25.7, Requirements 29.1, 29.2)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/pins') return { pins: [] } as never;
      if (path === '/me/pin-showcase') return { showcase: [] } as never;
      if (path === '/me/food-item-logs') return [] as never;
      if (path === '/me/food-lists/collection') return { listOwned: [], listSaved: [] } as never;
      if (path === '/me/experience-lists/collection') return { listOwned: [], listSaved: [] } as never;
      if (path === '/me/stats?percentile=true') {
        return {
          overall: { totalLoggedRides: 0 },
          parkBreakdown: {},
        } as never;
      }
      if (path === '/photos/config') {
        return { enabled: true, tripEnabled: true, remainingToday: 20 } as never;
      }
      return {} as never;
    });
  });

  function renderCollection(navRef?: any) {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="CollectionHome" component={CollectionScreen} />
            <Stack.Screen
              name="MyPhotos"
              component={DummyMyPhotosScreen}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    );
  }

  it('renders vault-my-photos-entry on all four segments when photos are enabled', async () => {
    renderCollection();

    // 1. Pins segment (default)
    expect(await screen.findByTestId('vault-my-photos-entry')).toBeTruthy();

    // 2. Food segment
    fireEvent.press(screen.getByTestId('vault-seg-food'));
    expect(screen.getByTestId('vault-my-photos-entry')).toBeTruthy();

    // 3. Lists segment
    fireEvent.press(screen.getByTestId('vault-seg-lists'));
    expect(screen.getByTestId('vault-my-photos-entry')).toBeTruthy();

    // 4. Stats segment
    fireEvent.press(screen.getByTestId('vault-seg-stats'));
    expect(screen.getByTestId('vault-my-photos-entry')).toBeTruthy();
  });

  it('omits vault-my-photos-entry when config reports enabled: false', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return { enabled: false } as never;
      }
      return {} as never;
    });

    renderCollection();

    // Wait for the screen to render
    await screen.findByTestId('collection-screen');
    expect(screen.queryByTestId('vault-my-photos-entry')).toBeNull();
  });

  it('omits vault-my-photos-entry when config request fails', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        throw new Error('Config failed');
      }
      return {} as never;
    });

    renderCollection();

    await screen.findByTestId('collection-screen');
    expect(screen.queryByTestId('vault-my-photos-entry')).toBeNull();
  });

  it('omits vault-my-photos-entry while config is loading', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        // Pending promise
        return new Promise(() => {});
      }
      return {} as never;
    });

    renderCollection();

    await screen.findByTestId('collection-screen');
    expect(screen.queryByTestId('vault-my-photos-entry')).toBeNull();
  });

  it('pressing vault-my-photos-entry navigates to MyPhotos route', async () => {
    const navRef = React.createRef<NavigationContainerRef<any>>();
    renderCollection(navRef);

    const entryBtn = await screen.findByTestId('vault-my-photos-entry');
    fireEvent.press(entryBtn);

    await waitFor(() => {
      expect(navRef.current?.getCurrentRoute()?.name).toBe('MyPhotos');
    });
    expect(screen.getByTestId('screen-my-photos')).toBeTruthy();
  });
});
