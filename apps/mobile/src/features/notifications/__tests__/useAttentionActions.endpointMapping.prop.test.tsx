// Feature: notification-center, Property 5: Inline action endpoint mapping
//
// Validates: Requirements 2.2, 7.6
//
// Property 5 (from design.md → Correctness Properties):
//   For any Attention_Item and any inline action valid for its domain,
//   activating that action invokes exactly that domain's existing per-item
//   action endpoint — with the HTTP method, path, and identifiers dictated by
//   the item's domain and its identifiers (and the optional rating for a
//   rode-with confirm) — and invokes no other endpoint (R2.2, R7.6).
//
// Endpoint map (design.md → inline-action endpoint table, all existing/unchanged):
//   friendRequest accept  → POST /me/friend-requests/:requestId/accept
//                 decline → POST /me/friend-requests/:requestId/decline
//   tripInvite    accept  → POST /me/trip-invites/:inviteId/accept
//                 decline → POST /me/trip-invites/:inviteId/decline
//   rodeWithTag   confirm → POST /me/rode-with-tags/:tagId/confirm  (body {rating} only when a rating is provided)
//                 decline → POST /me/rode-with-tags/:tagId/decline
//   share         markRead→ POST /me/inbox/:shareId/open
//
// Test strategy (hook-level):
//   - `useAttentionActions()` exposes one trigger per inline action. Each
//     trigger takes an Attention_Item whose `ref` carries the identifiers the
//     endpoint interpolates, and calls `apiRequest('POST', endpoint, body?, signal)`
//     under a 10s AbortController.
//   - We render the hook over a real `QueryClientProvider` with the lowest-level
//     `apiRequest` mocked (resolving success), mirroring the mocking convention
//     of `useAttention.fanout.test.tsx` / `useAttention.sessionGating.prop.test.tsx`
//     (stub `expo-secure-store` + `expo-constants`, replace only `apiRequest`,
//     inert `@react-navigation/native`).
//   - `fast-check` generates an arbitrary Attention_Item for a domain, a valid
//     action for that domain, and (for a rode-with confirm) an optional rating,
//     at numRuns: 100 (the established mobile PBT count). For each case we
//     activate the trigger and assert `apiRequest` was called exactly once with
//     method 'POST', the exact expected path (identifiers interpolated), and the
//     correct body (a `{rating}` object only for confirm-with-rating, `undefined`
//     otherwise) — so the single call proves both "the right endpoint" and "no
//     other endpoint".

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import type { AttentionItem } from '@dwt/shared';

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

// Replace only `apiRequest`; preserve the real `ApiError` and everything else.
// The mock resolves success so each inline action reaches its keep-removed
// success path; the assertions are on how it was called.
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

import { apiRequest } from '../../../api/client';
import {
  useAttentionActions,
  type UseAttentionActionsResult,
} from '../useAttentionActions';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2025-01-01T00:00:00.000Z'),
  })
  .map((d) => d.toISOString());

/** A realistic non-empty domain identifier (uuid-shaped). */
const idArb: fc.Arbitrary<string> = fc.uuid();

/** A short human-readable summary stand-in (its content is not asserted). */
const summaryArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });

/**
 * One generated inline-action case: the domain, which trigger to fire, the
 * Attention_Item to fire it on, the exact endpoint that firing must invoke, and
 * the exact request body it must send.
 */
interface ActionCase {
  readonly label: string;
  readonly trigger: (actions: UseAttentionActionsResult) => void;
  readonly item: AttentionItem;
  readonly expectedPath: string;
  readonly expectedBody: unknown;
}

/** Friend_Request accept/decline → POST /me/friend-requests/:requestId/(accept|decline). */
const friendRequestCaseArb: fc.Arbitrary<ActionCase> = fc.record({
  requestId: idArb,
  sourceTimestamp: isoDateArb,
  summary: summaryArb,
  action: fc.constantFrom<'accept' | 'decline'>('accept', 'decline'),
}).map(({ requestId, sourceTimestamp, summary, action }) => {
  const item: AttentionItem = {
    domain: 'friendRequest',
    id: requestId,
    sourceTimestamp,
    summary,
    ref: { requestId },
  };
  return {
    label: `friendRequest.${action}`,
    trigger: (actions) =>
      action === 'accept'
        ? actions.acceptFriendRequest(item)
        : actions.declineFriendRequest(item),
    item,
    expectedPath: `/me/friend-requests/${requestId}/${action}`,
    expectedBody: undefined,
  };
});

