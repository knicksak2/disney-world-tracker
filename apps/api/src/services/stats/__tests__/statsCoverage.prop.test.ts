// Feature: friend-stats-viewing, Property 4: Stats coverage, active-only computation, and counts.
/**
 * Property-based test for Property 4 of the Friend Stats Viewing design.
 *
 * Property 4 (Stats coverage, active-only computation, and counts):
 *   For any catalog of active and inactive Experiences and any completion set,
 *   an authorized statistics read returns a breakdown for the overall total,
 *   for every Park, and for every one of the six Experience_Categories, where
 *   each breakdown's `completed` and `total` counts are computed over only
 *   Active Experiences and each `percent` is the `computePercent` of those two
 *   counts.
 *
 * The stats roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`, which folds a `StatsSnapshot`'s flat cell list
 * into `overall` / `byPark` / `byCategory` / `byParkAndCategory`, each a
 * `{ completed, total, percent }` breakdown with `percent === computePercent`.
 *
 * The active-only computation itself happens in the repository SQL
 * (`getStatsSnapshot`, which joins `experiences ... AND e.active = TRUE`), so
 * the cells handed to `buildResponse` already reflect active-only counts. This
 * test reproduces that filter at the data level: it generates a catalog of
 * active/inactive Experiences plus a per-Experience completion flag, derives
 * the snapshot cells the way the SQL would (counting Active Experiences only),
 * and asserts that `buildResponse`:
 *
 *   - covers the overall total, every Park, and every Experience_Category,
 *     plus every (Park, Category) cell (coverage),
 *   - reports counts that reflect only Active Experiences — inactive
 *     Experiences (even completed ones) never contribute (active-only),
 *   - reports `overall` as the exact sum of the cell counts (counts),
 *   - and reports every `percent` as `computePercent(completed, total)`.
 *
 * Validates: Requirements 3.1, 3.3
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { buildResponse } from '../routes.js';
import type { StatsCell, StatsSnapshot } from '../repo.js';
import { computePercent } from '../computePercent.js';

const NUM_RUNS = 100;

/** One generated catalog Experience plus whether the target User completed it. */
interface GeneratedExperience {
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly active: boolean;
  readonly completed: boolean;
}

const experienceArb: fc.Arbitrary<GeneratedExperience> = fc.record({
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  active: fc.boolean(),
  completed: fc.boolean(),
});

/**
 * A catalog of 0..120 Experiences. The upper bound is generous enough to keep
 * most (Park, Category) cells populated across runs while staying fast.
 */
const catalogArb: fc.Arbitrary<readonly GeneratedExperience[]> = fc.array(
  experienceArb,
  { maxLength: 120 },
);

/** Stable key for a (Park, Category) cell. */
function cellKey(park: Park, category: ExperienceCategory): string {
  return `${park}|${category}`;
}

/**
 * Build the active-only snapshot cells the repository SQL would produce for a
 * generated catalog: group **Active** Experiences by (Park, Category), with
 * `total` = number of active Experiences in the cell and `completed` = number
 * of those that carry a Completion. Inactive Experiences are excluded entirely
 * — mirroring `JOIN experiences e ... AND e.active = TRUE`.
 */
function activeOnlySnapshot(
  catalog: readonly GeneratedExperience[],
): StatsSnapshot {
  const acc = new Map<string, StatsCell>();
  for (const exp of catalog) {
    if (!exp.active) {
      continue;
    }
    const key = cellKey(exp.park, exp.category);
    const existing = acc.get(key);
    if (existing) {
      acc.set(key, {
        park: exp.park,
        category: exp.category,
        completed: existing.completed + (exp.completed ? 1 : 0),
        total: existing.total + 1,
      });
    } else {
      acc.set(key, {
        park: exp.park,
        category: exp.category,
        completed: exp.completed ? 1 : 0,
        total: 1,
      });
    }
  }
  return { cells: Array.from(acc.values()) };
}

