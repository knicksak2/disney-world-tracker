/**
 * Stats_Service: pure per-Facet_Value_Key roll-up (Requirement 3).
 *
 * Pure functions only — no I/O, no clock, no DB access. `rollUpFacets`
 * consumes one `RawFacetExperienceRow` per active Experience (produced by the
 * snapshot repository) and folds them into an open-ended list of
 * `FacetCoverage`, one entry per distinct Facet_Value_Key present on any active
 * Experience.
 *
 * Design decisions (from design.md §3 "facets.ts"):
 *
 *   - **Facet_Value_Key = `id`** (exact string). Keys are grouped by *exact*
 *     string equality; any difference in letter case or leading/trailing
 *     whitespace produces a distinct key (R3.7). This is deliberately unlike
 *     the Land/Resort_Area normalization, which trims + lowercases.
 *
 *   - **Display label = `name`**. When a single key is observed with more than
 *     one distinct display label across Experiences, the reported label is the
 *     one that sorts first under ascending case-insensitive comparison (R3.8).
 *
 *   - **Interest_Facets is a derived subset of Grouped_Facets** (see
 *     `catalog/disney/enrich.ts`). Flattening every group of `groupedFacets`
 *     therefore covers both Grouped_Facets and Interest_Facets in one pass; the
 *     per-experience dedup below guarantees an Experience carrying the same key
 *     in both views is counted once (R3.4).
 *
 *   - **Per-experience dedup** (R3.4): within one Experience, repeated keys are
 *     collapsed via a `Set<key>` so an Experience counts *at most once* in a
 *     key's `total`, and at most once in its `completed` when the Target_User
 *     has completed it.
 *
 *   - **Empty-facet exclusion** (R3.6): an Experience with no Facet_Values in
 *     any group contributes to no key.
 *
 *   - **Open-ended** (R3.3): the key set is data-driven and returned as a list,
 *     never a fixed map.
 *
 *   - **Defense-in-depth**: a group whose JSONB value is not a `{ id, name }[]`
 *     array is skipped, and individual entries that are not well-formed
 *     `{ id, name }` pairs are skipped, so malformed catalog data cannot corrupt
 *     the counts.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8.
 */

import type { FacetValueDTO, GroupedFacetsDTO } from '@dwt/shared';

import { type CompletionCell, toCompletionCell } from './coverage.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One active Experience's facet material, as read by the snapshot repository
 * inside the single `REPEATABLE READ READ ONLY` transaction. Owned here (the
 * pure module owns its input type) so the repository can import it when it is
 * extended to populate `StatsSnapshot.facetExperiences`.
 */
export interface RawFacetExperienceRow {
  /** Stable Experience identity (used only for reasoning; not needed for the roll-up). */
  readonly experienceId: string;
  /** `true` when the Target_User has completed this Experience. */
  readonly completedByUser: boolean;
  /**
   * The parsed `experiences.grouped_facets` JSONB. Contains both Grouped_Facets
   * and, as a derived subset, Interest_Facets.
   */
  readonly groupedFacets: GroupedFacetsDTO;
}

/**
 * A per-Facet_Value_Key Coverage_Statistic: the exact key, the chosen
 * human-readable display label, and the completion cell for the group.
 */
export interface FacetCoverage {
  /** Facet_Value `id`, exact string (case- and whitespace-sensitive, R3.7). */
  readonly key: string;
  /** Chosen display label = the case-insensitively-first Facet_Value `name` (R3.8). */
  readonly label: string;
  /** Completion cell: `{ completed, total, percent, remaining, completeBadge }`. */
  readonly cell: CompletionCell;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Per-key accumulator. `total`/`completed` are folded across Experiences (each
 * Experience contributing at most once). `labels` collects every distinct
 * display label observed for the key so the case-insensitively-first one can be
 * chosen after all rows are seen (R3.8).
 */
interface FacetAccumulator {
  total: number;
  completed: number;
  readonly labels: Set<string>;
}

/**
 * Roll up raw per-Experience facet rows into an open-ended list of
 * per-Facet_Value_Key Coverage_Statistics.
 *
 * The result is sorted by exact key ascending purely for deterministic output;
 * callers treat it as an unordered, open-ended list (R3.3).
 */
export function rollUpFacets(
  rows: readonly RawFacetExperienceRow[],
): readonly FacetCoverage[] {
  const accumulators = new Map<string, FacetAccumulator>();

  for (const row of rows) {
    // Keys present on THIS Experience, deduped so it counts at most once per
    // key regardless of how many groups (Grouped_Facets / Interest_Facets)
    // carry it (R3.4).
    const keysInExperience = new Set<string>();

    for (const groupValue of Object.values(row.groupedFacets)) {
      // Defense-in-depth: skip a group whose JSONB value is not an array.
      if (!Array.isArray(groupValue)) {
        continue;
      }
      for (const facet of groupValue) {
        if (!isFacetValue(facet)) {
          // Defense-in-depth: skip malformed entries that are not `{id, name}`.
          continue;
        }
        const key = facet.id; // exact string; no normalization (R3.7)
        keysInExperience.add(key);

        let acc = accumulators.get(key);
        if (acc === undefined) {
          acc = { total: 0, completed: 0, labels: new Set<string>() };
          accumulators.set(key, acc);
        }
        // Collect every observed label for the key, from every occurrence, so
        // R3.8's "case-insensitively first" choice sees all candidates.
        acc.labels.add(facet.name);
      }
    }

    // Count each present key at most once for this Experience (R3.4). An
    // Experience with no valid Facet_Values contributes to nothing (R3.6).
    for (const key of keysInExperience) {
      const acc = accumulators.get(key);
      // `acc` always exists here: the key was inserted while building the set.
      if (acc === undefined) {
        continue;
      }
      acc.total += 1;
      if (row.completedByUser) {
        acc.completed += 1;
      }
    }
  }

  const result: FacetCoverage[] = [];
  for (const [key, acc] of accumulators) {
    result.push({
      key,
      label: chooseLabel(acc.labels),
      cell: toCompletionCell(acc.completed, acc.total),
    });
  }

  // Deterministic output ordering by exact key. Purely cosmetic; the list is
  // open-ended and the key set is data-driven (R3.3).
  result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown JSONB array element to a well-formed `{ id, name }` pair.
 * Both fields must be strings; anything else is treated as malformed and
 * skipped by the caller (defense-in-depth against catalog data drift).
 */
function isFacetValue(value: unknown): value is FacetValueDTO {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
}

/**
 * Choose the display label for a key: the one that sorts first under ascending
 * case-insensitive comparison (R3.8). When two distinct labels are equal
 * case-insensitively (e.g. "Thrill" vs "thrill"), the exact-string comparison
 * breaks the tie so the choice is deterministic.
 *
 * The `labels` set is always non-empty when this is called, because a key only
 * exists once at least one Facet_Value with that id (and therefore a name) has
 * been observed. The `?? ''` fallback keeps the function total.
 */
function chooseLabel(labels: ReadonlySet<string>): string {
  let chosen: string | undefined;
  for (const label of labels) {
    if (chosen === undefined || compareCaseInsensitive(label, chosen) < 0) {
      chosen = label;
    }
  }
  return chosen ?? '';
}

/**
 * Compare two strings case-insensitively, falling back to exact comparison to
 * remain deterministic when they are equal ignoring case.
 */
function compareCaseInsensitive(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
