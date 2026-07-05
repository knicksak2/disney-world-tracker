// Feature: resort-tracking-and-stats, Property 3: Category counts every row (representing rows under `Resort`).
/**
 * Property-based test for Property 3 of the Resort Tracking and Stats design.
 *
 * Property 3 (Category is a total partition; resorts count under `Resort`):
 *   `byCategory` counts every active row under its Experience_Category — a real
 *   Experience under its own category, and each resort-representing row under
 *   the `Resort` category (the only category those hotel stand-ins carry). So
 *   `byCategory` is a total partition of the snapshot by category, and
 *   `byCategory['Resort']` reflects hotels-visited progress rather than reading
 *   zero (R1.3). This supersedes the earlier design in which representing rows
 *   were excluded from every Category bucket; a real `Resort` category now makes
 *   resort progress a first-class Category statistic.
 *
 * Because each `StatsCell.total` already reflects the active-only counts
 * produced by the repository SQL (`getStatsSnapshot`, which filters
 * `active = TRUE`), this test asserts over arbitrary snapshots:
 *
 *   1. For every category `c`, `byCategory[c]` equals the summed counts of
 *      every cell whose `category === c` — representing or not (total partition
 *      by category).
 *   2. A resort-representing row contributes to `byCategory['Resort']` and to no
 *      other category, so `byCategory['Resort']` is exactly the hotels-visited
 *      figure.
 *
 * Validates: Requirements 1.3, 4.4
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
    // Keep completed within [0, total] so cells resemble real snapshot rows.
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

/**
 * A resort-representing cell: the hotels-visited row backing the
 * Resort_Statistic. `park === null`, `areaType === 'Resort'`,
 * `isResortRepresentation === true`, and `category === 'Resort'` (the real
 * category these stand-ins carry). It contributes to `byCategory['Resort']`.
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
 * A snapshot mixing general cells (some of which may be representing rows) with
 * a guaranteed batch of explicit representing cells, so the property always
 * exercises the `Resort`-category counting rather than occasionally generating a
 * snapshot with no representing rows at all.
 */
const snapshotArb: fc.Arbitrary<CoverageCellsSnapshot> = fc
  .record({
    general: fc.array(cellArb, { maxLength: 60 }),
    representing: fc.array(representingCellArb, { maxLength: 10 }),
  })
  .map(({ general, representing }) => ({
    cells: [...general, ...representing],
  }));

describe('buildResponse — Property 3: Category is a total partition; resorts count under Resort', () => {
  it('byCategory[c] equals the summed counts of every cell with category c (representing included)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        for (const category of EXPERIENCE_CATEGORIES) {
          let expectedTotal = 0;
          let expectedCompleted = 0;
          for (const cell of snapshot.cells) {
            if (cell.category === category) {
              expectedTotal += cell.total;
              expectedCompleted += cell.completed;
            }
          }
          expect(response.byCategory[category].total).toBe(expectedTotal);
          expect(response.byCategory[category].completed).toBe(expectedCompleted);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a snapshot of only resort-representing rows counts entirely under byCategory[Resort]', () => {
    fc.assert(
      fc.property(
        fc.array(representingCellArb, { minLength: 1, maxLength: 10 }),
        (representing) => {
          const response = buildResponse({ cells: representing });

          const expectedTotal = representing.reduce((s, c) => s + c.total, 0);
          const expectedCompleted = representing.reduce(
            (s, c) => s + c.completed,
            0,
          );

          // All counts land under `Resort`...
          expect(response.byCategory.Resort.total).toBe(expectedTotal);
          expect(response.byCategory.Resort.completed).toBe(expectedCompleted);

          // ...and nothing leaks into any other Category bucket.
          for (const category of EXPERIENCE_CATEGORIES) {
            if (category === 'Resort') continue;
            expect(response.byCategory[category].total).toBe(0);
            expect(response.byCategory[category].completed).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
