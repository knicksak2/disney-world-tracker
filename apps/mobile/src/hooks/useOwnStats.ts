/**
 * Own_Stats_Read query hook (task 23.1).
 *
 * Reads the requesting User's own completion statistics from the existing
 * `GET /me/stats` endpoint — the same read the Own_Stats_View (`StatsScreen`)
 * already issues. It exists so the Friend_Profile_View can pull in the
 * viewer's own stats *alongside* the friend reads, giving the
 * `Progress_Comparison` (task 24) the viewer half of the side-by-side view
 * from already-retrieved data (R12.4).
 *
 * Cache sharing: the query key is the exact `['me-stats']` tuple `StatsScreen`
 * uses, so a viewer who has already opened the Stats tab has this data cached
 * and the Friend_Profile_View reads it without a second network round-trip
 * (R12.4). Conversely, opening a Friend_Profile_View first warms the same
 * cache entry for the Stats tab.
 *
 * The result is typed as `FriendStatsResponse` — the shared four-dimension
 * roll-up shape (overall / per-Park / per-Category / per-(Park,Category)) that
 * the friend stats read also returns. `GET /me/stats` returns a superset (it
 * also carries area and resort roll-ups the comparison does not use), so the
 * narrower shared type lets task 24 consume the viewer's and the Friend's
 * stats through one uniform contract.
 *
 * This is an owner-path read of the caller's own data, so it never yields
 * `profile_forbidden`; retry policy is inherited from the app-level default.
 *
 * Validates: Requirements 12.4
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../api/client';
import type { FriendStatsResponse } from '../api/friendProfile';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Key factory for the Own_Stats_Read. Deliberately the same `['me-stats']`
 * tuple `StatsScreen` registers, so the two screens share one cache entry
 * (R12.4).
 */
export const ownStatsKeys = {
  stats: () => ['me-stats'] as const,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 30 seconds — mirrors the Own_Stats_View's staleness window so the shared
 * `['me-stats']` cache entry behaves identically regardless of which screen
 * primed it.
 */
const STATS_STALE_TIME_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Query the requesting User's own completion statistics via `GET /me/stats`,
 * keyed `['me-stats']` and shared with the Own_Stats_View (R12.4). The result
 * is projected to the shared `FriendStatsResponse` shape so the comparison can
 * consume the viewer's and the Friend's stats uniformly.
 */
export function useOwnStatsQuery(): UseQueryResult<FriendStatsResponse, ApiError> {
  return useQuery<FriendStatsResponse, ApiError>({
    queryKey: ownStatsKeys.stats(),
    queryFn: () => apiRequest<FriendStatsResponse>('GET', '/me/stats'),
    staleTime: STATS_STALE_TIME_MS,
  });
}
