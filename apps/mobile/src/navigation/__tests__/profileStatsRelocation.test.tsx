/**
 * Runtime reachability tests for the personal statistics view after its
 * relocation under the Profile tab (trips spec, Task 16.2).
 *
 * Validates:
 *   Requirements 17.3, 17.5
 *
 * The trips navigation change removes the personal statistics view
 * (`StatsStack`) as a top-level tab and re-hosts it, unchanged, inside the
 * Profile tab's own stack (`ProfileStack`) as the `Stats` route. R17.5 requires
 * that *every* Stats screen reachable before the relocation stay reachable
 * through navigation originating from the Profile tab. These tests exercise
 * that against a real `NavigationContainer` (React Navigation is NOT mocked),
 * mirroring the harness conventions of `StatsStack.test.tsx`: a container ref
 * drives navigation and reads the current route.
 *
 * The Profile screen and the five Stats screen COMPONENTS are replaced with
 * lightweight stubs so the assertions focus purely on the navigator topology
 * and reachability rather than on the screens' data reads (each screen has its
 * own dedicated test suite). Stubbing the components does not alter the
 * navigator wiring under test — `ProfileStack` still nests the real
 * `StatsStack`, which still registers the same route names.
 *
 *   - **Profile is the tab landing; Stats is reachable from it (R17.3).**
 *     Mounting `ProfileStack` renders the `ProfileMain` screen, and a single
 *     `navigate('Stats', …)` reaches the re-hosted statistics view.
 *   - **Every prior Stats screen stays reachable through the Profile tab
 *     (R17.5).** Navigating Profile → Stats → each of `StatsOverview`,
 *     `CoverageDetail`, `RatingsDetail`, `InterestsDetail`, and
 *     `ExperiencesDetail` lands on that route and renders its screen.
 *   - **Deep-link through the Profile tab from the root (R17.3).** With the
 *     production nesting (RootStack ⊃ MainTabs ⊃ Profile = `ProfileStack` ⊃
 *     Stats = `StatsStack`), a single `navigate('MainTabs', { screen:
 *     'Profile', params: { screen: 'Stats', params: { screen: 'RatingsDetail'
 *     } } })` walks all the way down to `RatingsDetail`.
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
// The Profile screen and each Stats screen are replaced with a bare `View`
// carrying a stable testID so the tests can assert which route is mounted
// without pulling in the screens' React Query reads / navigation-dependent
// hooks. The `ProfileStack` / `StatsStack` navigator wiring (route names,
// initial route, nesting) is left completely intact.
// ---------------------------------------------------------------------------

// Each stub is a named, capitalized function component so React Navigation
// infers a valid display name.
jest.mock('../../screens/ProfileScreen', () => ({
  __esModule: true,
  default: function ProfileMainStub(): JSX.Element {
    const { View: RNView } = require('react-native');
    return <RNView testID="stub-profile-main" />;
  },
}));

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

import ProfileStack from '../ProfileStack';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// A loosely-typed container ref so tests can read the current route name and
// drive navigation (mirrors the sibling `StatsStack.test.tsx`).
const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

/** testID per StatsStack route, so a route's screen can be asserted mounted. */
const STUB_TEST_ID: Record<string, string> = {
  StatsOverview: 'stub-stats-overview',
  CoverageDetail: 'stub-coverage-detail',
  RatingsDetail: 'stub-ratings-detail',
  InterestsDetail: 'stub-interests-detail',
  ExperiencesDetail: 'stub-experiences-detail',
};

/**
 * Every Stats screen that was reachable before the relocation — the Overview
 * hub plus the four focused detail routes. Each must stay reachable through
 * the Profile tab (R17.5).
 */
const PRIOR_STATS_SCREENS = [
  'StatsOverview',
  'CoverageDetail',
  'RatingsDetail',
  'InterestsDetail',
  'ExperiencesDetail',
] as const;

/** Render the real `ProfileStack` standalone inside a real NavigationContainer. */
function renderProfileStack(): void {
  render(
    <NavigationContainer ref={navRef}>
      <ProfileStack />
    </NavigationContainer>,
  );
}

// Production nesting for the deep-link test: RootStack ⊃ MainTabs ⊃ Profile,
// where the Profile tab's component is the real `ProfileStack` — matching how
// `RootNavigator` wires the Profile tab (task 16.1).
const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStub(): JSX.Element {
  return <View testID="stub-home" />;
}

function MainTabsHarness(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeStub} />
      <Tab.Screen name="Profile" component={ProfileStack} />
    </Tab.Navigator>
  );
}

/** Render the RootStack ⊃ MainTabs ⊃ Profile(ProfileStack) production nesting. */
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

describe('Personal statistics relocated under the Profile tab (Requirements 17.3, 17.5)', () => {
  // -------------------------------------------------------------------------
  // Profile is the tab landing; Stats is reachable from it (R17.3)
  // -------------------------------------------------------------------------
  test('R17.3: the Profile screen (ProfileMain) is the Profile tab landing route', async () => {
    renderProfileStack();

    expect(await screen.findByTestId('stub-profile-main')).toBeTruthy();
    expect(navRef.getCurrentRoute()?.name).toBe('ProfileMain');

    // Stats is not mounted until the User navigates to it — it is not a
    // top-level surface (R17.1, R17.3).
    expect(screen.queryByTestId('stub-stats-overview')).toBeNull();
  });

  test('R17.3: the statistics view is reachable from the Profile tab in a single navigate', async () => {
    renderProfileStack();

    await screen.findByTestId('stub-profile-main');

    act(() => {
      navRef.navigate('Stats' as never);
    });

    // Reaching the Stats route lands on the re-hosted stack's Overview hub.
    expect(await screen.findByTestId('stub-stats-overview')).toBeTruthy();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('StatsOverview');
    });
  });

  // -------------------------------------------------------------------------
  // Every prior Stats screen stays reachable through the Profile tab (R17.5)
  // -------------------------------------------------------------------------
  test.each(PRIOR_STATS_SCREENS)(
    'R17.5: the prior Stats screen %s remains reachable via Profile → Stats',
    async (route) => {
      renderProfileStack();

      await screen.findByTestId('stub-profile-main');

      act(() => {
        // Push the re-hosted Stats stack and select the specific screen within
        // it — the navigation path a Profile-tab control would drive.
        (
          navRef.navigate as unknown as (name: string, params?: object) => void
        )('Stats', { screen: route });
      });

      expect(await screen.findByTestId(STUB_TEST_ID[route]!)).toBeTruthy();
      await waitFor(() => {
        expect(navRef.getCurrentRoute()?.name).toBe(route);
      });
    },
  );

  // -------------------------------------------------------------------------
  // Deep-link through the Profile tab from the root (R17.3)
  // -------------------------------------------------------------------------
  test('R17.3: a nested deep-link to Profile/Stats/RatingsDetail lands on the ratings detail', async () => {
    renderNestedNavigator();

    act(() => {
      (
        navRef.navigate as unknown as (name: string, params?: object) => void
      )('MainTabs', {
        screen: 'Profile',
        params: { screen: 'Stats', params: { screen: 'RatingsDetail' } },
      });
    });

    expect(await screen.findByTestId('stub-ratings-detail')).toBeTruthy();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('RatingsDetail');
    });
  });
});
