/**
 * Example-based unit/merge tests for the Stats_Service per-resort coverage merge
 * (`services/stats/repo.ts` → `mergeResortCoverageRows`), task 1.4 of the
 * stats-experience-redesign plan.
 *
 * `mergeResortCoverageRows(denominatorRows, numeratorRows)` is the pure fold
 * that combines the two grouped result sets read inside the snapshot
 * transaction into `RawResortCoverageRow[]`. It mirrors the existing
 * `mergeCoverageRows` merge and is exported for direct unit testing without a
 * live DB.
 *
 * These tests exercise the merge function's CONTRACT:
 *   - Grouping is keyed by `resort_id`; the denominator read is authoritative
 *     for the resort set, the `resorts` name join (→ `label`), and `total`.
 *   - The numerator only attaches the Target_User's completed count to a resort
 *     already present in the denominators, defaulting to `0` when that resort
 *     has no completion row.
 *   - `total` / `completed` arrive as `bigint` strings (from `pg`) and are
 *     parsed to numbers.
 *   - A numerator row with no matching denominator is ignored defensively.
 *
 * The SQL-level exclusions — `represents_resort_id IS NOT NULL` rows, inactive
 * resorts, and inactive experiences (R7.2, R7.3) — are enforced by the query
 * that produces these result sets, not by the merge. The merge therefore
 * assumes its inputs are already filtered; these tests assert the merge honours
 * that contract by trusting the denominator's resort set verbatim.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4.
 */

import { describe, expect, it } from 'vitest';

import { mergeResortCoverageRows } from '../repo.js';
import type { RawResortCoverageRow } from '../resorts.js';

// ---------------------------------------------------------------------------
// Local row shapes
// ---------------------------------------------------------------------------
//
// `ResortDenominatorRow` / `ResortNumeratorRow` are repo-internal (not
// exported), so we mirror their structural shape here. `total` / `completed`
// are `bigint`-as-string exactly as `pg` returns them.

interface DenomRow {
  readonly resort_id: string;
  readonly resort_name: string;
  readonly total: string;
}

interface NumRow {
  readonly resort_id: string;
  readonly completed: string;
}

function denom(
  resort_id: string,
  resort_name: string,
  total: number,
): DenomRow {
  return { resort_id, resort_name, total: String(total) };
}

