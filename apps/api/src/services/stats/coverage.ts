/**
 * Stats_Service: pure Coverage_Statistic roll-up (task 2.1).
 *
 * Pure functions only — no I/O, no clock, no DB access. This module consumes
 * the raw coverage cells the snapshot repository reads inside its single
 * `REPEATABLE READ READ ONLY` transaction and folds them into every reported
 * Coverage_Statistic dimension:
 *
 *   - `overall`       (R1.1)   — every active experience.
 *   - `byPark`        (R1.3)   — one cell per Park in the closed `PARKS` enum.
 *   - `byCategory`    (R1.4)   — one cell per `EXPERIENCE_CATEGORIES` value.
 *   - `byAreaType`    (R1.5)   — one cell per `AREA_TYPES` value, EXCLUDING
 *                                resort-representing rows so it stays
 *                                resort-*area* activity, not hotels visited
 *                                (R2.2).
 *   - `byLand`        (R1.6,   — one cell per distinct Land, grouped by trimmed
 *                      R1.8)     + case-insensitive key; null/empty/whitespace
 *                                Land values excluded.
 *   - `byResortArea`  (R1.7,   — identical rule for Resort_Area.
 *                      R1.9)
 *   - `resort`        (R2.1,   — the hotels-visited Resort_Statistic: sum of the
 *                      R2.2)     resort-representing rows ONLY, reported
 *                                separately from `byAreaType['Resort']`.
 *
 * Every dimension derives its `percent`, `remaining`, and `completeBadge`
 * through the single `toCompletionCell` constructor, so no dimension can
 * diverge on the empty-group rule (R1.12, R2.5): `total === 0` implies
 * `completed 0`, `percent 0.0`, `remaining 0`, `completeBadge false`.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10,
 * 1.11, 1.12, 2.1, 2.2, 2.3, 2.4, 2.5.
 */

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { computePercent } from './computePercent.js';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * One raw coverage cell produced by the snapshot repository: the pre-aggregated
 * `(completed, total)` counts for a single grouping tuple over ACTIVE
 * experiences only (inactive experiences are excluded from both numerator and
 * denominator upstream, R1.10).
 *
 * `land` / `resortArea` are kept in their RAW form (untrimmed, original case)
 * so this pure layer can apply the trim + case-insensitive normalization
 * (R1.6, R1.7) in exactly one place and remain independently testable.
 */
export interface RawCoverageCell {
  /** Owning Park, or `null` for Park-less rows (resort-area / resort-representing). */
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly areaType: AreaType;
  /** Raw Land value; normalized here. May be `null`. */
  readonly land: string | null;
  /** Raw Resort_Area value; normalized here. May be `null`. */
  readonly resortArea: string | null;
  /** `true` when the cell counts resort-representing rows (hotels-visited stand-ins). */
  readonly isResortRepresentation: boolean;
  readonly completed: number;
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * A Coverage_Statistic: the `{ completed, total, percent }` triple extended
 * with the derived `remaining` and `completeBadge` fields.
 *
 * Invariants (guaranteed by `toCompletionCell`):
 *   - `0 <= completed <= total`
 *   - `percent` ∈ `[0.0, 100.0]`, one decimal, round-half-away-from-zero
 *   - `remaining === total - completed` and `remaining >= 0`
 *   - `completeBadge === (total > 0 && completed === total)`
 *   - `total === 0` ⇒ `completed 0, percent 0.0, remaining 0, completeBadge false`
 */
export interface CompletionCell {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly remaining: number;
  readonly completeBadge: boolean;
}

/**
 * A Coverage_Statistic tagged with a human-readable display label, used for the
 * open-ended per-Land and per-Resort_Area dimensions where the group key is
 * data-driven rather than a fixed enum.
 */
export interface LabeledCell {
  readonly label: string;
  readonly cell: CompletionCell;
}

/**
 * The full Coverage_Statistic roll-up returned by `rollUpCoverage`. The
 * open-ended per-Facet_Value_Key dimension is produced by the separate
 * `facets.ts` module and is intentionally not part of this shape.
 */
export interface CoverageStats {
  readonly overall: CompletionCell;
  readonly byPark: Record<Park, CompletionCell>;
  readonly byCategory: Record<ExperienceCategory, CompletionCell>;
  readonly byAreaType: Record<AreaType, CompletionCell>;
  readonly byLand: readonly LabeledCell[];
  readonly byResortArea: readonly LabeledCell[];
  readonly resort: CompletionCell;
}

// ---------------------------------------------------------------------------
// CompletionCell constructor
// ---------------------------------------------------------------------------

/**
 * Build a `CompletionCell` from raw counts, computing `percent`, `remaining`,
 * and `completeBadge` uniformly so every coverage dimension derives them the
 * same way (R1.11, R2.3, R2.4).
 *
 * The `total === 0` short-circuit enforces the empty-group rule (R1.12, R2.5)
 * defensively: an empty group always reports `completed 0`, `percent 0.0`,
 * `remaining 0`, and `completeBadge false`, regardless of the `completed`
 * argument (which is structurally 0 for an empty group anyway).
 */
export function toCompletionCell(completed: number, total: number): CompletionCell {
  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      percent: 0.0,
      remaining: 0,
      completeBadge: false,
    };
  }
  return {
    completed,
    total,
    percent: computePercent(completed, total),
    remaining: total - completed,
    completeBadge: completed === total,
  };
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

