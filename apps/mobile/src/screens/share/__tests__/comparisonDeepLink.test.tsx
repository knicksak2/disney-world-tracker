/**
 * Progress_Share comparison deep-link unit tests (task 26.2).
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 *
 * These tests exercise the deep-link that carries a recipient from a tapped
 * `progress` Share in the Inbox onto the sending Friend's Progress_Comparison
 * (tasks 26.1). Two harnesses back the four branches:
 *
 *   - **Cross-navigator flow (R14.2, R14.3, R14.4 + the end-to-end R14.1).**
 *     The real `InboxScreen` and the real `FriendProfileScreen` are mounted
 *     together inside a real `NavigationContainer` whose topology mirrors
 *     production (RootStack ⊃ MainTabs ⊃ FriendsStack ⊃ {Inbox, FriendProfile},
 *     with `ExperienceDetail` a sibling above the tabs). Only the lowest-level
 *     `apiRequest` is mocked, routed by path; React Navigation is NOT mocked,
 *     so the cross-navigator `navigate` from the Inbox to the Friend_Profile_View
 *     resolves for real and the receiving screen renders against live reads.
 *       - R14.2 — a `progress` tap whose sender is still a Friend lands on
 *         `FriendProfile` carrying `{ friendId, displayName, initialSection:
 *         'comparison' }`.
 *       - R14.1 (end-to-end) — that same navigation opens the Friend_Profile_View
 *         on the Compare pane (`friend-mode-compare`, `tab-Compare` selected).
 *       - R14.3 — a `progress` tap whose sender is no longer a Friend keeps the
 *         User on the Inbox with the sender-unavailable message and never
 *         navigates.
 *       - R14.4 — when the comparison data cannot be retrieved (the viewer's
 *         own-stats read fails) the navigation still completes and the
 *         comparison-unavailable indication (`friend-comparison-unavailable`)
 *         shows.
 *
 *   - **Direct render (R14.1, focused).** The real `FriendProfileScreen` is
 *     mounted as the initial route of a minimal stack so the `initialSection`
 *     param can be varied in isolation: with `'comparison'` the screen opens on
 *     Compare; without it the screen opens on the default Overview.
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
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import {
  type InboxItemDTO,
  type InboxResponse,
  type ProfileDTO,
} from '@dwt/shared';

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

// Replace only `apiRequest`; keep the real `ApiError` (and everything else) so
// the screens' `instanceof ApiError` / `error.code` branches resolve against
// the genuine class and React Navigation is exercised for real.
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

import InboxScreen from '../InboxScreen';
import FriendProfileScreen from '../../friends/FriendProfileScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Per-share failure copy (mirrors the constant in InboxScreen.tsx).
// ---------------------------------------------------------------------------

const SENDER_TAP_UNAVAILABLE_COPY =
  'This friend\u2019s profile is no longer available.';

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

// The sender of a `progress` Share becomes the `friendId` of the
// Friend_Profile_View the deep-link opens.
const SENDER_ID = 'sender-0001';
const SENDER_NAME = 'Minnie Mouse';
// The viewer's own id, distinct from the sender so the own-path completions
// read (`/users/{ownId}/completions`) routes apart from the friend read.
const OWN_ID = 'me-0001';

function progressItem(shareId: string): InboxItemDTO {
  return {
    shareId,
    read: true,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'progress',
    payload: {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: {},
      perCategoryPercent: {},
    },
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  };
}

function inboxResponse(item: InboxItemDTO): InboxResponse {
  return { unread: item.read ? 0 : 1, items: [item] };
}

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    userId: SENDER_ID,
    displayName: SENDER_NAME,
    avatarPreset: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

function makeStats(): StatsResponse {
  return makeStatsResponse();
}

function meResponse(): unknown {
  return {
    user: { id: OWN_ID, email: 'me@test.local' },
    profile: { displayName: 'Me' },
  };
}

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
}

// ---------------------------------------------------------------------------
// Route registry — a mutable set of handlers keyed by logical read, so each
// test overrides only the branch it cares about.
// ---------------------------------------------------------------------------

type RouteHandler = () => Promise<unknown>;

interface RouteHandlers {
  inbox: RouteHandler;
  friends: RouteHandler;
  profile: RouteHandler;
  friendStats: RouteHandler;
  friendCompletions: RouteHandler;
  ownStats: RouteHandler;
  ownCompletions: RouteHandler;
  me: RouteHandler;
}

let routeHandlers: RouteHandlers;

function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me/inbox') return routeHandlers.inbox() as never;
    if (path === '/me/friends') return routeHandlers.friends() as never;
    // `/me/stats` is exact; `/me/stats/summary?for=…` is the friend read.
    if (path === '/me/stats') return routeHandlers.ownStats() as never;
    if (path.startsWith('/me/stats/summary')) {
      return routeHandlers.friendStats() as never;
    }
    if (path === '/me') return routeHandlers.me() as never;
    if (path.endsWith('/profile')) return routeHandlers.profile() as never;
    if (path.endsWith('/completions')) {
      // The own-path completions read is keyed by the viewer's own id; the
      // friend read is keyed by the sender id.
      return path.includes(OWN_ID)
        ? (routeHandlers.ownCompletions() as never)
        : (routeHandlers.friendCompletions() as never);
    }
    throw new Error(`unexpected apiRequest path: ${String(path)}`);
  });
}

/** Defaults: every read resolves so the Compare pane reaches its ready state. */
function defaultRouteHandlers(item: InboxItemDTO): RouteHandlers {
  return {
    inbox: () => Promise.resolve(inboxResponse(item)),
    friends: () => Promise.resolve({ friends: [{ userId: SENDER_ID }] }),
    profile: () => Promise.resolve(makeProfile()),
    friendStats: () => Promise.resolve(makeStats()),
    friendCompletions: () => Promise.resolve({ entries: [] }),
    ownStats: () => Promise.resolve(makeStats()),
    ownCompletions: () => Promise.resolve({ entries: [] }),
    me: () => Promise.resolve(meResponse()),
  };
}

