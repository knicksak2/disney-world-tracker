/**
 * Inbox tap-through navigation + failure-branch unit tests (task 8.4).
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6
 *
 * These tests exercise the real `InboxScreen` tap-through wiring (task 8.1)
 * inside a real `NavigationContainer` carrying the app's actual navigator
 * topology, so the cross-navigator `navigate` dispatches resolve for real
 * rather than against a mock navigator:
 *
 *   - `InboxScreen` is mounted as the initial route of a native stack that
 *     mirrors the production `FriendsStack` (Inbox + `FriendProfile`), which is
 *     the `Friends` tab of a bottom-tab `MainTabs`, which is itself the initial
 *     route of a root native stack that also hosts `ExperienceDetail` as a
 *     sibling above the tabs — exactly the composition `InboxScreen`'s
 *     `InboxNavigation` type assumes.
 *   - Selecting an available `experience` Share bubbles a `navigate` up past the
 *     tab navigator to the root stack's `ExperienceDetail` screen with the
 *     referenced `experienceId` (R5.1, R5.4).
 *   - Selecting a `progress` Share whose sender is still a Friend resolves a
 *     sibling `navigate` within the Friends stack to `FriendProfile` for the
 *     sender (R5.2).
 *   - Selecting an `experience` Share whose referenced Experience cannot be
 *     retrieved keeps the User on the Inbox and surfaces the per-share
 *     Experience-unavailable message (R5.5).
 *   - Selecting a `progress` Share whose sender is no longer a Friend keeps the
 *     User on the Inbox and surfaces the per-share sender-unavailable message
 *     (R5.6).
 *
 * Only the lowest-level `apiRequest` is mocked (routed by path); the real
 * `ApiError` and the rest of the client are preserved, and React Navigation is
 * NOT mocked. The current route is observed through a `NavigationContainer`
 * ref, mirroring the harness conventions in the navigation integration tests.
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
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { InboxItemDTO, InboxResponse } from '@dwt/shared';

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
// the screen's `instanceof ApiError` branches resolve against the genuine class.
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
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Per-share failure copy (mirrors the constants in InboxScreen.tsx).
// ---------------------------------------------------------------------------

const EXPERIENCE_TAP_UNAVAILABLE_COPY =
  'This experience is unavailable right now.';
const SENDER_TAP_UNAVAILABLE_COPY =
  'This friend\u2019s profile is no longer available.';

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

const SENDER_ID = 'sender-0001';
const SENDER_NAME = 'Minnie Mouse';
const EXPERIENCE_ID = 'exp-space-mountain-0001';

const EXPERIENCE_METADATA = {
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
} as const;

function experienceItem(shareId: string): InboxItemDTO {
  return {
    shareId,
    read: true,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'experience',
    payload: { kind: 'experience', experienceId: EXPERIENCE_ID },
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  };
}

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

// ---------------------------------------------------------------------------
// Navigator harness — mirrors the production topology so the cross-navigator
// dispatch resolves for real (RootStack ⊃ MainTabs ⊃ FriendsStack ⊃ Inbox).
// ---------------------------------------------------------------------------

type FriendsTestStackParamList = {
  Inbox: undefined;
  FriendProfile: { friendId: string; displayName: string };
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

/** Stub destinations — these tests only assert the route + params landed. */
function FriendProfileStub(): JSX.Element {
  return <View testID="friend-profile-stub" />;
}

function ExperienceDetailStub(): JSX.Element {
  return <View testID="experience-detail-stub" />;
}

function FriendsTestStack(): JSX.Element {
  return (
    <FriendsStack.Navigator screenOptions={{ headerShown: false }}>
      <FriendsStack.Screen name="Inbox" component={InboxScreen} />
      <FriendsStack.Screen name="FriendProfile" component={FriendProfileStub} />
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
// Suite
// ---------------------------------------------------------------------------

describe('Inbox tap-through navigation and failure branches (R5.1, R5.2, R5.4, R5.5, R5.6)', () => {
  // The Inbox's 10-second metadata window arms a `setTimeout`; a trailing React
  // Query notify can land just after `waitFor` resolves, surfacing a benign
  // "not wrapped in act(...)" warning. Filter just that warning while leaving
  // every other console.error intact.
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
  });

  test('selecting an available experience Share navigates cross-navigator to ExperienceDetail (R5.1, R5.4)', async () => {
    const item = experienceItem('share-exp-ok');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/inbox') return inboxResponse(item) as never;
      if (path === `/catalog/${encodeURIComponent(EXPERIENCE_ID)}`) {
        return EXPERIENCE_METADATA as never;
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R5.4: the navigation bubbles up past the tab navigator to the root
    // stack. R5.1: the destination is ExperienceDetail for the referenced id.
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });
    expect(navRef.getCurrentRoute()?.params).toEqual({
      experienceId: EXPERIENCE_ID,
    });
  });

  test('selecting a progress Share whose sender is still a Friend navigates to FriendProfile (R5.2)', async () => {
    const item = progressItem('share-prog-ok');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/inbox') return inboxResponse(item) as never;
      if (path === '/me/friends') {
        return { friends: [{ userId: SENDER_ID }] } as never;
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R5.2: the sibling navigate within the Friends stack lands on
    // FriendProfile for the sender, carrying the sender's id + display name.
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FriendProfile');
    });
    expect(navRef.getCurrentRoute()?.params).toEqual({
      friendId: SENDER_ID,
      displayName: SENDER_NAME,
      initialSection: 'comparison',
    });
  });

  test('selecting an experience Share whose Experience is unavailable keeps the User on the Inbox with a message (R5.5)', async () => {
    const item = experienceItem('share-exp-fail');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/inbox') return inboxResponse(item) as never;
      if (path === `/catalog/${encodeURIComponent(EXPERIENCE_ID)}`) {
        throw new Error('catalog unavailable');
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R5.5: the per-share Experience-unavailable message appears and the User
    // stays on the Inbox — no navigation occurs.
    const message = await screen.findByTestId(
      `inbox-tap-message-${item.shareId}`,
    );
    expect(message.props.children).toBe(EXPERIENCE_TAP_UNAVAILABLE_COPY);
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(screen.queryByTestId('experience-detail-stub')).toBeNull();
  });

  test('selecting a progress Share whose sender is no longer a Friend keeps the User on the Inbox with a message (R5.6)', async () => {
    const item = progressItem('share-prog-fail');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/inbox') return inboxResponse(item) as never;
      if (path === '/me/friends') {
        // Sender is absent from the current friends list.
        return { friends: [{ userId: 'someone-else' }] } as never;
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderInboxNavigator();

    const row = await screen.findByTestId(`inbox-row-${item.shareId}`);
    fireEvent.press(row);

    // R5.6: the per-share sender-unavailable message appears and the User stays
    // on the Inbox — no navigation occurs.
    const message = await screen.findByTestId(
      `inbox-tap-message-${item.shareId}`,
    );
    expect(message.props.children).toBe(SENDER_TAP_UNAVAILABLE_COPY);
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(screen.queryByTestId('friend-profile-stub')).toBeNull();
  });
});
