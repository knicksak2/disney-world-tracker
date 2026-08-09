/**
 * Structural unit tests for the bottom-tab navigation change
 * (trips spec, Task 16.2).
 *
 * Validates:
 *   Requirements 17.1, 17.3, 17.5
 *
 * The trips feature reworks `MainTabs` to exactly five top-level tabs — Home,
 * Catalog, Trips, Friends, Profile (left-to-right) — and removes the personal
 * statistics view (`StatsStack`) as a top-level tab, **re-hosting** it under
 * the Profile tab's own stack (`ProfileStack`), reachable via a navigation
 * control on the Profile screen. Relocating the whole `StatsStack` unchanged
 * preserves every previously reachable Stats screen. These tests assert that
 * declared structure directly (the runtime reachability is exercised by the
 * sibling `profileStatsRelocation.test.tsx`):
 *
 *   - `MainTabs` registers exactly the five tabs in order and does NOT include
 *     `Stats` as a top-level tab (R17.1).
 *   - `ProfileStack` re-hosts the personal statistics view: it registers a
 *     `Stats` route whose component is the whole `StatsStack` (R17.3).
 *   - `StatsStack` still registers every prior Stats screen — the Overview hub
 *     plus the Coverage/Ratings/Interests/Experiences detail routes — so the
 *     relocation costs no reachability (R17.5).
 *
 * Technique (mirrors `navigationStructure.test.tsx`): the React Navigation
 * navigator factories are mocked so the `Navigator` component captures the
 * `name`/`options`/`component` of each child `Screen` (read from the element
 * descriptors) plus its `initialRouteName`, without mounting any screen
 * `component`. Rendering the production navigators therefore records their
 * declared screen registrations without pulling in the live screen trees.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Capture registry + mocks (declared before the modules under test import).
// ---------------------------------------------------------------------------

interface ScreenCapture {
  readonly name: string;
  readonly options: { readonly headerShown?: boolean } | undefined;
  readonly component: unknown;
  readonly listeners?: unknown;
}

interface NavigatorCapture {
  readonly initialRouteName: string | undefined;
  readonly screens: readonly ScreenCapture[];
}

// Prefixed `mock*` so the jest.mock factories below may reference it (jest
// hoists the factories above the imports). It is only read at render time,
// well after this module has initialized.
const mockNavCaptures: NavigatorCapture[] = [];

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

// Force `RootNavigator` to render the authenticated `RootStack` by reporting a
// present session token.
jest.mock('../../state/sessionStore', () => ({
  __esModule: true,
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ token: 'test-token', clearToken: jest.fn() }),
}));

/**
 * Build a navigator factory whose `Navigator` records the declared child
 * screens (name, options, and the registered `component`) and
 * `initialRouteName`, then renders nothing — so no screen `component` is ever
 * mounted. `Screen` likewise renders nothing; its registration is read from
 * the element descriptor by the parent `Navigator`.
 *
 * Defined inside `jest.mock` factories (which may not reference out-of-scope
 * variables); only `mockNavCaptures` — `mock`-prefixed and read lazily at
 * render time — is captured.
 */
jest.mock('@react-navigation/native-stack', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: (props: { initialRouteName?: string; children?: unknown }) => {
        const screens = ReactActual.Children.toArray(props.children as never)
          .filter((child): child is React.ReactElement =>
            ReactActual.isValidElement(child),
          )
          .map((child) => {
            const childProps = child.props as {
              name: string;
              options?: { headerShown?: boolean };
              component?: unknown;
            };
            return {
              name: childProps.name,
              options: childProps.options,
              component: childProps.component,
            };
          });
        mockNavCaptures.push({
          initialRouteName: props.initialRouteName,
          screens,
        });
        return null;
      },
      Screen: () => null,
    }),
  };
});

jest.mock('@react-navigation/bottom-tabs', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    createBottomTabNavigator: () => ({
      Navigator: (props: { initialRouteName?: string; children?: unknown }) => {
        const screens = ReactActual.Children.toArray(props.children as never)
          .filter((child): child is React.ReactElement =>
            ReactActual.isValidElement(child),
          )
          .map((child) => {
            const childProps = child.props as {
              name: string;
              options?: { headerShown?: boolean };
              component?: unknown;
              listeners?: unknown;
            };
            return {
              name: childProps.name,
              options: childProps.options,
              component: childProps.component,
              listeners: childProps.listeners,
            };
          });
        mockNavCaptures.push({
          initialRouteName: props.initialRouteName,
          screens,
        });
        return null;
      },
      Screen: () => null,
    }),
  };
});

// ---------------------------------------------------------------------------
// Modules under test (imported after the mocks above).
// ---------------------------------------------------------------------------

import RootNavigator from '../RootNavigator';
import ProfileStack from '../ProfileStack';
import StatsStack from '../StatsStack';

beforeEach(() => {
  mockNavCaptures.length = 0;
});

/**
 * The five top-level tabs, in the required left-to-right order (R17.1).
 */
const EXPECTED_TAB_ORDER = [
  'Home',
  'Catalog',
  'Trips',
  'Friends',
  'Profile',
] as const;

