/**
 * Return-navigation and detail-source integration tests (task 10.4).
 *
 * Validates: Requirements 2.4, 5.3
 *
 * Two behaviors are exercised here against a *real* `NavigationContainer`
 * carrying the app's tab + nested-stack topology (a `Catalog` tab nesting a
 * stack with an `ExperienceDetail` screen, a `Stats` tab rendering the real
 * `StatsScreen`, and a `Friends` tab nesting the real `FriendProfileScreen`):
 *
 *   1. Return navigation + guard reset on focus (R5.3) — after navigating from
 *      a Completed_Experience_Row into `ExperienceDetail` and returning to the
 *      originating screen, the originating screen is shown again and a
 *      subsequent tap navigates anew (the `useOpenExperience` in-flight guard
 *      is cleared when the originating screen regains focus). This case uses a
 *      lightweight stub detail screen so the assertion focuses purely on the
 *      navigation lifecycle, observed through a `NavigationContainer` ref.
 *
 *   2. Detail data source (R2.4) — after navigating from a *Friend's* row, the
 *      *real* `ExperienceDetailScreen` loads the *viewing* User's own
 *      Completion / Rating / Note via `/me/experiences/:id/...`, never a
 *      friend-scoped (`/users/{friendId}/...`) read. This proves the detail
 *      screen presents the viewing User's own tracking data regardless of
 *      whose row was tapped.
 *
 * Mocking is limited to the lowest-level `apiRequest`, routed by path; React
 * Navigation is NOT mocked. This file is independent of (and does not edit)
 * the task-10.3 `navigationWiring.integration.test.tsx`; it only mirrors that
 * file's harness conventions.
 */

import React from 'react';
import { View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { type ExperienceCategory, type Park } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

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

// Mock only `apiRequest`; preserve the real `ApiError` so the error plumbing
// (e.g. the friend-profile timeout/error class and the detail screen's
// `*_not_found` swallowing) keeps its genuine error class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import StatsStack from '../../../navigation/StatsStack';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../../friends/FriendProfileScreen';
import ExperienceDetailScreen from '../../catalog/ExperienceDetailScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

/**
 * Local Catalog-stack param list for the test harness. The production
 * `CatalogStackParamList` no longer carries `ExperienceDetail` (it moved to the
 * root stack), so this harness mirrors that: the Catalog stack owns only
 * `CatalogList`, and `ExperienceDetail` is registered on a root-level stack
 * above the tabs (see `RootTestStackParamList` below).
 */
type CatalogStackParamList = {
  CatalogList: undefined;
};

/**
 * Root-level stack param list for the test harness, mirroring the production
 * `RootStack`: `MainTabs` (the bottom-tab navigator) is the initial route and
 * `ExperienceDetail` is registered as a sibling pushed above the tabs.
 */
type RootTestStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';
const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

// The single completed Experience every mode navigates to. Magic Kingdom /
// Ride places it in deterministic groups; the id has no URL-special chars so
// `encodeURIComponent` leaves it unchanged.
const EXPERIENCE_ID = 'exp-space-mountain-001';
const EXPERIENCE_NAME = 'Space Mountain';

const ENTRY = {
  experienceId: EXPERIENCE_ID,
  experienceName: EXPERIENCE_NAME,
  park: 'Magic Kingdom' as Park,
  category: 'Ride' as ExperienceCategory,
  completedOn: '2024-01-05',
  rating: 8,
  sharedNote: null,
};

// Catalog detail returned by `GET /catalog/:id`, consumed by the real
// ExperienceDetailScreen (matches its `ExperienceDetailDTO` shape).
const EXPERIENCE_DETAIL = {
  id: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: 'Magic Kingdom' as Park,
  category: 'Ride' as ExperienceCategory,
  description: 'A high-speed indoor roller coaster in the dark.',
  imageUrl: null,
  imageAttribution: null,
};

/** A fully-populated nested stats roll-up (every Park / Category present). */
function makeStats(): StatsResponse {
  return makeStatsResponse();
}

const FRIEND_PROFILE = {
  userId: FRIEND_ID,
  displayName: DISPLAY_NAME,
  avatarPreset: null,
  overallCompletionPercent: 42,
};

/**
 * Route `apiRequest` by path so both screens' reads — and the real
 * ExperienceDetailScreen's reads — resolve deterministically:
 *   - `/me`                                   → identity (own-user resolution)
 *   - `/me/stats` / `/me/stats/summary?...`   → stats roll-up
 *   - `/users/{id}/profile`                   → friend profile
 *   - `/users/{id}/completions`               → completions list
 *   - `/catalog/{id}/live`                    → fail → live-unavailable indicator
 *   - `/catalog/{id}`                         → catalog detail
 *   - `/me/experiences/{id}/completion|rating|note` → viewing User's own (null ⇒ empty)
 *   - `/experiences/{id}/aggregate-rating`    → below-threshold empty aggregate
 */
function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me') return ME_RESPONSE as unknown;
    if (path.startsWith('/me/stats')) return makeStats() as unknown;
    if (path.endsWith('/profile')) return FRIEND_PROFILE as unknown;
    if (path.endsWith('/completions')) {
      return { entries: [ENTRY] } as unknown;
    }
    // Live read fails → the detail screen shows only the unavailable indicator
    // while the static fields render (keeps the screen from blocking on it).
    if (path.endsWith('/live')) {
      throw new Error('live unavailable');
    }
    if (path.startsWith('/catalog/')) return EXPERIENCE_DETAIL as unknown;
    // The viewing User's own tracking reads (R2.4). Returning `null` exercises
    // the screen's empty-state branches without needing full DTOs.
    if (
      path.endsWith('/completion') ||
      path.endsWith('/rating') ||
      path.endsWith('/note')
    ) {
      return null as unknown;
    }
    if (path.endsWith('/aggregate-rating')) {
      return { value: null, count: 0 } as unknown;
    }
    throw new Error(`unexpected apiRequest path: ${path}`);
  });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ---------------------------------------------------------------------------
