// Feature: resort-tracking-and-stats, Property 6: Percent invariants hold everywhere.
/**
 * Property-based test for Property 6 of the Resort Tracking and Stats design.
 *
 * Property 6 (Percent invariants hold everywhere):
 *   For every breakdown in the response (including `byAreaType` and `resort`),
 *   `percent ∈ [0.0, 100.0]`, is rounded to one decimal, `completed ≤ total`,
 *   and `total === 0 ⇒ completed === 0 ∧ percent === 0.0`.
 *
 * The roll-up under test is `buildResponse(snapshot)` from
 * `services/stats/routes.ts`. It folds a `CoverageCellsSnapshot`'s flat cell list into
 * every response dimension and produces each `percent` field via
 * `computePercent`, which applies the `[0.0, 100.0]` clamp, one-decimal
 * rounding, and the `denominator === 0 ⇒ 0.0` rule uniformly (R2.4, R4.3).
 *
 * This test collects EVERY breakdown across the whole response — `overall`,
 * all `byPark`, all `byCategory`, all `byParkAndCategory`, all `byAreaType`,
 * and `resort` — and asserts the four invariants on each:
 *
 *   1. `percent ∈ [0.0, 100.0]`.
 *   2. `percent` is rounded to one decimal: `percent === Math.round(percent*10)/10`.
 *   3. `completed ≤ total`.
 *   4. `total === 0 ⇒ completed === 0 ∧ percent === 0.0`.
 *
 * Note on invariant 3: `completed ≤ total` for an aggregated bucket only holds
 * when it holds per contributing cell. Real snapshot cells always satisfy
 * `completed ≤ total` (a scope cannot complete more Experiences than exist), so
 * the generator constrains every generated cell to `completed ≤ total`; summed
 * buckets then keep `completed ≤ total` too.
 *
 * Validates: Requirements 2.4, 4.3
 *
 * `fast-check` via Vitest, `numRuns >= 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage } from '../coverage.js';
import type { CompletionCell } from '../coverage.js';
import type { RawCoverageCell } from '../repo.js';

/**
 * Local compatibility shim. The coverage roll-up moved out of the (now removed)
 * `buildResponse` route helper into the pure `rollUpCoverage` module, which no
 * longer produces a `byParkAndCategory` dimension (dropped by the expanded-stats
 * design). The percent invariants are asserted over every remaining dimension.
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

/** Clamp a candidate completed count into `[0, total]` so `completed <= total`. */
const clampCompleted = (total: number, completedRatio: number): number =>
  total === 0 ? 0 : completedRatio % (total + 1);

/**
 * A general cell drawn across the full input space: any Park (or none), any
 * Category, any Area_Type, and either representation flag. Every cell keeps
 * `completed <= total` so aggregated buckets do too.
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
 * A resort-representing cell (hotels-visited row backing the Resort_Statistic):
 * `park === null`, `areaType === 'Resort'`, `isResortRepresentation === true`.
 * Included explicitly so the `resort` breakdown is regularly non-empty.
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

/** A snapshot mixing general cells with guaranteed representing cells. */
const snapshotArb: fc.Arbitrary<CoverageCellsSnapshot> = fc
  .record({
    general: fc.array(cellArb, { maxLength: 60 }),
    representing: fc.array(representingCellArb, { maxLength: 10 }),
  })
  .map(({ general, representing }) => ({
    cells: [...general, ...representing],
  }));

/**
 * Collect every breakdown across the whole response into a flat list, each
 * labelled for a readable assertion failure.
 */
function collectBreakdowns(
  response: ReturnType<typeof buildResponse>,
): ReadonlyArray<{ label: string; breakdown: CompletionCell }> {
  const out: { label: string; breakdown: CompletionCell }[] = [];

  out.push({ label: 'overall', breakdown: response.overall });

  for (const park of PARKS) {
    out.push({ label: `byPark[${park}]`, breakdown: response.byPark[park] });
  }

  for (const category of EXPERIENCE_CATEGORIES) {
    out.push({
      label: `byCategory[${category}]`,
      breakdown: response.byCategory[category],
    });
  }

  for (const areaType of AREA_TYPES) {
    out.push({
      label: `byAreaType[${areaType}]`,
      breakdown: response.byAreaType[areaType],
    });
  }

  out.push({ label: 'resort', breakdown: response.resort });

  return out;
}

describe('buildResponse — Property 6: Percent invariants hold everywhere', () => {
  it('every breakdown satisfies percent range, one-decimal rounding, completed<=total, and the zero rule', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const response = buildResponse(snapshot);

        for (const { label, breakdown } of collectBreakdowns(response)) {
          const { completed, total, percent } = breakdown;

          // 1. percent ∈ [0.0, 100.0]
          expect(percent, `${label}: percent >= 0`).toBeGreaterThanOrEqual(0.0);
          expect(percent, `${label}: percent <= 100`).toBeLessThanOrEqual(100.0);

          // 2. percent rounded to one decimal
          expect(percent, `${label}: percent is one-decimal`).toBe(
            Math.round(percent * 10) / 10,
          );

          // 3. completed ≤ total
          expect(completed, `${label}: completed <= total`).toBeLessThanOrEqual(
            total,
          );

          // 4. total === 0 ⇒ completed === 0 ∧ percent === 0.0
          if (total === 0) {
            expect(completed, `${label}: total==0 ⇒ completed==0`).toBe(0);
            expect(percent, `${label}: total==0 ⇒ percent==0.0`).toBe(0.0);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
