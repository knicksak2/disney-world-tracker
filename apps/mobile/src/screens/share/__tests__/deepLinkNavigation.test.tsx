/**
 * Notification tap deep-linking — Inbox destination unit tests (task 20.2).
 *
 * Validates: Requirements 10.2, 10.4
 *
 * The root notification handler (`useNotificationResponse`) forwards a
 * resolvable `shareId` to the `Inbox` as a route param (task 20.1); the Inbox
 * then continues the deep link by reusing its in-app tap-through wiring
 * (Requirement 5). These tests mount the real `InboxScreen` with a deep-link
 * `shareId` initial param inside a real `NavigationContainer` carrying the
 * app's actual navigator topology, so the cross-navigator dispatch resolves for
 * real (RootStack ⊃ MainTabs ⊃ FriendsStack ⊃ Inbox):
 *
 *   - R10.2: when the deep-linked Share still exists in the Inbox, the Inbox
 *     navigates to the Share's Requirement-5 destination and sets its
 *     `Read_State` to `read` (POST /me/inbox/:shareId/open) without any user
 *     tap.
 *   - R10.4: when the deep-linked Share is gone, the Inbox opens with its
 *     current contents and surfaces the "no longer available" message,
 *     navigating nowhere.
 *
 * Only the lowest-level `apiRequest` is mocked (routed by path); the real
 * `ApiError` and the rest of the client are preserved, and React Navigation is
 * NOT mocked.
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
import { render, screen, waitFor } from '@testing-library/react-native';

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
// Copy (mirrors the constants in InboxScreen.tsx).
// ---------------------------------------------------------------------------

const SHARE_NO_LONGER_AVAILABLE_COPY = 'That share is no longer available.';

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

/** An unread experience Share so opening it must mark it read (R10.2). */
function unreadExperienceItem(shareId: string): InboxItemDTO {
  return {
    shareId,
    read: false,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'experience',
    payload: { kind: 'experience', experienceId: EXPERIENCE_ID },
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  };
}

function inboxResponse(items: InboxItemDTO[]): InboxResponse {
  const unread = items.reduce((acc, it) => (it.read ? acc : acc + 1), 0);
  return { unread, items };
}

// ---------------------------------------------------------------------------
// Navigator harness — mirrors the production topology.
// ---------------------------------------------------------------------------

type FriendsTestStackParamList = {
  Inbox: { shareId?: string } | undefined;
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

function FriendProfileStub(): JSX.Element {
  return <View testID="friend-profile-stub" />;
}

function ExperienceDetailStub(): JSX.Element {
  return <View testID="experience-detail-stub" />;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Render the navigator with the Inbox reached via a deep-link `shareId`. */
function renderDeepLinked(shareId: string): void {
  function FriendsTestStack(): JSX.Element {
    return (
      <FriendsStack.Navigator screenOptions={{ headerShown: false }}>
        <FriendsStack.Screen
          name="Inbox"
          component={InboxScreen}
          initialParams={{ shareId }}
        />
        <FriendsStack.Screen
          name="FriendProfile"
          component={FriendProfileStub}
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

describe('Inbox notification deep-link branches (R10.2, R10.4)', () => {
  // The Inbox's 10-second metadata window arms a `setTimeout`; a trailing React
  // Query notify can land just after `waitFor` resolves, surfacing a benign
  // "not wrapped in act(...)" warning. Filter just that warning.
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

  test('R10.2 — a deep-linked Share that still exists navigates to its destination and is marked read', async () => {
    const item = unreadExperienceItem('share-deeplink-ok');
    const openCalls: string[] = [];
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/inbox') return inboxResponse([item]) as never;
      if (
        method === 'POST' &&
        path === `/me/inbox/${encodeURIComponent(item.shareId)}/open`
      ) {
        openCalls.push(path);
        return null as never;
      }
      if (path === `/catalog/${encodeURIComponent(EXPERIENCE_ID)}`) {
        return EXPERIENCE_METADATA as never;
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderDeepLinked(item.shareId);

    // R10.2: auto-drives to the ExperienceDetail destination (no user tap).
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });
    expect(navRef.getCurrentRoute()?.params).toEqual({
      experienceId: EXPERIENCE_ID,
    });
    // R10.2: the unread Share was marked read on open.
    expect(openCalls).toEqual([
      `/me/inbox/${encodeURIComponent(item.shareId)}/open`,
    ]);
  });

  test('R10.4 — a deep-linked Share that no longer exists opens the Inbox with a "no longer available" message', async () => {
    // The inbox holds a different Share; the deep-link target is absent.
    const present = unreadExperienceItem('share-present');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/inbox') return inboxResponse([present]) as never;
      if (path === `/catalog/${encodeURIComponent(EXPERIENCE_ID)}`) {
        return EXPERIENCE_METADATA as never;
      }
      throw new Error(`unexpected apiRequest path: ${String(path)}`);
    });

    renderDeepLinked('share-that-is-gone');

    // R10.4: the "no longer available" banner appears with the current contents.
    const banner = await screen.findByTestId('inbox-deeplink-message');
    expect(banner).toHaveTextContent(SHARE_NO_LONGER_AVAILABLE_COPY);
    // The current Inbox contents are still shown.
    expect(screen.getByTestId(`inbox-row-${present.shareId}`)).toBeTruthy();
    // R10.4: no navigation occurred — the User stays on the Inbox.
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(screen.queryByTestId('experience-detail-stub')).toBeNull();
  });
});
