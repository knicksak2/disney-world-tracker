/**
 * Bug-condition exploration tests for the Experience Detail back-navigation
 * bug (bugfix spec: experience-detail-back-navigation, Task 1).
 *
 * Validates (expected behavior encoded by these tests):
 *   Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 *   (Property 1 — Bug Condition / Property 3 — Single Themed Header With
 *   Accessible Back Control)
 *
 * IMPORTANT — these tests encode the EXPECTED (post-fix) behavior and are
 * EXPECTED TO FAIL on the current, unfixed code. Each failure is a
 * counterexample that demonstrates the bug:
 *
 *   - Symptom A (`action = 'backFromDetail'`): opening `ExperienceDetail`
 *     from a non-Catalog origin (Stats_View, Friend_Profile_View, Home_View)
 *     and pressing back must return to that originating screen. On the unfixed
 *     code `ExperienceDetail` is registered only inside `CatalogStack` and is
 *     reached via a cross-tab `navigate('Catalog', { screen: 'ExperienceDetail' })`,
 *     so back pops within the Catalog stack and lands on `CatalogList`.
 *
 *   - Symptom B (`action = 'presentDetail'`): the presented detail screen must
 *     show a single themed header (no redundant native header bar) and expose a
 *     visible back control with `accessibilityRole="button"` and a back
 *     `accessibilityLabel`. On the unfixed code the Catalog stack declares
 *     `options={{ title: 'Experience' }}` (a redundant native header) and the
 *     screen renders no in-content back control.
 *
 * Harness — this file mirrors `returnNavigationDetailSource.integration.test.tsx`
 * and `navigationWiring.integration.test.tsx`: a real `NavigationContainer`
 * carrying the app's tab + nested-stack topology, with only the lowest-level
 * `apiRequest` mocked (routed by path). React Navigation is NOT mocked.
 *
 * To keep the SAME test valid before and after the fix, the topology registers
 * `ExperienceDetail` in BOTH places the fix moves it between:
 *   - inside the `Catalog` tab stack (the unfixed destination, with the
 *     redundant native header), and
 *   - as a sibling screen on a root-level native stack above the tabs (the
 *     fixed destination, with `headerShown: false`).
 * The real screens drive the real navigation dispatch, so the test follows
 * whichever destination the production code targets: the Catalog-stack copy on
 * unfixed code (bug reproduced) or the root-level copy on fixed code (bug
 * resolved).
 *
 * Scoped property domain: the bug is deterministic per origin, so Symptom A is
 * a scoped property over the concrete failing origins
 * {Stats_View, Friend_Profile_View, Home_View}; Symptom B is the single
 * `presentDetail` case.
 */

