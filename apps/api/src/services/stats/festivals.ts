/**
 * Stats_Service: festival lifetime and per-festival completion roll-up
 * (Feature: festival-booth-tagging, Requirement 5).
 *
 * Pure functions only — no I/O, no DB access. `rollUpFestivalStats` folds raw
 * counts read by the snapshot repository into a `FestivalStatsDTO`.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5, 6.1 (Property 28)
 */

import type { FestivalSlug, FestivalStatsDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Raw per-festival distinct completed booth count, as read by the snapshot
 * repository inside the single `REPEATABLE READ READ ONLY` transaction.
 */
export interface RawFestivalCountRow {
  readonly slug: FestivalSlug;
  readonly n: number | string;
}

export const EMPTY_FESTIVAL_STATS: FestivalStatsDTO = Object.freeze({
  lifetimeCount: 0,
  byFestival: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

/**
 * Fold the raw festival counts into `FestivalStatsDTO`.
 * Pure over its input.
 *
 * - Zero-count festivals are omitted (R5.5).
 * - Sorted by count descending, then slug ascending (total deterministic order).
 * - No percentage, ratio, or denominator fields (R5.3, R6.1, Property 28).
 */
export function rollUpFestivalStats(
  lifetimeCount: number,
  rows: readonly RawFestivalCountRow[],
): FestivalStatsDTO {
  return {
    lifetimeCount,
    byFestival: rows
      .map((r) => ({ slug: r.slug, count: Number(r.n) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug)),
  };
}
