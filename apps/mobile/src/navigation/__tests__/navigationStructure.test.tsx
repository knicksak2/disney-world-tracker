/**
 * Structural unit tests for the fixed navigation topology
 * (bugfix spec: experience-detail-back-navigation, Task 3.6).
 *
 * Validates (expected structure of the fix):
 *   Requirements 2.1, 2.2, 2.3, 2.5
 *   (Property 1 — Bug Condition / Property 3 — Single Themed Header)
 *
 * The fix promotes `ExperienceDetail` out of the Catalog tab stack to a
 * root-level native stack (`RootStack`) that wraps the tab navigator, so a
 * back request pops to the exact originating tab/screen rather than unwinding
 * into the Catalog stack. These tests assert that structure directly, rather
 * than its runtime behavior (which the integration tests cover):
 *
 *   - `RootStack` registers `MainTabs` as the initial route and
 *     `ExperienceDetail` as a sibling screen with `headerShown: false` (so no
 *     redundant native header bar renders — clause 2.5).
 *   - `CatalogStack` no longer registers `ExperienceDetail`; `CatalogList`
 *     remains its sole screen.
 *
 * Technique: the React Navigation navigator factories are mocked so the
 * `Navigator` component captures the `name`/`options` of each child `Screen`
 * (read from the element descriptors) plus its `initialRouteName`, without
 * mounting any screen `component`. Rendering the production `RootNavigator`
 * and `CatalogStack` therefore records the declared screen registrations
 * without pulling in the live screen trees.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Capture registry + mocks (declared before the modules under test import).
// ---------------------------------------------------------------------------

interface ScreenCapture {
  readonly name: string;
  readonly options: { readonly headerShown?: boolean } | undefined;
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
 * screens and `initialRouteName`, then renders nothing — so no screen
 * `component` is ever mounted. `Screen` likewise renders nothing; its
 * registration is read from the element descriptor by the parent `Navigator`.
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
            };
            return { name: childProps.name, options: childProps.options };
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
            };
            return { name: childProps.name, options: childProps.options };
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import RootNavigator from '../RootNavigator';
import CatalogStack from '../CatalogStack';

beforeEach(() => {
  mockNavCaptures.length = 0;
});

describe('RootStack structure (Requirements 2.1, 2.2, 2.3, 2.5)', () => {
  it('registers MainTabs as the initial route and ExperienceDetail with headerShown: false', () => {
    // RootNavigator reads the shared QueryClient (to clear the cache on a 401),
    // so it must render under a QueryClientProvider.
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RootNavigator />
      </QueryClientProvider>,
    );

    // The root native stack is the navigator that owns ExperienceDetail.
    const rootStack = mockNavCaptures.find((capture) =>
      capture.screens.some((s) => s.name === 'ExperienceDetail'),
    );
    expect(rootStack).toBeDefined();

    // MainTabs is the initial route (the tabs remain mounted beneath the
    // pushed detail, so back returns to the originating tab/screen).
    expect(rootStack?.initialRouteName).toBe('MainTabs');

    const names = rootStack?.screens.map((s) => s.name) ?? [];
    expect(names).toContain('MainTabs');
    expect(names).toContain('ExperienceDetail');

    // ExperienceDetail suppresses the native header bar (clause 2.5): the
    // screen presents only its themed in-content header.
    const experienceDetail = rootStack?.screens.find(
      (s) => s.name === 'ExperienceDetail',
    );
    expect(experienceDetail?.options?.headerShown).toBe(false);
  });
});

describe('CatalogStack structure (Requirements 2.5)', () => {
  it('no longer registers ExperienceDetail; CatalogList and DestinationScreen are its screens', () => {
    render(<CatalogStack />);

    const catalogStack = mockNavCaptures.find((capture) =>
      capture.screens.some((s) => s.name === 'CatalogList'),
    );
    expect(catalogStack).toBeDefined();

    const names = catalogStack?.screens.map((s) => s.name) ?? [];
    expect(names).toContain('CatalogList');
    // ExperienceDetail stays on the root stack, not the Catalog tab stack.
    expect(names).not.toContain('ExperienceDetail');
    // The Level-2 Destination_Screen is registered here (catalog redesign
    // task 11.1) and the CrowdCalendar screen (crowd-calendar feature);
    // CatalogList remains the initial route.
    expect(names).toEqual(['CatalogList', 'DestinationScreen', 'CrowdCalendar']);
  });
});
