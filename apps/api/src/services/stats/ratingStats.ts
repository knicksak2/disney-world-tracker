/**
 * Stats_Service: pure Personal Rating Statistics roll-up (task 4.1).
 *
 * Pure functions only — no I/O, no clock, no DB access. Consumes the
 * Target_User's Ratings on **active** Experiences (already filtered by the
 * repository so R4.5 / R5.4 / R6.5 hold at the source) and folds them into the
 * Group B `RatingStatistics` wire shape.
 *
 * All rating statistics are gated on the count of active Ratings against
 * `MINIMUM_RATINGS_THRESHOLD` (the leaderboard precedent, value 3). When the
 * count is below the threshold — including zero — the gated fields are omitted
 * and `sufficient` is `false`; the `ratedCompletionsCount` is always reported
 * (R4.4, R4.6, R5.2, R5.3, R6.4).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4,
 * 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6.
 */

import type { ExperienceCategory, Park } from '@dwt/shared';

import { round1 } from './computePercent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum number of the Target_User's Ratings on active Experiences required
 * before the gated Rating_Statistics are reported. Value is 3, matching the
 * leaderboard precedent (glossary, R4/R5/R6).
 */
export const MINIMUM_RATINGS_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * One of the Target_User's Ratings on an active Experience. Produced by the
 * snapshot repository (`repo.ts`) already filtered to `e.active = TRUE`, so the
 * pure roll-up never has to re-check the active flag (R4.5, R5.4, R6.5).
 *
 * `park` is nullable because resort-area Experiences carry no Park; such rows
 * feed the overall average and the distribution but contribute to no per-Park
 * entry.
 */
