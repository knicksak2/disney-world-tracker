// Feature: expanded-stats, Property 9: Rating distribution partitions the active ratings
/**
 * Property-based test for the Stats_Service pure Personal Rating Statistics
 * roll-up (`services/stats/ratingStats.ts`, Requirement 5).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * Property 9 (design.md §"Correctness Properties"):
 *
 *   For any set of the Target_User's active Ratings at or above the
 *   Minimum_Ratings_Threshold, the Rating_Distribution has exactly one count
 *   for each integer 1..10 (zeros included) and the ten counts sum to the
 *   total active-rating count; below the threshold the distribution is omitted
 *   and the insufficient-data flag is set; and the rated-completions count is
 *   reported regardless of the threshold and derived only from active
 *   Experiences.
 *
 * The pure roll-up consumes `RawUserRatingRow[]` that the repository has
 * already filtered to active Experiences, so "derived only from active
 * Experiences" (R5.4) is honored at the source: every generated row is an
 * active rating, and the count of rows is therefore both the total
 * active-rating count and the rated-completions count.
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

import {
  MINIMUM_RATINGS_THRESHOLD,
  rollUpRatings,
  type RatingDistribution,
  type RawUserRatingRow,
} from '../ratingStats.js';

const NUM_RUNS = 100;

/** The ten integer Rating values a distribution must always key on. */
const DISTRIBUTION_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Ratings are integers in the inclusive range 1..10 (glossary). */
const ratingValueArb = fc.integer({ min: 1, max: 10 });

/**
 * A Park pool drawn from the closed `PARKS` enum; `null` models resort-area
 * (Park-less) rows so the generator matches `RawUserRatingRow.park`.
 */
const parkArb: fc.Arbitrary<Park | null> = fc.constantFrom<Park | null>(
  ...PARKS,
  null,
);

/** An Experience_Category pool drawn from the closed `EXPERIENCE_CATEGORIES` enum. */
const categoryArb: fc.Arbitrary<ExperienceCategory> =
  fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES);

/**
 * One of the Target_User's active Ratings. `experienceId` is drawn unique per
 * array by fast-check indexing in the map below; identity/name values do not
 * affect the distribution but keep the row shape realistic.
 */
const ratingRowArb: fc.Arbitrary<Omit<RawUserRatingRow, 'experienceId'>> =
  fc.record({
    experienceName: fc.string({ minLength: 1, maxLength: 12 }),
    value: ratingValueArb,
    park: parkArb,
    category: categoryArb,
  });

/**
 * A set of the Target_User's active Ratings. `minLength: 0` so the below- and
 * at-threshold boundaries (including the zero-ratings case, R5.2) are both
 * exercised across runs.
 */
const ratingRowsArb: fc.Arbitrary<readonly RawUserRatingRow[]> = fc
  .array(ratingRowArb, { minLength: 0, maxLength: 40 })
  .map((rows) =>
    rows.map((row, i) => ({ ...row, experienceId: `exp-${i}` })),
  );

/** Sum the ten distribution entries. */
function sumDistribution(distribution: RatingDistribution): number {
  return DISTRIBUTION_KEYS.reduce((acc, key) => acc + distribution[key], 0);
}

describe('Stats_Service ratings — Property 9: distribution partitions the active ratings', () => {
  it('at/above threshold: exactly one count per 1..10 and the ten counts sum to the active-rating total', () => {
    fc.assert(
      fc.property(ratingRowsArb, (rows) => {
        const stats = rollUpRatings(rows);

        if (rows.length < MINIMUM_RATINGS_THRESHOLD) {
          // Below-threshold runs are covered by the next property; skip here.
          return true;
        }

        // Sufficient data → distribution is reported (R5.1).
        if (!stats.sufficient) return false;
        if (stats.distribution === undefined) return false;

        const distribution = stats.distribution;

        // Exactly one count entry for each integer 1..10, no extra keys (R5.1).
        const keys = Object.keys(distribution)
          .map(Number)
          .sort((a, b) => a - b);
        if (keys.length !== 10) return false;
        for (let i = 0; i < DISTRIBUTION_KEYS.length; i += 1) {
          if (keys[i] !== DISTRIBUTION_KEYS[i]) return false;
        }

        // Every entry is a non-negative integer; zeros are included implicitly
        // by the fixed key set above (R5.1).
        for (const key of DISTRIBUTION_KEYS) {
          const count = distribution[key];
          if (!Number.isInteger(count) || count < 0) return false;
        }

        // The ten counts sum to the total active-rating count (R5.5). Since
        // every row is an active rating, that total is `rows.length` (R5.4).
        if (sumDistribution(distribution) !== rows.length) return false;

        // Each bucket equals the independently counted number of rows holding
        // that value — the partition is correct, not merely well-summed.
        for (const key of DISTRIBUTION_KEYS) {
          const expected = rows.filter((r) => r.value === key).length;
          if (distribution[key] !== expected) return false;
        }

        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('below threshold (including zero): distribution omitted and insufficient-data flag set', () => {
    fc.assert(
      fc.property(ratingRowsArb, (rows) => {
        const stats = rollUpRatings(rows);

        if (rows.length >= MINIMUM_RATINGS_THRESHOLD) {
          // At/above-threshold runs are covered by the property above.
          return true;
        }

        // Below threshold → distribution omitted, sufficient === false (R5.2).
        if (stats.sufficient !== false) return false;
        if (stats.distribution !== undefined) return false;

        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rated-completions count is reported regardless of threshold and equals the active-rating count (R5.3, R5.4)', () => {
    fc.assert(
      fc.property(ratingRowsArb, (rows) => {
        const stats = rollUpRatings(rows);

        // Reported regardless of the threshold, and derived only from active
        // Ratings (all generated rows are active) → equals the row count.
        if (!Number.isInteger(stats.ratedCompletionsCount)) return false;
        if (stats.ratedCompletionsCount !== rows.length) return false;

        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Stats_Service ratings — Property 9 fixed regression examples', () => {
  function row(value: number, i: number): RawUserRatingRow {
    return {
      experienceId: `exp-${i}`,
      experienceName: `Experience ${i}`,
      value,
      park: null,
      category: 'Ride',
    };
  }

  it('exactly at threshold reports a full 1..10 distribution summing to the count', () => {
    const rows = [row(1, 0), row(5, 1), row(10, 2)];
    const stats = rollUpRatings(rows);

    expect(stats.sufficient).toBe(true);
    expect(stats.distribution).toBeDefined();
    expect(stats.ratedCompletionsCount).toBe(3);

    const distribution = stats.distribution!;
    // Zeros are included for every unassigned value.
    expect(distribution).toEqual({
      1: 1,
      2: 0,
      3: 0,
      4: 0,
      5: 1,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
      10: 1,
    });
    expect(sumDistribution(distribution)).toBe(3);
  });

  it('one below threshold omits the distribution but still reports the rated-completions count', () => {
    const rows = [row(4, 0), row(7, 1)];
    const stats = rollUpRatings(rows);

    expect(stats.sufficient).toBe(false);
    expect(stats.distribution).toBeUndefined();
    expect(stats.ratedCompletionsCount).toBe(2);
  });

  it('zero ratings reports insufficient data with a zero rated-completions count', () => {
    const stats = rollUpRatings([]);

    expect(stats.sufficient).toBe(false);
    expect(stats.distribution).toBeUndefined();
    expect(stats.ratedCompletionsCount).toBe(0);
  });
});
