/**
 * Friend_Profile_View data-layer helpers (task 7.1).
 *
 * Typed wrappers around the three backend reads that compose the
 * Friend_Profile_View, each keyed by the target Friend's id:
 *
 *   GET /users/{friendId}/profile            → ProfileDTO
 *   GET /me/stats/summary?for={friendId}     → StatsResponse
 *   GET /users/{friendId}/completions        → FriendCompletionsDTO
 *
 * All three share `requestWithTimeout`, which enforces a 30-second
 * per-request timeout via an `AbortController` (R5.5). When the timeout
 * fires the underlying `fetch` is aborted and rejects with an
 * `AbortError`; we translate that into a synthetic `ApiError` whose
 * `code` is deliberately *not* `profile_forbidden`, so the timeout flows
 * through the screen's error/retry path (R5.4, R5.6) rather than the
 * "unavailable" path reserved for `profile_forbidden` (R5.3).
 *
 * The success-body envelope handling and the error-envelope → `ApiError`
 * translation are reused from `apiRequest`; these helpers only add the
 * per-request timeout and the friend-scoped paths.
 *
 * Validates: Requirements 5.5
 */

import type { FriendCompletionsDTO, ProfileDTO } from '@dwt/shared';

import { ApiError, apiRequest, type ApiMethod } from './client';
import type { StatsResponse } from './statsTypes';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * Friend stats read on `GET /me/stats/summary?for={friendId}` returns the
 * shared nested `StatsResponse` — structurally identical for self and friend
 * reads (see `statsTypes.ts`, task 3.1). The flat `FriendStatsResponse` /
 * `FriendStatsBreakdown` shapes were removed in favour of the nested
 * `coverage` / `ratings` / `percentileRank` contract (R16.1, R16.2, R16.3).
 *
 * Re-exported here so friend-scoped consumers can pull the wire type from the
 * same module as the reads that produce it.
 */
export type { StatsResponse } from './statsTypes';

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

/**
 * Per-request timeout for every Friend_Profile_View read (R5.5). A request
 * that does not complete within this window is aborted and surfaced as a
 * failed (non-`profile_forbidden`) request.
 */
export const FRIEND_PROFILE_TIMEOUT_MS = 30_000;

/**
 * Issue a GET against `path` with a `FRIEND_PROFILE_TIMEOUT_MS` deadline.
 *
 * An `AbortController` arms a timer that aborts the underlying `fetch`
 * when the deadline elapses. On abort, `apiRequest` propagates the
 * `fetch` `AbortError`; we catch it (recognized via `signal.aborted`,
 * not the error's brand, which varies across runtimes) and re-throw a
 * synthetic `ApiError` with `code: 'internal_error'` — any non-
 * `profile_forbidden` code routes the screen to its error/retry branch
 * (R5.4, R5.5). Errors that are *not* the timeout (including a real
 * `profile_forbidden` from the server) propagate unchanged.
 *
 * The timer is always cleared in `finally`, so a request that completes
 * before the deadline leaves no dangling timer.
 */
async function requestWithTimeout<T>(method: ApiMethod, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FRIEND_PROFILE_TIMEOUT_MS);

  try {
    return await apiRequest<T>(method, path, undefined, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      // Synthetic, deliberately non-`profile_forbidden` so the screen
      // treats the timeout as a retryable failure (R5.5).
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a Friend's Profile summary (display name, avatar reference,
 * overall completion percentage) from `GET /users/{friendId}/profile`
 * (R2.1). Gated server-side by the owner-or-friend rule; a denial
 * surfaces as an `ApiError` with `code: 'profile_forbidden'`.
 */
export function fetchFriendProfile(friendId: string): Promise<ProfileDTO> {
  return requestWithTimeout<ProfileDTO>(
    'GET',
    `/users/${encodeURIComponent(friendId)}/profile`,
  );
}

/**
 * Fetch a Friend's completion statistics from
 * `GET /me/stats/summary?for={friendId}` (R3.1, R10.2). The `for` query
 * parameter names the target Friend; the requester is taken from the
 * session. The friend read deliberately omits the `percentile` parameter —
 * percentile is an Own_Surface-only brag (R10.2, R10.6).
 */
export function fetchFriendStats(friendId: string): Promise<StatsResponse> {
  return requestWithTimeout<StatsResponse>(
    'GET',
    `/me/stats/summary?for=${encodeURIComponent(friendId)}`,
  );
}

/**
 * Fetch a Friend's Completions from `GET /users/{friendId}/completions`
 * (R4.1). Returns `{ entries: [] }` when the Friend has no Completions
 * over Active Experiences (the screen renders this as the empty state,
 * R4.10).
 */
export function fetchFriendCompletions(
  friendId: string,
): Promise<FriendCompletionsDTO> {
  return requestWithTimeout<FriendCompletionsDTO>(
    'GET',
    `/users/${encodeURIComponent(friendId)}/completions`,
  );
}
