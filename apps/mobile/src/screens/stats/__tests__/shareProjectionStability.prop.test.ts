// Feature: stats-experience-redesign, Property 8: Share projection stability
//
// Validates: Requirements 13.2, 13.3, 13.4, 13.5
//
// Property 8 (from design.md):
//   For any valid StatsResponse, `buildProgressShareParams` emits a stable
//   `progress` projection over the nested `coverage` object:
//     - it emits `kind: 'progress'`, `overallPercent`, `perParkPercent`, and
//       `perCategoryPercent` (R13.2),
//     - `perParkPercent` covers every member of `PARKS` (R13.3),
//     - `perCategoryPercent` covers every member of `EXPERIENCE_CATEGORIES`
//       (R13.4),
//     - and `overallPercent`, each `perParkPercent` entry, and each
//       `perCategoryPercent` entry equal the displayed-percent of the
//       corresponding `coverage` Completion_Cell — a `total === 0` cell
//       yielding `0.0` (R13.5).
//
// This targets the migrated pure projection in `../statsView`:
//   - `buildProgressShareParams(stats)` — reads only `coverage.overall`,
//     `coverage.byPark`, and `coverage.byCategory`, projecting each through the
//     shared `displayedPercent` transform.
//
// Test strategy:
//   - `buildProgressShareParams` is a framework-free pure function, so the
//     property runs without rendering — no React / navigation / expo mocks.
//   - Generate arbitrary VALID coverage maps: one arbitrary VALID cell per park
//     and per category (via the shared `makeCell` fixture builder, which
//     reproduces the server invariants), plus an arbitrary overall cell,
//     including many `total === 0` cells (small totals) to exercise R13.5's
//     empty-cell branch. `makeStatsResponse` fills the rest of the response so
//     the input is indistinguishable from real wire data.
//   - The expected value for every entry is `displayedPercent(cell)`, the same
//     transform Property 2 pins to `cell.percent.toFixed(1)` — so this property
//     proves the projection wires each cell to its displayed percent, and
//     determinism/purity are asserted alongside.

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';
import fc from 'fast-check';

import { buildProgressShareParams, displayedPercent } from '../statsView';
import { makeCell, makeStatsResponse } from '../__testSupport__/statsFixture';
import type { CompletionCell } from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID `CompletionCell`: `total` in `[0, 30]`, `completed` in
 * `[0, total]`, every other field derived by the shared `makeCell` so the cell
 * upholds the server invariants. Small totals make `total === 0` (and exact
 * completions) common, exercising the empty-cell branch of R13.5.
 */
const cellArb: fc.Arbitrary<CompletionCell> = fc
  .nat({ max: 30 })
  .chain((total) => fc.nat({ max: total }).map((completed) => makeCell(completed, total)));

/** Build a fixed-enum cell map (one arbitrary cell per enum member). */
function enumCellMapArb<K extends string>(
  keys: readonly K[],
): fc.Arbitrary<Record<K, CompletionCell>> {
  return fc
    .array(cellArb, { minLength: keys.length, maxLength: keys.length })
    .map((cells) => {
      const map = {} as Record<K, CompletionCell>;
      keys.forEach((key, i) => {
        map[key] = cells[i]!;
      });
      return map;
    });
}

const byParkArb = enumCellMapArb<Park>(PARKS);
const byCategoryArb = enumCellMapArb<ExperienceCategory>(EXPERIENCE_CATEGORIES);

/**
 * An arbitrary valid `StatsResponse` whose `coverage.overall`, `coverage.byPark`,
 * and `coverage.byCategory` are independently generated (the fields the share
 * projection reads); every other field comes from the fixture default.
 */
const statsArb = fc
  .record({
    overall: cellArb,
    byPark: byParkArb,
    byCategory: byCategoryArb,
  })
  .map(({ overall, byPark, byCategory }) =>
    makeStatsResponse({ coverage: { overall, byPark, byCategory } }),
  );

// ---------------------------------------------------------------------------
// Property 8: Share projection stability
// ---------------------------------------------------------------------------

describe('Property 8: Share projection stability (R13.2, R13.3, R13.4, R13.5)', () => {
  test('emits a progress projection with overall/park/category percents', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const params = buildProgressShareParams(stats);

        // R13.2: the four projected fields are emitted.
        expect(params.kind).toBe('progress');
        if (params.kind !== 'progress') return; // narrow for the type checker
        expect(typeof params.overallPercent).toBe('number');
        expect(params.perParkPercent).toBeDefined();
        expect(params.perCategoryPercent).toBeDefined();

        // R13.5: overall equals the displayed-percent of coverage.overall.
        expect(params.overallPercent).toBe(displayedPercent(stats.coverage.overall));
      }),
      { numRuns: 300 },
    );
  });

  test('perParkPercent covers every PARK, each equal to its cell displayed-percent', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const params = buildProgressShareParams(stats);
        if (params.kind !== 'progress') throw new Error('expected progress kind');

        // R13.3: one entry for every member of PARKS (no extras).
        expect(Object.keys(params.perParkPercent).sort()).toEqual([...PARKS].sort());

        // R13.5: each entry equals the displayed-percent of its coverage cell,
        // and a total === 0 cell yields exactly 0.0.
        for (const park of PARKS) {
          const cell = stats.coverage.byPark[park];
          expect(params.perParkPercent[park]).toBe(displayedPercent(cell));
          if (cell.total === 0) {
            expect(params.perParkPercent[park]).toBe(0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  test('perCategoryPercent covers every EXPERIENCE_CATEGORY, each equal to its cell displayed-percent', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const params = buildProgressShareParams(stats);
        if (params.kind !== 'progress') throw new Error('expected progress kind');

        // R13.4: one entry for every member of EXPERIENCE_CATEGORIES (no extras).
        expect(Object.keys(params.perCategoryPercent).sort()).toEqual(
          [...EXPERIENCE_CATEGORIES].sort(),
        );

        // R13.5: each entry equals the displayed-percent of its coverage cell,
        // and a total === 0 cell yields exactly 0.0.
        for (const category of EXPERIENCE_CATEGORIES) {
          const cell = stats.coverage.byCategory[category];
          expect(params.perCategoryPercent[category]).toBe(displayedPercent(cell));
          if (cell.total === 0) {
            expect(params.perCategoryPercent[category]).toBe(0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  test('the projection is deterministic (equal input → equal output)', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        expect(buildProgressShareParams(stats)).toEqual(buildProgressShareParams(stats));
      }),
      { numRuns: 100 },
    );
  });
});