/** Trip_Invite accept/decline → POST /me/trip-invites/:inviteId/(accept|decline). */
const tripInviteCaseArb: fc.Arbitrary<ActionCase> = fc.record({
  inviteId: idArb,
  tripId: idArb,
  sourceTimestamp: isoDateArb,
  summary: summaryArb,
  action: fc.constantFrom<'accept' | 'decline'>('accept', 'decline'),
}).map(({ inviteId, tripId, sourceTimestamp, summary, action }) => {
  const item: AttentionItem = {
    domain: 'tripInvite',
    id: inviteId,
    sourceTimestamp,
    summary,
    ref: { inviteId, tripId },
  };
  return {
    label: `tripInvite.${action}`,
    trigger: (actions) =>
      action === 'accept'
        ? actions.acceptTripInvite(item)
        : actions.declineTripInvite(item),
    item,
    expectedPath: `/me/trip-invites/${inviteId}/${action}`,
    expectedBody: undefined,
  };
});

/**
 * Rode_With_Tag confirm/decline → POST /me/rode-with-tags/:tagId/(confirm|decline).
 * On confirm the rating is optional: a numeric rating sends `{ rating }`, while
 * an omitted (`undefined`) or explicit `null` rating sends no body.
 */
const rodeWithTagCaseArb: fc.Arbitrary<ActionCase> = fc.record({
  tagId: idArb,
  tripLogEntryId: idArb,
  sourceTimestamp: isoDateArb,
  summary: summaryArb,
  action: fc.constantFrom<'confirm' | 'decline'>('confirm', 'decline'),
  rating: fc.oneof(
    fc.constant<number | null | undefined>(undefined),
    fc.constant<number | null | undefined>(null),
    fc.integer({ min: 1, max: 5 }),
  ),
}).map(({ tagId, tripLogEntryId, sourceTimestamp, summary, action, rating }) => {
  const item: AttentionItem = {
    domain: 'rodeWithTag',
    id: tagId,
    sourceTimestamp,
    summary,
    ref: { tagId, tripLogEntryId },
  };
  if (action === 'confirm') {
    const hasRating = typeof rating === 'number';
    return {
      label: `rodeWithTag.confirm${hasRating ? `(rating=${rating})` : ''}`,
      trigger: (actions) => actions.confirmRodeWithTag(item, rating),
      item,
      expectedPath: `/me/rode-with-tags/${tagId}/confirm`,
      // A body is sent only when a numeric rating was provided (R2.2).
      expectedBody: hasRating ? { rating } : undefined,
    };
  }
  return {
    label: 'rodeWithTag.decline',
    trigger: (actions) => actions.declineRodeWithTag(item),
    item,
    expectedPath: `/me/rode-with-tags/${tagId}/decline`,
    expectedBody: undefined,
  };
});

/** Share mark-read → POST /me/inbox/:shareId/open. */
const shareCaseArb: fc.Arbitrary<ActionCase> = fc.record({
  shareId: idArb,
  sourceTimestamp: isoDateArb,
  summary: summaryArb,
  hasDestination: fc.boolean(),
  destinationId: idArb,
}).map(({ shareId, sourceTimestamp, summary, hasDestination, destinationId }) => {
  const item: AttentionItem = {
    domain: 'share',
    id: shareId,
    sourceTimestamp,
    summary,
    ref: hasDestination
      ? { shareId, destination: { kind: 'experience', id: destinationId } }
      : { shareId },
  };
  return {
    label: 'share.markRead',
    trigger: (actions) => actions.markShareRead(item),
    item,
    expectedPath: `/me/inbox/${shareId}/open`,
    expectedBody: undefined,
  };
});

/** Any valid (domain, action) inline-action case. */
const actionCaseArb: fc.Arbitrary<ActionCase> = fc.oneof(
  friendRequestCaseArb,
  tripInviteCaseArb,
  rodeWithTagCaseArb,
  shareCaseArb,
);

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

describe('Property 5: Inline action endpoint mapping (R2.2, R7.6)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    // Every inline action succeeds; the assertions are on the invocation.
    apiRequestMock.mockResolvedValue(undefined as unknown as never);
  });

  it('invokes exactly the correct domain endpoint (method, path, identifiers, optional rating) and no other', async () => {
    await fc.assert(
      fc.asyncProperty(actionCaseArb, async (testCase) => {
        apiRequestMock.mockClear();
        apiRequestMock.mockResolvedValue(undefined as unknown as never);

        const client = createClient();
        const { result, unmount } = renderActions(client);

        // Activate the inline action for this item.
        await act(async () => {
          testCase.trigger(result.current);
        });

        // The action reaches exactly one endpoint invocation.
        await waitFor(() => {
          expect(apiRequestMock).toHaveBeenCalledTimes(1);
        });

        const call = apiRequestMock.mock.calls[0]!;
        const [method, path, body] = call;

        // Exactly that domain's per-item action endpoint, with the item's
        // identifiers interpolated and the correct optional-rating body (R2.2).
        expect(method).toBe('POST');
        expect(path).toBe(testCase.expectedPath);
        expect(body).toEqual(testCase.expectedBody);

        // No other endpoint was invoked (a single call total, R7.6).
        expect(apiRequestMock).toHaveBeenCalledTimes(1);

        unmount();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