describe('buildResponse — Property 4: stats coverage, active-only counts, and percentages', () => {
  it('covers overall, every Park, every Category, and every (Park, Category) cell', () => {
    fc.assert(
      fc.property(catalogArb, (catalog) => {
        const response = buildResponse(activeOnlySnapshot(catalog));

        // overall present
        expect(response.overall).toBeDefined();

        // every Park present in byPark
        expect(new Set(Object.keys(response.byPark))).toEqual(new Set(PARKS));
        // every Category present in byCategory
        expect(new Set(Object.keys(response.byCategory))).toEqual(
          new Set(EXPERIENCE_CATEGORIES),
        );
        // every (Park, Category) cell present in byParkAndCategory
        expect(new Set(Object.keys(response.byParkAndCategory))).toEqual(
          new Set(PARKS),
        );
        for (const park of PARKS) {
          expect(
            new Set(Object.keys(response.byParkAndCategory[park])),
          ).toEqual(new Set(EXPERIENCE_CATEGORIES));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('computes counts over only Active Experiences (inactive never contribute)', () => {
    fc.assert(
      fc.property(catalogArb, (catalog) => {
        const response = buildResponse(activeOnlySnapshot(catalog));

        const active = catalog.filter((e) => e.active);

        // Expected per-cell counts derived directly from the active subset.
        for (const park of PARKS) {
          for (const category of EXPERIENCE_CATEGORIES) {
            const inCell = active.filter(
              (e) => e.park === park && e.category === category,
            );
            const expectedTotal = inCell.length;
            const expectedCompleted = inCell.filter((e) => e.completed).length;
            const cell = response.byParkAndCategory[park][category];
            expect(cell.total).toBe(expectedTotal);
            expect(cell.completed).toBe(expectedCompleted);
          }
        }

        // Per-Park and per-Category totals also reflect only active rows.
        for (const park of PARKS) {
          const inPark = active.filter((e) => e.park === park);
          expect(response.byPark[park].total).toBe(inPark.length);
          expect(response.byPark[park].completed).toBe(
            inPark.filter((e) => e.completed).length,
          );
        }
        for (const category of EXPERIENCE_CATEGORIES) {
          const inCat = active.filter((e) => e.category === category);
          expect(response.byCategory[category].total).toBe(inCat.length);
          expect(response.byCategory[category].completed).toBe(
            inCat.filter((e) => e.completed).length,
          );
        }

        // Overall counts equal the active totals and never count inactive rows.
        expect(response.overall.total).toBe(active.length);
        expect(response.overall.completed).toBe(
          active.filter((e) => e.completed).length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports overall as the exact sum of all (Park, Category) cell counts', () => {
    fc.assert(
      fc.property(catalogArb, (catalog) => {
        const response = buildResponse(activeOnlySnapshot(catalog));

        let sumCompleted = 0;
        let sumTotal = 0;
        for (const park of PARKS) {
          for (const category of EXPERIENCE_CATEGORIES) {
            const cell = response.byParkAndCategory[park][category];
            sumCompleted += cell.completed;
            sumTotal += cell.total;
          }
        }

        expect(response.overall.completed).toBe(sumCompleted);
        expect(response.overall.total).toBe(sumTotal);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports every percent as computePercent(completed, total)', () => {
    fc.assert(
      fc.property(catalogArb, (catalog) => {
        const response = buildResponse(activeOnlySnapshot(catalog));

        const check = (b: { completed: number; total: number; percent: number }): void => {
          expect(b.percent).toBe(computePercent(b.completed, b.total));
        };

        check(response.overall);
        for (const park of PARKS) {
          check(response.byPark[park]);
          for (const category of EXPERIENCE_CATEGORIES) {
            check(response.byParkAndCategory[park][category]);
          }
        }
        for (const category of EXPERIENCE_CATEGORIES) {
          check(response.byCategory[category]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
