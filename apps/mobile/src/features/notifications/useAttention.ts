/**
 * Notification_Center data/hook layer — read fan-out (task 10.1).
 *
 * `useAttention(sortMode)` fans out the four existing per-domain read endpoints
 * in parallel via TanStack React Query, adapts each raw domain response into the
 * pure model's `AttentionSourceOutcome` inputs, and reduces them with
 * `buildAttentionState` into the derived `AttentionState` that drives both the
 * Attention_Feed and the Attention_Badge (R1.1, R7.2, R7.4).
 *
 * The four reads reuse the domain screens' existing React Query keys so the
 * cache stays coherent with the surviving domain surfaces (R7.2):
 *
 *   ['friends']              → GET /me/friends            select incomingRequests
 *   ['trips','invites']      → GET /me/trip-invites
 *   ['rodeWithTags','pending'] → GET /me/rode-with-tags?state=pending  (new read)
 *   ['inbox']                → GET /me/inbox              select unread items
 *
 * This hook implements ONLY the read fan-out and the mapping to
 * `AttentionSourceOutcome` + `buildAttentionState`, returning the `AttentionState`
 * plus per-source loading/failure flags. Each read runs under a per-attempt 10s
 * Load_Deadline (`AbortController`) with `retry: false`, so a rejection, a
 * non-2xx `ApiError`, or an abort/timeout settles the query as an error that
 * derives into a `failure` outcome (task 10.2). The 60s foreground polling +
 * focus refresh and session gating / cache clearing are layered on by
 * subsequent tasks (10.3–10.4); the structure here keeps those additive — each
 * read is an independent `useQuery` whose options object those tasks extend.
 *
 * Foreground polling + focus refresh (task 10.3): every read carries
 * `refetchInterval: POLLING_INTERVAL_MS` (the 60-second Polling_Interval) so a
 * foregrounded Mobile_App re-reads every Domain_Source on that cadence, letting
 * newly pending items flow into both the Attention_Feed and the Attention_Badge
 * within one interval (R5.1, R6.1, R6.3, R10.6). A `useFocusEffect` refetches
 * all four reads when the Notification_Center regains focus, so items resolved
 * elsewhere no longer appear on return (R5.5).
 *
 * Session gating + cache clearing (task 10.4): the hook subscribes to
 * `sessionStore.token`. While no authenticated session exists all four reads
 * are `enabled: false` and the hook short-circuits to an empty AttentionState
 * (no items, hidden badge), so nothing is presented without a session (R11.2,
 * R11.3). Clearing the React Query cache on session end is wired centrally into
 * the existing 401 → `notifyUnauthorized()` path in `RootNavigator`, which
 * calls `queryClient.clear()` alongside `clearToken()` so every Pending_Item
 * cached during a session is discarded and cannot leak into a later session for
 * a different user (R11.4, R11.5, R11.6).
 *
 * Validates: Requirements 1.1, 5.1, 5.5, 6.1, 6.3, 7.2, 7.4, 10.6, 11.2, 11.3,
 * 11.4, 11.5, 11.6
 */

import { useCallback, useMemo } from 'react';

import { useFocusEffect } from '@react-navigation/native';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  buildAttentionState,
  toAttentionItem,
  type AttentionDomain,
  type AttentionItem,
  type AttentionSourceOutcome,
  type AttentionState,
  type FriendRequestDTO,
  type InboxResponse,
  type PendingRodeWithTagDTO,
  type SortMode,
  type TripIncomingInviteDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * The four Domain_Source query keys, deliberately reusing the exact tuples the
 * surviving domain screens already register so the Notification_Center shares
 * their cache and never drifts from domain truth (R7.2):
 *
 * - `friends` matches `FriendsListScreen`'s `['friends']` read.
 * - `inbox` matches the Share Inbox's `['inbox']` read (a prefix of the badge's
 *   `['inbox','unread']` key, so an inbox invalidation refreshes both).
 * - `tripInvites` / `rodeWithTagsPending` are the trip-invite and the new
 *   rode-with pending reads.
 */
