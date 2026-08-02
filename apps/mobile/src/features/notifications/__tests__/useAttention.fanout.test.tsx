/**
 * Integration tests for the Notification_Center read fan-out (task 10.6).
 *
 * Validates: Requirements 1.1, 5.1, 5.5, 6.1, 7.2, 7.4, 10.6, 11.4, 11.5, 11.6
 *
 * These are example/integration tests (not property-based). They exercise the
 * `useAttention` hook end-to-end over a real `QueryClientProvider` with the
 * lowest-level `apiRequest` mocked, mirroring the mocking convention in
 * `api/friendProfile.test.ts` and `hooks/__tests__/useOwnCompletions.test.tsx`.
 *
 * What is asserted:
 *   - On open with a valid session token, the fan-out fires all four existing
 *     per-domain read endpoints — GET /me/friends, GET /me/trip-invites,
 *     GET /me/rode-with-tags?state=pending, GET /me/inbox (R1.1, R7.2, R7.4).
 *   - No endpoint outside those four reads is requested by the fan-out (R7.2).
 *   - Each read is configured for the 60s foreground Polling_Interval
 *     (`refetchInterval: 60_000`) and a `useFocusEffect`-driven refresh re-fires
 *     all four reads on return to the screen (R5.1, R5.5, R6.1, R10.6).
 *   - When the authenticated session ends (token → null), the hook presents no
 *     items and hides the badge even though prior domain data is still cached,
 *     so nothing from the ended session leaks into a later session (R11.4,
 *     R11.5, R11.6). The React Query cache clear itself is wired centrally into
 *     the 401 → `notifyUnauthorized()` path in `RootNavigator`
 *     (`queryClient.clear()`); the observable session-end behavior tested here
 *     is the hook-level empty state.
 */

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`: the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve even though `apiRequest` is mocked.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL; never read here (the network is
// mocked) but provided so any defensive codepath in the real client module does
// not throw on import.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` so the hook's
// synthetic timeout error remains a genuine `ApiError`.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The hook refreshes all four reads on focus via `useFocusEffect`. Mount it
// standalone (no navigator) by capturing the registered focus callback so a
// test can fire it deliberately, modelling the screen regaining focus. The
// callback is NOT auto-run on mount, so the initial fan-out and the focus
// re-fire stay independently observable.
let latestFocusCallback: (() => void | (() => void)) | null = null;
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    latestFocusCallback = callback;
  },
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  InboxResponse,
  PendingRodeWithTagDTO,
  TripIncomingInviteDTO,
} from '@dwt/shared';

import { apiRequest as mockedApiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import {
  POLLING_INTERVAL_MS,
  attentionKeys,
  useAttention,
} from '../useAttention';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures — one Pending_Item per Domain_Source.
// ---------------------------------------------------------------------------

const FRIENDS_PATH = '/me/friends';
const TRIP_INVITES_PATH = '/me/trip-invites';
const RODE_WITH_PATH = '/me/rode-with-tags?state=pending';
const INBOX_PATH = '/me/inbox';

/** The complete set of read endpoints the fan-out is allowed to touch (R7.2). */
const ALLOWED_READ_PATHS = [
  FRIENDS_PATH,
  TRIP_INVITES_PATH,
  RODE_WITH_PATH,
  INBOX_PATH,
];

const FRIENDS_RESPONSE = {
  incomingRequests: [
    {
      id: 'fr-1',
      otherUserId: 'user-2',
      otherDisplayName: 'Minnie',
      createdAt: '2024-03-01T10:00:00.000Z',
    },
  ],
};

const TRIP_INVITES_RESPONSE: readonly TripIncomingInviteDTO[] = [
  {
    inviteId: 'inv-1',
    tripId: 'trip-1',
    tripName: 'Spring Break',
    startDate: '2024-04-01',
    endDate: '2024-04-05',
    inviterDisplayName: 'Goofy',
    inviterAvatarPreset: null,
    createdAt: '2024-03-02T10:00:00.000Z',
  },
];

const RODE_WITH_RESPONSE: readonly PendingRodeWithTagDTO[] = [
  {
    tagId: 'tag-1',
    tripLogEntryId: 'tle-1',
    experienceName: 'Space Mountain',
    taggingMemberDisplayName: 'Donald',
    createdAt: '2024-03-03T10:00:00.000Z',
  },
];

const INBOX_RESPONSE: InboxResponse = {
  unread: 1,
  items: [
    {
      shareId: 'share-1',
      read: false,
      senderId: 'user-3',
      senderDisplayName: 'Daisy',
      payloadKind: 'experience',
      payload: { kind: 'experience', experienceId: 'exp-1' },
      sentAt: '2024-03-04T10:00:00.000Z',
      myReaction: null,
    },
  ],
};

/**
 * Route each mocked `apiRequest` by path to its fixture response. Any path
 * outside the four reads throws loudly so a stray fan-out call is caught rather
 * than silently resolving `undefined`.
 */
function routeReadsByPath(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    switch (path) {
      case FRIENDS_PATH:
        return FRIENDS_RESPONSE as unknown;
      case TRIP_INVITES_PATH:
        return TRIP_INVITES_RESPONSE as unknown;
      case RODE_WITH_PATH:
        return RODE_WITH_RESPONSE as unknown;
      case INBOX_PATH:
        return INBOX_RESPONSE as unknown;
      default:
        throw new Error(`unexpected apiRequest path: ${String(path)}`);
    }
  });
}

