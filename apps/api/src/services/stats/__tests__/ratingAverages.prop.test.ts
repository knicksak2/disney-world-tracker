// Feature: expanded-stats, Property 8: Rating averages are gated and well-formed
/**
 * Property-based test for the Stats_Service pure Personal Rating Statistics
 * roll-up (`services/stats/ratingStats.ts`, Requirement 4).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 *
 * Property 8 (design.md §"Correctness Properties"):
 *
 *   For any set of the Target_User's active Ratings, when the count is at least
 *   the Minimum_Ratings_Threshold the overall average and each reported
 *   per-Park and per-Category average lie in [1.0, 10.0] rounded to one decimal
 *   half-away-from-zero, a per-group average is present exactly for groups with
 *   at least one active Rating, and when the count is below the threshold
 *   (including zero) all averages are omitted and the insufficient-data flag is
 *   set.
 *
 * The test drives `rollUpRatings` with generated `RawUserRatingRow[]` and checks
 * the gating boundary from both sides and the well-formedness of each reported
 * average against an independent reference oracle. Rows arrive pre-filtered to
 * active Experiences (R4.5) exactly as the repository would deliver them, so
 * the active flag is not part of this pure input.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { round1 } from '../computePercent.js';
import {
  MINIMUM_RATINGS_THRESHOLD,
  rollUpRatings,
  type RawUserRatingRow,
} from '../ratingStats.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// Small pools for Park (including the null case for resort-area Experiences)
// and Category keep group collisions frequent so the "present exactly for
// groups with >= 1 active Rating" invariant is exercised with real overlap
// rather than one row per group. `value` is drawn across the full 1..10 domain
// so the averages land off round tenths and the round-half-away-from-zero rule
// is meaningfully checked.

const valueArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });
// `park` is nullable: resort-area rows carry no Park and must feed the overall
// average without producing a per-Park entry (R4.2 group presence).
const parkArb: fc.Arbitrary<Park | null> = fc.constantFrom<Park | null>(
  ...PARKS,
  null,
);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const ratingRowArb: fc.Arbitrary<RawUserRatingRow> = fc
  .record({
    idx: fc.integer({ min: 0, max: 9999 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
    value: valueArb,
    park: parkArb,
    category: categoryArb,
  })
  .map((r) => ({
    experienceId: `exp-${String(r.idx).padStart(4, '0')}`,
    experienceName: r.name,
    value: r.value,
    park: r.park,
    category: r.category,
  }));

/**
 * Full-range population: 0..12 rows. Straddles the threshold in both
 * directions so the gated and ungated branches are both exercised per run.
 */
const anyRatingsArb: fc.Arbitrary<readonly RawUserRatingRow[]> = fc.array(
  ratingRowArb,
  { minLength: 0, maxLength: 12 },
);

/**
 * Below-threshold population: 0..(threshold - 1) rows. Forces the gating branch
 * (R4.4, R4.6 including the zero case) every run.
 */
const belowThresholdArb: fc.Arbitrary<readonly RawUserRatingRow[]> = fc.array(
  ratingRowArb,
  { minLength: 0, maxLength: MINIMUM_RATINGS_THRESHOLD - 1 },
);

/**
 * At-or-above-threshold population: threshold..12 rows. Forces the sufficient
 * branch every run so the averages' well-formedness (R4.1–R4.3) is always
 * checked.
 */
const atOrAboveThresholdArb: fc.Arbitrary<readonly RawUserRatingRow[]> =
  fc.array(ratingRowArb, {
    minLength: MINIMUM_RATINGS_THRESHOLD,
    maxLength: 12,
  });

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/** Round-half-away-from-zero mean of a non-empty value list, mirroring `round1`. */
function expectedAverage(values: readonly number[]): number {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return round1(sum / values.length);
}

/** Group row values by a key selector, skipping rows whose key is null. */
function groupValues<K>(
  rows: readonly RawUserRatingRow[],
  keyOf: (row: RawUserRatingRow) => K | null,
): Map<K, number[]> {
  const out = new Map<K, number[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(row.value);
    else out.set(key, [row.value]);
  }
  return out;
}

/** Assert an average is a well-formed [1.0, 10.0] one-decimal value. */
function isWellFormedAverage(avg: number): boolean {
  return (
    Number.isFinite(avg) &&
    avg >= 1.0 &&
    avg <= 10.0 &&
    // one decimal place: value * 10 is an integer (within float tolerance)
    Math.abs(avg * 10 - Math.round(avg * 10)) < 1e-9
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Stats_Service ratings — Property 8: rating averages are gated and well-formed', () => {
  it('gates all averages by the threshold: omitted below, present above (R4.4, R4.6)', () => {
    fc.assert(
      fc.property(anyRatingsArb, (rows) => {
        const result = rollUpRatings(rows);

        if (rows.length < MINIMUM_RATINGS_THRESHOLD) {
          // Below threshold (including zero): sufficient=false and every
          // average field is omitted (R4.4, R4.6).
          expect(result.sufficient).toBe(false);
          expect(result.average).toBeUndefined();
          expect(result.averageByPark).toBeUndefined();
          expect(result.averageByCategory).toBeUndefined();
        } else {
          // At or above threshold: sufficient=true and all averages present.
          expect(result.sufficient).toBe(true);
          expect(result.average).toBeDefined();
          expect(result.averageByPark).toBeDefined();
          expect(result.averageByCategory).toBeDefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('below the threshold (including zero) always omits averages (R4.4, R4.6)', () => {
    fc.assert(
      fc.property(belowThresholdArb, (rows) => {
        const result = rollUpRatings(rows);
        expect(result.sufficient).toBe(false);
        expect(result.average).toBeUndefined();
        expect(result.averageByPark).toBeUndefined();
        expect(result.averageByCategory).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('overall average is the round-half-away-from-zero mean in [1.0, 10.0] (R4.1)', () => {
    fc.assert(
      fc.property(atOrAboveThresholdArb, (rows) => {
        const result = rollUpRatings(rows);
        expect(result.sufficient).toBe(true);

        const avg = result.average!;
        expect(isWellFormedAverage(avg)).toBe(true);
        expect(avg).toBe(expectedAverage(rows.map((r) => r.value)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('per-Park averages are present exactly for Parks with >= 1 rating and well-formed (R4.2)', () => {
    fc.assert(
      fc.property(atOrAboveThresholdArb, (rows) => {
        const result = rollUpRatings(rows);
        const byPark = result.averageByPark!;
        const oracle = groupValues(rows, (r) => r.park);

        // Presence is exactly the set of Parks with >= 1 active rating; Park-less
        // rows produce no entry.
        const reportedParks = new Set(Object.keys(byPark));
        expect(reportedParks.size).toBe(oracle.size);
        for (const [park, values] of oracle) {
          const avg = byPark[park];
          expect(avg).toBeDefined();
          expect(isWellFormedAverage(avg!)).toBe(true);
          expect(avg).toBe(expectedAverage(values));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('per-Category averages are present exactly for Categories with >= 1 rating and well-formed (R4.3)', () => {
    fc.assert(
      fc.property(atOrAboveThresholdArb, (rows) => {
        const result = rollUpRatings(rows);
        const byCategory = result.averageByCategory!;
        const oracle = groupValues(rows, (r) => r.category);

        const reportedCategories = new Set(Object.keys(byCategory));
        expect(reportedCategories.size).toBe(oracle.size);
        for (const [category, values] of oracle) {
          const avg = byCategory[category];
          expect(avg).toBeDefined();
          expect(isWellFormedAverage(avg!)).toBe(true);
          expect(avg).toBe(expectedAverage(values));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
