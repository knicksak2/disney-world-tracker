/**
 * Stats_Service: live Percentile_Rank primitive (Requirement 7).
 *
 * Pure function only — no I/O, no clock, no DB access. The repo assembles a
 * `PercentileInput` (the Target_User's active-completion total plus one total
 * per OTHER tracker with >= 1 completion) inside the single
 * `REPEATABLE READ READ ONLY` snapshot transaction; this module folds that
 * material into the reported Percentile_Rank. The value lives only in the
 * response object — it is never persisted or cached between requests (R7.7).
 *
 * Validates: R7.1, R7.3, R7.4, R7.5, R7.6, R7.7.
 */

import type { PercentileInput } from './repo.js';
import { roundHalfUpDecimal } from './computePercent.js';

/**
 * Compute the Percentile_Rank as the percentage of OTHER trackers (each with at
 * least one Completion) that the Target_User is strictly ahead of by total
 * Completion count.
 *
 * Formula (R7.1, R7.3):
 *   100 * (count of other trackers strictly less than the target)
 *       / (number of other trackers with >= 1 completion)
 * expressed in `[0.0, 100.0]`, rounded to one decimal place using round-half-up.
 *
 * Rules:
 * - **Ties** (R7.4): other trackers whose total equals the target's total are
 *   excluded from the numerator (strictly-less comparison) but retained in the
 *   denominator (they are still "other trackers with >= 1 completion").
 * - **Only tracker** (R7.5): when there are no other trackers with a Completion
 *   (`otherTotals` is empty), the denominator is 0 and the rank is `0.0`.
 * - **Zero completions** (R7.6): when the Target_User has zero Completions
 *   (`targetTotal === 0`), no other tracker can be strictly below them, so the
 *   numerator is 0 and the rank is `0.0`. This falls out of the strictly-less
 *   comparison naturally, since every other tracker in `otherTotals` has a
 *   total of at least 1.
 *
 * @param input the Target_User's total and every other tracker's total
 * @returns the Percentile_Rank in `[0.0, 100.0]`, one decimal, round-half-up
 */
export function computePercentileRank(input: PercentileInput): number {
  const { targetTotal, otherTotals } = input;

  // R7.5: the Target_User is the only tracker with a completion.
  const denominator = otherTotals.length;
  if (denominator === 0) {
    return 0.0;
  }

  // R7.4: strictly-less comparison excludes ties from the numerator while the
  // denominator retains every other tracker. R7.6 also holds here: when
  // targetTotal === 0, no other tracker (each >= 1) is strictly below it.
  let ahead = 0;
  for (const otherTotal of otherTotals) {
    if (otherTotal < targetTotal) {
      ahead += 1;
    }
  }

  const raw = (100 * ahead) / denominator;
  return roundHalfUpDecimal(raw, 1);
}
