// Feature: stats-experience-redesign, Property 2: Percent display
//
// Validates: Requirements 12.1, 12.2
//
// Property 2 (from design.md):
//   For any valid Completion_Cell, every rendered percent equals
//   `cell.percent.toFixed(1)` (R12.1). A `total === 0` cell yields `0.0%`,
//   a `completed` of 0, and no "N to go" affordance (R12.2).
//
// This targets the pure display transforms in `../statsView`:
//   - `displayedPercentLabel(cell)` — the one-decimal percent string the UI
//     renders (without the `%` glyph). The law is that it is value-identical to
//     `cell.percent.toFixed(1)` for every valid cell.
//   - `displayedPercent(cell)` — the numeric form used by the share projection;
//     `0` for a `total === 0` cell.
//   - `remainingToGo(cell)` — the "N to go" count, `null` (suppressed) for a
//     `total === 0` cell.
//   - `showCompleteBadge(cell)` — mirrors `cell.completeBadge`.
//
// Test strategy:
//   - All four transforms are framework-free pure functions, so the property
//     runs without rendering — no React / navigation / expo mocks needed.
//   - Generate arbitrary VALID `CompletionCell`s by picking `total` (0..N) and
//     `completed` (0..total), then deriving the remaining fields through the
//     shared `makeCell` fixture builder, which reproduces the exact
//     server-side laws (`percent = (completed/total)*100` rounded to one decimal
//     via `toFixed(1)`, `0.0` when `total === 0`; `remaining = total -
//     completed`; `completeBadge = total > 0 && completed === total`). This
//     guarantees the generated cells are indistinguishable from real wire data.
//   - A dedicated `total === 0` generator exercises the empty-cell branch of
//     R12.2 explicitly (alongside the general generator, which also produces it).

import fc from 'fast-check';

import {
  displayedPercent,
  displayedPercentLabel,
  remainingToGo,
  showCompleteBadge,
} from '../statsView';
import { makeCell } from '../__testSupport__/statsFixture';
import type { CompletionCell } from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID `CompletionCell`: `total` in `[0, 500]`, `completed` in
 * `[0, total]`, with every other field derived by `makeCell` so the cell
 * upholds the server invariants (`0 <= completed <= total`, server-rounded
 * `percent`, `remaining = total - completed`, `completeBadge` law).
 */
const completionCellArb: fc.Arbitrary<CompletionCell> = fc
  .nat({ max: 500 })
  .chain((total) =>
    fc.nat({ max: total }).map((completed) => makeCell(completed, total)),
  );

/** An arbitrary empty (`total === 0`) cell — always `makeCell(0, 0)`. */
const emptyCellArb: fc.Arbitrary<CompletionCell> = fc.constant(makeCell(0, 0));

// ---------------------------------------------------------------------------
// Property 2: Percent display
// ---------------------------------------------------------------------------

describe('Property 2: Percent display (R12.1, R12.2)', () => {
  test('every rendered percent equals cell.percent.toFixed(1)', () => {
    fc.assert(
      fc.property(completionCellArb, (cell) => {
        // R12.1: the rendered one-decimal string is value-identical to
        // `cell.percent.toFixed(1)`.
        expect(displayedPercentLabel(cell)).toBe(cell.percent.toFixed(1));

        // The numeric form agrees with the string form (same displayed value).
        expect(displayedPercent(cell).toFixed(1)).toBe(displayedPercentLabel(cell));

        // For any non-empty cell the numeric percent equals the server value.
        if (cell.total > 0) {
          expect(displayedPercent(cell)).toBe(cell.percent);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('a total === 0 cell yields 0.0%, completed 0, and no "N to go"', () => {
    fc.assert(
      fc.property(emptyCellArb, (cell) => {
        // R12.2: displays `0.0%`.
        expect(displayedPercentLabel(cell)).toBe('0.0');
        expect(displayedPercent(cell)).toBe(0);

        // R12.2: `completed` is 0.
        expect(cell.completed).toBe(0);

        // R12.2: no "N to go" affordance (suppressed → null).
        expect(remainingToGo(cell)).toBeNull();

        // An empty cell is never complete, so no complete badge either.
        expect(showCompleteBadge(cell)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  test('the "N to go" affordance is suppressed for every total === 0 cell drawn from the general generator', () => {
    fc.assert(
      fc.property(completionCellArb, (cell) => {
        if (cell.total === 0) {
          expect(displayedPercentLabel(cell)).toBe('0.0');
          expect(remainingToGo(cell)).toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });
});
