// Feature: expanded-stats, Property 3: Complete_Badge and empty-group behavior
/**
 * Property-based tests for the pure Coverage_Statistic roll-up
 * (`services/stats/coverage.ts`), focused on the Complete_Badge flag and the
 * empty-group rule.
 *
 * Validates: Requirements 2.4, 2.5, 1.12
 *
 * Design Property 3 states, for any coverage cell:
 *
 *   - `completeBadge` is true **if and only if** `total > 0 && completed === total`
 *     (R2.4); and
 *   - when `total === 0`, then `completed === 0`, `percent === 0.0`,
 *     `remaining === 0`, and `completeBadge === false` (R2.5, R1.12).
 *
 * The badge and empty-group semantics are produced uniformly by the single
 * `toCompletionCell` constructor, so every reported dimension (overall,
 * per-Park, per-Category, per-Area_Type, per-Land, per-Resort_Area, and the
 * Resort_Statistic) inherits the same guarantees. These tests therefore assert
 * the property both directly against `toCompletionCell` and against every cell
 * emitted by `rollUpCoverage`.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import {
  rollUpCoverage,
  toCompletionCell,
  type CompletionCell,
  type CoverageStats,
  type RawCoverageCell,
} from '../coverage.js';

const NUM_RUNS = 100;

/**
 * Assert Property 3 against a single produced `CompletionCell`. Kept as a plain
 * predicate returning `boolean` so it composes inside `fc.property`.
 */
function badgeAndEmptyGroupHold(cell: CompletionCell): boolean {
  // R2.4: completeBadge iff total > 0 && completed === total.
  const expectedBadge = cell.total > 0 && cell.completed === cell.total;
  if (cell.completeBadge !== expectedBadge) {
    return false;
  }

  // R2.5 / R1.12: the empty-group cell is fully pinned.
  if (cell.total === 0) {
    if (
      cell.completed !== 0 ||
      cell.percent !== 0.0 ||
      cell.remaining !== 0 ||
      cell.completeBadge !== false
    ) {
      return false;
    }
  }

  return true;
}

/**
 * A raw coverage cell arbitrary. `completed` is constrained to `[0, total]`
 * (the meaningful input space: a group's completed count never exceeds its
 * total), and `total` is drawn from `[0, max]` so the `total === 0`
 * empty-group case is reachable with reasonable frequency.
 */
const rawCoverageCellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom(...AREA_TYPES),
    land: fc.option(
      fc.constantFrom('Fantasyland', ' tomorrowland ', 'Adventureland', ''),
      { nil: null },
    ),
    resortArea: fc.option(
      fc.constantFrom('Epcot Area', ' magic kingdom area ', 'Deluxe', ''),
      { nil: null },
    ),
    worldShowcaseCountry: fc.option(
      fc.constantFrom('Epcot Area', ' magic kingdom area ', 'Deluxe', ''),
      { nil: null },
    ),
    isResortRepresentation: fc.boolean(),
    total: fc.integer({ min: 0, max: 40 }),
  })
  .chain((base) =>
    fc
      .integer({ min: 0, max: base.total })
      .map((completed) => ({ ...base, completed })),
  );

/** Collect every `CompletionCell` emitted by a `CoverageStats` roll-up. */
function allCells(stats: CoverageStats): CompletionCell[] {
  return [
    stats.overall,
    ...Object.values(stats.byPark),
    ...Object.values(stats.byCategory),
    ...Object.values(stats.byAreaType),
    ...stats.byLand.map((l) => l.cell),
    ...stats.byResortArea.map((l) => l.cell),
    stats.resort,
  ];
}

describe('coverage — Property 3: Complete_Badge and empty-group behavior', () => {
  it('toCompletionCell: badge iff total > 0 && completed === total, and empty-group is pinned', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: 40 })
          .chain((total) =>
            fc
              .integer({ min: 0, max: total })
              .map((completed) => ({ completed, total })),
          ),
        ({ completed, total }) => {
          const cell = toCompletionCell(completed, total);
          return badgeAndEmptyGroupHold(cell);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('toCompletionCell: a full group (completed === total > 0) always earns the badge', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (total) => {
        const cell = toCompletionCell(total, total);
        return (
          cell.completeBadge === true &&
          cell.remaining === 0 &&
          cell.percent === 100.0
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('toCompletionCell: a partial group (completed < total) never earns the badge', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 40 })
          .chain((total) =>
            fc
              .integer({ min: 0, max: total - 1 })
              .map((completed) => ({ completed, total })),
          ),
        ({ completed, total }) => {
          const cell = toCompletionCell(completed, total);
          return cell.completeBadge === false && cell.remaining > 0;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rollUpCoverage: every emitted cell satisfies the badge and empty-group rules', () => {
    fc.assert(
      fc.property(
        fc.array(rawCoverageCellArb, { minLength: 0, maxLength: 30 }),
        (cells) => {
          const stats = rollUpCoverage(cells);
          return allCells(stats).every(badgeAndEmptyGroupHold);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rollUpCoverage: enum dimensions with no contributing rows report the pinned empty-group cell', () => {
    // With an empty input, every fixed-enum bucket must be the empty-group cell
    // and there are no open-ended Land/Resort_Area rows at all.
    const stats = rollUpCoverage([]);
    const emptyCell: CompletionCell = {
      completed: 0,
      total: 0,
      percent: 0.0,
      remaining: 0,
      completeBadge: false,
    };
    for (const cell of allCells(stats)) {
      expect(cell).toEqual(emptyCell);
    }
    expect(stats.byLand).toEqual([]);
    expect(stats.byResortArea).toEqual([]);
  });
});
