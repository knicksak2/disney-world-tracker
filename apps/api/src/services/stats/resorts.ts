/**
 * Stats_Service: pure per-resort *activity* completion roll-up (Requirement 7).
 *
 * Pure functions only — no I/O, no clock, no DB access. `rollUpResortCoverage`
 * consumes the merged per-resort denominator/numerator counts read by the
 * snapshot repository (one `RawResortCoverageRow` per resort that owns at least
 * one active, non-representing resort-linked Experience) and folds them into a
 * sorted, open-ended list of `ResortCoverage`.
 *
 * This is the additive `byResort` coverage dimension (design D9): per-resort
 * *activity* completion ("how much you've done **at** each resort" — dining,
 * recreation, spa, and other resort-area activities owned by a specific hotel),
 * grouped by `experiences.resort_id`.
 *
 * Design decisions (from design.md "Backend Addition: `byResort`"):
 *
 *   - **Independent of hotels-visited** (R7.8): the repository excludes
 *     resort-representing stand-in rows (`represents_resort_id IS NOT NULL`)
 *     from the counts, so `byResort` (activity completion) and the
 *     `coverage.resort` hotels-visited (stayed) statistic never share a row and
 *     cannot conflate.
 *
 *   - **Shared cell laws** (R7.7): each row is mapped through the shared
 *     `toCompletionCell` constructor so the `0 <= completed <= total`,
 *     `percent ∈ [0.0, 100.0]`, `remaining = total - completed`, and
 *     `completeBadge ⇔ completed === total` laws are identical to every other
 *     coverage cell. Included resorts always have `total >= 1` by construction
 *     (the denominator read only yields groups with ≥ 1 active resort-linked
 *     experience).
 *
 *   - **Total-order sort** (R7.6): percent descending, then total descending,
 *     then case-insensitive label ascending, then exact label ascending, then
 *     `resortId` ascending. Two distinct resorts may share a name (e.g. a
 *     duplicated label), so the unique `resortId` (R7.10) is the ultimate
 *     tiebreak that keeps the order total, deterministic, and independent of
 *     input order — label alone is not unique.
 *
 *   - **Open-ended & empty** (R7.9, R7.10): the resort set is data-driven and
 *     returned as a list; empty input yields an empty list, and the repository
 *     never emits a duplicate `resortId`, so the output carries none either.
 *
 * Decision (b) (D5 / R17.3): `ResortCoverage` is defined here for local
 * mirroring (the existing convention). The mobile layer re-declares the
 * byte-identical shape. Either side MAY instead import it from `@dwt/shared`
 * without changing the shape.
 *
 * Validates: Requirements 7.5, 7.6, 7.7, 7.9, 7.10, 17.3.
 */

import { type CompletionCell, toCompletionCell } from './coverage.js';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * One resort's merged raw counts, as read and merged by the snapshot repository
 * inside the single `REPEATABLE READ READ ONLY` transaction. Owned here (the
 * pure module owns its input type, mirroring how `facets.ts` owns
 * `RawFacetExperienceRow` and `coverage.ts` owns `RawCoverageCell`) so the
 * repository can import it when it is extended to populate
 * `StatsSnapshot.resortCoverage`.
 *
 * The repository guarantees:
 *   - one row per distinct `resortId` (no duplicates, R7.10);
 *   - `total >= 1` (only resorts with ≥ 1 active resort-linked experience, R7.4);
 *   - resort-representing stand-in rows excluded (R7.2, R7.8);
 *   - `label` = the resort's `name` (R7.5).
 */
export interface RawResortCoverageRow {
  /** `resorts.id` — stable resort identity for navigation/identification. */
  readonly resortId: string;
  /** Display label = `resorts.name`. */
  readonly label: string;
  /** Target_User completions among that resort's active resort-linked experiences. */
  readonly completed: number;
  /** Count of that resort's active, non-representing resort-linked experiences. */
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

/**
 * A per-resort Coverage_Statistic: the resort's stable id, its display label,
 * and the completion cell for its resort-linked activity. Mirrors
 * `FacetCoverage { key, label, cell }`.
 *
 * The shape is byte-identical to the mobile `ResortCoverage` (R17.3): the
 * mobile layer mirrors this contract, whether the type is duplicated locally
 * (default) or centralized in `@dwt/shared`.
 */
export interface ResortCoverage {
  /** `resorts.id` — stable resort identity for navigation/identification. */
  readonly resortId: string;
  /** Display label = `resorts.name`. */
  readonly label: string;
  /** Completion cell: `{ completed, total, percent, remaining, completeBadge }`. */
  readonly cell: CompletionCell;
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

/**
 * Fold the merged raw per-resort counts into the sorted `ResortCoverage` list.
 * Pure over its input; called once per stats request from the route layer.
 *
 * Empty input yields an empty list (R7.9). The output preserves the "no
 * duplicate `resortId`" guarantee of the input (R7.10) — this function neither
 * introduces nor collapses rows, it only maps and sorts.
 *
 * Sort order (R7.6): percent descending → total descending → case-insensitive
 * label ascending → exact label ascending → `resortId` ascending (a total
 * order; `resortId` is unique per R7.10, so the final key resolves any
 * same-label tie deterministically regardless of input order).
 */
export function rollUpResortCoverage(
  rows: readonly RawResortCoverageRow[],
): readonly ResortCoverage[] {
  return rows
    .map((row) => ({
      resortId: row.resortId,
      label: row.label,
      cell: toCompletionCell(row.completed, row.total),
    }))
    .sort((a, b) => {
      if (b.cell.percent !== a.cell.percent) return b.cell.percent - a.cell.percent;
      if (b.cell.total !== a.cell.total) return b.cell.total - a.cell.total;
      const al = a.label.toLowerCase();
      const bl = b.label.toLowerCase();
      if (al !== bl) return al < bl ? -1 : 1;
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      // Ultimate tiebreak: the unique resortId (R7.10). Two distinct resorts can
      // share a label, so without this the sort is not a total order and the
      // output would depend on input order.
      return a.resortId < b.resortId ? -1 : a.resortId > b.resortId ? 1 : 0;
    });
}
