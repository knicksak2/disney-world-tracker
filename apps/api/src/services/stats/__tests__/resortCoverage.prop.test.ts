// Feature: stats-experience-redesign, Property 13: byResort bounds, independence & ordering
/**
 * Property-based tests for the pure per-resort *activity* completion roll-up
 * (`services/stats/resorts.ts`), the additive `byResort` coverage dimension.
 *
 * Validates: Requirements 7.6, 7.7, 7.8, 7.9, 7.10
 *
 * Design Property 13 (`byResort` bounds, independence & ordering):
 *
 *   For any valid stats snapshot, `rollUpResortCoverage` yields, for every
 *   included resort, a `CompletionCell` obeying the standard cell laws
 *   (`0 <= completed <= total`, `total >= 1`, `percent ∈ [0,100]`,
 *   `remaining = total - completed`, `completeBadge ⇔ completed === total`).
 *   The list is empty iff no active resort-linked experiences exist, contains
 *   no duplicate `resortId`, and is ordered by a total order (percent desc,
 *   then total desc, then case-insensitive label asc, then exact label). No
 *   entry counts a resort-representing stand-in row — the repository excludes
 *   them from the input entirely — so `byResort` is independent of the
 *   hotels-visited `coverage.resort` stat: changing one cannot change the other
 *   for a fixed catalog.
 *
 * The roll-up is pure over its `RawResortCoverageRow[]` input, which by the
 * repository contract carries only non-representing rows with `total >= 1` and
 * a distinct `resortId` each. At this pure layer, "independence from the
 * hotels-visited stat" (R7.8) manifests as: the output is a faithful,
 * count-preserving projection of exactly its input rows (each output cell maps
 * back to one input row with identical `completed`/`total`), so no representing
 * stand-in data can leak in and no counts can be inflated.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  rollUpResortCoverage,
  type RawResortCoverageRow,
  type ResortCoverage,
} from '../resorts.js';

const NUM_RUNS = 100;

/**
 * A label generator biased toward collisions: a small pool of values that vary
 * only by case (`Grand`/`grand`/`GRAND`, ...) mixed with short random strings.
 * The bias makes the case-insensitive and exact-label tiebreaks of the total
 * order actually fire during testing.
 */
const labelArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'Grand',
    'grand',
    'GRAND',
    'Pop Century',
    'pop century',
    'Art of Animation',
    'art of animation',
    'Beach Club',
    'Contemporary',
  ),
  fc.string({ maxLength: 6 }),
);

/**
 * One raw per-resort row honoring the repository contract:
 *   - `total >= 1` (only resorts with ≥ 1 active resort-linked experience),
 *   - `0 <= completed <= total`.
 *
 * `total` is kept in a small range so `percent`/`total` ties are common,
 * exercising the deeper (label) tiebreaks of the total order. `resortId` is a
 * placeholder here; uniqueness is enforced by the array generator below.
 */
const rawRowArb: fc.Arbitrary<RawResortCoverageRow> = fc
  .record({
    resortId: fc.string({ minLength: 1, maxLength: 8 }),
    label: labelArb,
    total: fc.integer({ min: 1, max: 8 }),
  })
  .chain((base) =>
    fc.integer({ min: 0, max: base.total }).map((completed) => ({
      resortId: base.resortId,
      label: base.label,
      completed,
      total: base.total,
    })),
  );

/**
 * A list of raw rows with distinct `resortId` values, mirroring the repository
 * guarantee that each resort appears at most once (R7.10). Uniqueness is keyed
 * on `resortId` so labels/counts may freely collide.
 */
const rowsArb: fc.Arbitrary<RawResortCoverageRow[]> = fc.uniqueArray(rawRowArb, {
  selector: (row) => row.resortId,
  maxLength: 40,
});

/**
 * The total order the roll-up must follow (R7.6): percent desc, then total
 * desc, then case-insensitive label asc, then exact label asc. Re-implemented
 * here independently so the test pins the contract rather than the code.
 */
function compare(a: ResortCoverage, b: ResortCoverage): number {
  if (b.cell.percent !== a.cell.percent) return b.cell.percent - a.cell.percent;
  if (b.cell.total !== a.cell.total) return b.cell.total - a.cell.total;
  const al = a.label.toLowerCase();
  const bl = b.label.toLowerCase();
  if (al !== bl) return al < bl ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

describe('rollUpResortCoverage — Property 13: byResort bounds, independence & ordering', () => {
  it('every entry obeys the standard cell laws (bounds, remaining, badge)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        for (const { cell } of rollUpResortCoverage(rows)) {
          // 0 <= completed <= total
          expect(cell.completed).toBeGreaterThanOrEqual(0);
          expect(cell.completed).toBeLessThanOrEqual(cell.total);
          // total >= 1 for every included resort
          expect(cell.total).toBeGreaterThanOrEqual(1);
          // percent ∈ [0, 100]
          expect(cell.percent).toBeGreaterThanOrEqual(0);
          expect(cell.percent).toBeLessThanOrEqual(100);
          // remaining = total - completed
          expect(cell.remaining).toBe(cell.total - cell.completed);
          // completeBadge ⇔ completed === total
          expect(cell.completeBadge).toBe(cell.completed === cell.total);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is ordered by the total order (percent desc → total desc → ci-label asc → exact label asc)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const out = rollUpResortCoverage(rows);
        for (let i = 1; i < out.length; i++) {
          // Each adjacent pair respects the comparator.
          expect(compare(out[i - 1]!, out[i]!)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ordering is deterministic and independent of input order (a total order)', () => {
    fc.assert(
      fc.property(rowsArb, fc.array(fc.nat(), { maxLength: 40 }), (rows, seeds) => {
        // Deterministic: same input → identical output.
        expect(rollUpResortCoverage(rows)).toEqual(rollUpResortCoverage(rows));

        // Shuffle the rows using the seed array, then assert the roll-up is
        // invariant to input order — the sort imposes a total order.
        const shuffled = [...rows]
          .map((row, i) => ({ row, k: seeds[i] ?? i }))
          .sort((x, y) => x.k - y.k)
          .map((entry) => entry.row);

        expect(rollUpResortCoverage(shuffled)).toEqual(rollUpResortCoverage(rows));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('contains no duplicate resortId', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const out = rollUpResortCoverage(rows);
        const ids = out.map((r) => r.resortId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns an empty list for empty input', () => {
    expect(rollUpResortCoverage([])).toEqual([]);
  });

  it('is a faithful, count-preserving projection of its input — no hotels-visited leakage (R7.8)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const out = rollUpResortCoverage(rows);

        // Same set of rows in, same set out (only reordered): resortId set is
        // preserved exactly, so no representing stand-in row can appear and
        // none can be dropped.
        expect(new Set(out.map((r) => r.resortId))).toEqual(
          new Set(rows.map((r) => r.resortId)),
        );
        expect(out.length).toBe(rows.length);

        // Each output cell maps back to exactly one input row with identical
        // counts — the roll-up neither invents nor inflates counts, so it is
        // computed solely from `byResort` rows and is independent of the
        // hotels-visited `coverage.resort` stat.
        const byId = new Map(rows.map((r) => [r.resortId, r]));
        for (const entry of out) {
          const src = byId.get(entry.resortId);
          expect(src).toBeDefined();
          expect(entry.label).toBe(src!.label);
          expect(entry.cell.completed).toBe(src!.completed);
          expect(entry.cell.total).toBe(src!.total);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
