/**
 * Friend-selection navigation test (task 8.4).
 *
 * Validates: Requirements 5.1
 *
 * R5.1 requires that selecting a Friend from the friends list navigates to
 * the Friend_Profile_View for that Friend. This test exercises the real
 * `FriendsStack` (the friends list + the registered `FriendProfile` screen)
 * inside a real `NavigationContainer`, so the `FriendRow` `onPress` →
 * `navigation.navigate('FriendProfile', { friendId, displayName })` dispatch
 * (wired in task 8.2) and the stack's screen registration are both exercised
 * for real — no mock navigator.
 *
 * The assertion is twofold:
 *   1. The `FriendProfileScreen` actually mounts (its `friend-profile-screen`
 *      testID appears) after the row is pressed.
 *   2. The selected Friend's `friendId` flows through as the route param —
 *      proven by the three friend-scoped reads firing against that exact id
 *      (`GET /users/{friendId}/profile`, `GET /me/stats/summary?for={friendId}`,
 *      `GET /users/{friendId}/completions`), which the screen keys entirely
 *      off `route.params.friendId`.
 *
 * Implementation notes mirror `src/__tests__/navigation.test.tsx`:
 *   - `apiRequest` is stubbed via `jest.mock` while `ApiError` and the rest
 *     of the client are preserved via `jest.requireActual`, so the screen's
 *     `instanceof ApiError` branches still work.
 *   - `expo-secure-store` and `expo-constants` are stubbed so neither the
 *     session store nor the client base-URL resolution touches the platform.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

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
  avatarUrl: null,
  establishedAt: '2024-01-02T00:00:00Z',
} as const;

const FRIENDS_RESPONSE = {
  friends: [FRIEND],
  incomingRequests: [],
  outgoingRequests: [],
} as const;

const ZERO_BREAKDOWN = { completed: 0, total: 0, percent: 0 } as const;

/** A fully-populated stats response so `StatsSection` renders every dimension. */
function makeStatsResponse() {
  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((c) => [c, ZERO_BREAKDOWN]),
  );
  return {
    overall: ZERO_BREAKDOWN,
    byPark: Object.fromEntries(PARKS.map((p) => [p, ZERO_BREAKDOWN])),
    byCategory,
    byParkAndCategory: Object.fromEntries(
      PARKS.map((p) => [p, byCategory]),
    ),
  };
}

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

function renderFriendsStack(): ReturnType<typeof render> {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <FriendsStack />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('friend selection navigation (R5.1)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE;
      }
      if (path === `/users/${FRIEND.userId}/profile`) {
        return {
          userId: FRIEND.userId,
          displayName: FRIEND.displayName,
          avatarUrl: null,
          overallCompletionPercent: 0,
        };
      }
      if (path === `/me/stats/summary?for=${FRIEND.userId}`) {
        return makeStatsResponse();
      }
      if (path === `/users/${FRIEND.userId}/completions`) {
        return { entries: [] };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  test('selecting a friend routes to FriendProfileScreen with the friendId param', async () => {
    renderFriendsStack();

    // The friends list resolves asynchronously; wait for the friend row.
    const row = await screen.findByTestId(`friends-friend-${FRIEND.userId}`);
    expect(row).toBeTruthy();

    fireEvent.press(row);

    // 1. The Friend_Profile_View must mount.
    await waitFor(() => {
      expect(screen.getByTestId('friend-profile-screen')).toBeTruthy();
    });

    // 2. The selected friendId flowed through as the route param: all three
    //    friend-scoped reads fired against that exact id.
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        `/users/${FRIEND.userId}/profile`,
        undefined,
        expect.anything(),
      );
    });
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      `/me/stats/summary?for=${FRIEND.userId}`,
      undefined,
      expect.anything(),
    );
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      `/users/${FRIEND.userId}/completions`,
      undefined,
      expect.anything(),
    );
  });
});
