// Feature: expanded-stats, Property 5: Resort_Statistic is independent of per-Area_Type Resort
/**
 * Property-based tests for the pure Coverage_Statistic roll-up
 * (`services/stats/coverage.ts`), focused on the independence of the
 * hotels-visited Resort_Statistic (`coverage.resort`) from the per-Area_Type
 * Resort cell (`coverage.byAreaType['Resort']`).
 *
 * Validates: Requirements 2.1, 2.2
 *
 * Design Property 5 says, in essence:
 *
 *   For any set of raw coverage cells, the Resort_Statistic is computed SOLELY
 *   from resort-representing rows (`isResortRepresentation === true`) and its
 *   numerator never exceeds its denominator, while `byAreaType['Resort']` is
 *   computed SOLELY from NON-resort-representing rows; the two are reported as
 *   two separate, independently computed values.
 *
 * The two dimensions partition the input on the `isResortRepresentation` flag,
 * so a change to one class of rows can never move the other value. We verify
 * this by (a) checking each value equals the from-scratch aggregate over its
 * own class of rows, (b) checking `0 <= completed <= total` for the
 * Resort_Statistic, and (c) perturbing one class of rows and asserting the
 * other value is unchanged.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage, type RawCoverageCell } from '../coverage.js';

const NUM_RUNS = 100;

/**
 * Generate one raw coverage cell with pre-aggregated counts satisfying the
 * repository contract `0 <= completed <= total` (inactive experiences are
 * already excluded upstream). `land`/`resortArea` are irrelevant to this
 * property, so they are held `null`.
 */
const rawCoverageCellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    isResortRepresentation: fc.boolean(),
    total: fc.nat({ max: 500 }),
  })
  .chain((base) =>
    fc.integer({ min: 0, max: base.total }).map((completed) => ({
      park: base.park,
      category: base.category,
      areaType: base.areaType,
      land: null,
      resortArea: null,
      worldShowcaseCountry: null,
      isResortRepresentation: base.isResortRepresentation,
      completed,
      total: base.total,
    })),
  );

const cellsArb = fc.array(rawCoverageCellArb, { maxLength: 60 });

/** Sum `(completed, total)` over a subset of cells. */
function aggregate(cells: readonly RawCoverageCell[]): {
  completed: number;
  total: number;
} {
  let completed = 0;
  let total = 0;
  for (const c of cells) {
    completed += c.completed;
    total += c.total;
  }
  return { completed, total };
}

describe('Coverage roll-up — Property 5: Resort_Statistic independent of per-Area_Type Resort', () => {
  it('resort is computed solely from resort-representing rows; numerator <= denominator', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { resort } = rollUpCoverage(cells);

        const expected = aggregate(cells.filter((c) => c.isResortRepresentation));

        // Computed solely from resort-representing rows.
        expect(resort.completed).toBe(expected.total === 0 ? 0 : expected.completed);
        expect(resort.total).toBe(expected.total);

        // Numerator never exceeds denominator; remaining is non-negative.
        expect(resort.completed).toBeGreaterThanOrEqual(0);
        expect(resort.completed).toBeLessThanOrEqual(resort.total);
        expect(resort.remaining).toBe(resort.total - resort.completed);
        expect(resort.remaining).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("byAreaType['Resort'] is computed solely from non-resort-representing rows", () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { byAreaType } = rollUpCoverage(cells);
        const resortAreaCell = byAreaType.Resort;

        const expected = aggregate(
          cells.filter(
            (c) => !c.isResortRepresentation && c.areaType === 'Resort',
          ),
        );

        expect(resortAreaCell.completed).toBe(
          expected.total === 0 ? 0 : expected.completed,
        );
        expect(resortAreaCell.total).toBe(expected.total);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the two values are reported separately and are mutually independent under perturbation', () => {
    fc.assert(
      fc.property(cellsArb, cellsArb, (baseCells, extraCells) => {
        const base = rollUpCoverage(baseCells);

        // Adding ONLY resort-representing rows must not change byAreaType.Resort.
        const addedResortRows = extraCells.map(
          (c): RawCoverageCell => ({ ...c, isResortRepresentation: true }),
        );
        const withResortRows = rollUpCoverage([...baseCells, ...addedResortRows]);
        expect(withResortRows.byAreaType.Resort).toEqual(base.byAreaType.Resort);

        // Adding ONLY non-resort Resort-area rows must not change the Resort_Statistic.
        const addedAreaRows = extraCells.map(
          (c): RawCoverageCell => ({
            ...c,
            isResortRepresentation: false,
            areaType: 'Resort',
          }),
        );
        const withAreaRows = rollUpCoverage([...baseCells, ...addedAreaRows]);
        expect(withAreaRows.resort).toEqual(base.resort);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
