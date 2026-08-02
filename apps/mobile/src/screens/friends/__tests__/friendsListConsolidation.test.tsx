/**
 * Friends-list consolidation example test (task 15.4).
 *
 * Validates: Requirements 7.1
 *
 * The Notification_Center is now the single in-app surface for acting on
 * pending incoming Friend_Requests. Task 15.1 removed the incoming
 * friend-request accept/decline actionable section from `FriendsListScreen`,
 * leaving the `['friends']` read in place only for the current-friends list and
 * the outgoing-request display.
 *
 * This test renders the real `FriendsStack` inside a `NavigationContainer`
 * (mirroring `friendSelectionNavigation.test.tsx`) with a `GET /me/friends`
 * response that carries an incoming Friend_Request, and asserts:
 *   1. No accept/decline actionable controls render for the incoming request
 *      (no `friends-accept-*` / `friends-decline-*` testIDs, no Accept/Decline
 *      copy, and the incoming requester's name is absent — the section is gone).
 *   2. The current-friends list itself still renders.
 *
 * Only `apiRequest` is stubbed (routed by path); `ApiError` and the rest of the
 * client are preserved via `jest.requireActual`, and the expo platform modules
 * the session store / client base URL touch are stubbed.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

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

import FriendsStack from '../../../navigation/FriendsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-02T00:00:00Z',
} as const;

const INCOMING_REQUESTER_NAME = 'Goofy Goof';

// A `GET /me/friends` response that carries a pending incoming Friend_Request
// alongside a current friend. Before consolidation the incoming request would
// have rendered an actionable accept/decline row; after task 15.1 it must not.
const FRIENDS_RESPONSE = {
  friends: [FRIEND],
  incomingRequests: [
    {
      id: 'req-incoming-1',
      otherUserId: 'user-incoming-1',
      otherDisplayName: INCOMING_REQUESTER_NAME,
      createdAt: '2024-01-03T00:00:00Z',
    },
  ],
  outgoingRequests: [],
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderFriendsStack(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <FriendsStack />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Friends list consolidation — no incoming friend-request actions (R7.1)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE as never;
      }
      if (path === '/me/inbox/unread-count') {
        return { count: 0 } as never;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  test('renders the friends list but no accept/decline controls for the incoming request', async () => {
    renderFriendsStack();

    // The current-friends list still renders.
    expect(
      await screen.findByTestId(`friends-friend-${FRIEND.userId}`),
    ).toBeTruthy();
    expect(screen.getByText(FRIEND.displayName)).toBeTruthy();

    // No accept/decline actionable controls render for the incoming request.
    expect(
      screen.queryByTestId(`friends-accept-${FRIENDS_RESPONSE.incomingRequests[0].id}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`friends-decline-${FRIENDS_RESPONSE.incomingRequests[0].id}`),
    ).toBeNull();
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();

    // The incoming section is absent entirely: the requester's name is not
    // rendered anywhere on the screen.
    expect(screen.queryByText(INCOMING_REQUESTER_NAME)).toBeNull();
  });

  test('never renders an incoming friend-request row testID', async () => {
    renderFriendsStack();

    await waitFor(() => {
      expect(screen.getByTestId(`friends-friend-${FRIEND.userId}`)).toBeTruthy();
    });

    // Any historical incoming-row testID must be gone.
    expect(
      screen.queryByTestId(
        `friends-incoming-${FRIENDS_RESPONSE.incomingRequests[0].id}`,
      ),
    ).toBeNull();
  });
});