export interface RawUserRatingRow {
  readonly experienceId: string;
  readonly experienceName: string;
  /** Integer Rating in the inclusive range 1..10. */
  readonly value: number;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * A single Rated Experience result (highest- or lowest-rated), comprising the
 * Experience's identity, its display name, and the Target_User's own Rating
 * value for it (R6.1, R6.2).
 */
export interface RatedExperience {
  readonly experienceId: string;
  readonly name: string;
  /** The Target_User's Rating value, 1..10. */
  readonly value: number;
}

/**
 * The Rating_Distribution: exactly one count per integer value 1 through 10,
 * with 0 for any value the Target_User assigned to no Ratings (R5.1). When
 * reported, the ten counts sum to the total active-rating count (R5.5).
 */
export type RatingDistribution = Readonly<
  Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, number>
>;

/**
 * The Group B Personal Rating Statistics.
 *
 * `sufficient` is `true` exactly when the count of active Ratings is at least
 * `MINIMUM_RATINGS_THRESHOLD`. When `false`, every gated field (`average`,
 * `averageByPark`, `averageByCategory`, `distribution`, `highest`, `lowest`) is
 * omitted; `ratedCompletionsCount` is reported regardless (R5.3).
 */
export interface RatingStatistics {
  /** `true` when the active-rating count is >= MINIMUM_RATINGS_THRESHOLD. */
  readonly sufficient: boolean;
  /**
   * Count of the Target_User's rated Completions on active Experiences, always
   * reported regardless of the threshold (R5.3); 0 when there are none.
   */
  readonly ratedCompletionsCount: number;
  /** Overall average Rating, [1.0, 10.0] one decimal half-away-from-zero (R4.1). */
  readonly average?: number;
  /** Per-Park average Rating; one entry per Park with >= 1 active Rating (R4.2). */
  readonly averageByPark?: Partial<Record<Park, number>>;
  /** Per-Category average Rating; one entry per Category with >= 1 active Rating (R4.3). */
  readonly averageByCategory?: Partial<Record<ExperienceCategory, number>>;
  /** Counts for each value 1..10, zeros included (R5.1). */
  readonly distribution?: RatingDistribution;
  /** Highest-rated active Experience (R6.1). */
  readonly highest?: RatedExperience;
  /** Lowest-rated active Experience (R6.2). */
  readonly lowest?: RatedExperience;
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

/**
 * Fold the Target_User's active Ratings into the `RatingStatistics` wire shape.
 *
 * @param rows the Target_User's Ratings on active Experiences (already filtered
 *   to active by the repository). Every row's `value` is expected in 1..10.
 */
export function rollUpRatings(
  rows: readonly RawUserRatingRow[],
): RatingStatistics {
  // A Rating on an active Experience is a rated Completion; the active filter
  // is applied upstream, so the count of rows is the rated-completions count
  // (R5.3, R5.4). Reported regardless of the threshold.
  const ratedCompletionsCount = rows.length;

  // Gate: below the threshold (including zero) omit every gated field and flag
  // insufficient data (R4.4, R4.6, R5.2, R6.4).
  if (rows.length < MINIMUM_RATINGS_THRESHOLD) {
    return { sufficient: false, ratedCompletionsCount };
  }

  return {
    sufficient: true,
    ratedCompletionsCount,
    average: computeOverallAverage(rows),
    averageByPark: computeAverageByPark(rows),
    averageByCategory: computeAverageByCategory(rows),
    distribution: computeDistribution(rows),
    highest: selectExtreme(rows, 'highest'),
    lowest: selectExtreme(rows, 'lowest'),
  };
}

// ---------------------------------------------------------------------------
// Averages (R4.1, R4.2, R4.3)
// ---------------------------------------------------------------------------

/**
 * Overall average Rating across all active Ratings, in [1.0, 10.0] rounded to
 * one decimal using round-half-away-from-zero (R4.1). Called only when the
 * threshold is met, so `rows` is non-empty.
 */
function computeOverallAverage(rows: readonly RawUserRatingRow[]): number {
  const sum = rows.reduce((acc, row) => acc + row.value, 0);
  return round1(sum / rows.length);
}

/**
 * Per-Park average Rating with one entry for every Park in which the user has
 * at least one active Rating (R4.2). Park-less rows contribute to no entry.
 */
function computeAverageByPark(
  rows: readonly RawUserRatingRow[],
): Partial<Record<Park, number>> {
  const sums = new Map<Park, { sum: number; count: number }>();
  for (const row of rows) {
    if (row.park === null) {
      continue;
    }
    const acc = sums.get(row.park);
    if (acc) {
      acc.sum += row.value;
      acc.count += 1;
    } else {
      sums.set(row.park, { sum: row.value, count: 1 });
    }
  }

  const out: Partial<Record<Park, number>> = {};
  for (const [park, { sum, count }] of sums) {
    out[park] = round1(sum / count);
  }
  return out;
}

/**
 * Per-Experience_Category average Rating with one entry for every Category in
 * which the user has at least one active Rating (R4.3).
 */
function computeAverageByCategory(
  rows: readonly RawUserRatingRow[],
): Partial<Record<ExperienceCategory, number>> {
  const sums = new Map<ExperienceCategory, { sum: number; count: number }>();
  for (const row of rows) {
    const acc = sums.get(row.category);
    if (acc) {
      acc.sum += row.value;
      acc.count += 1;
    } else {
      sums.set(row.category, { sum: row.value, count: 1 });
    }
  }

  const out: Partial<Record<ExperienceCategory, number>> = {};
  for (const [category, { sum, count }] of sums) {
    out[category] = round1(sum / count);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distribution (R5.1, R5.5)
// ---------------------------------------------------------------------------

/**
 * Build the 1..10 Rating_Distribution: exactly one count per integer value,
 * zeros included, and the ten counts sum to the total active-rating count
 * (R5.1, R5.5). Values outside 1..10 are not expected (the repo constrains the
 * source), and are ignored defensively so the invariant cannot be violated by
 * a stray value.
 */
function computeDistribution(
  rows: readonly RawUserRatingRow[],
): RatingDistribution {
  const counts: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
    10: 0,
  };
  for (const row of rows) {
    if (Number.isInteger(row.value) && row.value >= 1 && row.value <= 10) {
      const value = row.value as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
      counts[value] += 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Highest / lowest selection (R6.1, R6.2, R6.3, R6.6)
// ---------------------------------------------------------------------------

/**
 * Select the highest- or lowest-rated active Experience.
 *
 * The extreme is the row with the maximum (resp. minimum) `value`; ties are
 * broken by ascending case-insensitive Experience name, then by ascending
 * Experience id, so exactly one row is chosen (R6.3). When every Rating shares
 * a single value the max and min sets are identical, so the same tie-break
 * yields the same Experience for both highest and lowest (R6.6).
 *
 * Called only when the threshold is met, so `rows` is non-empty.
 */
function selectExtreme(
  rows: readonly RawUserRatingRow[],
  which: 'highest' | 'lowest',
): RatedExperience {
  let best = rows[0]!;
  for (let i = 1; i < rows.length; i += 1) {
    const candidate = rows[i]!;
    if (isBetterExtreme(candidate, best, which)) {
      best = candidate;
    }
  }
  return {
    experienceId: best.experienceId,
    name: best.experienceName,
    value: best.value,
  };
}

/**
 * Decide whether `candidate` should replace the current `best` for the given
 * extreme. A candidate wins on a strictly better value (higher for `highest`,
 * lower for `lowest`); on an equal value it wins only if it sorts first by the
 * tie-break (ascending case-insensitive name, then ascending id).
 */
function isBetterExtreme(
  candidate: RawUserRatingRow,
  best: RawUserRatingRow,
  which: 'highest' | 'lowest',
): boolean {
  if (candidate.value !== best.value) {
    return which === 'highest'
      ? candidate.value > best.value
      : candidate.value < best.value;
  }
  return compareByTieBreak(candidate, best) < 0;
}

/**
 * Tie-break comparator: ascending case-insensitive Experience name, then
 * ascending Experience id. Returns a negative number when `a` sorts before
 * `b`, positive when after, and 0 when identical on both keys.
 */
function compareByTieBreak(
  a: RawUserRatingRow,
  b: RawUserRatingRow,
): number {
  const an = a.experienceName.toLowerCase();
  const bn = b.experienceName.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  if (a.experienceId < b.experienceId) return -1;
  if (a.experienceId > b.experienceId) return 1;
  return 0;
}
