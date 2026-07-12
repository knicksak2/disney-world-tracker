// Feature: resort-tracking-and-stats, Property 1: Overall is the total over active items.
/**
 * Property-based test for Property 1 of the Resort Tracking and Stats design.
 *
 * Property 1 (Overall is the total over active items):
 *   For any catalog + completion state, `overall.total` equals the count of
 *   active Experiences (including resort-area and resort-representing rows) and
 *   `overall.completed` equals the count of the scope's completions against
 *   those rows.
 *
 * The stats roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`. It folds a `CoverageCellsSnapshot`'s flat cell list into
 * the response dimensions; the `overall` breakdown is the one this property
 * targets. Each `StatsCell` already reflects the active-only counts produced by
 * the repository SQL (`getStatsSnapshot`, which filters `active = TRUE`), so the
 * sum of every cell's `total` is precisely the count of active Experiences and
 * the sum of every cell's `completed` is precisely the scope's completions
 * against those active rows.
 *
 * Crucially for this feature, the snapshot now includes Park-less rows —
 * resort-area Experiences (`park === null`, `areaType === 'Resort'`,
 * `isResortRepresentation === false`) and resort-representing rows
 * (`park === null`, `isResortRepresentation === true`). The `overall` roll-up
 * must count these rows too (they were previously dropped). This test generates
 * arbitrary snapshots that deliberately mix Park-owned cells, Park-less resort-
 * area cells, and resort-representing cells, and asserts that
 * `overall.total` / `overall.completed` are the exact sums across all of them.
 *
 * Validates: Requirements 1.1, 1.2
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage } from '../coverage.js';
import type { RawCoverageCell } from '../repo.js';

/**
 * Local compatibility shim. The coverage roll-up moved out of the (now removed)
 * `buildResponse` route helper into the pure `rollUpCoverage` module. These
 * legacy property tests target the coverage fold, so they build the raw cell
 * list and call `rollUpCoverage`; the `land`/`resortArea` columns (unused by
 * this property) default to null.
 */
type StatsCell = Omit<RawCoverageCell, 'land' | 'resortArea' | 'worldShowcaseCountry'>;
interface CoverageCellsSnapshot {
  readonly cells: readonly StatsCell[];
}
function buildResponse(snapshot: CoverageCellsSnapshot) {
  return rollUpCoverage(
    snapshot.cells.map((c) => ({ ...c, land: null, resortArea: null, worldShowcaseCountry: null })),
  );
}

const NUM_RUNS = 100;

/**
 * Generator for a single snapshot cell with realistic, internally-consistent
 * counts (`completed <= total`, both non-negative). `park` is drawn from the
 * real Parks or `null`; `areaType` and `category` from their closed enums; and
 * `isResortRepresentation` from a boolean so representing rows are exercised.
 */
const cellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    isResortRepresentation: fc.boolean(),
    total: fc.nat({ max: 500 }),
    completedRatio: fc.nat({ max: 500 }),
  })
  .map(({ park, category, areaType, isResortRepresentation, total, completedRatio }) => ({
    park,
    category,
    areaType,
    isResortRepresentation,
    total,
    // Keep completed within [0, total] so cells resemble real snapshot rows.
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

/**
 * A Park-less resort-area cell: a resort restaurant/spa/recreation row that has
 * no owning Park and is NOT a representing row. These are the rows the old
 * pipeline dropped; `overall` must now count them.
 */
const resortAreaCellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    total: fc.nat({ max: 200 }),
    completedRatio: fc.nat({ max: 200 }),
  })
  .map(({ category, total, completedRatio }) => ({
    park: null,
    category,
    areaType: 'Resort' as const,
    isResortRepresentation: false,
    total,
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

/**
 * A resort-representing cell: the hotels-visited row backing the
 * Resort_Statistic. `park === null`, `areaType === 'Resort'`,
 * `isResortRepresentation === true`. It must still contribute to `overall`.
 */
const representingCellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    total: fc.nat({ max: 200 }),
    completedRatio: fc.nat({ max: 200 }),
  })
  .map(({ total, completedRatio }) => ({
    park: null,
    category: 'Resort' as const,
    areaType: 'Resort' as const,
    isResortRepresentation: true,
    total,
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

/**
 * A snapshot mixing general cells with at least some Park-less resort-area and
 * resort-representing cells, so the property exercises the rows the feature
 * newly retains rather than only Park-owned cells.
 */
const snapshotArb: fc.Arbitrary<CoverageCellsSnapshot> = fc
  .record({
    general: fc.array(cellArb, { maxLength: 60 }),
    resortArea: fc.array(resortAreaCellArb, { maxLength: 10 }),
    representing: fc.array(representingCellArb, { maxLength: 10 }),
  })
  .map(({ general, resortArea, representing }) => ({
    cells: [...general, ...resortArea, ...representing],
  }));

describe('buildResponse — Property 1: overall is the total over active items', () => {
  it('reports overall.total and overall.completed as the exact sums across all cells (incl. Park-less)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        let expectedTotal = 0;
        let expectedCompleted = 0;
        for (const cell of snapshot.cells) {
          expectedTotal += cell.total;
          expectedCompleted += cell.completed;
        }

        expect(response.overall.total).toBe(expectedTotal);
        expect(response.overall.completed).toBe(expectedCompleted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts Park-less resort-area and resort-representing rows in overall (regression guard)', () => {
    fc.assert(
      fc.property(
        fc.array(resortAreaCellArb, { minLength: 1, maxLength: 10 }),
        fc.array(representingCellArb, { minLength: 1, maxLength: 10 }),
        (resortArea, representing) => {
          const cells = [...resortArea, ...representing];
          const response = buildResponse({ cells });

          const expectedTotal = cells.reduce((sum, c) => sum + c.total, 0);
          const expectedCompleted = cells.reduce((sum, c) => sum + c.completed, 0);

          // Every generated cell is Park-less, so if any of them were dropped
          // (the old behaviour) overall would under-count. It must not.
          expect(response.overall.total).toBe(expectedTotal);
          expect(response.overall.completed).toBe(expectedCompleted);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
