// Feature: resort-tracking-and-stats, Property 2: Park dimensions are Park-scoped.
/**
 * Property-based test for Property 2 of the Resort Tracking and Stats design.
 *
 * Property 2 (Park dimensions are Park-scoped):
 *   No Park-less row (resort-area or resort-representing) contributes to any
 *   `byPark`/`byParkAndCategory` cell.
 *
 * The stats roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`. It folds a `CoverageCellsSnapshot`'s flat cell list into
 * the response dimensions. The Park dimensions (`byPark` and
 * `byParkAndCategory`) must stay scoped to Experiences that belong to a Park:
 * a cell with `park === null` — whether a resort-area Experience
 * (`isResortRepresentation === false`) or a resort-representing row
 * (`isResortRepresentation === true`) — must never land in any Park bucket.
 *
 * This test generates arbitrary snapshots that deliberately mix Park-owned
 * cells with Park-less resort-area and resort-representing cells, and asserts:
 *
 *   1. `sum(byPark[*].total)` equals the sum of `total` over only the cells
 *      with `park !== null` (Park-less rows contribute nothing), and likewise
 *      for `completed`.
 *   2. `sum(byParkAndCategory[*][*].total)` equals the same Park-scoped sum
 *      (and likewise for `completed`).
 *   3. Per-Park-and-Category, each cell equals the exact sum of the Park-owned
 *      snapshot cells for that `(park, category)` — no Park-less counts leak
 *      into any bucket.
 *
 * Validates: Requirements 1.4
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { Park } from '@dwt/shared';

import { rollUpCoverage } from '../coverage.js';
import type { RawCoverageCell } from '../repo.js';

/**
 * Local compatibility shim. The coverage roll-up moved out of the (now removed)
 * `buildResponse` route helper into the pure `rollUpCoverage` module, which no
 * longer produces a `byParkAndCategory` dimension (dropped by the expanded-stats
 * design). These legacy Park-scoping assertions retain the `byPark` checks; the
 * `byParkAndCategory` checks are removed with the dimension.
 */
type StatsCell = Omit<RawCoverageCell, 'land' | 'resortArea'>;
interface CoverageCellsSnapshot {
  readonly cells: readonly StatsCell[];
}
function buildResponse(snapshot: CoverageCellsSnapshot) {
  return rollUpCoverage(
    snapshot.cells.map((c) => ({ ...c, land: null, resortArea: null })),
  );
}

const NUM_RUNS = 100;

/** Keep a cell's completed count within [0, total] so it resembles a real row. */
function boundedCompleted(total: number, ratio: number): number {
  return total === 0 ? 0 : ratio % (total + 1);
}

/**
 * A Park-owned cell: a real theme-park / water-park / Disney Springs Experience
 * that belongs to a Park. These are the only cells allowed to contribute to the
 * Park dimensions.
 */
const parkCellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    park: fc.constantFrom(...PARKS),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    isResortRepresentation: fc.boolean(),
    total: fc.nat({ max: 300 }),
    ratio: fc.nat({ max: 300 }),
  })
  .map(({ park, category, areaType, isResortRepresentation, total, ratio }) => ({
    park,
    category,
    areaType,
    isResortRepresentation,
    total,
    completed: boundedCompleted(total, ratio),
  }));

/**
 * A Park-less resort-area cell: a resort restaurant/spa/recreation row with no
 * owning Park and NOT a representing row. It must contribute to no Park bucket.
 */
const resortAreaCellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    total: fc.nat({ max: 200 }),
    ratio: fc.nat({ max: 200 }),
  })
  .map(({ category, total, ratio }) => ({
    park: null,
    category,
    areaType: 'Resort' as const,
    isResortRepresentation: false,
    total,
    completed: boundedCompleted(total, ratio),
  }));

/**
 * A Park-less resort-representing cell: the hotels-visited row backing the
 * Resort_Statistic. It too must contribute to no Park bucket.
 */
const representingCellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    total: fc.nat({ max: 200 }),
    ratio: fc.nat({ max: 200 }),
  })
  .map(({ total, ratio }) => ({
    park: null,
    category: 'Resort' as const,
    areaType: 'Resort' as const,
    isResortRepresentation: true,
    total,
    completed: boundedCompleted(total, ratio),
  }));

/**
 * A snapshot mixing Park-owned cells with Park-less resort-area and resort-
 * representing cells so the property exercises exactly the rows that must be
 * excluded from the Park dimensions.
 */
const snapshotArb: fc.Arbitrary<CoverageCellsSnapshot> = fc
  .record({
    parkCells: fc.array(parkCellArb, { maxLength: 60 }),
    resortArea: fc.array(resortAreaCellArb, { maxLength: 12 }),
    representing: fc.array(representingCellArb, { maxLength: 12 }),
  })
  .map(({ parkCells, resortArea, representing }) => ({
    cells: [...parkCells, ...resortArea, ...representing],
  }));

/** Sum `total` / `completed` over only the cells with a non-null Park. */
function parkScopedSums(snapshot: CoverageCellsSnapshot): {
  total: number;
  completed: number;
} {
  let total = 0;
  let completed = 0;
  for (const cell of snapshot.cells) {
    if (cell.park !== null) {
      total += cell.total;
      completed += cell.completed;
    }
  }
  return { total, completed };
}

describe('buildResponse — Property 2: Park dimensions are Park-scoped', () => {
  it('sums byPark[*] to exactly the Park-owned cells (Park-less rows contribute nothing)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);
        const expected = parkScopedSums(snapshot);

        let sumTotal = 0;
        let sumCompleted = 0;
        for (const park of PARKS) {
          sumTotal += response.byPark[park].total;
          sumCompleted += response.byPark[park].completed;
        }

        expect(sumTotal).toBe(expected.total);
        expect(sumCompleted).toBe(expected.completed);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never leaks a Park-less cell into any byPark bucket', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        // Expected Park-scoped counts derived from ONLY the non-null-Park cells.
        const expectedPark = new Map<Park, { completed: number; total: number }>(
          PARKS.map((p) => [p, { completed: 0, total: 0 }]),
        );

        for (const cell of snapshot.cells) {
          if (cell.park === null) {
            continue; // Park-less rows must not appear anywhere in Park dims.
          }
          const p = expectedPark.get(cell.park)!;
          p.total += cell.total;
          p.completed += cell.completed;
        }

        for (const park of PARKS) {
          expect(response.byPark[park].total).toBe(expectedPark.get(park)!.total);
          expect(response.byPark[park].completed).toBe(
            expectedPark.get(park)!.completed,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('drops all Park counts when every cell is Park-less (regression guard)', () => {
    fc.assert(
      fc.property(
        fc.array(resortAreaCellArb, { minLength: 1, maxLength: 12 }),
        fc.array(representingCellArb, { minLength: 1, maxLength: 12 }),
        (resortArea, representing) => {
          const response = buildResponse({ cells: [...resortArea, ...representing] });

          for (const park of PARKS) {
            expect(response.byPark[park].total).toBe(0);
            expect(response.byPark[park].completed).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