// Shared navigator pieces
// ---------------------------------------------------------------------------

type FriendsTestStackParamList = {
  FriendProfile: FriendProfileParams;
};

const FriendsStack = createNativeStackNavigator<FriendsTestStackParamList>();

function FriendsTestStack(): JSX.Element {
  return (
    <FriendsStack.Navigator screenOptions={{ headerShown: false }}>
      <FriendsStack.Screen
        name="FriendProfile"
        component={FriendProfileScreen}
        initialParams={{ friendId: FRIEND_ID, displayName: DISPLAY_NAME }}
      />
    </FriendsStack.Navigator>
  );
}

const CatalogStack = createNativeStackNavigator<CatalogStackParamList>();
const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootTestStackParamList>();

// A loosely-typed container ref so tests can read the current route name and
// drive a tab switch back to the originating screen.
const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

// ===========================================================================
// 1. Return navigation + guard reset on focus (R5.3)
// ===========================================================================

/** Stub destination — the return test only cares about the route lifecycle. */
function ExperienceDetailStub(): JSX.Element {
  return <View testID="experience-detail-stub" />;
}

function CatalogStubStack(): JSX.Element {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen name="CatalogList">
        {() => <View testID="catalog-list" />}
      </CatalogStack.Screen>
    </CatalogStack.Navigator>
  );
}

function MainTabsStub(): JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Stats"
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Stats" component={StatsStack} />
      <Tab.Screen name="Catalog" component={CatalogStubStack} />
    </Tab.Navigator>
  );
}

