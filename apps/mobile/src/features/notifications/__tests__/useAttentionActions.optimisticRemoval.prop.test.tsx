// Feature: notification-center, Property 6: Optimistic removal outcome invariant
//
// Validates: Requirements 2.4, 2.5, 2.6, 2.7, 2.8, 5.2
//
// Property 6 (from design.md → Correctness Properties):
//   For any Attention_Feed and any item in it on which an inline action is
//   activated: after the action resolves, if the action endpoint returned any
//   response (reporting success or failure), that item is absent from the feed;
//   if the action did not return within the Load_Deadline, that item is restored
//   to the feed; and in either case every other item in the feed is unchanged.
//
// Test strategy (hook-level):
//   - `useAttentionActions()` implements the optimistic-removal contract. Its
//     `onMutate` snapshots and optimistically removes the acted item from the
//     affected Domain_Source's cached read; `onSuccess` (any returned response —
//     a 2xx OR a non-2xx `ApiError` envelope) keeps it removed and invalidates;
//     `onError` (no response — an abort/timeout or a transport rejection with no
//     response) restores the snapshot.
//   - The Attention_Feed and Attention_Badge both derive from these same cached
//     reads (see `useAttention`), so the item's disappearance/reappearance is
//     driven purely by editing the cached read under its query key
//     (`['friends']`, `['trips','invites']`, `['rodeWithTags','pending']`,
//     `['inbox']`). We therefore seed the relevant cache with a target item plus
//     others, activate the action on the target, and read the resulting feed
//     membership straight off the cache (the same projection `useAttention` uses:
//     the raw list for the three list domains, and the unread subset for shares).
//   - `apiRequest` is mocked three ways across generated cases (mirroring the
//     mocking convention of `useAttention.fanout.test.tsx` /
//     `useAttentionActions.endpointMapping.prop.test.tsx`):
//       1. resolves 2xx                     → returned response → target absent
//       2. rejects with a non-2xx ApiError  → returned response → target absent
//       3. rejects with no response         → no response       → target restored
//     Outcome 3 models the Load_Deadline branch: `runAction` treats any
//     rejection that is neither a returned `ApiError` nor tied to a fired abort
//     signal as "no response" and rethrows so `onError` restores the snapshot
//     (R2.6) — the same restore path a genuine 10s deadline abort takes.
//   - `fast-check` generates the domain, an arbitrary list of items (target plus
//     others), which item is the target, the action variant, and the outcome
//     kind, at numRuns: 100 (the established mobile PBT count).

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import type {
  AttentionItem,
  InboxResponse,
  PendingRodeWithTagDTO,
  TripIncomingInviteDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store` — the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve even though `apiRequest` is mocked.
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

// Replace only `apiRequest`; preserve the real `ApiError` so a returned non-2xx
// envelope stays a genuine `ApiError` that `runAction` classifies as a response.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// `useAttentionActions` transitively imports `useAttention`, which imports
// `@react-navigation/native`'s `useFocusEffect`. It is never invoked here (we
// only render `useAttentionActions`), but the module must resolve.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useFocusEffect: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test (after the mocks above).
// ---------------------------------------------------------------------------

import { ApiError, apiRequest } from '../../../api/client';
import { attentionKeys } from '../useAttention';
import {
  useAttentionActions,
  type UseAttentionActionsResult,
} from '../useAttentionActions';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Raw cached read shapes the fan-out reads (mirror `useAttention`).
// ---------------------------------------------------------------------------

interface IncomingFriendRequestRow {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

interface FriendsReadResponse {
  readonly incomingRequests: readonly IncomingFriendRequestRow[];
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2025-01-01T00:00:00.000Z'),
  })
  .map((d) => d.toISOString());

/** One abstract pending item; adapted per-domain into its cached read shape. */
interface Seed {
  readonly id: string;
  readonly createdAt: string;
  readonly name: string;
  /** Only meaningful for the Share domain's per-recipient read state. */
  readonly read: boolean;
  readonly experienceId: string;
}

const seedArb: fc.Arbitrary<Seed> = fc.record({
  id: fc.uuid(),
  createdAt: isoDateArb,
  name: fc.string({ minLength: 1, maxLength: 20 }),
  read: fc.boolean(),
  experienceId: fc.uuid(),
});

/** A non-empty list of items with distinct ids (target plus at least one other). */
const seedsArb: fc.Arbitrary<readonly Seed[]> = fc.uniqueArray(seedArb, {
  selector: (s) => s.id,
  minLength: 2,
  maxLength: 6,
});

type Domain = 'friendRequest' | 'tripInvite' | 'rodeWithTag' | 'share';

const domainArb: fc.Arbitrary<Domain> = fc.constantFrom(
  'friendRequest',
  'tripInvite',
  'rodeWithTag',
  'share',
);

/** The three action outcome kinds Property 6 spans. */
type Outcome = 'success' | 'errorResponse' | 'noResponse';

const outcomeArb: fc.Arbitrary<Outcome> = fc.constantFrom(
  'success',
  'errorResponse',
  'noResponse',
);

// ---------------------------------------------------------------------------
// Per-domain scenario
// ---------------------------------------------------------------------------

/**
 * A fully-built test scenario for one (domain, seeds, target) triple: the query
 * key to seed, the seeded cached read, the target's `AttentionItem`, the trigger
 * that activates the inline action on it, and the two pure projections used to
 * assert the invariant — `feedIds` (the feed membership the Attention_Feed shows
 * for that cached read) and `others` (every non-target entry, for the
 * "unchanged" check).
 */
interface Scenario {
  readonly queryKey: readonly unknown[];
  readonly data: unknown;
  readonly item: AttentionItem;
  readonly trigger: (actions: UseAttentionActionsResult, item: AttentionItem) => void;
  readonly feedIds: (data: unknown) => string[];
  readonly others: (data: unknown, targetId: string) => unknown;
}

function buildScenario(
  domain: Domain,
  seeds: readonly Seed[],
  target: Seed,
  pick: boolean,
): Scenario {
  switch (domain) {
    case 'friendRequest': {
      const data: FriendsReadResponse = {
        incomingRequests: seeds.map((s) => ({
          id: s.id,
          otherUserId: `u-${s.id}`,
          otherDisplayName: s.name,
          createdAt: s.createdAt,
        })),
      };
      const item: AttentionItem = {
        domain: 'friendRequest',
        id: target.id,
        sourceTimestamp: target.createdAt,
        summary: '',
        ref: { requestId: target.id },
      };
      return {
        queryKey: attentionKeys.friends(),
        data,
        item,
        trigger: (actions, it) =>
          pick ? actions.acceptFriendRequest(it) : actions.declineFriendRequest(it),
        feedIds: (d) =>
          (d as FriendsReadResponse).incomingRequests.map((r) => r.id),
        others: (d, targetId) =>
          (d as FriendsReadResponse).incomingRequests.filter(
            (r) => r.id !== targetId,
          ),
      };
    }
    case 'tripInvite': {
      const data: readonly TripIncomingInviteDTO[] = seeds.map((s) => ({
        inviteId: s.id,
        tripId: `t-${s.id}`,
        tripName: s.name,
        startDate: '2024-01-01',
        endDate: '2024-01-05',
        inviterDisplayName: s.name,
        inviterAvatarPreset: null,
        createdAt: s.createdAt,
      }));
      const item: AttentionItem = {
        domain: 'tripInvite',
        id: target.id,
        sourceTimestamp: target.createdAt,
        summary: '',
        ref: { inviteId: target.id, tripId: `t-${target.id}` },
      };
      return {
        queryKey: attentionKeys.tripInvites(),
        data,
        item,
        trigger: (actions, it) =>
          pick ? actions.acceptTripInvite(it) : actions.declineTripInvite(it),
        feedIds: (d) =>
          (d as readonly TripIncomingInviteDTO[]).map((i) => i.inviteId),
        others: (d, targetId) =>
          (d as readonly TripIncomingInviteDTO[]).filter(
            (i) => i.inviteId !== targetId,
          ),
      };
    }
    case 'rodeWithTag': {
      const data: readonly PendingRodeWithTagDTO[] = seeds.map((s) => ({
        tagId: s.id,
        tripLogEntryId: `tle-${s.id}`,
        experienceName: s.name,
        taggingMemberDisplayName: s.name,
        createdAt: s.createdAt,
      }));
      const item: AttentionItem = {
        domain: 'rodeWithTag',
        id: target.id,
        sourceTimestamp: target.createdAt,
        summary: '',
        ref: { tagId: target.id, tripLogEntryId: `tle-${target.id}` },
      };
      return {
        queryKey: attentionKeys.rodeWithTagsPending(),
        data,
        item,
        trigger: (actions, it) =>
          pick ? actions.confirmRodeWithTag(it) : actions.declineRodeWithTag(it),
        feedIds: (d) => (d as readonly PendingRodeWithTagDTO[]).map((t) => t.tagId),
        others: (d, targetId) =>
          (d as readonly PendingRodeWithTagDTO[]).filter(
            (t) => t.tagId !== targetId,
          ),
      };
    }
    case 'share': {
      // The Share feed is the unread subset of the inbox. The target must be
      // unread so it is present in the feed and removable (a Share disappears by
      // flipping its cached `read` to true, which the feed's select filters out).
      const data: InboxResponse = {
        items: seeds.map((s) => ({
          shareId: s.id,
          read: s.id === target.id ? false : s.read,
          senderId: `u-${s.id}`,
          senderDisplayName: s.name,
          payloadKind: 'experience',
          payload: { kind: 'experience', experienceId: s.experienceId },
          sentAt: s.createdAt,
          myReaction: null,
        })),
        unread: seeds.filter((s) => (s.id === target.id ? true : !s.read)).length,
      };
      const item: AttentionItem = {
        domain: 'share',
        id: target.id,
        sourceTimestamp: target.createdAt,
        summary: '',
        ref: { shareId: target.id },
      };
      return {
        queryKey: attentionKeys.inbox(),
        data,
        item,
        // Share supports only mark-read (`pick` is irrelevant).
        trigger: (actions, it) => actions.markShareRead(it),
        feedIds: (d) =>
          (d as InboxResponse).items.filter((i) => !i.read).map((i) => i.shareId),
        others: (d, targetId) =>
          (d as InboxResponse).items.filter((i) => i.shareId !== targetId),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // `gcTime: Infinity` keeps the seeded Domain_Source read in the cache even
      // though this hook-only render has no observer for the read query — so the
      // optimistic edit has something to act on and the assertions can read the
      // resulting feed off the cache. A fresh client per run keeps runs isolated.
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderActions(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAttentionActions(), { wrapper });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

describe('Property 6: Optimistic removal outcome invariant (R2.4, R2.5, R2.6, R2.7, R2.8, R5.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('keeps the item removed on any returned response, restores it on no response, and never touches other items', async () => {
    await fc.assert(
      fc.asyncProperty(
        domainArb,
        seedsArb,
        fc.nat(),
        fc.boolean(),
        outcomeArb,
        async (domain, seeds, rawIndex, pick, outcome) => {
          const target = seeds[rawIndex % seeds.length]!;
          const scenario = buildScenario(domain, seeds, target, pick);

          // Arm the mocked action endpoint for this outcome kind.
          apiRequestMock.mockReset();
          if (outcome === 'success') {
            // A 2xx: a response came back reporting success.
            apiRequestMock.mockResolvedValue(undefined as unknown as never);
          } else if (outcome === 'errorResponse') {
            // A non-2xx `ApiError`: a response came back reporting failure.
            apiRequestMock.mockRejectedValue(
              new ApiError({
                code: 'internal_error',
                message: 'server reported a failure',
                status: 409,
              }),
            );
          } else {
            // No response within the Load_Deadline (abort/timeout or a transport
            // rejection with no response): `runAction` rethrows → onError restores.
            apiRequestMock.mockRejectedValue(new Error('no response'));
          }

          const client = createClient();
          client.setQueryData(scenario.queryKey, scenario.data);

          const feedBefore = scenario.feedIds(scenario.data);
          const othersBefore = scenario.others(scenario.data, target.id);

          // Precondition: the target is genuinely in the feed, so its
          // disappearance/reappearance is meaningful.
          expect(feedBefore).toContain(target.id);

          const { result, unmount } = renderActions(client);

          await act(async () => {
            scenario.trigger(result.current, scenario.item);
          });

          if (outcome === 'noResponse') {
            // Wait for the terminal "action did not complete" signal, set by
            // onError *after* the snapshot has been restored.
            await waitFor(() => {
              expect(result.current.errors[target.id]?.kind).toBe('incomplete');
            });

            const after = client.getQueryData(scenario.queryKey);
            // The target is restored to the feed (R2.6, R5.2)...
            expect(scenario.feedIds(after)).toContain(target.id);
            expect(scenario.feedIds(after)).toEqual(feedBefore);
            // ...and the cached read is byte-for-byte the pre-action snapshot,
            // so every other item is unchanged too.
            expect(after).toEqual(scenario.data);
            expect(scenario.others(after, target.id)).toEqual(othersBefore);
          } else {
            // Any returned response (2xx or non-2xx envelope) keeps the item
            // removed. Removal is terminal — invalidation cannot re-add it (no
            // active read observer in this hook-only render).
            await waitFor(() => {
              expect(
                scenario.feedIds(client.getQueryData(scenario.queryKey)),
              ).not.toContain(target.id);
            });

            const after = client.getQueryData(scenario.queryKey);
            // The target is absent from the feed (R2.4, R2.5, R2.7, R2.8)...
            expect(scenario.feedIds(after)).not.toContain(target.id);
            expect(scenario.feedIds(after)).toEqual(
              feedBefore.filter((id) => id !== target.id),
            );
            // ...and every other item is exactly as it was.
            expect(scenario.others(after, target.id)).toEqual(othersBefore);
          }

          unmount();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});