function num(resort_id: string, completed: number): NumRow {
  return { resort_id, completed: String(completed) };
}

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe('mergeResortCoverageRows — empty inputs', () => {
  it('returns an empty list when there are no denominator rows (R7.4)', () => {
    expect(mergeResortCoverageRows([], [])).toEqual([]);
  });

  it('ignores numerator rows entirely when no denominator rows exist (R7.4)', () => {
    // A numerator with no matching denominator cannot come from a real snapshot
    // (every completed experience is also counted in the active denominator),
    // so the merge drops it defensively rather than inventing a resort.
    expect(mergeResortCoverageRows([], [num('resort-a', 3)])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Denominator is authoritative for the resort set, label, and total
// ---------------------------------------------------------------------------

describe('mergeResortCoverageRows — denominator authoritative (R7.1, R7.4, R7.5)', () => {
  it('carries the resort_id, joined resort name (label), and total from the denominator', () => {
    const merged = mergeResortCoverageRows(
      [denom('resort-a', 'Grand Floridian', 5)],
      [num('resort-a', 2)],
    );

    expect(merged).toEqual<RawResortCoverageRow[]>([
      { resortId: 'resort-a', label: 'Grand Floridian', completed: 2, total: 5 },
    ]);
  });

  it('produces exactly one merged row per denominator resort, grouped by resort_id', () => {
    const merged = mergeResortCoverageRows(
      [
        denom('resort-a', 'Grand Floridian', 5),
        denom('resort-b', 'Contemporary', 3),
        denom('resort-c', 'Polynesian', 8),
      ],
      [num('resort-b', 1), num('resort-c', 8)],
    );

    expect(merged).toEqual<RawResortCoverageRow[]>([
      { resortId: 'resort-a', label: 'Grand Floridian', completed: 0, total: 5 },
      { resortId: 'resort-b', label: 'Contemporary', completed: 1, total: 3 },
      { resortId: 'resort-c', label: 'Polynesian', completed: 8, total: 8 },
    ]);
    // One row per denominator resort — no duplicate resortId (R7.10).
    expect(merged.map((r) => r.resortId)).toEqual([
      'resort-a',
      'resort-b',
      'resort-c',
    ]);
  });

  it('parses bigint-as-string total from the denominator into a number', () => {
    const merged = mergeResortCoverageRows([denom('resort-a', 'Yacht Club', 12)], []);

    expect(merged).toHaveLength(1);
    const row = merged[0]!;
    expect(row.total).toBe(12);
    expect(typeof row.total).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Numerator attaches completed count; defaults to 0
// ---------------------------------------------------------------------------

describe('mergeResortCoverageRows — numerator attaches completed (R7.1)', () => {
  it('defaults completed to 0 for a denominator resort with no numerator row', () => {
    const merged = mergeResortCoverageRows([denom('resort-a', 'Beach Club', 4)], []);

    expect(merged).toEqual<RawResortCoverageRow[]>([
      { resortId: 'resort-a', label: 'Beach Club', completed: 0, total: 4 },
    ]);
  });

  it('attaches the numerator completed count to the matching denominator resort', () => {
    const merged = mergeResortCoverageRows(
      [denom('resort-a', 'Wilderness Lodge', 6)],
      [num('resort-a', 4)],
    );

    expect(merged[0]!.completed).toBe(4);
  });

  it('parses bigint-as-string completed from the numerator into a number', () => {
    const merged = mergeResortCoverageRows(
      [denom('resort-a', 'Animal Kingdom Lodge', 9)],
      [num('resort-a', 7)],
    );

    const row = merged[0]!;
    expect(row.completed).toBe(7);
    expect(typeof row.completed).toBe('number');
  });

  it('supports a fully-completed resort (completed === total)', () => {
    const merged = mergeResortCoverageRows(
      [denom('resort-a', 'BoardWalk', 3)],
      [num('resort-a', 3)],
    );

    expect(merged[0]!.completed).toBe(3);
    expect(merged[0]!.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Numerator with no matching denominator is ignored
// ---------------------------------------------------------------------------

describe('mergeResortCoverageRows — orphan numerator rows (R7.4)', () => {
  it('ignores a numerator row whose resort_id is absent from the denominators', () => {
    const merged = mergeResortCoverageRows(
      [denom('resort-a', 'Riviera', 5)],
      [num('resort-a', 2), num('resort-ghost', 99)],
    );

    // Only the denominator resort survives; the orphan numerator is dropped and
    // never adds a phantom resort to the output.
    expect(merged).toEqual<RawResortCoverageRow[]>([
      { resortId: 'resort-a', label: 'Riviera', completed: 2, total: 5 },
    ]);
    expect(merged.map((r) => r.resortId)).not.toContain('resort-ghost');
  });
});

// ---------------------------------------------------------------------------
// Contract note: SQL-enforced exclusions
// ---------------------------------------------------------------------------

describe('mergeResortCoverageRows — trusts the pre-filtered denominator set (R7.2, R7.3)', () => {
  it('reflects exactly the resorts the query supplied (representing/inactive rows already excluded)', () => {
    // The exclusion of `represents_resort_id IS NOT NULL` rows and inactive
    // resorts/experiences happens in the SQL that produces these result sets.
    // The merge trusts that set verbatim: it neither adds nor removes resorts,
    // so the merged output is precisely the denominator's resort set.
    const denominators = [
      denom('resort-a', 'Grand Floridian', 5),
      denom('resort-b', 'Contemporary', 2),
    ];

    const merged = mergeResortCoverageRows(denominators, [num('resort-a', 1)]);

    expect(merged.map((r) => r.resortId)).toEqual(['resort-a', 'resort-b']);
    expect(merged).toHaveLength(denominators.length);
  });
});
