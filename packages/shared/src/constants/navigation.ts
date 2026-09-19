/**
 * Navigation & Live Waits constants.
 */

/**
 * The wait-minutes threshold at or below which an experience is considered a "walk-on".
 * (Requirement 10.4, Configuration & Constants)
 */
export const WALK_ON_THRESHOLD_MINUTES = 25;

/**
 * The maximum number of accepted friends displayed inline on YouAndCrewScreen
 * before capping and offering an expand/collapse toggle.
 * (Requirement 7.7, Configuration & Constants)
 */
export const MAX_INLINE_FRIENDS = 3;

/**
 * The high-intensity thrillFactor facet IDs matching headliner experiences.
 * Confirmed against the synced catalog database (Task 1.3).
 * (Requirement 10.5, Configuration & Constants)
 */
export const HEADLINER_THRILL_FACET_VALUES: readonly string[] = [
  'thrill-rides',
  'big-drops',
] as const;

/**
 * Server-side and client-side freshness window for Park Live Snapshot (300 seconds = 5 minutes).
 * (Requirement 9.3, Configuration & Constants)
 */
export const PARK_LIVE_CACHE_TTL_SECONDS = 300;

/**
 * Server-side cache retention for Park Live Snapshot fallback (86400 seconds = 24 hours).
 * (Requirement 9.4, Configuration & Constants)
 */
export const PARK_LIVE_CACHE_RETENTION_SECONDS = 86400;