// ---------------------------------------------------------------------------
// Navigator harness — mirrors the production topology so the cross-navigator
// dispatch resolves for real (RootStack ⊃ MainTabs ⊃ FriendsStack ⊃ Inbox),
// with the REAL FriendProfileScreen as the deep-link destination.
// ---------------------------------------------------------------------------

type FriendsTestStackParamList = {
  Inbox: undefined;
  FriendProfile: {
    friendId: string;
    displayName: string;
    initialSection?: 'comparison';
  };
};

type MainTabTestParamList = {
  Friends: undefined;
};

type RootTestStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
};

const FriendsStack = createNativeStackNavigator<FriendsTestStackParamList>();
const Tab = createBottomTabNavigator<MainTabTestParamList>();
const RootStack = createNativeStackNavigator<RootTestStackParamList>();

const navRef =
  createNavigationContainerRef<Record<string, object | undefined>>();

function ExperienceDetailStub(): JSX.Element {
  return <View testID="experience-detail-stub" />;
}

function FriendsTestStack(): JSX.Element {
  return (
    <FriendsStack.Navigator screenOptions={{ headerShown: false }}>
      <FriendsStack.Screen name="Inbox" component={InboxScreen} />
      <FriendsStack.Screen
        name="FriendProfile"
        component={FriendProfileScreen as React.ComponentType}
      />
    </FriendsStack.Navigator>
  );
}

function MainTabsTest(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Friends" component={FriendsTestStack} />
    </Tab.Navigator>
  );
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderInboxNavigator(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer ref={navRef}>
        <RootStack.Navigator
          initialRouteName="MainTabs"
          screenOptions={{ headerShown: false }}
        >
          <RootStack.Screen name="MainTabs" component={MainTabsTest} />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailStub}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Direct-render harness — the real FriendProfileScreen as the initial route of
// a minimal stack so `initialSection` can be varied in isolation (R14.1).
// ---------------------------------------------------------------------------

const DirectStack = createNativeStackNavigator();