/**
 * Fold a flat list of raw coverage cells into every Coverage_Statistic
 * dimension. Pure over its input; called once per stats request from the
 * route layer.
 */
export function rollUpCoverage(cells: readonly RawCoverageCell[]): CoverageStats {
  // overall (R1.1): every cell contributes, resort-representing rows included.
  let overallCompleted = 0;
  let overallTotal = 0;

  // resort (R2.1, R2.2): resort-representing rows ONLY, summed independently of
  // every enum dimension so hotels-visited progress and resort-area activity
  // are never conflated.
  let resortCompleted = 0;
  let resortTotal = 0;

  for (const cell of cells) {
    overallCompleted += cell.completed;
    overallTotal += cell.total;
    if (cell.isResortRepresentation) {
      resortCompleted += cell.completed;
      resortTotal += cell.total;
    }
  }

  return {
    overall: toCompletionCell(overallCompleted, overallTotal),
    // byPark (R1.3): Park-less rows (park === null) contribute to no Park.
    byPark: rollUpEnumDimension(PARKS, cells, (c) => c.park, () => true),
    // byCategory (R1.4): every active row under its category, including
    // resort-representing rows under the `Resort` category.
    byCategory: rollUpEnumDimension(
      EXPERIENCE_CATEGORIES,
      cells,
      (c) => c.category,
      () => true,
    ),
    // byAreaType (R1.5, R2.2): resort-representing rows excluded so this stays
    // resort-*area* activity, not hotels visited.
    byAreaType: rollUpEnumDimension(
      AREA_TYPES,
      cells,
      (c) => c.areaType,
      (c) => !c.isResortRepresentation,
    ),
    // byLand (R1.6, R1.8) / byResortArea (R1.7, R1.9): open-ended dimensions
    // grouped by the trimmed + case-insensitive key.
    byLand: rollUpNamedDimension(cells, (c) => c.land),
    byResortArea: rollUpNamedDimension(cells, (c) => c.resortArea),
    resort: toCompletionCell(resortCompleted, resortTotal),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Roll cells up into a fixed-enum dimension: one `CompletionCell` per key in
 * `keys`, seeded to zero so an absent key reports the empty-group cell (R1.12).
 *
 * `keyOf` maps a cell to its enum key or `null` (a `null` key contributes to no
 * bucket, e.g. Park-less rows for `byPark`). `include` gates which cells are
 * counted at all (e.g. `byAreaType` excludes resort-representing rows).
 */
function rollUpEnumDimension<K extends string>(
  keys: readonly K[],
  cells: readonly RawCoverageCell[],
  keyOf: (cell: RawCoverageCell) => K | null,
  include: (cell: RawCoverageCell) => boolean,
): Record<K, CompletionCell> {
  const acc = new Map<K, { completed: number; total: number }>();
  for (const key of keys) {
    acc.set(key, { completed: 0, total: 0 });
  }

  for (const cell of cells) {
    if (!include(cell)) {
      continue;
    }
    const key = keyOf(cell);
    if (key === null) {
      continue;
    }
    const bucket = acc.get(key);
    if (bucket) {
      bucket.completed += cell.completed;
      bucket.total += cell.total;
    }
  }

  const out = {} as Record<K, CompletionCell>;
  for (const key of keys) {
    const bucket = acc.get(key) ?? { completed: 0, total: 0 };
    out[key] = toCompletionCell(bucket.completed, bucket.total);
  }
  return out;
}

/**
 * Roll cells up into an open-ended, data-driven dimension (Land / Resort_Area).
 *
 * Two values fall in the same group iff they are equal after trimming leading
 * and trailing whitespace and comparing case-insensitively (R1.6, R1.7). Cells
 * whose value is `null`, empty, or whitespace-only are excluded entirely (R1.8,
 * R1.9).
 *
 * The reported display label is the first form under ascending case-insensitive
 * ordering among the trimmed forms observed for the group (design R1.6/R1.7
 * label rule); ties on the case-insensitive comparison fall back to raw
 * ascending order so the choice is deterministic. Output rows are sorted by the
 * same comparison for a stable, deterministic list.
 */
function rollUpNamedDimension(
  cells: readonly RawCoverageCell[],
  valueOf: (cell: RawCoverageCell) => string | null,
): LabeledCell[] {
  const groups = new Map<
    string,
    { labels: string[]; completed: number; total: number }
  >();

  for (const cell of cells) {
    const raw = valueOf(cell);
    if (raw === null) {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
      continue;
    }
    const key = trimmed.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.labels.push(trimmed);
      existing.completed += cell.completed;
      existing.total += cell.total;
    } else {
      groups.set(key, {
        labels: [trimmed],
        completed: cell.completed,
        total: cell.total,
      });
    }
  }

  const result: LabeledCell[] = [];
  for (const group of groups.values()) {
    result.push({
      label: pickLabel(group.labels),
      cell: toCompletionCell(group.completed, group.total),
    });
  }

  result.sort((a, b) => compareLabels(a.label, b.label));
  return result;
}

/**
 * Choose the label that sorts first under ascending case-insensitive
 * comparison (ties broken by raw ascending) among the trimmed forms of a group.
 */
function pickLabel(labels: readonly string[]): string {
  return labels.reduce((best, current) =>
    compareLabels(current, best) < 0 ? current : best,
  );
}

/**
 * Compare two labels case-insensitively; on a case-insensitive tie, fall back
 * to raw comparison so the ordering is total and deterministic.
 */
function compareLabels(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
