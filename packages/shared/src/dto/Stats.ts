/**
 * Stats DTO.
 *
 * The User's completion statistics returned by `GET /me/stats`: overall, per
 * Park, and per Experience_Category. Each entry carries the rendered
 * percentage (already rounded to one decimal place and capped at 100.0,
 * R3.1-R3.3, R3.8), the completed count (numerator), and the total count
 * (denominator) for that group (R3.4, R3.6, R3.7).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8
 */

import type { ExperienceCategory, Park } from '../enums.js';

/**
 * One row of a stats breakdown. `percent` is in `[0.0, 100.0]` to one
 * decimal place; `total == 0` implies `percent == 0` and `completed == 0`
 * (R3.6, R3.7).
 */
export interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

/**
 * A Coverage_Statistic cell: the shared shape reported for every completion
 * group in the expanded stats response and carried, for the top facet, inside
 * the Progress_Share payload snapshot.
 *
 * It extends {@link StatsBreakdown} with a `remaining` count and a
 * `completeBadge` flag so every dimension derives these uniformly:
 * - `percent` is in `[0.0, 100.0]` to one decimal place (half-away-from-zero).
 * - `remaining` is `total - completed` and is always a non-negative integer.
 * - `completeBadge` is `true` iff `total > 0 && completed === total`.
 * - `total === 0` implies `completed === 0`, `percent === 0.0`,
 *   `remaining === 0`, and `completeBadge === false`.
 *
 * Validates: Requirements 1.11, 1.12, 2.3, 2.4, 2.5, 10.2
 */
export interface CompletionCell {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly remaining: number;
  readonly completeBadge: boolean;
}

export interface StatsDTO {
  readonly overall: StatsBreakdown;

  /**
   * Per-Park breakdown, keyed by Park enum member name. Every Park is
   * present so the client can render a stable list ordering even when a Park
   * has zero Experiences (R3.6).
   */
  readonly perPark: { readonly [park in Park]: StatsBreakdown };

  /**
   * Per-Experience_Category breakdown, keyed by category enum member name.
   * Every category is present (R3.6, R3.7).
   */
  readonly perCategory: { readonly [category in ExperienceCategory]: StatsBreakdown };
}
