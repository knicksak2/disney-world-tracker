// Feature: experience-detail-redesign, Task 14.1 — pure passport visit stats
//
// Validates: Requirements 17.2, 17.3, 17.5, 17.6
//
// Pure and framework-free module for calculating passport aggregate stats.

/** A single visit log's rating, or null when that visit carries none. */
export type VisitRatingInput = number | null | undefined;

/**
 * Compute the Passport_Average_Rating: the mean of every non-null rating in
 * `ratings`, rounded to one decimal place. Returns null when every entry is
 * null (R17.3 — no rating to average). Pure, total, never throws.
 */
export function computePassportAverage(
  ratings: readonly VisitRatingInput[],
): number | null {
  if (!ratings || ratings.length === 0) {
    return null;
  }

  let sum = 0;
  let count = 0;

  for (const r of ratings) {
    if (typeof r === 'number' && Number.isFinite(r)) {
      sum += r;
      count++;
    }
  }

  if (count === 0) {
    return null;
  }

  const mean = sum / count;
  return Math.round(mean * 10) / 10;
}