export const attentionKeys = {
  friends: () => ['friends'] as const,
  tripInvites: () => ['trips', 'invites'] as const,
  rodeWithTagsPending: () => ['rodeWithTags', 'pending'] as const,
  inbox: () => ['inbox'] as const,
};

// ---------------------------------------------------------------------------
// Load_Deadline
// ---------------------------------------------------------------------------

/**
 * The Load_Deadline: the 10-second per-attempt ceiling after which an in-flight
 * Domain_Source read is treated as failed (R8.1, R9.4). Each read attempt is
 * given its own timer, so a slow source fails on its own without holding the
 * others past their own deadlines.
 */
export const LOAD_DEADLINE_MS = 10_000;

/**
 * The Polling_Interval: the fixed 60-second cadence at which a foregrounded
 * Mobile_App refreshes every Domain_Source read (R5.1). Set as each read's
 * `refetchInterval` so a newly pending item appears in the Attention_Feed and
 * is counted by the Attention_Badge within one interval (R6.1, R6.3, R10.6).
 */
export const POLLING_INTERVAL_MS = 60_000;

/**
 * Run a single Domain_Source read under a per-attempt Load_Deadline.
 *
 * A fresh {@link AbortController} arms a `LOAD_DEADLINE_MS` timer that aborts
 * the underlying `fetch` when the deadline elapses; the controller's `signal`
 * is threaded into {@link apiRequest} so the abort actually cancels the
 * in-flight request. On abort, `fetch` rejects and `apiRequest` propagates the
 * rejection; we recognize the timeout via `signal.aborted` (not the error's
 * brand, which varies across runtimes) and re-throw a synthetic non-2xx
 * {@link ApiError} so the query settles as an error and `toOutcome` folds it
 * into a `failure` outcome (R9.4). Any non-timeout rejection — a network error
 * or a real non-2xx `ApiError` from the server — propagates unchanged and
 * likewise settles the query as an error.
 *
 * The timer is always cleared in `finally`, so a read that completes before the
 * deadline leaves no dangling timer. Callers must pair this with
 * `retry: false` so a single attempt maps to a single Load_Deadline window.
 */