import React from 'react';
import { View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import fc from 'fast-check';

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

// Mock only `apiRequest`; preserve the real `ApiError` so the detail screen's
// `*_not_found` swallowing and the friend-profile error plumbing keep their
// genuine error class.
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

import HomeScreen from '../../home/HomeScreen';
import StatsStack from '../../../navigation/StatsStack';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../../friends/FriendProfileScreen';
import ExperienceDetailScreen from '../../catalog/ExperienceDetailScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

/**
 * Local Catalog-stack param list for the test harness. This mirrors the
 * UNFIXED production topology where `ExperienceDetail` was registered inside
 * the Catalog stack. The production `CatalogStackParamList` no longer carries
 * `ExperienceDetail` (it moved to the root stack), so this harness declares
 * its own param list rather than importing the trimmed production type.
 */
type CatalogStackParamList = {
  CatalogList: undefined;
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// React Query notify scheduler (harness lifecycle stabilization).
//
// By default React Query batches observer notifications onto a `setTimeout`
// macrotask. In a fast-check loop that mounts/unmounts a tree per sample, a
// notify timer scheduled by one iteration's QueryClient can fire during the
// NEXT iteration's render — after `cleanup()` has unmounted the prior tree —
// producing the intermittent "Can't access .root on unmounted test renderer"
// crash. Running the scheduler synchronously means notifications are delivered
// inside the act-wrapped operation that triggered them (render / fireEvent /
// waitFor), so no notify timer survives across iterations. This is a
// test-harness timing safeguard only; it changes no assertion and no
// production behavior.
// ---------------------------------------------------------------------------
notifyManager.setScheduler((flush) => {
  flush();
});

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

// The single completed Experience every origin navigates to.
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

// Highest-rated leaderboard row consumed by HomeScreen (R11.5 shape).
const LEADERBOARD_ENTRY = {
  experienceId: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: 'Magic Kingdom' as Park,
  category: 'Ride' as ExperienceCategory,
  value: 8.5,
  count: 12,
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
 * Route `apiRequest` by path so all three origin screens AND the real
 * ExperienceDetailScreen resolve deterministically.
 */
function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me') return ME_RESPONSE as unknown;
    if (path === '/home/highest-rated') {
      return { entries: [LEADERBOARD_ENTRY] } as unknown;
    }
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
// Navigator topology
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

/**
 * The Catalog tab stack — mirrors the UNFIXED production `CatalogStack`:
 * `ExperienceDetail` is registered here with the redundant native header
 * (`title: 'Experience'`). This is the destination the unfixed cross-tab
 * dispatch lands on.
 */
function CatalogTestStack(): JSX.Element {
  return (
    <CatalogStack.Navigator>
      <CatalogStack.Screen name="CatalogList" options={{ headerShown: false }}>
        {() => <View testID="catalog-list" />}
      </CatalogStack.Screen>
      <CatalogStack.Screen
        name="ExperienceDetail"
        component={ExperienceDetailScreen}
        options={{ title: 'Experience' }}
      />
    </CatalogStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

// Set by `renderApp` before each mount so the originating tab is focused
// without needing to drive the bottom tab bar.
let currentInitialTab: 'Home' | 'Stats' | 'Friends' = 'Home';

function MainTabsNavigator(): JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName={currentInitialTab}
      // `lazy: false` mounts every tab (including the Catalog tab) on first
      // render, so the Catalog stack initializes with `CatalogList` at the
      // base of its history. This mirrors a real session where the Catalog
      // list has been initialized, so the unfixed cross-tab dispatch produces
      // a Catalog history of [CatalogList, ExperienceDetail] and back lands on
      // `CatalogList` (the documented bug symptom) rather than bubbling to the
      // tab navigator's first-route back behavior.
      screenOptions={{ headerShown: false, lazy: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen as React.ComponentType<unknown>} />
      <Tab.Screen name="Stats" component={StatsStack} />
      <Tab.Screen name="Friends" component={FriendsTestStack} />
      <Tab.Screen name="Catalog" component={CatalogTestStack} />
    </Tab.Navigator>
  );
}

type RootStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
};

const RootStack = createNativeStackNavigator<RootStackParamList>();

const navRef =
  createNavigationContainerRef<Record<string, object | undefined>>();

/**
 * The QueryClient created for the currently-mounted tree. Tracked at module
 * scope so `teardownApp` can clear its caches and drain its batched notify
 * timers when the tree is unmounted. This prevents a React Query notify timer
 * (scheduled by a query observer) from firing against an already-unmounted
 * renderer between fast-check iterations — the cause of the intermittent
 * "Can't access .root on unmounted test renderer" harness crash. This is a
 * lifecycle-only safeguard; it does not change what any test asserts.
 */
let activeQueryClient: QueryClient | null = null;

/**
 * Mount the root native stack (hosting `ExperienceDetail` above the tabs — the
 * FIXED destination, `headerShown: false`) wrapping the tab navigator whose
 * Catalog tab also hosts `ExperienceDetail` (the UNFIXED destination).
 */
function renderApp(initialTab: 'Home' | 'Stats' | 'Friends'): void {
  currentInitialTab = initialTab;
  activeQueryClient = makeQueryClient();
  render(
    <QueryClientProvider client={activeQueryClient}>
      <NavigationContainer ref={navRef}>
        <RootStack.Navigator>
          <RootStack.Screen
            name="MainTabs"
            component={MainTabsNavigator}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            options={{ headerShown: false }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/**
 * Fully tear down the mounted tree between iterations / tests:
 *   1. `cleanup()` unmounts the React tree.
 *   2. The per-iteration QueryClient's caches are cleared so no query/mutation
 *      observers remain subscribed to a tree that is going away.
 *
 * Combined with the synchronous notify scheduler installed at module load (see
 * `notifyManager.setScheduler` below), this guarantees no React Query
 * batched-notify timer remains scheduled against an unmounted renderer when the
 * next iteration calls `renderApp` — the cause of the intermittent
 * "Can't access .root on unmounted test renderer" harness crash. This only
 * stabilizes lifecycle/teardown ordering; it touches no assertion.
 */
function teardownApp(): void {
  cleanup();
  if (activeQueryClient) {
    activeQueryClient.clear();
    activeQueryClient = null;
  }
}

// ---------------------------------------------------------------------------
// Per-origin drivers — navigate from the originating screen into the detail
// screen by activating a real Completed_Experience_Row / leaderboard row.
// ---------------------------------------------------------------------------

interface OriginCase {
  /** Tab to focus on mount so the origin screen is shown. */
  readonly initialTab: 'Home' | 'Stats' | 'Friends';
  /** Expected focused route name after pressing back (the origin). */
  readonly expectedRoute: string;
  /** Drive the origin screen to open ExperienceDetail. */
  readonly open: () => Promise<void>;
}

async function openFromStats(): Promise<void> {
  await screen.findByTestId('stats-screen');
  fireEvent.press(await screen.findByTestId('stats-highlight-experiences'));
  await screen.findByTestId('experiences-detail-screen');
  fireEvent.press(await screen.findByTestId('own-experience-row-0'));
}

async function openFromFriend(): Promise<void> {
  await screen.findByTestId('friend-profile-screen');
  fireEvent.press(screen.getByTestId('tab-Experiences'));
  await screen.findByTestId('friend-mode-experiences');
  fireEvent.press(await screen.findByTestId('friend-experience-row-0'));
}

async function openFromHome(): Promise<void> {
  fireEvent.press(
    await screen.findByTestId(`home-leaderboard-row-${EXPERIENCE_ID}`),
  );
}

const ORIGIN_LABELS = [
  'Stats_View',
  'Friend_Profile_View',
  'Home_View',
] as const;
type OriginLabel = (typeof ORIGIN_LABELS)[number];

const CASES: Record<OriginLabel, OriginCase> = {
  Stats_View: {
    initialTab: 'Stats',
    expectedRoute: 'ExperiencesDetail',
    open: openFromStats,
  },
  Friend_Profile_View: {
    initialTab: 'Friends',
    expectedRoute: 'FriendProfile',
    open: openFromFriend,
  },
  Home_View: { initialTab: 'Home', expectedRoute: 'Home', open: openFromHome },
};

// ===========================================================================
// Symptom A — back from a non-Catalog origin must return to that origin
// (Requirements 1.1, 1.2, 1.3).
// ===========================================================================

describe('Experience Detail back navigation — Symptom A: back returns to the originating screen', () => {
  afterEach(() => {
    teardownApp();
  });

  it('for any non-Catalog origin, opening the detail then pressing back returns to that origin', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<OriginLabel>(...ORIGIN_LABELS),
        async (originLabel) => {
          // Fresh mocks per scoped sample.
          apiRequestMock.mockReset();
          installApiRouter();

          const testCase = CASES[originLabel];
          try {
            renderApp(testCase.initialTab);

            // Open ExperienceDetail by activating the real row.
            await testCase.open();
            await waitFor(() => {
              expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
            });

            // Issue a back request (mirrors the user pressing "back").
            act(() => {
              navRef.goBack();
            });

            // Wait for the route to settle off the detail screen.
            await waitFor(() => {
              expect(navRef.getCurrentRoute()?.name).not.toBe(
                'ExperienceDetail',
              );
            });

            // EXPECTED behavior: back lands on the originating screen.
            // On unfixed code this lands on 'CatalogList' instead.
            expect(navRef.getCurrentRoute()?.name).toBe(testCase.expectedRoute);
          } finally {
            // Fully unmount + clear the per-iteration QueryClient before the
            // next scoped sample mounts a fresh tree. Lifecycle-only; the
            // assertions above are unchanged.
            teardownApp();
          }
        },
      ),
      {
        // Deterministically exercise the entire scoped origin domain.
        numRuns: ORIGIN_LABELS.length,
        examples: ORIGIN_LABELS.map((label) => [label] as [OriginLabel]),
      },
    );
  });
});

// ===========================================================================
// Symptom B — the presented detail screen shows a single themed header (no
// redundant native header bar) and a visible, accessible back control
// (Requirements 1.4, 1.5).
// ===========================================================================

describe('Experience Detail presentation — Symptom B: single themed header with an accessible back control', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    teardownApp();
  });

  it('presents one themed header (no native "Experience" header bar) and a back control with role "button"', async () => {
    renderApp('Stats');

    // Present the detail screen via a real row activation.
    await openFromStats();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });
    await screen.findByTestId('experience-detail');

    // EXPECTED: no redundant native stack header titled "Experience" above the
    // themed GradientHeader. On unfixed code the Catalog stack renders one via
    // `options={{ title: 'Experience' }}`.
    expect(screen.queryByText('Experience')).toBeNull();

    // EXPECTED: a visible, accessible back control on the screen itself. On
    // unfixed code the screen exposes no in-content back control.
    const backControl = screen.queryByRole('button', { name: /back/i });
    expect(backControl).not.toBeNull();
    expect(backControl?.props.accessibilityRole).toBe('button');
  });
});
