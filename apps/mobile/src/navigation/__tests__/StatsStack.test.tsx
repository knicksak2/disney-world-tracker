/**
 * StatsStack navigation tests (stats-experience-redesign task 9.2).
 *
 * Validates: Requirements 3.1, 3.3, 3.4
 *
 * `StatsStack` (`apps/mobile/src/navigation/StatsStack.tsx`) is the native
 * stack local to the Stats tab. Its initial route is the Overview hub
 * (`StatsOverview`) and the four focused detail screens — `CoverageDetail`,
 * `RatingsDetail`, `InterestsDetail`, `ExperiencesDetail` — are pushed above it
 * (`headerShown: false`, D1a). These tests exercise the navigator's real wiring
 * against a real `NavigationContainer` (React Navigation is NOT mocked),
 * mirroring the harness conventions of the sibling integration tests
 * (`returnNavigationDetailSource.integration.test.tsx`,
 * `tapThroughNavigation.test.tsx`): a container ref drives navigation and reads
 * the current route.
 *
 * The five Stats screen COMPONENTS are replaced with lightweight stubs so the
 * assertions focus purely on the navigator topology and lifecycle rather than
 * on the screens' data reads (each screen has its own dedicated test suite).
 * Stubbing the components does not alter the navigator wiring under test —
 * `StatsStack` still registers the same route names against the same navigator.
 *
 *   - **Initial route is the hub (R3.1).** Mounting `StatsStack` renders the
 *     `StatsOverview` hub with no prior navigation.
 *   - **The four detail routes register (R3.1).** Navigating to each of
 *     `CoverageDetail`, `RatingsDetail`, `InterestsDetail`, and
 *     `ExperiencesDetail` lands on that route and renders its screen — proving
 *     each is registered on the stack.
 *   - **Deep-link lands on ratings detail (R3.4).** With the production
 *     nesting (RootStack ⊃ MainTabs ⊃ Stats = `StatsStack`), a single
 *     `navigate('MainTabs', { screen: 'Stats', params: { screen:
 *     'RatingsDetail' } })` walks all the way down to `RatingsDetail`.
 *   - **Native back returns to the hub (R3.3).** From a detail route, a back
 *     dispatch (`goBack`, the programmatic equivalent of the native back
 *     gesture / header control) pops back to the `StatsOverview` hub.
 */

import React from 'react';
import { View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Screen-component stubs (declared before the module under test is imported).
//
// Each Stats screen is replaced with a bare `View` carrying a stable testID so
// the tests can assert which route is mounted without pulling in the screens'
// React Query reads / navigation-dependent hooks. The `StatsStack` navigator
// wiring (route names, initial route, header options) is left completely
// intact — only what each `Screen`'s `component` renders changes.
// ---------------------------------------------------------------------------

// Each stub is a named, capitalized function component so React Navigation
// infers a valid display name (an anonymous `default` arrow would trip its
// "components must start with an uppercase letter" dev warning).
jest.mock('../../screens/stats/StatsScreen', () => ({
  __esModule: true,
  default: function StatsOverviewStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-stats-overview" />;
  },
}));

jest.mock('../../screens/stats/CoverageDetailScreen', () => ({
  __esModule: true,
  default: function CoverageDetailStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-coverage-detail" />;
  },
}));

jest.mock('../../screens/stats/RatingsDetailScreen', () => ({
  __esModule: true,
  default: function RatingsDetailStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-ratings-detail" />;
  },
}));

jest.mock('../../screens/stats/InterestsDetailScreen', () => ({
  __esModule: true,
  default: function InterestsDetailStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-interests-detail" />;
  },
}));

jest.mock('../../screens/stats/ExperiencesDetailScreen', () => ({
  __esModule: true,
  default: function ExperiencesDetailStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-experiences-detail" />;
  },
}));

// ---------------------------------------------------------------------------
// Module under test (imported after the mocks above).
// ---------------------------------------------------------------------------

import StatsStack from '../StatsStack';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// A loosely-typed container ref so tests can read the current route name and
// drive navigation / back dispatches (mirrors the sibling integration tests).
const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

/** testID per StatsStack route, so a route's screen can be asserted mounted. */
const STUB_TEST_ID: Record<string, string> = {
  StatsOverview: 'stub-stats-overview',
  CoverageDetail: 'stub-coverage-detail',
  RatingsDetail: 'stub-ratings-detail',
  InterestsDetail: 'stub-interests-detail',
  ExperiencesDetail: 'stub-experiences-detail',
};