async function withLoadDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, LOAD_DEADLINE_MS);

  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      // Synthetic non-2xx failure so the query settles as an error the
      // reducer records as a failed Domain_Source (R8.1, R9.4).
      throw new ApiError({
        code: 'internal_error',
        message: 'The request took too long to complete. Please try again.',
        status: 0,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Raw wire shapes
// ---------------------------------------------------------------------------

/**
 * One incoming-request row of `GET /me/friends`.`incomingRequests`. This is the
 * runtime shape the friends read actually returns (mirrors
 * `FriendRequestListEntry` in `FriendsListScreen`): unlike the shared
 * {@link FriendRequestDTO}, it carries the other user's `otherDisplayName`, so
 * the Attention_Item summary can name the sender rather than show a bare id.
 */
interface IncomingFriendRequestRow {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

/** Response subset of `GET /me/friends` the fan-out consumes. */
interface FriendsReadResponse {
  readonly incomingRequests: readonly IncomingFriendRequestRow[];
}

// ---------------------------------------------------------------------------
// DTO adapters (raw row -> AttentionItem)
// ---------------------------------------------------------------------------

/**
 * Adapt one raw incoming-request row into an {@link AttentionItem}.
 *
 * The shared {@link FriendRequestDTO} the pure model normalizes carries only a
 * `senderId`, but the runtime `GET /me/friends` row carries the sender's
 * display name (`otherDisplayName`). To let the summary name the sender, we
 * project the display name into the DTO's `senderId` slot — the field
 * `summarize('friendRequest', …)` reads — while keeping the row's real `id` and
 * `createdAt` intact for the item id and source timestamp. `recipientId` is
 * unused by the model, so it is left empty.
 */
function adaptFriendRequest(row: IncomingFriendRequestRow): AttentionItem {
  const dto: FriendRequestDTO = {
    id: row.id,
    // Adaptation: place the display name where the summary reads the sender, so
    // the row shows a human name instead of an opaque id (see task note).
    senderId: row.otherDisplayName,
    recipientId: '',
    createdAt: row.createdAt,
  };
  return toAttentionItem('friendRequest', dto);
}

/** Adapt each pending trip invite into an {@link AttentionItem}. */
function adaptTripInvite(dto: TripIncomingInviteDTO): AttentionItem {
  return toAttentionItem('tripInvite', dto);
}

/** Adapt each pending rode-with tag into an {@link AttentionItem}. */
function adaptRodeWithTag(dto: PendingRodeWithTagDTO): AttentionItem {
  return toAttentionItem('rodeWithTag', dto);
}

/**
 * Select the unread Shares from `GET /me/inbox` and adapt each into an
 * {@link AttentionItem}. Only unread items alert in the Notification_Center; the
 * full inbox (read + unread) stays reachable via the surviving Share_Inbox
 * surface (R7.4, R7.7).
 */
function selectUnreadShares(data: InboxResponse): readonly AttentionItem[] {
  return data.items
    .filter((item) => !item.read)
    .map((item) => toAttentionItem('share', item));
}

// ---------------------------------------------------------------------------
// Per-source outcome derivation
// ---------------------------------------------------------------------------

/**
 * Per-source status flags surfaced alongside the derived state. `loading` is
 * true while a Domain_Source read has neither resolved nor failed; `failed` is
 * true once its read rejected — a non-2xx `ApiError`, a network rejection, or
 * an abort once the per-attempt Load_Deadline elapses (R8.1, R9.4).
 */
export interface AttentionSourceStatus {
  readonly loading: boolean;
  readonly failed: boolean;
}

/** The per-source status flags for each of the four Domain_Sources. */
export type AttentionSources = Readonly<
  Record<AttentionDomain, AttentionSourceStatus>
>;

/**
 * Reduce one React Query result into the pure model's per-source outcome, or
 * `null` while the read is still in flight (neither succeeded nor failed).
 * A successful read contributes its already-adapted `AttentionItem[]`; a failed
 * read contributes a `failure` outcome so the state reducer excludes it and
 * records it in `failedDomains` (R8.1).
 */
function toOutcome(
  domain: AttentionDomain,
  query: UseQueryResult<readonly AttentionItem[], ApiError>,
): AttentionSourceOutcome | null {
  if (query.isSuccess) {
    return { domain, status: 'success', items: query.data };
  }
  if (query.isError) {
    return { domain, status: 'failure' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

/**
 * What `useAttention` returns: the derived {@link AttentionState} (ordered feed
 * + badge), the resolved per-source outcomes fed to the reducer, the per-source
 * loading/failure flags, and `inFlight` (true while any read is still loading)
 * for the presentation layer's view classifier.
 */
export interface UseAttentionResult {
  readonly state: AttentionState;
  readonly outcomes: readonly AttentionSourceOutcome[];
  readonly sources: AttentionSources;
  readonly inFlight: boolean;
  /**
   * Re-request ONLY the Domain_Sources whose most recent read failed, leaving
   * the successful sources untouched (R8.2, R8.5). Each failed read re-runs
   * under its own Load_Deadline; a retried success merges with the previously
   * loaded successful items (React Query keeps their cached data), so the feed
   * and badge update to include the newly loaded items and the source drops out
   * of `failedDomains` (R8.6). A no-op while no authenticated session exists.
   */
  readonly retryFailed: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fan out the four Domain_Source reads and derive the Notification_Center's
 * {@link AttentionState} for the given {@link SortMode}.
 *
 * Each read is an independent `useQuery` keyed by its domain's existing cache
 * key and `select`-mapped straight to `AttentionItem[]`, so the reducer inputs
 * are pure model values. Only resolved sources (success or failure) become
 * outcomes; a still-loading source contributes nothing yet and is reflected in
 * `sources[domain].loading` and the aggregate `inFlight` flag instead.
 */
export function useAttention(sortMode: SortMode): UseAttentionResult {
  // Session gating (R11.2, R11.3): the Notification_Center is a private,
  // per-user surface, so every read is scoped to the authenticated session.
  // We subscribe to `sessionStore.token`; when there is no token there is no
  // authenticated session, so all four reads are `enabled: false` (they never
  // fire) and the hook returns an empty AttentionState (no items, hidden
  // badge) regardless of anything still sitting in the React Query cache. This
  // pairs with the cache clearing on session end (wired into the 401 →
  // `notifyUnauthorized()` path in `RootNavigator`, which calls
  // `queryClient.clear()`), so no Pending_Item retrieved during one session can
  // leak into a later session for a different user (R11.4, R11.6).
  const token = useSessionStore((state) => state.token);
  const enabled = token !== null;

  const friendRequestsQuery = useQuery<
    FriendsReadResponse,
    ApiError,
    readonly AttentionItem[]
  >({
    queryKey: attentionKeys.friends(),
    queryFn: () =>
      withLoadDeadline((signal) =>
        apiRequest<FriendsReadResponse>('GET', '/me/friends', undefined, signal),
      ),
    enabled,
    retry: false,
    refetchInterval: POLLING_INTERVAL_MS,
    select: (data) => data.incomingRequests.map(adaptFriendRequest),
  });

  const tripInvitesQuery = useQuery<
    readonly TripIncomingInviteDTO[],
    ApiError,
    readonly AttentionItem[]
  >({
    queryKey: attentionKeys.tripInvites(),
    queryFn: () =>
      withLoadDeadline((signal) =>
        apiRequest<readonly TripIncomingInviteDTO[]>(
          'GET',
          '/me/trip-invites',
          undefined,
          signal,
        ),
      ),
    enabled,
    retry: false,
    refetchInterval: POLLING_INTERVAL_MS,
    select: (data) => data.map(adaptTripInvite),
  });

  const rodeWithTagsQuery = useQuery<
    readonly PendingRodeWithTagDTO[],
    ApiError,
    readonly AttentionItem[]
  >({
    queryKey: attentionKeys.rodeWithTagsPending(),
    queryFn: () =>
      withLoadDeadline((signal) =>
        apiRequest<readonly PendingRodeWithTagDTO[]>(
          'GET',
          '/me/rode-with-tags?state=pending',
          undefined,
          signal,
        ),
      ),
    enabled,
    retry: false,
    refetchInterval: POLLING_INTERVAL_MS,
    select: (data) => data.map(adaptRodeWithTag),
  });

  const inboxQuery = useQuery<
    InboxResponse,
    ApiError,
    readonly AttentionItem[]
  >({
    queryKey: attentionKeys.inbox(),
    queryFn: () =>
      withLoadDeadline((signal) =>
        apiRequest<InboxResponse>('GET', '/me/inbox', undefined, signal),
      ),
    enabled,
    retry: false,
    refetchInterval: POLLING_INTERVAL_MS,
    select: selectUnreadShares,
  });

  // Refetch all four Domain_Sources when the Notification_Center regains focus
  // so items resolved elsewhere (accepted on another surface, expired, etc.) no
  // longer appear in the Attention_Feed on return (R5.5). This complements the
  // 60s foreground polling above: focus fires the moment the user comes back,
  // rather than waiting for the next poll tick.
  const { refetch: refetchFriendRequests } = friendRequestsQuery;
  const { refetch: refetchTripInvites } = tripInvitesQuery;
  const { refetch: refetchRodeWithTags } = rodeWithTagsQuery;
  const { refetch: refetchInbox } = inboxQuery;

  useFocusEffect(
    useCallback(() => {
      // Respect session gating: with no authenticated session the reads are
      // disabled, so a focus refresh must not force them to fire (a manual
      // `refetch()` bypasses `enabled`). Only refresh when a session exists.
      if (!enabled) {
        return;
      }
      void refetchFriendRequests();
      void refetchTripInvites();
      void refetchRodeWithTags();
      void refetchInbox();
    }, [
      enabled,
      refetchFriendRequests,
      refetchTripInvites,
      refetchRodeWithTags,
      refetchInbox,
    ]),
  );

  // Retry only the failed Domain_Sources (R8.2, R8.5). We drive the retry off
  // each query's current `isError` flag so a successful source is never
  // re-requested; refetching an errored query re-runs its `queryFn` under a
  // fresh Load_Deadline. Guard on `enabled` so a manual `refetch()` cannot fire
  // a read while no authenticated session exists (a manual refetch bypasses
  // `enabled`).
  const friendRequestsErrored = friendRequestsQuery.isError;
  const tripInvitesErrored = tripInvitesQuery.isError;
  const rodeWithTagsErrored = rodeWithTagsQuery.isError;
  const inboxErrored = inboxQuery.isError;

  const retryFailed = useCallback(() => {
    if (!enabled) {
      return;
    }
    if (friendRequestsErrored) {
      void refetchFriendRequests();
    }
    if (tripInvitesErrored) {
      void refetchTripInvites();
    }
    if (rodeWithTagsErrored) {
      void refetchRodeWithTags();
    }
    if (inboxErrored) {
      void refetchInbox();
    }
  }, [
    enabled,
    friendRequestsErrored,
    tripInvitesErrored,
    rodeWithTagsErrored,
    inboxErrored,
    refetchFriendRequests,
    refetchTripInvites,
    refetchRodeWithTags,
    refetchInbox,
  ]);

  const result = useMemo<Omit<UseAttentionResult, 'retryFailed'>>(() => {
    // Session gating short-circuit (R11.2, R11.3): with no authenticated
    // session the reads are disabled and never resolve, so React Query holds
    // them in a `pending`/`idle` state that is neither success nor error. Left
    // to `toOutcome` that reads as "still loading" and would wedge `inFlight`
    // true forever. Instead we return a fully-idle empty state directly: no
    // outcomes, an empty AttentionState (no items, hidden badge), and every
    // source flagged neither loading nor failed.
    if (!enabled) {
      const idleSources = {
        friendRequest: { loading: false, failed: false },
        tripInvite: { loading: false, failed: false },
        rodeWithTag: { loading: false, failed: false },
        share: { loading: false, failed: false },
      } as const;
      return {
        state: buildAttentionState([], sortMode),
        outcomes: [],
        sources: idleSources,
        inFlight: false,
      };
    }

    const perSource: ReadonlyArray<
      readonly [AttentionDomain, UseQueryResult<readonly AttentionItem[], ApiError>]
    > = [
      ['friendRequest', friendRequestsQuery],
      ['tripInvite', tripInvitesQuery],
      ['rodeWithTag', rodeWithTagsQuery],
      ['share', inboxQuery],
    ];

    const outcomes: AttentionSourceOutcome[] = [];
    const sources = {} as Record<AttentionDomain, AttentionSourceStatus>;
    let inFlight = false;

    for (const [domain, query] of perSource) {
      const outcome = toOutcome(domain, query);
      if (outcome !== null) {
        outcomes.push(outcome);
      }
      const loading = outcome === null;
      if (loading) {
        inFlight = true;
      }
      sources[domain] = { loading, failed: query.isError };
    }

    return {
      state: buildAttentionState(outcomes, sortMode),
      outcomes,
      sources,
      inFlight,
    };
  }, [
    enabled,
    friendRequestsQuery,
    tripInvitesQuery,
    rodeWithTagsQuery,
    inboxQuery,
    sortMode,
  ]);

  return useMemo<UseAttentionResult>(
    () => ({ ...result, retryFailed }),
    [result, retryFailed],
  );
}
