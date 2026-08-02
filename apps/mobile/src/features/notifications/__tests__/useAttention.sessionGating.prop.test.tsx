// Feature: notification-center, Property 13: Session gating
//
// Validates: Requirements 11.2, 11.3
//
// Property 13 (from design.md → Correctness Properties):
//   With no authenticated session, the Notification_Center presents no Pending_Items
//   and the Attention_Badge shows no count — regardless of any Domain_Source data
//   still sitting in the React Query cache from a prior session (R11.2, R11.3).
//
// Test strategy (hook-level):
//   - `useAttention(sortMode)` gates every Domain_Source read on
//     `useSessionStore((s) => s.token)`. When the token is `null` there is no
//     authenticated session, so all four reads are `enabled: false` (they never
//     fire through `apiRequest`) and the hook short-circuits to an empty
//     AttentionState (no items, hidden badge).
//   - This property proves the gating is a hard cut, not merely "don't fetch":
//     even when the shared cache is pre-seeded with arbitrary prior-session
//     domain data under the exact query keys the hook reads
//     (`['friends']`, `['trips','invites']`, `['rodeWithTags','pending']`,
//     `['inbox']`), the derived feed is empty and the badge is hidden. Cached
//     data must not leak into a session-less render.
//   - Mocking mirrors the mobile hook-test convention (see
//     `hooks/__tests__/useOwnCompletions.test.tsx`): the platform modules the
//     real `api/client` loads are stubbed, only `apiRequest` is replaced (so we
//     can assert it is never called), and `@react-navigation/native`'s
//     `useFocusEffect` is inert since the session-less hook must not force any
//     read.
//   - `fast-check` generates the arbitrary cached domain payloads plus the
//     active SortMode, at numRuns: 100 (the established mobile PBT count). No
//     async settling is needed: with no session the hook returns the idle empty
//     state synchronously from `useMemo`.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import fc from 'fast-check';

import type { SortMode } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store` — the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL, read by the client at load time.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` and everything else.
// We assert it is never called: with no session the reads are disabled.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The hook wires a `useFocusEffect` focus-refresh. With no session the hook's
// callback returns early, and this property never simulates focus, so the
// hook's focus effect is inert here.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useFocusEffect: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test (after the mocks above).
// ---------------------------------------------------------------------------

import { apiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import { attentionKeys, useAttention } from '../useAttention';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Generators — arbitrary prior-session domain data for each Domain_Source key.
// ---------------------------------------------------------------------------

const isoDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2025-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** `GET /me/friends` cache shape the fan-out reads (`incomingRequests`). */
const friendsCacheArb = fc.record({
  incomingRequests: fc.array(
    fc.record({
      id: fc.uuid(),
      otherUserId: fc.uuid(),
      otherDisplayName: fc.string({ minLength: 1, maxLength: 24 }),
      createdAt: isoDateArb,
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

/** `GET /me/trip-invites` cache shape (array of pending invites). */
const tripInvitesCacheArb = fc.array(
  fc.record({
    id: fc.uuid(),
    tripId: fc.uuid(),
    inviterId: fc.uuid(),
    inviterDisplayName: fc.string({ minLength: 1, maxLength: 24 }),
    createdAt: isoDateArb,
  }),
  { minLength: 1, maxLength: 8 },
);

/** `GET /me/rode-with-tags?state=pending` cache shape (array of pending tags). */
const rodeWithTagsCacheArb = fc.array(
  fc.record({
    id: fc.uuid(),
    taggerId: fc.uuid(),
    taggerDisplayName: fc.string({ minLength: 1, maxLength: 24 }),
    createdAt: isoDateArb,
  }),
  { minLength: 1, maxLength: 8 },
);

/** `GET /me/inbox` cache shape (`items`, a mix with unread entries). */
const inboxCacheArb = fc.record({
  items: fc.array(
    fc.record({
      shareId: fc.uuid(),
      read: fc.boolean(),
      createdAt: isoDateArb,
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

const sortModeArb: fc.Arbitrary<SortMode> = fc.constantFrom(
  'timestampDesc',
  'groupByDomain',
);

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

/**
 * A fresh client with a pre-seeded cache carrying arbitrary prior-session data
 * under every Domain_Source key the hook reads. `retry: false` / `gcTime: 0`
 * keep the client inert between runs.
 */
function seededClient(
  friends: unknown,
  tripInvites: unknown,
  rodeWithTags: unknown,
  inbox: unknown,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  client.setQueryData(attentionKeys.friends(), friends);
  client.setQueryData(attentionKeys.tripInvites(), tripInvites);
  client.setQueryData(attentionKeys.rodeWithTagsPending(), rodeWithTags);
  client.setQueryData(attentionKeys.inbox(), inbox);
  return client;
}

function renderAttention(client: QueryClient, sortMode: SortMode) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAttention(sortMode), { wrapper });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

describe('Property 13: Session gating (R11.2, R11.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    // No authenticated session. `hydrated: true` mirrors a fully-loaded store
    // that simply has no token (e.g. after logout / before login).
    useSessionStore.setState({ token: null, hydrated: true });
  });

  afterAll(() => {
    useSessionStore.setState({ token: null, hydrated: false });
  });

  it('presents no items and a hidden badge with no session, ignoring cached prior-session data', () => {
    fc.assert(
      fc.property(
        friendsCacheArb,
        tripInvitesCacheArb,
        rodeWithTagsCacheArb,
        inboxCacheArb,
        sortModeArb,
        (friends, tripInvites, rodeWithTags, inbox, sortMode) => {
          const client = seededClient(friends, tripInvites, rodeWithTags, inbox);

          // Sanity: the cache genuinely holds prior-session domain data, so an
          // empty feed proves gating, not an empty cache.
          expect(client.getQueryData(attentionKeys.friends())).toBe(friends);
          expect(client.getQueryData(attentionKeys.inbox())).toBe(inbox);

          const { result, unmount } = renderAttention(client, sortMode);

          const { state, inFlight } = result.current;

          // The Attention_Feed presents no Pending_Items (R11.2).
          expect(state.items).toEqual([]);
          expect(state.items).toHaveLength(0);

          // The Attention_Badge shows no count: count zero → hidden (R11.3).
          expect(state.badgeCount).toBe(0);
          expect(state.badgeDisplay).toBe('hidden');

          // Nothing failed and nothing is loading — the hook is fully idle,
          // not merely mid-flight.
          expect(state.failedDomains).toEqual([]);
          expect(result.current.outcomes).toEqual([]);
          expect(inFlight).toBe(false);

          // The reads are gated off entirely: no Domain_Source read ever fired.
          expect(apiRequestMock).not.toHaveBeenCalled();

          unmount();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
