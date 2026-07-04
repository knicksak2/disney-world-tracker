// Feature: resort-tracking-and-stats, Property 5: Resort_Statistic identity.
/**
 * Property-based test for Property 5 of the Resort Tracking and Stats design.
 *
 * Property 5 (Resort_Statistic identity):
 *   `resort.total` equals the count of active Resorts and `resort.completed`
 *   equals the scope's completions of representing rows; representing rows
 *   never appear in `byAreaType['Resort']`.
 *
 * The stats roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`. It folds a `StatsSnapshot`'s flat cell list into
 * the response dimensions. The two dimensions this property targets are:
 *
 *   - `resort`               — the hotels-visited Resort_Statistic. Under
 *                              Option A there is exactly one resort-representing
 *                              Experience per active Resort, so the sum of the
 *                              `total` over every cell with
 *                              `isResortRepresentation === true` is precisely the
 *                              count of active Resorts, and the sum of the
 *                              `completed` over those cells is precisely the
 *                              scope's Resort_Visits (completions of representing
 *                              rows).
 *   - `byAreaType['Resort']` — the resort-*area* activity statistic. It must
 *                              count only NON-representing Resort-area cells;
 *                              representing rows must never leak into it (R4.4).
 *
 * The generator deliberately mixes Park-owned cells, non-representing Resort-area
 * cells, and resort-representing cells (all `areaType === 'Resort'`) so the
 * property exercises the exact conflation the design forbids: two different
 * "resort" measurements sharing the `Resort` Area_Type but kept distinct by the
 * `isResortRepresentation` discriminator.
 *
 * Validates: Requirements 4.1, 4.4
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { buildResponse } from '../routes.js';
import type { StatsCell, StatsSnapshot } from '../repo.js';

const NUM_RUNS = 100;

/** Clamp a candidate completed count into `[0, total]`. */
const clampCompleted = (total: number, completedRatio: number): number =>
  total === 0 ? 0 : completedRatio % (total + 1);

/**
 * A general cell drawn across the full input space: any Park (or none), any
 * Category, any Area_Type, and either representation flag. Exercises the roll-up
 * broadly so the Resort_Statistic identity is not accidentally coupled to a
 * narrow shape.
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
    completed: clampCompleted(total, completedRatio),
  }));

/**
 * A non-representing Resort-area cell: a resort restaurant/spa/recreation row.
 * `areaType === 'Resort'`, `isResortRepresentation === false`. These are the
 * rows that belong in `byAreaType['Resort']` and must NOT feed `resort`.
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
    completed: clampCompleted(total, completedRatio),
  }));

/**
 * A resort-representing cell: the hotels-visited row backing the
 * Resort_Statistic. `areaType === 'Resort'`, `isResortRepresentation === true`.
 * Its `total` counts active Resorts and its `completed` counts Resort_Visits.
 * It must feed `resort` and must NOT feed `byAreaType['Resort']`.
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
    completed: clampCompleted(total, completedRatio),
  }));

/**
 * A snapshot mixing general cells with a guaranteed presence of both
 * non-representing Resort-area cells and resort-representing cells, so the
 * property always exercises the two "resort" measurements side by side.
 */
const snapshotArb: fc.Arbitrary<StatsSnapshot> = fc
  .record({
    general: fc.array(cellArb, { maxLength: 60 }),
    resortArea: fc.array(resortAreaCellArb, { maxLength: 10 }),
    representing: fc.array(representingCellArb, { maxLength: 10 }),
  })
  .map(({ general, resortArea, representing }) => ({
    cells: [...general, ...resortArea, ...representing],
  }));

describe('buildResponse — Property 5: Resort_Statistic identity', () => {
  it('reports resort.total/completed as the exact sums over representing cells', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        // The count of active Resorts is the sum of the `total` over every
        // representing cell (one representing row per Resort); the scope's
        // Resort_Visits is the sum of `completed` over those same cells.
        let expectedResortTotal = 0;
        let expectedResortCompleted = 0;
        for (const cell of snapshot.cells) {
          if (cell.isResortRepresentation) {
            expectedResortTotal += cell.total;
            expectedResortCompleted += cell.completed;
          }
        }

        expect(response.resort.total).toBe(expectedResortTotal);
        expect(response.resort.completed).toBe(expectedResortCompleted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps representing rows out of byAreaType['Resort'] (no conflation)", () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        // byAreaType['Resort'] must count ONLY non-representing Resort-area
        // cells. Representing rows share the 'Resort' Area_Type but must never
        // contribute to this bucket (R4.4).
        let expectedAreaTotal = 0;
        let expectedAreaCompleted = 0;
        for (const cell of snapshot.cells) {
          if (cell.areaType === 'Resort' && !cell.isResortRepresentation) {
            expectedAreaTotal += cell.total;
            expectedAreaCompleted += cell.completed;
          }
        }

        expect(response.byAreaType.Resort.total).toBe(expectedAreaTotal);
        expect(response.byAreaType.Resort.completed).toBe(expectedAreaCompleted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('separates the two resort measurements even when both are non-empty', () => {
    fc.assert(
      fc.property(
        fc.array(resortAreaCellArb, { minLength: 1, maxLength: 10 }),
        fc.array(representingCellArb, { minLength: 1, maxLength: 10 }),
        (resortArea, representing) => {
          const cells = [...resortArea, ...representing];
          const response = buildResponse({ cells });

          const areaTotal = resortArea.reduce((sum, c) => sum + c.total, 0);
          const areaCompleted = resortArea.reduce((sum, c) => sum + c.completed, 0);
          const resortTotal = representing.reduce((sum, c) => sum + c.total, 0);
          const resortCompleted = representing.reduce((sum, c) => sum + c.completed, 0);

          // Resort_Statistic sees only representing rows...
          expect(response.resort.total).toBe(resortTotal);
          expect(response.resort.completed).toBe(resortCompleted);
          // ...and byAreaType['Resort'] sees only the resort-area activity rows.
          expect(response.byAreaType.Resort.total).toBe(areaTotal);
          expect(response.byAreaType.Resort.completed).toBe(areaCompleted);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