function renderFriendProfileDirect(
  params: FriendsTestStackParamList['FriendProfile'],
): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <DirectStack.Navigator screenOptions={{ headerShown: false }}>
          <DirectStack.Screen
            name="FriendProfile"
            component={FriendProfileScreen as React.ComponentType}
            initialParams={params}
          />
        </DirectStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Progress_Share comparison deep-link (R14.1, R14.2, R14.3, R14.4)', () => {
  // The Inbox's 10 s metadata window and the friend reads' 30 s timeout arm
  // `setTimeout`s; a trailing React Query notify can land just after `waitFor`
  // resolves, surfacing a benign "not wrapped in act(...)" warning. Filter just
  // that warning while leaving every other console.error intact.
  let errorSpy: jest.SpyInstance;
  beforeAll(() => {
    const realError = console.error.bind(console);
    errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        if (
          typeof args[0] === 'string' &&
          args[0].includes('not wrapped in act')
        ) {
          return;
        }
        realError(...(args as []));
      });
  });
  afterAll(() => {
    errorSpy.mockRestore();
  });

  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  // -------------------------------------------------------------------------
  // R14.2 (+ R14.1 end-to-end) — the cross-navigator deep-link and its params
  // -------------------------------------------------------------------------
  test('R14.2: tapping a progress Share navigates cross-stack to FriendProfile with initialSection=comparison', async () => {
    const item = progressItem('share-prog-deeplink');
    routeHandlers = defaultRouteHandlers(item);

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R14.2: the navigate bubbles up to present FriendProfile from its
    // FriendsStack host, carrying the sender identity plus the comparison hint.
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FriendProfile');
    });
    expect(navRef.getCurrentRoute()?.params).toEqual({
      friendId: SENDER_ID,
      displayName: SENDER_NAME,
      initialSection: 'comparison',
    });
  });

  test('R14.1: the deep-linked FriendProfile opens on the Compare pane', async () => {
    const item = progressItem('share-prog-opens-compare');
    routeHandlers = defaultRouteHandlers(item);

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R14.1: the Progress_Comparison (Compare pane) is the initially visible
    // section, and its tab is the selected one on first render.
    const compareTab = await screen.findByTestId('tab-Compare');
    expect(compareTab.props.accessibilityState?.selected).toBe(true);
    expect(screen.getByTestId('friend-mode-compare')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R14.3 — sender no longer a Friend keeps the User on the Inbox
  // -------------------------------------------------------------------------
  test('R14.3: a progress Share whose sender is no longer a Friend keeps the User on the Inbox with a message and does not navigate', async () => {
    const item = progressItem('share-prog-not-friend');
    routeHandlers = defaultRouteHandlers(item);
    // Sender is absent from the current friends list.
    routeHandlers.friends = () =>
      Promise.resolve({ friends: [{ userId: 'someone-else' }] });

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R14.3: the per-share sender-unavailable message appears, the User stays
    // on the Inbox, and no navigation to FriendProfile occurs.
    const message = await screen.findByTestId(
      `inbox-tap-message-${item.shareId}`,
    );
    expect(message.props.children).toBe(SENDER_TAP_UNAVAILABLE_COPY);
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(screen.queryByTestId('friend-mode-compare')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.4 — navigation completes and the comparison-unavailable indication shows
  // -------------------------------------------------------------------------
  test('R14.4: when the comparison data cannot be retrieved, navigation completes and the comparison-unavailable indication shows', async () => {
    const item = progressItem('share-prog-comparison-fail');
    routeHandlers = defaultRouteHandlers(item);
    // The viewer's own-stats read fails, so the Progress_Comparison cannot be
    // derived even though the navigation itself succeeds.
    routeHandlers.ownStats = () => Promise.reject(transientError());

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R14.4: the navigation still completes onto the Compare pane...
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FriendProfile');
    });
    // ...and the comparison-unavailable indication (Requirement 12) surfaces.
    expect(
      await screen.findByTestId('friend-comparison-unavailable'),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R14.1 (focused) — the initialSection param drives the opening pane
  // -------------------------------------------------------------------------
  describe('FriendProfileScreen initialSection param (R14.1)', () => {
    beforeEach(() => {
      // The direct-render tests only need the friend/own reads; reuse the
      // default resolving handlers keyed off a placeholder item.
      routeHandlers = defaultRouteHandlers(progressItem('unused'));
    });

    test('with initialSection=comparison the screen opens on the Compare pane', async () => {
      renderFriendProfileDirect({
        friendId: SENDER_ID,
        displayName: SENDER_NAME,
        initialSection: 'comparison',
      });

      const compareTab = await screen.findByTestId('tab-Compare');
      expect(compareTab.props.accessibilityState?.selected).toBe(true);
      expect(screen.getByTestId('friend-mode-compare')).toBeTruthy();
      expect(screen.queryByTestId('friend-mode-overview')).toBeNull();
    });

    test('without initialSection the screen opens on the default Overview pane', async () => {
      renderFriendProfileDirect({
        friendId: SENDER_ID,
        displayName: SENDER_NAME,
      });

      const overviewTab = await screen.findByTestId('tab-Overview');
      expect(overviewTab.props.accessibilityState?.selected).toBe(true);
      expect(screen.getByTestId('friend-mode-overview')).toBeTruthy();
      expect(screen.queryByTestId('friend-mode-compare')).toBeNull();
    });
  });
});
