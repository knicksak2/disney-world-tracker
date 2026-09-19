/**
 * Default park resolution for Live Waits screen.
 * (Requirements 4.3, 10.1, Property 5, design.md Section 4 & 11)
 *
 * Implements the fallback chain:
 *   1. Active Trip's park (when valid and non-null)
 *   2. Most recently viewed park (when valid and non-null)
 *   3. First park in canonical PARKS order ('Magic Kingdom')
 */

import { PARKS, type Park } from '@dwt/shared';

/**
 * Resolve the default park to select when opening Live Waits.
 * Always resolves to a member of PARKS; never null, never invalid.
 */
export function resolveDefaultLiveWaitsPark(
  activeTripPark: Park | null | undefined,
  lastViewedPark: Park | null | undefined,
): Park {
  if (activeTripPark && (PARKS as readonly string[]).includes(activeTripPark)) {
    return activeTripPark;
  }
  if (lastViewedPark && (PARKS as readonly string[]).includes(lastViewedPark)) {
    return lastViewedPark;
  }
  return PARKS[0];
}
