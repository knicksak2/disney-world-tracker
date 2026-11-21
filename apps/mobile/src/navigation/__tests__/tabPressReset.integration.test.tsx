/**
 * Integration tests verifying that tapping any MainTabs bottom tab always
 * lands and stays on that tab's home screen (`CatalogList`, `TripsList`, or
 * `CollectionHome`), even after deep cross-tab navigation into a nested child
 * route (`PinBoard`, `LiveWaits`, `TripDetail`) or tapping an already-focused tab.
 */
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

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

import { handleTabPressToHome } from '../RootNavigator';

type ExploreParams = {
  CatalogList: undefined;
  LiveWaits: { park?: string } | undefined;
};

type TripsParams = {
  TripsList: undefined;
  TripDetail: { tripId: string };
};

type CollectionParams = {
  CollectionHome: undefined;
  PinBoard: undefined;
};

type TabParams = {
  Home: undefined;
  Explore: { screen: keyof ExploreParams; params?: unknown } | undefined;
  Trips: { screen: keyof TripsParams; params?: unknown } | undefined;
  Collection: { screen: keyof CollectionParams; params?: unknown } | undefined;
};

const Tab = createBottomTabNavigator<TabParams>();
const ExploreStackNav = createNativeStackNavigator<ExploreParams>();
const TripsStackNav = createNativeStackNavigator<TripsParams>();
const CollectionStackNav = createNativeStackNavigator<CollectionParams>();

let catalogMountCount = 0;

function makeStubScreen(name: string) {
  return function StubScreen(): JSX.Element {
    return (
      <View testID={`screen-${name}`}>
        <Text>{name}</Text>
      </View>
    );
  };
}

function CatalogListStub(): JSX.Element {
  useEffect(() => {
    catalogMountCount += 1;
  }, []);
  return (
    <View testID="screen-CatalogList">
      <Text>CatalogList</Text>
    </View>
  );
}

const HomeStub = makeStubScreen('Home');
const LiveWaitsStub = makeStubScreen('LiveWaits');
const TripsListStub = makeStubScreen('TripsList');
const TripDetailStub = makeStubScreen('TripDetail');
const CollectionHomeStub = makeStubScreen('CollectionHome');
const PinBoardStub = makeStubScreen('PinBoard');

function ExploreStackHost(): JSX.Element {
  return (
    <ExploreStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ExploreStackNav.Screen name="CatalogList" component={CatalogListStub} />
      <ExploreStackNav.Screen name="LiveWaits" component={LiveWaitsStub} />
    </ExploreStackNav.Navigator>
  );
}

function TripsStackHost(): JSX.Element {
  return (
    <TripsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <TripsStackNav.Screen name="TripsList" component={TripsListStub} />
      <TripsStackNav.Screen name="TripDetail" component={TripDetailStub} />
    </TripsStackNav.Navigator>
  );
}

function CollectionStackHost(): JSX.Element {
  return (
    <CollectionStackNav.Navigator screenOptions={{ headerShown: false }}>
      <CollectionStackNav.Screen name="CollectionHome" component={CollectionHomeStub} />
      <CollectionStackNav.Screen name="PinBoard" component={PinBoardStub} />
    </CollectionStackNav.Navigator>
  );
}

const navRef = createNavigationContainerRef<TabParams>();

function renderTabHarness(): void {
  render(
    <NavigationContainer ref={navRef}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen
          name="Home"
          component={HomeStub}
          options={{ tabBarTestID: 'tab-btn-Home' }}
        />
        <Tab.Screen
          name="Explore"
          component={ExploreStackHost}
          options={{ tabBarTestID: 'tab-btn-Explore' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => handleTabPressToHome(navigation, 'Explore', 'CatalogList', e),
          })}
        />
        <Tab.Screen
          name="Trips"
          component={TripsStackHost}
          options={{ tabBarTestID: 'tab-btn-Trips' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => handleTabPressToHome(navigation, 'Trips', 'TripsList', e),
          })}
        />
        <Tab.Screen
          name="Collection"
          component={CollectionStackHost}
          options={{ tabBarTestID: 'tab-btn-Collection', tabBarLabel: 'You' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => handleTabPressToHome(navigation, 'Collection', 'CollectionHome', e),
          })}
        />
      </Tab.Navigator>
    </NavigationContainer>,
  );
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
}

function getTabChildRouteNames(tabName: keyof TabParams): readonly string[] {
  const root = navRef.getRootState();
  const tab = root.routes.find((r) => r.name === tabName);
  return tab?.state?.routes?.map((r) => r.name) ?? [];
}

describe('MainTabs tabPress reset integration', () => {
  beforeEach(() => {
    catalogMountCount = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('tapping You after deep cross-tab navigation to PinBoard resets cleanly to CollectionHome and stays there', async () => {
    renderTabHarness();
    expect(navRef.getCurrentRoute()?.name).toBe('Home');

    // Deep jump from Home straight into Collection -> PinBoard (lazy tab initialized on PinBoard).
    await act(async () => {
      navRef.navigate('Collection', { screen: 'PinBoard' });
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('PinBoard');

    // Return to Home tab.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Home'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('Home');

    // Tap You (Collection): must reset to CollectionHome and stay there after RAF runs.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Collection'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('CollectionHome');
    expect(getTabChildRouteNames('Collection')).toEqual(['CollectionHome']);

    // Tap You a second time while already focused: remains on CollectionHome.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Collection'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('CollectionHome');
    expect(getTabChildRouteNames('Collection')).toEqual(['CollectionHome']);
  });

  it('tapping Explore after deep cross-tab navigation to LiveWaits lands and stays on CatalogList', async () => {
    renderTabHarness();

    // Deep jump from Home/Onboarding straight into Explore -> LiveWaits.
    await act(async () => {
      navRef.navigate('Explore', { screen: 'LiveWaits', params: { park: 'Magic Kingdom' } });
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('LiveWaits');

    // Navigate to CatalogList inside Explore, then switch back to Home.
    await act(async () => {
      navRef.navigate('Explore', { screen: 'CatalogList' });
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');

    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Home'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('Home');

    // Tap Explore tab: must land on CatalogList with no LiveWaits left under it.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Explore'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');
    expect(getTabChildRouteNames('Explore')).toEqual(['CatalogList']);
  });

  it('preserves mounted CatalogList instance when Explore stack root is already CatalogList', async () => {
    renderTabHarness();

    // Normal entry onto Explore tab (CatalogList mounts as routes[0]).
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Explore'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');
    expect(catalogMountCount).toBe(1);

    // Push LiveWaits on top of CatalogList.
    await act(async () => {
      navRef.navigate('Explore', { screen: 'LiveWaits' });
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('LiveWaits');
    expect(getTabChildRouteNames('Explore')).toEqual(['CatalogList', 'LiveWaits']);

    // Switch to Home, then tap Explore tab again.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Home'));
    });
    await flushFrames();

    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Explore'));
    });
    await flushFrames();

    expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');
    expect(getTabChildRouteNames('Explore')).toEqual(['CatalogList']);
    expect(catalogMountCount).toBe(1);
  });

  it('tapping the already-focused Trips tab from TripDetail returns to TripsList', async () => {
    renderTabHarness();

    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Trips'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('TripsList');

    await act(async () => {
      navRef.navigate('Trips', { screen: 'TripDetail', params: { tripId: 'trip-1' } });
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('TripDetail');

    // Tap the already-focused Trips tab.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tab-btn-Trips'));
    });
    await flushFrames();
    expect(navRef.getCurrentRoute()?.name).toBe('TripsList');
    expect(getTabChildRouteNames('Trips')).toEqual(['TripsList']);
  });
});
