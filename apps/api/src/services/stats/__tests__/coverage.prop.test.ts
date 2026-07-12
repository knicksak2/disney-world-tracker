// Feature: expanded-stats, Property 1: Coverage counts are bounded and consistent
/**
 * Property-based test for Property 1 of the Expanded Stats design.
 *
 * Property 1 (Coverage counts are bounded and consistent):
 *   For any set of raw coverage cells, every reported Coverage_Statistic
 *   (overall, per-Park, per-Category, per-Area_Type, per-Land, per-Resort_Area,
 *   and the Resort_Statistic) satisfies `0 <= completed <= total`,
 *   `remaining == total - completed`, and `remaining >= 0`, and excludes
 *   inactive experiences from both numerator and denominator.
 *
 * The roll-up under test is the pure `rollUpCoverage(cells)` from
 * `services/stats/coverage.ts`, which folds a flat list of `RawCoverageCell`s
 * (pre-aggregated active-only `(completed, total)` counts per grouping tuple)
 * into every Coverage_Statistic dimension. Because the raw cells are already
 * active-only (inactive experiences are filtered upstream in the repository
 * SQL), the active-only exclusion (R1.10, R2.1's numerator bound) is reflected
 * here as: no cell ever carries `completed > total`, and every rolled-up cell
 * preserves that bound.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.10, 2.1, 2.3
 *
 * `fast-check` via Vitest, `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage, type CompletionCell, type RawCoverageCell } from '../coverage.js';

const NUM_RUNS = 100;

/**
 * Generate one valid `RawCoverageCell`. A cell models active-only counts, so
 * the numerator can never exceed the denominator: `total >= 0` and
 * `completed ∈ [0, total]`.
 *
 * `land` / `resortArea` draw from `null`, whitespace-only, and mixed-case
 * strings so the open-ended per-Land / per-Resort_Area dimensions (which
 * normalize by trim + case-insensitive grouping and drop null/blank values)
 * are exercised without changing the count invariants under test.
 */
const rawCellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    land: fc.option(
      fc.constantFrom('Fantasyland', ' fantasyland ', 'Tomorrowland', '   ', ''),
      { nil: null },
    ),
    resortArea: fc.option(
      fc.constantFrom('Epcot Area', ' epcot area ', 'Magic Kingdom Area', '   ', ''),
      { nil: null },
    ),
    worldShowcaseCountry: fc.option(
      fc.constantFrom('Epcot Area', ' epcot area ', 'Magic Kingdom Area', '   ', ''),
      { nil: null },
    ),
    isResortRepresentation: fc.boolean(),
    total: fc.nat({ max: 500 }),
  })
  .chain((partial) =>
    fc
      .integer({ min: 0, max: partial.total })
      .map((completed) => ({ ...partial, completed })),
  );

/** A set of 0..80 raw coverage cells. */
const cellsArb: fc.Arbitrary<readonly RawCoverageCell[]> = fc.array(rawCellArb, {
  maxLength: 80,
});

/** Assert the Property 1 invariants for a single reported Coverage_Statistic. */
function assertBoundedAndConsistent(cell: CompletionCell): void {
  // 0 <= completed <= total
  expect(cell.completed).toBeGreaterThanOrEqual(0);
  expect(cell.completed).toBeLessThanOrEqual(cell.total);
  // remaining == total - completed
  expect(cell.remaining).toBe(cell.total - cell.completed);
  // remaining >= 0
  expect(cell.remaining).toBeGreaterThanOrEqual(0);
  // counts are non-negative integers
  expect(Number.isInteger(cell.completed)).toBe(true);
  expect(Number.isInteger(cell.total)).toBe(true);
  expect(cell.total).toBeGreaterThanOrEqual(0);
}

describe('rollUpCoverage — Property 1: coverage counts are bounded and consistent', () => {
  it('every reported Coverage_Statistic satisfies 0 <= completed <= total and remaining == total - completed', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const coverage = rollUpCoverage(cells);

        // overall (R1.1)
        assertBoundedAndConsistent(coverage.overall);

        // per-Park (R1.3), per-Category (R1.4), per-Area_Type (R1.5)
        for (const park of PARKS) {
          assertBoundedAndConsistent(coverage.byPark[park]);
        }
        for (const category of EXPERIENCE_CATEGORIES) {
          assertBoundedAndConsistent(coverage.byCategory[category]);
        }
        for (const areaType of AREA_TYPES) {
          assertBoundedAndConsistent(coverage.byAreaType[areaType]);
        }

        // per-Land (R1.6) and per-Resort_Area (R1.7) open-ended dimensions
        for (const labeled of coverage.byLand) {
          assertBoundedAndConsistent(labeled.cell);
        }
        for (const labeled of coverage.byResortArea) {
          assertBoundedAndConsistent(labeled.cell);
        }

        // Resort_Statistic (R2.1): numerator never exceeds denominator
        assertBoundedAndConsistent(coverage.resort);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('overall and resort counts equal the exact sums of their contributing cells (R1.2, R2.1)', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const coverage = rollUpCoverage(cells);

        // overall sums every cell (R1.1, R1.2)
        const overallCompleted = cells.reduce((s, c) => s + c.completed, 0);
        const overallTotal = cells.reduce((s, c) => s + c.total, 0);
        expect(coverage.overall.completed).toBe(overallCompleted);
        expect(coverage.overall.total).toBe(overallTotal);

        // resort sums only resort-representing cells (R2.1)
        const resortCells = cells.filter((c) => c.isResortRepresentation);
        expect(coverage.resort.completed).toBe(
          resortCells.reduce((s, c) => s + c.completed, 0),
        );
        expect(coverage.resort.total).toBe(
          resortCells.reduce((s, c) => s + c.total, 0),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