/** The four detail routes pushed above the hub. */
const DETAIL_ROUTES = [
  'CoverageDetail',
  'RatingsDetail',
  'InterestsDetail',
  'ExperiencesDetail',
] as const;

/** Render the real `StatsStack` standalone inside a real NavigationContainer. */
function renderStatsStack(): void {
  render(
    <NavigationContainer ref={navRef}>
      <StatsStack />
    </NavigationContainer>,
  );
}

// Production nesting for the deep-link test: RootStack ⊃ MainTabs ⊃ Stats,
// where the Stats tab's component is the real `StatsStack` — matching how
// `RootNavigator` wires the Stats tab (task 9.1).
const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStub(): JSX.Element {
  return <View testID="stub-home" />;
}

function MainTabsHarness(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeStub} />
      <Tab.Screen name="Stats" component={StatsStack} />
    </Tab.Navigator>
  );
}

/** Render the RootStack ⊃ MainTabs ⊃ Stats(StatsStack) production nesting. */
function renderNestedNavigator(): void {
  render(
    <NavigationContainer ref={navRef}>
      <RootStack.Navigator
        initialRouteName="MainTabs"
        screenOptions={{ headerShown: false }}
      >
        <RootStack.Screen name="MainTabs" component={MainTabsHarness} />
      </RootStack.Navigator>
    </NavigationContainer>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StatsStack navigation (Requirements 3.1, 3.3, 3.4)', () => {
  // -------------------------------------------------------------------------
  // Initial route is the hub (R3.1)
  // -------------------------------------------------------------------------
  test('R3.1: the Overview hub (StatsOverview) is the initial route', async () => {
    renderStatsStack();

    expect(await screen.findByTestId('stub-stats-overview')).toBeTruthy();
    expect(navRef.getCurrentRoute()?.name).toBe('StatsOverview');

    // No detail route is mounted on first paint.
    for (const route of DETAIL_ROUTES) {
      expect(screen.queryByTestId(STUB_TEST_ID[route]!)).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // The four detail routes register (R3.1)
  // -------------------------------------------------------------------------
  test.each(DETAIL_ROUTES)(
    'R3.1: the %s detail route is registered and navigable from the hub',
    async (route) => {
      renderStatsStack();

      await screen.findByTestId('stub-stats-overview');

      act(() => {
        navRef.navigate(route as never);
      });

      expect(await screen.findByTestId(STUB_TEST_ID[route]!)).toBeTruthy();
      await waitFor(() => {
        expect(navRef.getCurrentRoute()?.name).toBe(route);
      });
    },
  );

  // -------------------------------------------------------------------------
  // Deep-link lands on ratings detail (R3.4)
  // -------------------------------------------------------------------------
  test('R3.4: a nested deep-link to Stats/RatingsDetail lands on the ratings detail', async () => {
    renderNestedNavigator();

    // Starts on the hub within the Stats tab (Home is the initial tab, but the
    // deep-link drives straight to the Stats tab's RatingsDetail route).
    act(() => {
      // Loosely-typed navigate call: the container ref is typed generically for
      // the harness, so drive the nested deep-link through a widened signature.
      (
        navRef.navigate as unknown as (name: string, params?: object) => void
      )('MainTabs', {
        screen: 'Stats',
        params: { screen: 'RatingsDetail' },
      });
    });

    expect(await screen.findByTestId('stub-ratings-detail')).toBeTruthy();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('RatingsDetail');
    });
  });

  // -------------------------------------------------------------------------
  // Native back returns to the hub (R3.3)
  // -------------------------------------------------------------------------
  test('R3.3: native back from a detail route returns to the Overview hub', async () => {
    renderStatsStack();

    await screen.findByTestId('stub-stats-overview');

    // Drill into a detail route.
    act(() => {
      navRef.navigate('CoverageDetail' as never);
    });
    expect(await screen.findByTestId('stub-coverage-detail')).toBeTruthy();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('CoverageDetail');
    });

    // Native back (goBack is the programmatic equivalent of the native back
    // gesture / header control) pops back to the hub (R3.3).
    act(() => {
      navRef.goBack();
    });

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('StatsOverview');
    });
    expect(screen.getByTestId('stub-stats-overview')).toBeTruthy();
    expect(screen.queryByTestId('stub-coverage-detail')).toBeNull();
  });
});
