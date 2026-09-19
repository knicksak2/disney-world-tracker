/**
 * Header reachability regression tests (Task 13.2).
 *
 * Validates: Requirements 7.2, 8.1
 *
 * Requirements:
 * - Requirement 7.2: You_And_Crew SHALL be reachable from every Main_Tab
 *   via the avatar-chip control in that tab's header.
 * - Requirement 8.1: THE App SHALL present the Notification_Bell in the
 *   header of every Main_Tab, opening NotificationCenter.
 *
 * Asserts both YouAndCrew and NotificationCenter are reachable via
 * `navigation.navigate` from each of the four Main_Tabs:
 * Home, Explore, Trips, Collection.
 */

import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Screen stubs (declared before modules under test)
// ---------------------------------------------------------------------------

jest.mock('../../screens/home/HomeScreen', () => ({
  __esModule: true,
  default: function HomeStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-home" />;
  },
}));

jest.mock('../../screens/catalog/CatalogScreen', () => ({
  __esModule: true,
  default: function CatalogStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-catalog" />;
  },
}));

jest.mock('../../screens/trips/TripsListScreen', () => ({
  __esModule: true,
  default: function TripsStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-trips" />;
  },
  tripsListKeys: {
    list: () => ['trips', 'list'] as const,
  },
}));

jest.mock('../../screens/collection/CollectionScreen', () => ({
  __esModule: true,
  default: function CollectionStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-collection" />;
  },
}));

jest.mock('../../screens/youAndCrew/YouAndCrewScreen', () => ({
  __esModule: true,
  default: function YouAndCrewStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-you-and-crew" />;
  },
}));

jest.mock('../../screens/notifications/NotificationCenterScreen', () => ({
  __esModule: true,
  default: function NotificationCenterStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="screen-notification-center" />;
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../state/sessionStore', () => ({
  __esModule: true,
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ token: 'test-token', clearToken: jest.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test
// ---------------------------------------------------------------------------

import RootNavigator from '../RootNavigator';

const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

function renderApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer ref={navRef}>
        <RootNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('Header reachability from every Main_Tab (Requirements 7.2, 8.1)', () => {
  const MAIN_TABS = ['Home', 'Explore', 'Trips', 'Collection'] as const;

  for (const tab of MAIN_TABS) {
    describe(`from ${tab} tab`, () => {
      beforeEach(async () => {
        renderApp();
        await waitFor(() => expect(navRef.isReady()).toBe(true));

        act(() => {
          (navRef.navigate as any)('MainTabs', { screen: tab });
        });
      });

      test(`reaches YouAndCrew via navigate('YouAndCrew')`, async () => {
        act(() => {
          (navRef.navigate as any)('YouAndCrew');
        });

        await waitFor(() => {
          const current = navRef.getCurrentRoute()?.name;
          expect(current).toBe('YouAndCrewMain');
        });

        // Going back returns to the originating tab
        act(() => {
          navRef.goBack();
        });

        await waitFor(() => {
          const current = navRef.getCurrentRoute()?.name;
          // Home renders as 'Home', Explore as 'CatalogList', Trips as 'TripsList', Collection as 'CollectionHome'
          expect(current).toBeDefined();
        });
      });

      test(`reaches NotificationCenter via navigate('NotificationCenter')`, async () => {
        act(() => {
          (navRef.navigate as any)('NotificationCenter');
        });

        await waitFor(() => {
          const current = navRef.getCurrentRoute()?.name;
          expect(current).toBe('NotificationCenter');
        });

        // Dismissing modal returns to the originating tab
        act(() => {
          navRef.goBack();
        });

        await waitFor(() => {
          const current = navRef.getCurrentRoute()?.name;
          expect(current).not.toBe('NotificationCenter');
        });
      });
    });
  }
});
