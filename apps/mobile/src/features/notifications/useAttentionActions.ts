/**
 * Notification_Center inline action mutations (task 11.1).
 *
 * `useAttentionActions()` builds one `useMutation` per inline action kind and
 * wires the optimistic-removal contract that Requirement 2 defines, calling each
 * domain's existing, unchanged per-item action endpoint (R2.2, R7.6):
 *
 *   friendRequest  accept  → POST /me/friend-requests/:id/accept
 *                  decline → POST /me/friend-requests/:id/decline
 *   tripInvite     accept  → POST /me/trip-invites/:inviteId/accept
 *                  decline → POST /me/trip-invites/:inviteId/decline
 *   rodeWithTag    confirm → POST /me/rode-with-tags/:tagId/confirm  (optional {rating})
 *                  decline → POST /me/rode-with-tags/:tagId/decline
 *   share          markRead→ POST /me/inbox/:shareId/open
 *
 * Optimistic-removal contract (R2.4–R2.8, R5.2, R5.3):
 *
 * - `onMutate` snapshots the affected Domain_Source's cached read and
 *   optimistically removes the item from it. Because the Attention_Feed and the
 *   Attention_Badge both derive from these same cached reads (`useAttention` /
 *   `useAttentionBadge`), the item disappears from the feed and the badge count
 *   drops by one with no separate counter to keep in sync (badge = list length).
 * - When the action endpoint returns **any** response — a 2xx success or a
 *   non-2xx error envelope — the item stays removed and the affected source is
 *   invalidated so it refreshes within the Load_Deadline (R2.4, R2.5, R2.7,
 *   R2.8). A returned error is mapped to a per-item indication: the domain's
 *   "no longer available" codes (`friendship_not_found`, `trip_not_found` /
 *   `trip_forbidden` / `trip_invite_state_invalid` / `trip_tag_state_invalid`,
 *   and the inbox not-found `validation_failed`) surface "no longer available"
 *   (R2.8); every other returned failure surfaces "action did not complete"
 *   (R2.7).
 * - When the endpoint does **not** return a response within the 10s
 *   Load_Deadline — a timeout/abort or a transport error with no response — the
 *   snapshot is restored so the item reappears, and "action did not complete" is
 *   surfaced (R2.6).
 *
 * The distinction between "returned a response" and "no response" is made inside
 * the mutation function: a resolved `ApiError` (the server answered with a
 * non-2xx envelope) is captured and returned as data so the success path keeps
 * the item removed, while an abort/transport rejection is re-thrown so the error
 * path restores the snapshot. This is what makes R2.6 (restore) and R2.7/R2.8
 * (keep removed) mutually exclusive and driven purely by whether a response came
 * back.
 *
 * Validates: Requirements 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 5.2, 5.3, 7.6
 */

