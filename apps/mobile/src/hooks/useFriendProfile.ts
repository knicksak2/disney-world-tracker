/**
 * Friend_Profile_View query hooks (task 7.1).
 *
 * Three independent `useQuery` hooks — one per backend read — each keyed
 * by the target `friendId` so React Query caches and refetches them
 * separately. The screen (task 8.1) composes them into per-request
 * loading / error / retry states (R5.2, R5.4, R5.6); keeping them
 * independent here is what lets a failure in one read leave the others'
 * already-loaded data intact (R5.4).
 *
 * Query keys:
 *   ['friend-profile',     friendId] → GET /users/{friendId}/profile
 *   ['friend-stats',       friendId] → GET /me/stats/summary?for={friendId}
 *   ['friend-completions', friendId] → GET /users/{friendId}/completions
 *
 * Retry policy: a `profile_forbidden` denial is terminal — there is no
 * point retrying a request the server will keep refusing — so it is not
 * retried and surfaces immediately for the screen's "unavailable" branch
 * (R5.3). Every other failure (including the 30-second timeout from
 * `friendProfile.ts`, which is reported as a non-`profile_forbidden`
 * error) is retried once before surfacing, matching the App-level
 * default; the screen then offers a manual retry control (R5.4, R5.6).
 *
 * Validates: Requirements 5.5
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { FriendCompletionsDTO, ProfileDTO } from '@dwt/shared';

import { ApiError } from '../api/client';
import {
  fetchFriendCompletions,
  fetchFriendProfile,
  fetchFriendStats,
} from '../api/friendProfile';
import type { StatsResponse } from '../api/statsTypes';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Factory for the three friend-scoped query keys. Centralized so the
 * screen and any cache-invalidation logic reference the exact same key
 * tuples (e.g. when scoping a manual retry to a single request, R5.6).
 */
export const friendProfileKeys = {
  profile: (friendId: string) => ['friend-profile', friendId] as const,
  stats: (friendId: string) => ['friend-stats', friendId] as const,
  completions: (friendId: string) => ['friend-completions', friendId] as const,
};

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Retry every failure once except a terminal `profile_forbidden` denial
 * (R5.3): retrying a forbidden read only delays the inevitable, so we
 * surface it immediately. All other errors — transient network faults
 * and the synthetic 30-second timeout — get one automatic retry before
 * the screen shows its manual retry control (R5.4, R5.5, R5.6).
 */
function retryUnlessForbidden(failureCount: number, error: ApiError): boolean {
  if (error.code === 'profile_forbidden') {
    return false;
  }
  return failureCount < 1;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Query a Friend's Profile summary, keyed by `friendId` (R2.1). */
export function useFriendProfileQuery(
  friendId: string,
): UseQueryResult<ProfileDTO, ApiError> {
  return useQuery<ProfileDTO, ApiError>({
    queryKey: friendProfileKeys.profile(friendId),
    queryFn: () => fetchFriendProfile(friendId),
    retry: retryUnlessForbidden,
  });
}

/** Query a Friend's completion statistics, keyed by `friendId` (R3.1). */
export function useFriendStatsQuery(
  friendId: string,
): UseQueryResult<StatsResponse, ApiError> {
  return useQuery<StatsResponse, ApiError>({
    queryKey: friendProfileKeys.stats(friendId),
    queryFn: () => fetchFriendStats(friendId),
    retry: retryUnlessForbidden,
  });
}

/** Query a Friend's Completions, keyed by `friendId` (R4.1). */
export function useFriendCompletionsQuery(
  friendId: string,
): UseQueryResult<FriendCompletionsDTO, ApiError> {
  return useQuery<FriendCompletionsDTO, ApiError>({
    queryKey: friendProfileKeys.completions(friendId),
    queryFn: () => fetchFriendCompletions(friendId),
    retry: retryUnlessForbidden,
  });
}
