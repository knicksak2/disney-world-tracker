// Feature: stats-experience-redesign, Property 3: Complete badge equivalence
// Feature: stats-experience-redesign, Property 4: Remaining consistency
//
// Validates: Requirements 5.8, 5.9, 5.10
//
// Property 3 — Complete badge equivalence (from design.md):
//   For any valid Completion_Cell, the celebratory Complete_Badge is shown iff
//   `cell.completeBadge === true` (⇔ `total > 0 && completed === total`). The
//   view never recomputes the predicate; it mirrors the server flag (R5.8).
//
// Property 4 — Remaining consistency (from design.md):
//   The "N to go" affordance count equals `cell.remaining` and is shown ONLY
//   when the cell is incomplete and non-empty (`!completeBadge && total > 0`):
//     - complete cells suppress it (R5.10),
//     - empty (`total === 0`) cells suppress it,
//     - incomplete non-empty cells surface exactly `cell.remaining` (R5.9).
//
// This targets the pure display transforms in `../statsView`:
//   - `showCompleteBadge(cell)` — mirrors `cell.completeBadge` exactly.
//   - `remainingToGo(cell)` — the "N to go" count, or `null` when suppressed.
//
// Test strategy:
//   - Both transforms are framework-free pure functions, so the properties run
//     without rendering — no React / navigation / expo mocks needed.
//   - Generate arbitrary VALID `CompletionCell`s by picking `total` (0..N) and
//     `completed` (0..total), then deriving the remaining fields through the
//     shared `makeCell` fixture builder, which reproduces the exact server-side
//     laws (`remaining = total - completed`; `completeBadge = total > 0 &&
//     completed === total`). This guarantees generated cells are
//     indistinguishable from real wire data.
//   - Dedicated `complete`, `partial` (incomplete non-empty), and `empty`
//     generators exercise each branch of R5.9 / R5.10 explicitly, alongside the
//     general generator which covers all three.

import fc from 'fast-check';

import { remainingToGo, showCompleteBadge } from '../statsView';
import { makeCell } from '../__testSupport__/statsFixture';
import type { CompletionCell } from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID `CompletionCell`: `total` in `[0, 500]`, `completed` in
 * `[0, total]`, with every other field derived by `makeCell` so the cell
 * upholds the server invariants (`remaining = total - completed`,
 * `completeBadge = total > 0 && completed === total`).
 */
const completionCellArb: fc.Arbitrary<CompletionCell> = fc
  .nat({ max: 500 })
  .chain((total) =>
    fc.nat({ max: total }).map((completed) => makeCell(completed, total)),
  );

/**
 * An arbitrary COMPLETE cell (`total >= 1`, `completed === total`, so
 * `completeBadge === true`, `remaining === 0`).
 */
const completeCellArb: fc.Arbitrary<CompletionCell> = fc
  .integer({ min: 1, max: 500 })
  .map((total) => makeCell(total, total));

/**
 * An arbitrary INCOMPLETE non-empty cell (`total >= 1`, `completed < total`, so
 * `completeBadge === false`, `remaining >= 1`).
 */
const partialCellArb: fc.Arbitrary<CompletionCell> = fc
  .integer({ min: 1, max: 500 })
  .chain((total) =>
    fc.nat({ max: total - 1 }).map((completed) => makeCell(completed, total)),
  );

/** An arbitrary empty (`total === 0`) cell — always `makeCell(0, 0)`. */
const emptyCellArb: fc.Arbitrary<CompletionCell> = fc.constant(makeCell(0, 0));

// ---------------------------------------------------------------------------
// Property 3: Complete badge equivalence (R5.8)
// ---------------------------------------------------------------------------

describe('Property 3: Complete badge equivalence (R5.8)', () => {
  test('badge shown iff cell.completeBadge (⇔ total > 0 && completed === total)', () => {
    fc.assert(
      fc.property(completionCellArb, (cell) => {
        // R5.8: the view mirrors the server flag exactly — no recomputation.
        expect(showCompleteBadge(cell)).toBe(cell.completeBadge);

        // The server flag itself is equivalent to the completeness law, so the
        // badge decision agrees with `total > 0 && completed === total`.
        expect(showCompleteBadge(cell)).toBe(
          cell.total > 0 && cell.completed === cell.total,
        );
      }),
      { numRuns: 300 },
    );
  });

  test('every complete cell shows the badge', () => {
    fc.assert(
      fc.property(completeCellArb, (cell) => {
        expect(showCompleteBadge(cell)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('no incomplete or empty cell shows the badge', () => {
    fc.assert(
      fc.property(fc.oneof(partialCellArb, emptyCellArb), (cell) => {
        expect(showCompleteBadge(cell)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Remaining consistency (R5.9, R5.10)
// ---------------------------------------------------------------------------

describe('Property 4: Remaining consistency (R5.9, R5.10)', () => {
  test('"N to go" equals cell.remaining and is shown only when !completeBadge && total > 0', () => {
    fc.assert(
      fc.property(completionCellArb, (cell) => {
        const shown = !cell.completeBadge && cell.total > 0;
        if (shown) {
          // R5.9: surfaced exactly as `cell.remaining` for incomplete, non-empty cells.
          expect(remainingToGo(cell)).toBe(cell.remaining);
        } else {
          // R5.10 (complete) and empty (total === 0): suppressed → null.
          expect(remainingToGo(cell)).toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });

  test('incomplete non-empty cells surface exactly cell.remaining (a positive count)', () => {
    fc.assert(
      fc.property(partialCellArb, (cell) => {
        expect(remainingToGo(cell)).toBe(cell.remaining);
        expect(remainingToGo(cell)).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  test('complete cells suppress "N to go" (R5.10)', () => {
    fc.assert(
      fc.property(completeCellArb, (cell) => {
        expect(remainingToGo(cell)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  test('empty (total === 0) cells suppress "N to go"', () => {
    fc.assert(
      fc.property(emptyCellArb, (cell) => {
        expect(remainingToGo(cell)).toBeNull();
      }),
      { numRuns: 50 },
    );
  });
});