import { useCallback, useMemo, useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  AttentionDomain,
  AttentionItem,
  ErrorCode,
  InboxResponse,
  PendingRodeWithTagDTO,
  TripIncomingInviteDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { attentionKeys } from './useAttention';

// ---------------------------------------------------------------------------
// Load_Deadline
// ---------------------------------------------------------------------------

/**
 * The 10-second per-attempt Load_Deadline applied to every inline action, the
 * same ceiling the read fan-out uses (R2.6). A fresh `AbortController` arms this
 * timer per attempt; when it elapses the in-flight request is aborted and the
 * action resolves as "no response", restoring the optimistic removal.
 */
export const ACTION_DEADLINE_MS = 10_000;

// ---------------------------------------------------------------------------
// Raw cached read shapes (mirror `useAttention`'s query shapes)
// ---------------------------------------------------------------------------

/**
 * One incoming-request row of `GET /me/friends`.`incomingRequests`, the raw
 * shape cached under `['friends']` before `useAttention`'s `select` maps it to
 * an `AttentionItem`. Optimistic removal edits this cached shape, not the
 * derived items.
 */
interface IncomingFriendRequestRow {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

/** The cached `GET /me/friends` response subset the fan-out reads. */
interface FriendsReadResponse {
  readonly incomingRequests: readonly IncomingFriendRequestRow[];
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Which returned `ApiError.code`s mean the underlying item is no longer pending
 * or no longer available for each domain (R2.8). Any returned failure whose code
 * is not in the domain's set is treated as a generic "action did not complete"
 * (R2.7). The sets are domain-scoped so a code like the inbox not-found
 * `validation_failed` maps to "no longer available" only for a Share, while an
 * unrelated validation failure elsewhere stays a generic failure.
 */
const NO_LONGER_AVAILABLE_CODES: Readonly<
  Record<AttentionDomain, ReadonlySet<ErrorCode>>
> = {
  // Friend-request accept/decline collapses a missing/foreign request to
  // `friendship_not_found` (404).
  friendRequest: new Set<ErrorCode>(['friendship_not_found']),
  // Trip-invite accept/decline: a gone invite is the non-probing
  // `trip_not_found`; a request not addressed to the caller is `trip_forbidden`;
  // an already-handled (non-pending) invite is `trip_invite_state_invalid`.
  tripInvite: new Set<ErrorCode>([
    'trip_not_found',
    'trip_forbidden',
    'trip_invite_state_invalid',
  ]),
  // Rode-with confirm/decline: gone tag → `trip_not_found`; not the
  // Tagged_Member → `trip_forbidden`; already confirmed/declined →
  // `trip_tag_state_invalid`.
  rodeWithTag: new Set<ErrorCode>([
    'trip_not_found',
    'trip_forbidden',
    'trip_tag_state_invalid',
  ]),
  // Share open: "no such share" and "not addressed to this recipient" both
  // collapse to a `validation_failed` inbox not-found.
  share: new Set<ErrorCode>(['validation_failed']),
};

/** User-facing message for a Pending_Item that is no longer available (R2.8). */
export const ITEM_UNAVAILABLE_MESSAGE = 'This item is no longer available.';

/** User-facing message when an action did not complete (R2.6, R2.7). */
export const ACTION_INCOMPLETE_MESSAGE = 'The action did not complete.';

/**
 * The kind of inline-action failure surfaced on a row: `unavailable` when the
 * server reported the item is no longer pending/available (R2.8), `incomplete`
 * for any other returned failure or a no-response timeout (R2.6, R2.7).
 */
export type AttentionActionErrorKind = 'unavailable' | 'incomplete';

/** A per-item inline-action error the presentation layer renders on the row. */
export interface AttentionActionError {
  readonly itemId: string;
  readonly kind: AttentionActionErrorKind;
  readonly message: string;
}

/**
 * Map a **returned** `ApiError` to a per-item error indication for its domain.
 * A code in the domain's {@link NO_LONGER_AVAILABLE_CODES} set → `unavailable`
 * (R2.8); anything else → `incomplete` (R2.7).
 */
function mapReturnedError(
  domain: AttentionDomain,
  itemId: string,
  error: ApiError,
): AttentionActionError {
  const unavailable = NO_LONGER_AVAILABLE_CODES[domain].has(error.code);
  return unavailable
    ? { itemId, kind: 'unavailable', message: ITEM_UNAVAILABLE_MESSAGE }
    : { itemId, kind: 'incomplete', message: ACTION_INCOMPLETE_MESSAGE };
}

// ---------------------------------------------------------------------------
// Mutation function result
// ---------------------------------------------------------------------------

/**
 * The result of an inline action's mutation function once a response has been
 * received. `ok: true` is a 2xx; `ok: false` carries the returned `ApiError`
 * envelope. A no-response timeout/transport failure does not produce an
 * `ActionResponse` — the mutation function throws instead, so the error path
 * (restore) runs rather than the success path (keep removed).
 */
type ActionResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ApiError };

/**
 * Invoke an inline action endpoint under the {@link ACTION_DEADLINE_MS}
 * Load_Deadline and classify the outcome:
 *
 * - resolves with `{ ok: true }` on a 2xx (a response came back),
 * - resolves with `{ ok: false, error }` on a non-2xx `ApiError` (a response
 *   came back — an error envelope), so the caller keeps the item removed
 *   (R2.5, R2.7, R2.8),
 * - throws on abort (deadline elapsed) or any transport rejection with no
 *   response, so the caller restores the item (R2.6).
 *
 * A fresh `AbortController` arms the per-attempt timer and its signal is
 * threaded into {@link apiRequest}; the timer is always cleared in `finally`.
 * The timeout is recognized via `signal.aborted` rather than the rejection's
 * brand, which varies across runtimes.
 */
async function runAction(
  method: 'POST',
  endpoint: string,
  body?: unknown,
): Promise<ActionResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ACTION_DEADLINE_MS);

  try {
    await apiRequest<unknown>(method, endpoint, body, controller.signal);
    return { ok: true };
  } catch (err) {
    if (controller.signal.aborted) {
      // Deadline elapsed → no response → rethrow so the mutation's error path
      // restores the optimistically removed item (R2.6).
      throw err;
    }
    if (err instanceof ApiError) {
      // The server answered with a non-2xx envelope: a response was returned,
      // so the item stays removed and the code is mapped for the row (R2.7,
      // R2.8).
      return { ok: false, error: err };
    }
    // A transport rejection with no response (e.g. network down) → treat as
    // "no response" and restore (R2.6).
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Optimistic cache editing
// ---------------------------------------------------------------------------

/**
 * The React Query key of the Domain_Source read an action mutates, plus a pure
 * editor that removes the acted-on item from that cached read. Removing from the
 * cached read is what drives the optimistic disappearance from both the feed and
 * the badge, since both derive from these same reads.
 */
interface CachePlan {
  readonly queryKey: readonly unknown[];
  /** Remove the item identified by `itemId` from the cached read `old`. */
  readonly remove: (old: unknown, itemId: string) => unknown;
}

/** Optimistic-removal plan for the friend-request source (`['friends']`). */
const friendsPlan: CachePlan = {
  queryKey: attentionKeys.friends(),
  remove: (old, itemId) => {
    const data = old as FriendsReadResponse | undefined;
    if (data === undefined) return old;
    return {
      ...data,
      incomingRequests: data.incomingRequests.filter((r) => r.id !== itemId),
    } satisfies FriendsReadResponse;
  },
};

/** Optimistic-removal plan for the trip-invite source (`['trips','invites']`). */
const tripInvitesPlan: CachePlan = {
  queryKey: attentionKeys.tripInvites(),
  remove: (old, itemId) => {
    const data = old as readonly TripIncomingInviteDTO[] | undefined;
    if (data === undefined) return old;
    return data.filter((invite) => invite.inviteId !== itemId);
  },
};

/** Optimistic-removal plan for the rode-with source (`['rodeWithTags','pending']`). */
const rodeWithTagsPlan: CachePlan = {
  queryKey: attentionKeys.rodeWithTagsPending(),
  remove: (old, itemId) => {
    const data = old as readonly PendingRodeWithTagDTO[] | undefined;
    if (data === undefined) return old;
    return data.filter((tag) => tag.tagId !== itemId);
  },
};

/**
 * Optimistic-removal plan for the Share source (`['inbox']`). A Share is removed
 * from the Attention_Feed by flipping its cached `read` to `true` (which the
 * feed's `select` filters out) and decrementing the `unread` tally, rather than
 * dropping the row — the full inbox keeps every delivered Share for the
 * surviving Share_Inbox surface (R7.7).
 */
const inboxPlan: CachePlan = {
  queryKey: attentionKeys.inbox(),
  remove: (old, itemId) => {
    const data = old as InboxResponse | undefined;
    if (data === undefined) return old;
    const target = data.items.find((item) => item.shareId === itemId);
    if (target === undefined || target.read) return data;
    return {
      unread: Math.max(0, data.unread - 1),
      items: data.items.map((item) =>
        item.shareId === itemId ? { ...item, read: true } : item,
      ),
    } satisfies InboxResponse;
  },
};

// ---------------------------------------------------------------------------
// Mutation variables and context
// ---------------------------------------------------------------------------

/**
 * Variables passed to an inline action mutation: the acted-on Attention_Item
 * and, for a rode-with confirm only, the optional Rating. The item carries the
 * identifiers the endpoint needs via its `ref` (R2.2).
 */
interface ActionVars {
  readonly item: AttentionItem;
  readonly rating?: number | null;
}

/**
 * The snapshot captured in `onMutate` so the exact prior cached read can be
 * restored on a no-response failure (R2.6).
 */
interface ActionContext {
  readonly queryKey: readonly unknown[];
  readonly previous: unknown;
}

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

/**
 * The inline action triggers plus per-item action state the presentation layer
 * (task 13.1) renders on each row. `errors` is keyed by Attention_Item id;
 * `pendingItemIds` holds the ids with an action in flight so a row can disable
 * its controls / show a spinner. `clearError` dismisses a row's error (e.g. when
 * the user retries or the item refreshes away).
 */
export interface UseAttentionActionsResult {
  readonly acceptFriendRequest: (item: AttentionItem) => void;
  readonly declineFriendRequest: (item: AttentionItem) => void;
  readonly acceptTripInvite: (item: AttentionItem) => void;
  readonly declineTripInvite: (item: AttentionItem) => void;
  readonly confirmRodeWithTag: (
    item: AttentionItem,
    rating?: number | null,
  ) => void;
  readonly declineRodeWithTag: (item: AttentionItem) => void;
  readonly markShareRead: (item: AttentionItem) => void;
  readonly errors: Readonly<Record<string, AttentionActionError>>;
  readonly pendingItemIds: ReadonlySet<string>;
  readonly clearError: (itemId: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Build the seven inline action mutations (accept/decline friend request,
 * accept/decline trip invite, confirm/decline rode-with tag, mark share read),
 * each wiring the optimistic-removal contract of Requirement 2 against its
 * domain's unchanged endpoint.
 *
 * Every mutation shares the same `onMutate` / `onSuccess` / `onError` shape via
 * {@link useOptimisticActionOptions}, differing only in the endpoint it calls,
 * the request body it sends, and the {@link CachePlan} it edits — so the removal,
 * restore, invalidate, and error-mapping behavior is identical and testable
 * across all seven.
 */
export function useAttentionActions(): UseAttentionActionsResult {
  const queryClient = useQueryClient();

  const [errors, setErrors] = useState<Record<string, AttentionActionError>>(
    {},
  );
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const setPending = useCallback((itemId: string, pending: boolean) => {
    setPendingItemIds((prev) => {
      const next = new Set(prev);
      if (pending) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  }, []);

  const setItemError = useCallback((error: AttentionActionError) => {
    setErrors((prev) => ({ ...prev, [error.itemId]: error }));
  }, []);

  const clearError = useCallback((itemId: string) => {
    setErrors((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  /**
   * Assemble the shared `useMutation` options for one action kind. The domain,
   * cache plan, endpoint builder, and optional body builder are the only
   * per-action inputs; everything else (optimistic removal snapshot, keep-removed
   * + invalidate on any response, restore on no response, per-item error/pending
   * bookkeeping) is identical.
   */
  const buildOptions = useCallback(
    (config: {
      domain: AttentionDomain;
      plan: CachePlan;
      endpoint: (vars: ActionVars) => string;
      body?: (vars: ActionVars) => unknown;
    }) => ({
      mutationFn: (vars: ActionVars): Promise<ActionResponse> =>
        runAction(
          'POST',
          config.endpoint(vars),
          config.body ? config.body(vars) : undefined,
        ),
      onMutate: async (vars: ActionVars): Promise<ActionContext> => {
        const { plan } = config;
        const itemId = vars.item.id;
        // Clear any stale error for this row and mark it in flight.
        clearError(itemId);
        setPending(itemId, true);
        // Cancel in-flight reads for this source so a settling refetch cannot
        // clobber the optimistic removal, then snapshot and remove (R2.5).
        await queryClient.cancelQueries({ queryKey: plan.queryKey });
        const previous = queryClient.getQueryData(plan.queryKey);
        queryClient.setQueryData(plan.queryKey, (old: unknown) =>
          plan.remove(old, itemId),
        );
        return { queryKey: plan.queryKey, previous };
      },
      onSuccess: (result: ActionResponse, vars: ActionVars) => {
        // A response came back (2xx or error envelope): keep the item removed
        // and refresh the source within the deadline (R2.4, R2.5). A returned
        // error is mapped onto the row (R2.7, R2.8); the item stays removed
        // regardless.
        if (!result.ok) {
          setItemError(mapReturnedError(config.domain, vars.item.id, result.error));
        }
        void queryClient.invalidateQueries({ queryKey: config.plan.queryKey });
      },
      onError: (
        _err: unknown,
        vars: ActionVars,
        context: ActionContext | undefined,
      ) => {
        // No response within the Load_Deadline (timeout/abort or transport
        // failure): restore the snapshot so the item reappears, and surface
        // "action did not complete" (R2.6).
        if (context !== undefined) {
          queryClient.setQueryData(context.queryKey, context.previous);
        }
        setItemError({
          itemId: vars.item.id,
          kind: 'incomplete',
          message: ACTION_INCOMPLETE_MESSAGE,
        });
      },
      onSettled: (
        _result: ActionResponse | undefined,
        _err: unknown,
        vars: ActionVars,
      ) => {
        setPending(vars.item.id, false);
      },
    }),
    [queryClient, clearError, setPending, setItemError],
  );

  const acceptFriendRequestMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'friendRequest',
          plan: friendsPlan,
          endpoint: ({ item }) =>
            `/me/friend-requests/${item.ref.requestId}/accept`,
        }),
      [buildOptions],
    ),
  );

  const declineFriendRequestMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'friendRequest',
          plan: friendsPlan,
          endpoint: ({ item }) =>
            `/me/friend-requests/${item.ref.requestId}/decline`,
        }),
      [buildOptions],
    ),
  );

  const acceptTripInviteMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'tripInvite',
          plan: tripInvitesPlan,
          endpoint: ({ item }) => `/me/trip-invites/${item.ref.inviteId}/accept`,
        }),
      [buildOptions],
    ),
  );

  const declineTripInviteMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'tripInvite',
          plan: tripInvitesPlan,
          endpoint: ({ item }) =>
            `/me/trip-invites/${item.ref.inviteId}/decline`,
        }),
      [buildOptions],
    ),
  );

  const confirmRodeWithTagMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'rodeWithTag',
          plan: rodeWithTagsPlan,
          endpoint: ({ item }) =>
            `/me/rode-with-tags/${item.ref.tagId}/confirm`,
          // The rating is optional on confirm; only send a body when one was
          // provided so the server applies the default no-rating behavior.
          body: ({ rating }) =>
            rating === undefined || rating === null ? undefined : { rating },
        }),
      [buildOptions],
    ),
  );

  const declineRodeWithTagMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'rodeWithTag',
          plan: rodeWithTagsPlan,
          endpoint: ({ item }) =>
            `/me/rode-with-tags/${item.ref.tagId}/decline`,
        }),
      [buildOptions],
    ),
  );

  const markShareReadMutation = useMutation(
    useMemo(
      () =>
        buildOptions({
          domain: 'share',
          plan: inboxPlan,
          endpoint: ({ item }) => `/me/inbox/${item.ref.shareId}/open`,
        }),
      [buildOptions],
    ),
  );

  return useMemo<UseAttentionActionsResult>(
    () => ({
      acceptFriendRequest: (item) =>
        acceptFriendRequestMutation.mutate({ item }),
      declineFriendRequest: (item) =>
        declineFriendRequestMutation.mutate({ item }),
      acceptTripInvite: (item) => acceptTripInviteMutation.mutate({ item }),
      declineTripInvite: (item) => declineTripInviteMutation.mutate({ item }),
      confirmRodeWithTag: (item, rating) =>
        confirmRodeWithTagMutation.mutate(
          rating === undefined ? { item } : { item, rating },
        ),
      declineRodeWithTag: (item) => declineRodeWithTagMutation.mutate({ item }),
      markShareRead: (item) => markShareReadMutation.mutate({ item }),
      errors,
      pendingItemIds,
      clearError,
    }),
    [
      acceptFriendRequestMutation,
      declineFriendRequestMutation,
      acceptTripInviteMutation,
      declineTripInviteMutation,
      confirmRodeWithTagMutation,
      declineRodeWithTagMutation,
      markShareReadMutation,
      errors,
      pendingItemIds,
      clearError,
    ],
  );
}
