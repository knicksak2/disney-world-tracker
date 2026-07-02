/**
 * Own_Completions_Read query hook (task 6.1).
 *
 * Powers the Own_Experiences mode of the Own_Stats_View. It reads the
 * requesting User's own Completion_Entries through the *existing*
 * Tracking_Service completions endpoint `GET /users/{userId}/completions`
 * on the **owner path** — i.e. invoked with the requester's own
 * `ownUserId`. The established `Owner_Or_Friend_Rule` grants this whenever
 * the requester is the target User, so it returns the User's own data with
 * no new backend work.
 *
 * Resolution flow:
 *   1. Read the cached `['me']` query (the same `GET /me` read
 *      `ProfileScreen` uses) to obtain `ownUserId`.
 *   2. Once `ownUserId` is known, issue the existing
 *      `fetchFriendCompletions(ownUserId)` helper — reusing its 30-second
 *      per-request timeout and its error translation (R12.7, R12.8).
 *
 * Query key: ['own-completions', ownUserId]. Fetched once per screen open
 * and read from cache on every Own_Experiences re-entry, so switching modes
 * never re-issues it (R12.4).
 *
 * Because this is the owner path, the server never returns
 * `profile_forbidden` for this read, so there is no forbidden branch here:
 * any failure (including the synthetic 30-second timeout, surfaced as a
 * non-`profile_forbidden` `ApiError`) flows through the standard
 * error + retry path (R12.8, R12.9).
 *
 * Validates: Requirements 12.4, 12.7, 12.8, 12.9
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { FriendCompletionsDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import { fetchFriendCompletions } from '../api/friendProfile';

// ---------------------------------------------------------------------------
// `GET /me` shape
// ---------------------------------------------------------------------------

/**
 * Shape of `GET /me`. Mirrors `MeResponseBody` in
 * `apps/api/src/services/auth/routes.ts` and the same interface
 * `ProfileScreen` uses. Modeled here (rather than imported from the API
 * package) because the mobile client depends only on the public route
 * contract, never on backend internals.
 */
interface MeResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: { readonly displayName: string };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Key factory for the Own_Completions_Read, keyed by the resolved own
 * `userId` so the cache entry is partitioned per User and shared across
 * every Own_Experiences re-entry (R12.4).
 */
export const ownCompletionsKeys = {
  completions: (ownUserId: string) => ['own-completions', ownUserId] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Read the cached `['me']` query to resolve the requesting User's own id.
 * Reuses the exact key and query function `ProfileScreen` registers, so
 * when `/me` is already cached this resolves synchronously from cache and
 * issues no extra network call; otherwise it primes the same shared cache
 * entry.
 */
function useOwnUserIdQuery(): UseQueryResult<MeResponse, ApiError> {
  return useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });
}

/**
 * Query the requesting User's own Completions via the owner path of the
 * existing Tracking_Service completions read.
 *
 * The completions query is `enabled` only once `ownUserId` is resolved
 * from `['me']`, then keyed `['own-completions', ownUserId]` and fetched
 * through `fetchFriendCompletions(ownUserId)` so it inherits the helper's
 * 30-second timeout and error translation (R12.7, R12.8). A non-
 * `profile_forbidden` failure is retried once before surfacing to the
 * screen's error + retry control (R12.8, R12.9); the owner path never
 * yields `profile_forbidden`, so no forbidden branch is needed.
 */
export function useOwnCompletionsQuery(): UseQueryResult<
  FriendCompletionsDTO,
  ApiError
> {
  const meQuery = useOwnUserIdQuery();
  const ownUserId = meQuery.data?.user.id;

  return useQuery<FriendCompletionsDTO, ApiError>({
    // `ownUserId` is guaranteed defined whenever the query is enabled; the
    // `?? ''` only satisfies the key type before resolution, at which point
    // `enabled: false` prevents the query function from ever running.
    queryKey: ownCompletionsKeys.completions(ownUserId ?? ''),
    enabled: ownUserId !== undefined,
    queryFn: () => fetchFriendCompletions(ownUserId as string),
    retry: (failureCount: number) => failureCount < 1,
  });
}
