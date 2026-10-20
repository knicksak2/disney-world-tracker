/**
 * `tripSummary` Share consumers in the Inbox and the Sent list
 * (photo-uploads task 22.4, Requirements 15.2, 15.13, 15.19).
 *
 * Like `tapThroughNavigation.test.tsx`, this mounts the real `InboxScreen`
 * inside a real `NavigationContainer` that mirrors the production topology
 * (RootStack > MainTabs > YouAndCrew-like stack), so a wrong branch order
 * (the FriendProfile fallback swallowing the tap) fails here. React Navigation
 * is not mocked; only the network layer (`apiRequest`) is spied.
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
import type { InboxItemDTO, InboxResponse, SentShareDTO } from '@dwt/shared';

import * as clientModule from '../../../api/client';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';
import InboxScreen from '../InboxScreen';
import SentSharesScreen from '../SentSharesScreen';

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

const SENDER_TAP_UNAVAILABLE_COPY =
  'This friend\u2019s profile is no longer available.';

const SENDER_ID = 'sender-0001';
const SENDER_NAME = 'Minnie Mouse';
const SHARE_ID = 'share-trip-recap-1';
const TRIP_ID = 'trip-0001';
const TRIP_NAME = 'Fall 2026 Family Trip';

function tripSummaryItem(shareId: string): InboxItemDTO {
  return {
    shareId,
    read: true,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'tripSummary',
    payload: {
      kind: 'tripSummary',
      tripId: TRIP_ID,
      tripName: TRIP_NAME,
      sharerDisplayName: SENDER_NAME,
      includePhotos: true,
    },
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  };
}

function inboxResponse(item: InboxItemDTO): InboxResponse {
  return { unread: item.read ? 0 : 1, items: [item] };
}

// ---------------------------------------------------------------------------
// Navigator harness
// ---------------------------------------------------------------------------

type CrewTestStackParamList = {
  Inbox: undefined;
  FriendProfile: { friendId: string; displayName: string };
  TripRecap: { shareId: string };
};

const CrewStack = createNativeStackNavigator<CrewTestStackParamList>();
const Tab = createBottomTabNavigator<{ Friends: undefined }>();
const RootStack = createNativeStackNavigator<{ MainTabs: undefined }>();

const SentStack = createNativeStackNavigator<YouAndCrewStackParamList>();

const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

function FriendProfileStub(): JSX.Element {
  return <View testID="friend-profile-stub" />;
}

function TripRecapStub(): JSX.Element {
  return <View testID="trip-recap-stub" />;
}

function CrewTestStack(): JSX.Element {
  return (
    <CrewStack.Navigator screenOptions={{ headerShown: false }}>
      <CrewStack.Screen name="Inbox" component={InboxScreen} />
      <CrewStack.Screen name="FriendProfile" component={FriendProfileStub} />
      <CrewStack.Screen name="TripRecap" component={TripRecapStub} />
    </CrewStack.Navigator>
  );
}

function MainTabsTest(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Friends" component={CrewTestStack} />
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
        <RootStack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="MainTabs" component={MainTabsTest} />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

describe('Inbox tripSummary card (photo-uploads R15.13, R15.19)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    const realError = console.error.bind(console);
    errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
        return;
      }
      realError(...(args as []));
    });
  });
  afterAll(() => {
    errorSpy.mockRestore();
  });

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });
  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  function programInbox(item: InboxItemDTO, friendIds: readonly string[]): void {
    apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/inbox') return inboxResponse(item);
      if (path === '/me/friends') {
        return { friends: friendIds.map((userId) => ({ userId })) };
      }
      throw new Error(`unexpected apiRequest path: ${path}`);
    });
  }

  test('the card shows the trip name and "<sharer> shared a trip recap"', async () => {
    const item = tripSummaryItem(SHARE_ID);
    programInbox(item, [SENDER_ID]);
    renderInboxNavigator();

    const name = await screen.findByTestId(`inbox-trip-summary-${SHARE_ID}`);
    expect(name.props.children).toBe(TRIP_NAME);
    expect(screen.getByText(`${SENDER_NAME} shared a trip recap`)).toBeTruthy();
  });

  test('tapping the card from a sender who is still a Friend opens TripRecap with the share id and never FriendProfile', async () => {
    const item = tripSummaryItem(SHARE_ID);
    programInbox(item, [SENDER_ID]);
    renderInboxNavigator();

    fireEvent.press(await screen.findByTestId(`inbox-row-${SHARE_ID}`));

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('TripRecap');
    });
    expect(navRef.getCurrentRoute()?.params).toEqual({ shareId: SHARE_ID });
    // The FriendProfile fallback must not have swallowed the tap.
    expect(screen.queryByTestId('friend-profile-stub')).toBeNull();
    // The recap itself is read by the recap screen, not by the Inbox tap.
    expect(apiRequestSpy).not.toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/trip-recap'),
    );
  });

  test('tapping the card when the sender is no longer a Friend shows the unavailable copy and navigates nowhere (reused stillFriend pre-check)', async () => {
    const item = tripSummaryItem(SHARE_ID);
    programInbox(item, ['someone-else']);
    renderInboxNavigator();

    fireEvent.press(await screen.findByTestId(`inbox-row-${SHARE_ID}`));

    const message = await screen.findByTestId(`inbox-tap-message-${SHARE_ID}`);
    expect(message.props.children).toBe(SENDER_TAP_UNAVAILABLE_COPY);
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(screen.queryByTestId('trip-recap-stub')).toBeNull();
    expect(screen.queryByTestId('friend-profile-stub')).toBeNull();
  });

  test('a tripSummary card gets the default four reactions, not the pinShowcase subset (checklist item f)', async () => {
    const item = tripSummaryItem(SHARE_ID);
    programInbox(item, [SENDER_ID]);
    renderInboxNavigator();

    await screen.findByTestId(`inbox-reactions-${SHARE_ID}`);
    for (const value of ['like', 'love', 'been_there', 'want_to_go']) {
      expect(screen.getByTestId(`inbox-reaction-chip-${SHARE_ID}-${value}`)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Sent list
// ---------------------------------------------------------------------------

describe('SentSharesScreen tripSummary row (photo-uploads R15.6, R15.19)', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });
  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  const SENT: SentShareDTO = {
    shareId: SHARE_ID,
    payloadKind: 'tripSummary',
    payload: {
      kind: 'tripSummary',
      tripId: TRIP_ID,
      tripName: TRIP_NAME,
      sharerDisplayName: SENDER_NAME,
      includePhotos: true,
    },
    sentAt: '2024-01-02T03:04:05.000Z',
  };

  function renderSent(): void {
    apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/shares') return [SENT];
      if (path === `/me/shares/${SHARE_ID}/reactions`) return [];
      throw new Error(`unexpected apiRequest path: ${path}`);
    });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NavigationContainer>
          <SentStack.Navigator screenOptions={{ headerShown: false }}>
            <SentStack.Screen name="Sent" component={SentSharesScreen} />
          </SentStack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  test('the sender sees the trip name for a sent recap and no revoke or stop-sharing control (decision D22)', async () => {
    renderSent();

    const name = await screen.findByTestId(`sent-trip-summary-${SHARE_ID}`);
    expect(name.props.children).toBe(TRIP_NAME);
    expect(screen.queryByText(/stop sharing/i)).toBeNull();
    expect(screen.queryByText(/revoke|unsend|recall/i)).toBeNull();
    expect(screen.queryByLabelText(/stop sharing|revoke|unsend/i)).toBeNull();
  });
});
