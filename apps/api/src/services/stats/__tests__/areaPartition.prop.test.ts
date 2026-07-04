// Feature: resort-tracking-and-stats, Property 4: Area partition.
/**
 * Property-based test for Property 4 of the Resort Tracking and Stats design.
 *
 * Property 4 (Area partition):
 *   `sum(byAreaType[*].total)` equals the count of active non-representing
 *   Experiences, and each such Experience contributes to exactly one Area_Type.
 *
 * The stats roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`. It folds a `StatsSnapshot`'s flat cell list into
 * the response dimensions; the `byAreaType` breakdown is the one this property
 * targets. Per the design's roll-up table, a cell contributes to
 * `byAreaType[areaType]` only when `isResortRepresentation === false` —
 * resort-representing rows are the sole source of the Resort_Statistic and must
 * never inflate an Area_Type bucket (R2.2, R4.4).
 *
 * This test asserts the three facets of the partition:
 *
 *   1. Totality — `sum(byAreaType[*].total)` equals the sum of `total` over
 *      cells where `isResortRepresentation === false` (equivalently, the count
 *      of active non-representing Experiences). The same holds for `completed`.
 *
 *   2. Exclusion — resort-representing rows never contribute to `byAreaType`:
 *      injecting arbitrary representing cells does not change any `byAreaType`
 *      bucket.
 *
 *   3. Per-bucket partition — each non-representing cell's counts land in
 *      exactly its own `areaType` bucket (no double counting), and `byAreaType`
 *      has exactly the `AREA_TYPES` keys.
 *
 * Validates: Requirements 2.1, 2.2
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { AreaType } from '@dwt/shared';

import { buildResponse } from '../routes.js';
import type { StatsCell, StatsSnapshot } from '../repo.js';

const NUM_RUNS = 100;

/**
 * Generator for a single snapshot cell with realistic, internally-consistent
 * counts (`completed <= total`, both non-negative). `park` is drawn from the
 * real Parks or `null`; `areaType` and `category` from their closed enums; and
 * `isResortRepresentation` from a boolean so both representing and
 * non-representing rows are exercised in the same snapshot.
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
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

/**
 * A resort-representing cell: the hotels-visited row backing the
 * Resort_Statistic. `park === null`, `areaType === 'Resort'`,
 * `isResortRepresentation === true`. It must NEVER contribute to `byAreaType`.
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
 * A snapshot mixing general cells (some representing, some not) with extra
 * representing cells, so the property exercises the exclusion facet in addition
 * to the partition.
 */
const snapshotArb: fc.Arbitrary<StatsSnapshot> = fc
  .record({
    general: fc.array(cellArb, { maxLength: 60 }),
    representing: fc.array(representingCellArb, { maxLength: 10 }),
  })
  .map(({ general, representing }) => ({
    cells: [...general, ...representing],
  }));

describe('buildResponse — Property 4: Area partition', () => {
  it('sum(byAreaType[*].total/completed) equals the totals over non-representing cells', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        // Expected: only non-representing cells contribute to byAreaType.
        let expectedTotal = 0;
        let expectedCompleted = 0;
        for (const cell of snapshot.cells) {
          if (!cell.isResortRepresentation) {
            expectedTotal += cell.total;
            expectedCompleted += cell.completed;
          }
        }

        let actualTotal = 0;
        let actualCompleted = 0;
        for (const areaType of AREA_TYPES) {
          actualTotal += response.byAreaType[areaType].total;
          actualCompleted += response.byAreaType[areaType].completed;
        }

        expect(actualTotal).toBe(expectedTotal);
        expect(actualCompleted).toBe(expectedCompleted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('each non-representing cell lands in exactly its own areaType bucket (per-bucket partition)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        // Independently recompute the per-Area_Type totals by summing only the
        // non-representing cells into their own areaType bucket. Any double
        // counting or leakage across buckets would break this equality.
        const expected = new Map<AreaType, { completed: number; total: number }>(
          AREA_TYPES.map((a) => [a, { completed: 0, total: 0 }]),
        );
        for (const cell of snapshot.cells) {
          if (!cell.isResortRepresentation) {
            const bucket = expected.get(cell.areaType);
            // areaType is drawn from AREA_TYPES so the bucket always exists.
            if (bucket) {
              bucket.completed += cell.completed;
              bucket.total += cell.total;
            }
          }
        }

        for (const areaType of AREA_TYPES) {
          const want = expected.get(areaType) ?? { completed: 0, total: 0 };
          expect(response.byAreaType[areaType].total).toBe(want.total);
          expect(response.byAreaType[areaType].completed).toBe(want.completed);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('byAreaType has exactly the AREA_TYPES keys', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);
        expect(Object.keys(response.byAreaType).sort()).toEqual(
          [...AREA_TYPES].sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('representing rows never contribute to byAreaType (exclusion)', () => {
    fc.assert(
      fc.property(
        fc.array(cellArb, { maxLength: 40 }),
        fc.array(representingCellArb, { maxLength: 10 }),
        (general, representing) => {
          // byAreaType must be identical whether or not the representing cells
          // are present, since representing rows are excluded from it.
          const withoutRepresenting = buildResponse({ cells: general });
          const withRepresenting = buildResponse({
            cells: [...general, ...representing],
          });

          for (const areaType of AREA_TYPES) {
            expect(withRepresenting.byAreaType[areaType]).toEqual(
              withoutRepresenting.byAreaType[areaType],
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