/** The distinct paths the fan-out requested, in first-seen order. */
function requestedPaths(): string[] {
  return apiRequestMock.mock.calls.map((call) => String(call[1]));
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderAttention(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAttention('timestampDesc'), { wrapper });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useAttention read fan-out (R1.1, R5.1, R5.5, R6.1, R7.2, R7.4, R10.6, R11.4-R11.6)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    latestFocusCallback = null;
    // A valid authenticated session enables the four reads.
    useSessionStore.setState({ token: 'auth-token', hydrated: true });
  });

  afterEach(() => {
    // Reset inside `act` so the store update that re-renders any still-mounted
    // hook does not warn about an unwrapped state change.
    act(() => {
      useSessionStore.setState({ token: null, hydrated: true });
    });
  });

  test('opening the center fires all four reads with the correct method and path (R1.1, R7.2, R7.4)', async () => {
    routeReadsByPath();
    const client = createClient();
    const { result } = renderAttention(client);

    await waitFor(() => {
      expect(result.current.inFlight).toBe(false);
    });

    // One Attention_Item per Domain_Source landed in the feed.
    expect(result.current.state.items).toHaveLength(4);
    expect(result.current.state.badgeCount).toBe(4);

    // Every one of the four read endpoints was requested exactly once, each a GET.
    for (const path of ALLOWED_READ_PATHS) {
      const calls = apiRequestMock.mock.calls.filter((c) => c[1] === path);
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe('GET');
    }
  });

  test('the fan-out requests no endpoint outside the four reads (R7.2)', async () => {
    routeReadsByPath();
    const client = createClient();
    const { result } = renderAttention(client);

    await waitFor(() => {
      expect(result.current.inFlight).toBe(false);
    });

    for (const path of requestedPaths()) {
      expect(ALLOWED_READ_PATHS).toContain(path);
    }
    // Exactly the four reads, no more.
    expect(new Set(requestedPaths())).toEqual(new Set(ALLOWED_READ_PATHS));
  });

  test('each read is configured for the 60s foreground Polling_Interval (R5.1, R6.1, R10.6)', async () => {
    routeReadsByPath();
    const client = createClient();
    const { result } = renderAttention(client);

    await waitFor(() => {
      expect(result.current.inFlight).toBe(false);
    });

    // The Polling_Interval is the fixed 60 seconds.
    expect(POLLING_INTERVAL_MS).toBe(60_000);

    // Every read carries `refetchInterval: 60_000` so a foregrounded app
    // re-reads each Domain_Source on that cadence.
    const cache = client.getQueryCache();
    for (const queryKey of [
      attentionKeys.friends(),
      attentionKeys.tripInvites(),
      attentionKeys.rodeWithTagsPending(),
      attentionKeys.inbox(),
    ]) {
      const query = cache.find({ queryKey: [...queryKey] });
      expect(query).toBeDefined();
      // `refetchInterval` is a valid React Query option but is not surfaced on
      // the narrow `QueryOptions` type of `query.options`, so read it through a
      // typed view of the options bag to assert the configured 60s cadence.
      const options = query!.options as { readonly refetchInterval?: number };
      expect(options.refetchInterval).toBe(POLLING_INTERVAL_MS);
    }
  });

  test('regaining focus re-fires all four reads (R5.5)', async () => {
    routeReadsByPath();
    const client = createClient();
    const { result } = renderAttention(client);

    await waitFor(() => {
      expect(result.current.inFlight).toBe(false);
    });

    // The initial fan-out hit each read once.
    for (const path of ALLOWED_READ_PATHS) {
      expect(apiRequestMock.mock.calls.filter((c) => c[1] === path)).toHaveLength(1);
    }

    // Model the screen regaining focus: fire the captured `useFocusEffect`
    // callback, which refetches all four Domain_Sources.
    expect(latestFocusCallback).not.toBeNull();
    await act(async () => {
      latestFocusCallback!();
    });

    await waitFor(() => {
      for (const path of ALLOWED_READ_PATHS) {
        expect(
          apiRequestMock.mock.calls.filter((c) => c[1] === path).length,
        ).toBeGreaterThanOrEqual(2);
      }
    });

    // Still only the four reads — the focus refresh introduces no new endpoint.
    expect(new Set(requestedPaths())).toEqual(new Set(ALLOWED_READ_PATHS));
  });

  test('session end clears the feed and hides the badge even with prior data cached (R11.4, R11.5, R11.6)', async () => {
    routeReadsByPath();
    const client = createClient();
    const { result, rerender } = renderAttention(client);

    // Load a full feed under an authenticated session first.
    await waitFor(() => {
      expect(result.current.state.items).toHaveLength(4);
    });
    expect(result.current.state.badgeDisplay).toBe('count');

    // The prior session's domain data remains in the React Query cache.
    expect(client.getQueryData(attentionKeys.friends())).toBeDefined();

    // End the session.
    act(() => {
      useSessionStore.setState({ token: null });
    });
    rerender({});

    // The feed presents no items and the badge shows no count, so nothing from
    // the ended session leaks forward — despite the cache still holding data.
    expect(result.current.state.items).toHaveLength(0);
    expect(result.current.state.badgeCount).toBe(0);
    expect(result.current.state.badgeDisplay).toBe('hidden');
    expect(result.current.inFlight).toBe(false);
  });
});