function renderStubNavigator(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer ref={navRef}>
        <RootStack.Navigator
          initialRouteName="MainTabs"
          screenOptions={{ headerShown: false }}
        >
          <RootStack.Screen name="MainTabs" component={MainTabsStub} />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailStub}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('return navigation — guard resets on focus so a later tap navigates again (R5.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  test('after returning to the originating Stats screen, a subsequent tap navigates anew', async () => {
    renderStubNavigator();

    // Arrive at a Completed_Experience_Row on the Stats tab's ExperiencesDetail
    // screen (reached from the Overview hub's Experiences entry card).
    await screen.findByTestId('stats-screen');
    fireEvent.press(await screen.findByTestId('stats-highlight-experiences'));
    await screen.findByTestId('experiences-detail-screen');
    const firstRow = await screen.findByTestId('own-experience-row-0');

    // First tap → pushes `ExperienceDetail` onto the root stack above the
    // tabs (R5.1).
    fireEvent.press(firstRow);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });

    // Return to the originating screen: popping the root stack re-focuses the
    // Stats tab's ExperiencesDetail screen, which fires the `useFocusEffect`
    // that clears the in-flight guard. R5.3: the App returns to the
    // originating screen.
    act(() => {
      navRef.goBack();
    });
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperiencesDetail');
    });
    expect(screen.getByTestId('experiences-detail-screen')).toBeTruthy();

    // A deliberate subsequent tap after returning navigates again — proving
    // the guard was reset on focus rather than permanently latched (R5.3).
    const rowAgain = await screen.findByTestId('own-experience-row-0');
    fireEvent.press(rowAgain);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });
  });
});

// ===========================================================================
// 2. Detail data source — viewing User's own /me reads (R2.4)
// ===========================================================================

function CatalogRealStack(): JSX.Element {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen name="CatalogList">
        {() => <View testID="catalog-list" />}
      </CatalogStack.Screen>
    </CatalogStack.Navigator>
  );
}

function MainTabsReal(): JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Friends"
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Friends" component={FriendsTestStack} />
      <Tab.Screen name="Catalog" component={CatalogRealStack} />
    </Tab.Navigator>
  );
}

function renderRealDetailNavigator(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <RootStack.Navigator
          initialRouteName="MainTabs"
          screenOptions={{ headerShown: false }}
        >
          <RootStack.Screen name="MainTabs" component={MainTabsReal} />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/** Paths the `apiRequest` mock was called with, as strings. */
function calledPaths(): readonly string[] {
  return apiRequestMock.mock.calls
    .map((call) => call[1])
    .filter((p): p is string => typeof p === 'string');
}

describe('detail data source — ExperienceDetailScreen reads the viewing User\'s own /me data after navigating from a Friend\'s row (R2.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  test('navigating from a Friend row issues the viewing User\'s own /me reads, not friend-scoped reads', async () => {
    renderRealDetailNavigator();

    // Drive to a Friend's Completed_Experience_Row (Friend Experiences mode).
    await screen.findByTestId('friend-profile-screen');
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    await screen.findByTestId('friend-mode-experiences');
    const row = await screen.findByTestId('friend-experience-row-0');

    // Tap → cross-stack navigation into the REAL ExperienceDetailScreen.
    fireEvent.press(row);

    // The real detail screen renders its scroll body once the catalog detail
    // read resolves.
    await screen.findByTestId('experience-detail');

    // R2.4: the detail screen loads the viewing User's OWN Completion, Rating,
    // and Note via `/me/experiences/:id/...`, independent of whose row was
    // tapped.
    await waitFor(() => {
      expect(calledPaths()).toContain(
        `/me/experiences/${EXPERIENCE_ID}/completion`,
      );
    });
    const paths = calledPaths();
    expect(paths).toContain(`/me/experiences/${EXPERIENCE_ID}/rating`);
    expect(paths).toContain(`/me/experiences/${EXPERIENCE_ID}/note`);

    // It must NOT issue any friend-scoped per-experience tracking read for the
    // Friend whose row was tapped.
    const friendScopedReads = paths.filter((p) =>
      p.includes(`/users/${FRIEND_ID}/experiences`),
    );
    expect(friendScopedReads).toEqual([]);
  });
});
