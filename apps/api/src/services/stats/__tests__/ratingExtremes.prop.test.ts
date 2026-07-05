// Feature: expanded-stats, Property 10: Highest and lowest selection is deterministic under ties
/**
 * Property-based tests for the Stats_Service Personal Rating Statistics
 * highest-/lowest-rated selection (`rollUpRatings` in `../ratingStats.ts`).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 *
 * Design Property 10 states, in essence:
 *
 *   For any set of the Target_User's active Ratings at or above the
 *   Minimum_Ratings_Threshold, the highest-rated result is the active
 *   Experience with the maximum value and the lowest-rated is the one with the
 *   minimum value, ties broken by ascending case-insensitive name then
 *   ascending Experience id so exactly one is selected for each; when every
 *   Rating shares a single value the same Experience is returned as both
 *   highest and lowest; and below the threshold both are omitted with the
 *   insufficient-data flag set.
 *
 * `rollUpRatings` receives rows already filtered to active Experiences by the
 * repository (R6.5 is enforced upstream), so these tests exercise the pure
 * selection logic over active rows only. Each `fc.assert` runs with
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import {
  MINIMUM_RATINGS_THRESHOLD,
  rollUpRatings,
  type RatedExperience,
  type RawUserRatingRow,
} from '../ratingStats.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A small pool of Experience names chosen to force ties and to exercise the
 * case-insensitive comparison: `Alpha`/`alpha` and `Beta`/`beta` differ only
 * by case, so the name tie-break must fall through to the id tie-break when
 * they collide case-insensitively.
 */
const nameArb = fc.constantFrom(
  'Alpha',
  'alpha',
  'Beta',
  'beta',
  'Carousel',
  'carousel',
  'Zebra',
);

const parkArb: fc.Arbitrary<Park | null> = fc.option(
  fc.constantFrom<Park>(...PARKS),
  { nil: null },
);

const categoryArb = fc.constantFrom<ExperienceCategory>(
  ...EXPERIENCE_CATEGORIES,
);

/**
 * Generate a set of rating rows with **unique** Experience ids (a Rating is at
 * most one per (user, Experience), so an Experience appears at most once) while
 * allowing names and values to collide freely to provoke tie-breaks. Values are
 * drawn from a narrow band (2..5) so that ties on the extreme value are common.
 */
function ratingRowsArb(
  minLength: number,
  maxLength: number,
  valueMin = 2,
  valueMax = 5,
): fc.Arbitrary<readonly RawUserRatingRow[]> {
  return fc
    .array(
      fc.record({
        experienceId: fc.string({ minLength: 1, maxLength: 6 }),
        experienceName: nameArb,
        value: fc.integer({ min: valueMin, max: valueMax }),
        park: parkArb,
        category: categoryArb,
      }),
      { minLength, maxLength },
    )
    .map((rows) => {
      // Dedupe by experienceId (keep first occurrence) so ids are unique.
      const seen = new Set<string>();
      const out: RawUserRatingRow[] = [];
      for (const row of rows) {
        if (seen.has(row.experienceId)) {
          continue;
        }
        seen.add(row.experienceId);
        out.push(row);
      }
      return out;
    });
}

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/** Tie-break: ascending case-insensitive name, then ascending id (R6.3). */
function tieBreak(a: RawUserRatingRow, b: RawUserRatingRow): number {
  const an = a.experienceName.toLowerCase();
  const bn = b.experienceName.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  if (a.experienceId < b.experienceId) return -1;
  if (a.experienceId > b.experienceId) return 1;
  return 0;
}

/**
 * Independent recompute of the expected extreme: filter to the rows holding the
 * max (resp. min) value, then pick the first under the tie-break ordering.
 */
function expectedExtreme(
  rows: readonly RawUserRatingRow[],
  which: 'highest' | 'lowest',
): RatedExperience {
  const values = rows.map((r) => r.value);
  const target =
    which === 'highest' ? Math.max(...values) : Math.min(...values);
  const candidates = rows
    .filter((r) => r.value === target)
    .slice()
    .sort(tieBreak);
  const best = candidates[0]!;
  return {
    experienceId: best.experienceId,
    name: best.experienceName,
    value: best.value,
  };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Stats_Service — Property 10: highest/lowest deterministic selection', () => {
  it('at/above threshold selects the max-value highest and min-value lowest, tie-broken deterministically (R6.1, R6.2, R6.3)', () => {
    fc.assert(
      fc.property(
        ratingRowsArb(MINIMUM_RATINGS_THRESHOLD, 40),
        (rows) => {
          fc.pre(rows.length >= MINIMUM_RATINGS_THRESHOLD);
          const stats = rollUpRatings(rows);

          expect(stats.sufficient).toBe(true);
          expect(stats.highest).toEqual(expectedExtreme(rows, 'highest'));
          expect(stats.lowest).toEqual(expectedExtreme(rows, 'lowest'));

          // The reported values are the true extremes across all rows.
          const values = rows.map((r) => r.value);
          expect(stats.highest!.value).toBe(Math.max(...values));
          expect(stats.lowest!.value).toBe(Math.min(...values));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('the selected extreme is the first among all rows sharing its value under the ascending name-then-id tie-break (R6.3)', () => {
    fc.assert(
      fc.property(
        ratingRowsArb(MINIMUM_RATINGS_THRESHOLD, 40),
        (rows) => {
          fc.pre(rows.length >= MINIMUM_RATINGS_THRESHOLD);
          const stats = rollUpRatings(rows);

          for (const which of ['highest', 'lowest'] as const) {
            const chosen = which === 'highest' ? stats.highest! : stats.lowest!;
            // Every other row sharing the chosen value must sort at or after
            // the chosen one; exactly one row (the chosen) is minimal.
            const sharing = rows.filter((r) => r.value === chosen.value);
            const chosenRow = sharing.find(
              (r) => r.experienceId === chosen.experienceId,
            )!;
            for (const other of sharing) {
              expect(tieBreak(chosenRow, other)).toBeLessThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('when every rating shares a single value, the same experience is returned as both highest and lowest (R6.6)', () => {
    fc.assert(
      fc.property(
        // Fixed value band collapses to a single value for the whole set.
        ratingRowsArb(MINIMUM_RATINGS_THRESHOLD, 40, 7, 7),
        (rows) => {
          fc.pre(rows.length >= MINIMUM_RATINGS_THRESHOLD);
          const stats = rollUpRatings(rows);

          expect(stats.sufficient).toBe(true);
          expect(stats.highest).toBeDefined();
          expect(stats.lowest).toBeDefined();
          expect(stats.highest).toEqual(stats.lowest);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('below the threshold both highest and lowest are omitted and the insufficient-data flag is set (R6.4)', () => {
    fc.assert(
      fc.property(
        ratingRowsArb(0, MINIMUM_RATINGS_THRESHOLD - 1),
        (rows) => {
          fc.pre(rows.length < MINIMUM_RATINGS_THRESHOLD);
          const stats = rollUpRatings(rows);

          expect(stats.sufficient).toBe(false);
          expect(stats.highest).toBeUndefined();
          expect(stats.lowest).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
