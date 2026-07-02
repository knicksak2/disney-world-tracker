/**
 * Friend_Profile_View data-layer helpers (task 7.1).
 *
 * Typed wrappers around the three backend reads that compose the
 * Friend_Profile_View, each keyed by the target Friend's id:
 *
 *   GET /users/{friendId}/profile            → ProfileDTO
 *   GET /me/stats/summary?for={friendId}     → FriendStatsResponse
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

import type {
  ExperienceCategory,
  FriendCompletionsDTO,
  Park,
  ProfileDTO,
} from '@dwt/shared';

import { ApiError, apiRequest, type ApiMethod } from './client';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * One row of a stats roll-up returned by `GET /me/stats/summary`. Mirrors
 * `StatsBreakdown` in `apps/api/src/services/stats/routes.ts`: `percent`
 * is already in `[0.0, 100.0]` to one decimal place, and `total === 0`
 * implies `completed === 0` and `percent === 0` (R3.4).
 */
export interface FriendStatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

/**
 * Response shape for `GET /me/stats/summary?for={friendId}`. Mirrors the
 * four-dimension `StatsResponse` contract from the Stats_Service route.
 * Modeled here (rather than imported from the API package) because the
 * mobile client depends only on the public route contract, never on
 * backend internals — matching the convention in `StatsScreen`.
 *
 * Every Park is present in `byPark`, every Experience_Category in
 * `byCategory`, and every `(Park, Category)` cell in `byParkAndCategory`,
 * so the screen can render a stable, fixed-shape layout (R3.1).
 */
export interface FriendStatsResponse {
  readonly overall: FriendStatsBreakdown;
  readonly byPark: { readonly [park in Park]: FriendStatsBreakdown };
  readonly byCategory: {
    readonly [category in ExperienceCategory]: FriendStatsBreakdown;
  };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: FriendStatsBreakdown;
    };
  };
}

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
 * `GET /me/stats/summary?for={friendId}` (R3.1). The `for` query
 * parameter names the target Friend; the requester is taken from the
 * session.
 */
export function fetchFriendStats(friendId: string): Promise<FriendStatsResponse> {
  return requestWithTimeout<FriendStatsResponse>(
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
