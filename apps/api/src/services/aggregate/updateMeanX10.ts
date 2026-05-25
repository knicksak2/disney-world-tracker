/**
 * Aggregate-rating incremental update.
 *
 * Pure function that advances the per-Experience aggregate-rating triple
 * `(sum_ratings, count_ratings, mean_x10)` in response to a single
 * `RatingChanged{oldValue, newValue}` event. Mathematically equivalent to
 * recomputing `mean = sum / count` over the resulting raw rating set, so the
 * incremental path used by the recompute worker is observationally
 * indistinguishable from a from-scratch recompute.
 *
 * Both inputs and outputs use plain `number` per the design's storage row
 * shape `aggregate_ratings(sum_ratings BIGINT, count_ratings INT,
 * mean_x10 SMALLINT)`. Ratings are integers in `[1, 10]`, so for any
 * realistic Experience the values stay well inside the JavaScript safe
 * integer range.
 *
 * The `mean_x10` field is the rounded mean times 10 (an integer in
 * `[10, 100]` when `count >= 3`, else `null`), as defined by the design's
 * Aggregate_Ratings_Service section. Storing the mean as an integer
 * times 10 is what lets a SMALLINT column hold the rendered value without
 * floating-point representation drift.
 *
 * Validates: Requirements R10.1, R10.2, R10.8, R10.9
 */

/**
 * Minimum number of contributing ratings required before an Aggregate_Rating
 * value is published. Below this threshold the service withholds the value
 * and reports an empty-state indicator alongside the count (R10.4).
 */
export const MIN_AGGREGATE_RATING_COUNT = 3;

/**
 * Result of applying a single `RatingChanged` event to an aggregate row.
 *
 * `sum`     — new `sum_ratings` total over the resulting rating set.
 * `count`   — new `count_ratings` over the resulting rating set, `>= 0`.
 * `meanX10` — `null` while `count < MIN_AGGREGATE_RATING_COUNT` (R10.4),
 *             otherwise the rounded mean times 10, an integer in
 *             `[10, 100]` whenever every contributing rating is in `[1, 10]`.
 */
export interface AggregateMeanX10State {
  readonly sum: number;
  readonly count: number;
  readonly meanX10: number | null;
}

/**
 * Integer half-away-from-zero division.
 *
 * Returns `round(numerator / denominator)` where halves are rounded away
 * from zero (so `+0.5 -> 1`, `-0.5 -> -1`). Implemented with integer
 * arithmetic on the absolute value to avoid floating-point drift; this is
 * the "round_half_up" helper referenced in the design's update-strategy
 * pseudocode.
 *
 * Caller must ensure `denominator > 0`. Exported so the property test in
 * task 8.2 can pin its rounding semantics.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new Error('roundHalfUp: denominator must be > 0');
  }
  const sign = numerator < 0 ? -1 : 1;
  const absNumerator = Math.abs(numerator);
  const quotient = Math.trunc(absNumerator / denominator);
  const remainder = absNumerator - quotient * denominator;
  // 2 * remainder >= denominator means the fractional part is >= 0.5,
  // so round the magnitude up; sign reapplies the original direction.
  const roundedMagnitude = 2 * remainder >= denominator ? quotient + 1 : quotient;
  return sign * roundedMagnitude;
}

/**
 * Apply one `RatingChanged{oldValue, newValue}` event to an aggregate row.
 *
 * Event encoding follows the design:
 *   - `oldValue === null` and `newValue !== null` → user added a rating.
 *   - `oldValue !== null` and `newValue !== null` → user replaced a rating
 *     (R10.8: include the new value exactly once and exclude the prior
 *     value; the count is unchanged).
 *   - `oldValue !== null` and `newValue === null` → user removed a rating
 *     (R10.9).
 *   - `oldValue === null` and `newValue === null` → no-op; the triple is
 *     returned unchanged (with `meanX10` re-evaluated for consistency).
 *
 * The function does not validate that ratings are in `[1, 10]`; that is the
 * responsibility of the Tracking_Service before the event is enqueued.
 *
 * @param prevSum   Previous `sum_ratings` for this Experience, `>= 0`.
 * @param prevCount Previous `count_ratings` for this Experience, `>= 0`.
 * @param oldValue  Rating that was just removed from the set, or `null`.
 * @param newValue  Rating that was just added to the set, or `null`.
 * @returns The new `(sum, count, meanX10)` triple.
 */
export function updateMeanX10(
  prevSum: number,
  prevCount: number,
  oldValue: number | null,
  newValue: number | null,
): AggregateMeanX10State {
  const sumDelta = (newValue ?? 0) - (oldValue ?? 0);
  const countDelta = (newValue !== null ? 1 : 0) - (oldValue !== null ? 1 : 0);

  const sum = prevSum + sumDelta;
  const count = prevCount + countDelta;

  const meanX10 =
    count >= MIN_AGGREGATE_RATING_COUNT ? roundHalfUp(sum * 10, count) : null;

  return { sum, count, meanX10 };
}
