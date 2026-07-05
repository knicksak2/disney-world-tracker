// Feature: expanded-stats, Property 2: Percent is well-formed for every coverage cell
/**
 * Property-based test for Property 2 of the Expanded Stats design.
 *
 * Property 2 (Percent is well-formed for every coverage cell):
 *   For any coverage cell, `percent` is in `[0.0, 100.0]`, rounded to one
 *   decimal using round-half-away-from-zero, and equals `0.0` whenever
 *   `total == 0`.
 *
 * Validates: Requirements 1.11, 1.12
 *
 * The unit under test is the pure Coverage_Statistic roll-up in
 * `services/stats/coverage.ts`: the `toCompletionCell(completed, total)`
 * constructor (which every dimension derives its `percent` through) and the
 * `rollUpCoverage(cells)` fold that produces `overall`, `byPark`,
 * `byCategory`, `byAreaType`, `byLand`, `byResortArea`, and the `resort`
 * Resort_Statistic. Because every dimension routes its counts through the
 * single `toCompletionCell` constructor, checking the constructor directly and
 * checking every cell emitted by `rollUpCoverage` together cover "every
 * coverage cell".
 *
 * The round-half-away-from-zero rule (R1.11) is asserted against `round1`
 * (which implements exactly that rule in `computePercent.ts`): a well-formed
 * one-decimal percent must satisfy `percent === round1(percent)` (idempotence)
 * and, for a populated cell, `percent === min(100, round1(completed*100/total))`.
 *
 * `fast-check` via Vitest, `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage, toCompletionCell } from '../coverage.js';
import type { CompletionCell, RawCoverageCell } from '../coverage.js';
import { round1 } from '../computePercent.js';

const NUM_RUNS = 100;

/**
 * Assert Property 2's four sub-claims on a single well-formed `CompletionCell`.
 * `label` gives a readable location on failure.
 */
function assertPercentWellFormed(cell: CompletionCell, label: string): void {
  const { completed, total, percent } = cell;

  // 1. percent ∈ [0.0, 100.0] (R1.11).
  expect(percent, `${label}: percent >= 0.0`).toBeGreaterThanOrEqual(0.0);
  expect(percent, `${label}: percent <= 100.0`).toBeLessThanOrEqual(100.0);

  // 2. rounded to one decimal, round-half-away-from-zero (R1.11): a value that
  //    already honors the rule is a fixed point of round1.
  expect(percent, `${label}: percent === round1(percent)`).toBe(round1(percent));

  // 3. exact value: min(100, round1(completed*100/total)) for populated cells;
  //    0.0 for empty cells. This pins down the rounding rule by name.
  if (total === 0) {
    // 4. total === 0 ⇒ percent === 0.0 (R1.12).
    expect(percent, `${label}: total===0 ⇒ percent===0.0`).toBe(0.0);
  } else {
    expect(percent, `${label}: percent === min(100, round1(raw))`).toBe(
      Math.min(100.0, round1((completed * 100) / total)),
    );
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A raw coverage cell drawn across the full input space. `completed` is
 * constrained to `[0, total]` (a scope cannot complete more Experiences than
 * exist), matching the real snapshot invariant. `land`/`resortArea` include
 * null, whitespace-only, and mixed-case forms so the open-ended dimensions are
 * regularly populated.
 */
const cellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    land: fc.option(
      fc.constantFrom('Fantasyland', ' fantasyland ', 'Tomorrowland', '   ', ''),
      { nil: null },
    ),
    resortArea: fc.option(
      fc.constantFrom('Epcot Area', ' epcot area ', 'Magic Kingdom Area', '   '),
      { nil: null },
    ),
    isResortRepresentation: fc.boolean(),
    total: fc.nat({ max: 400 }),
    completedRatio: fc.nat({ max: 400 }),
  })
  .map(({ total, completedRatio, ...rest }) => ({
    ...rest,
    total,
    completed: total === 0 ? 0 : completedRatio % (total + 1),
  }));

const cellsArb: fc.Arbitrary<readonly RawCoverageCell[]> = fc.array(cellArb, {
  maxLength: 60,
});

/**
 * Collect every `CompletionCell` emitted by `rollUpCoverage` into one flat,
 * labelled list so Property 2 can be asserted on each.
 */
function collectCells(
  stats: ReturnType<typeof rollUpCoverage>,
): ReadonlyArray<{ label: string; cell: CompletionCell }> {
  const out: { label: string; cell: CompletionCell }[] = [];
  out.push({ label: 'overall', cell: stats.overall });
  out.push({ label: 'resort', cell: stats.resort });
  for (const park of PARKS) {
    out.push({ label: `byPark[${park}]`, cell: stats.byPark[park] });
  }
  for (const category of EXPERIENCE_CATEGORIES) {
    out.push({ label: `byCategory[${category}]`, cell: stats.byCategory[category] });
  }
  for (const areaType of AREA_TYPES) {
    out.push({ label: `byAreaType[${areaType}]`, cell: stats.byAreaType[areaType] });
  }
  stats.byLand.forEach((lc, i) =>
    out.push({ label: `byLand[${i}](${lc.label})`, cell: lc.cell }),
  );
  stats.byResortArea.forEach((lc, i) =>
    out.push({ label: `byResortArea[${i}](${lc.label})`, cell: lc.cell }),
  );
  return out;
}

describe('coverage — Property 2: Percent is well-formed for every coverage cell', () => {
  it('toCompletionCell yields a well-formed percent for any completed<=total', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 400 }),
        fc.nat({ max: 400 }),
        (total, completedRatio) => {
          const completed = total === 0 ? 0 : completedRatio % (total + 1);
          assertPercentWellFormed(
            toCompletionCell(completed, total),
            `toCompletionCell(${completed}, ${total})`,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('toCompletionCell reports percent 0.0 whenever total === 0 (R1.12)', () => {
    fc.assert(
      // `completed` is structurally 0 for an empty group, but the constructor
      // must defend the zero rule regardless of the argument.
      fc.property(fc.nat({ max: 400 }), (completed) => {
        const cell = toCompletionCell(completed, 0);
        expect(cell.percent).toBe(0.0);
        expect(cell.total).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every cell emitted by rollUpCoverage has a well-formed percent', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const stats = rollUpCoverage(cells);
        for (const { label, cell } of collectCells(stats)) {
          assertPercentWellFormed(cell, label);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