/**
 * Every Stats screen that was reachable before the relocation — the Overview
 * hub plus the four focused detail routes. Each must remain registered on the
 * re-hosted `StatsStack` (R17.5).
 */
const PRIOR_STATS_SCREENS = [
  'StatsOverview',
  'CoverageDetail',
  'RatingsDetail',
  'InterestsDetail',
  'ExperiencesDetail',
] as const;

/**
 * Render the production `RootNavigator`, locate the `MainTabs` screen the root
 * stack registers, and render *its* component so the (mocked) bottom-tab
 * navigator records the declared top-level tabs. The mocked `Navigator`
 * renders `null` and never mounts a screen `component`, so the nested
 * `MainTabsNavigator` must be pulled out of the capture and rendered directly.
 */
function captureMainTabs(): NavigatorCapture {
  // RootNavigator reads the shared QueryClient (to clear the cache on a 401),
  // so it must render under a QueryClientProvider — the query layer is real
  // context here, not the component under test.
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>,
  );

  const rootStack = mockNavCaptures.find((capture) =>
    capture.screens.some((s) => s.name === 'MainTabs'),
  );
  const mainTabsComponent = rootStack?.screens.find(
    (s) => s.name === 'MainTabs',
  )?.component as React.ComponentType | undefined;
  expect(mainTabsComponent).toBeDefined();

  const before = mockNavCaptures.length;
  render(React.createElement(mainTabsComponent!));

  // The bottom-tab navigator rendered by MainTabsNavigator is the capture that
  // owns the Trips tab.
  const mainTabs = mockNavCaptures
    .slice(before)
    .find((capture) => capture.screens.some((s) => s.name === 'Trips'));
  expect(mainTabs).toBeDefined();
  return mainTabs!;
}

describe('MainTabs structure (Requirements 17.1, 17.3)', () => {
  it('registers exactly the five tabs Home, Catalog, Trips, Friends, Profile in order', () => {
    const mainTabs = captureMainTabs();

    const tabNames = mainTabs.screens.map((s) => s.name);
    // Exactly five tabs, in the required left-to-right order.
    expect(tabNames).toEqual([...EXPECTED_TAB_ORDER]);
  });

  it('configures Catalog tab tabPress listener to navigate to CatalogList (Experience Catalogue)', () => {
    const mainTabs = captureMainTabs();
    const catalogScreen = mainTabs.screens.find((s) => s.name === 'Catalog');
    expect(catalogScreen).toBeDefined();
    expect(catalogScreen?.listeners).toBeDefined();

    const mockNavigate = jest.fn();
    const listenersFactory = catalogScreen?.listeners as (arg: { navigation: { navigate: jest.Mock } }) => { tabPress: () => void };
    const listeners = listenersFactory({ navigation: { navigate: mockNavigate } });
    expect(listeners.tabPress).toBeDefined();

    listeners.tabPress();
    expect(mockNavigate).toHaveBeenCalledWith('Catalog', { screen: 'CatalogList' });
  });

  it('does NOT register the personal statistics view (Stats) as a top-level tab', () => {
    const mainTabs = captureMainTabs();

    const tabNames = mainTabs.screens.map((s) => s.name);
    // Stats is relocated under Profile — it is no longer a top-level tab
    // (R17.1, R17.3).
    expect(tabNames).not.toContain('Stats');
  });
});

describe('ProfileStack re-hosts the personal statistics view (Requirement 17.3)', () => {
  it('registers a Stats route whose component is the whole StatsStack', () => {
    render(<ProfileStack />);

    const profileStack = mockNavCaptures.find((capture) =>
      capture.screens.some((s) => s.name === 'ProfileMain'),
    );
    expect(profileStack).toBeDefined();

    const names = profileStack?.screens.map((s) => s.name) ?? [];
    // Profile is the landing route; Stats is re-hosted beneath it.
    expect(names).toContain('ProfileMain');
    expect(names).toContain('Stats');

    // The re-hosted Stats route mounts the *entire* existing StatsStack, so
    // every screen it hosts comes along unchanged (R17.3, R17.5).
    const statsRoute = profileStack?.screens.find((s) => s.name === 'Stats');
    expect(statsRoute?.component).toBe(StatsStack);
  });
});

describe('StatsStack preserves every prior Stats screen (Requirement 17.5)', () => {
  it('still registers the Overview hub and all four detail routes', () => {
    render(<StatsStack />);

    const statsStack = mockNavCaptures.find((capture) =>
      capture.screens.some((s) => s.name === 'StatsOverview'),
    );
    expect(statsStack).toBeDefined();

    const names = statsStack?.screens.map((s) => s.name) ?? [];
    // Every screen reachable before the relocation is still registered, so
    // relocating the stack costs no reachability.
    for (const screenName of PRIOR_STATS_SCREENS) {
      expect(names).toContain(screenName);
    }
    // The hub remains the initial route of the re-hosted stack.
    expect(statsStack?.initialRouteName).toBeUndefined();
    expect(names[0]).toBe('StatsOverview');
  });
});
