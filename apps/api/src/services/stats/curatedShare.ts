/**
 * Stats_Service: curated Progress_Share snapshot (expanded-stats task 9.1).
 *
 * Pure functions only — no I/O, no clock, no DB access. When a `progress` Share
 * is created, the Sharing_Service captures a send-time snapshot of a small,
 * headline-worthy subset of the sender's statistics (Requirement 10). This
 * module folds the same single-snapshot raw material the Stats_Service reads
 * (a {@link StatsSnapshot}) into exactly the three curated fields the
 * Progress_Share payload carries:
 *
 *   - `overallPercent` — the sender's overall completion percent, already in
 *     `[0.0, 100.0]` to one decimal via `computePercent` (R10.1).
 *   - `topFacet` — the sender's top per-Facet_Value_Key Coverage_Statistic as a
 *     {@link CompletionCell} plus its display label (R10.2). "Top" is the facet
 *     statistic with the highest `completed`, tie-broken by highest `percent`
 *     and then by ascending case-insensitive display label (R10.4). It is
 *     included even when its `completed` is 0 as long as the sender has at least
 *     one facet statistic (R10.7) and omitted entirely when the sender has none
 *     (R10.8).
 *   - `percentileRank` — the sender's Percentile_Rank in `[0.0, 100.0]` to one
 *     decimal, `0.0` when the sender has zero Completions (R10.3).
 *
 * Everything else the Stats_Service computes — the Rating_Distribution, the
 * per-group breakdown maps (per-Park / per-Category / per-Land / per-Resort_Area
 * / the full per-Facet_Value_Key list), and the highest/lowest-rated
 * Experiences — is deliberately excluded from the curated snapshot (R10.5).
 *
 * Because the snapshot is a pure fold over the material the repository read
 * inside its single `REPEATABLE READ READ ONLY` transaction at creation time,
 * later changes to the sender's statistics cannot alter a recipient's view
 * (R10.6) — the recipient sees the values captured at send time.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8.
 */

import type { CompletionCell } from './coverage.js';
import { rollUpCoverage } from './coverage.js';
import type { FacetCoverage } from './facets.js';
import { rollUpFacets } from './facets.js';
import { computePercentileRank } from './percentile.js';
import type { StatsSnapshot } from './repo.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The curated subset of the sender's statistics captured into a Progress_Share
 * payload snapshot at creation time.
 *
 * `topFacet` is present whenever the sender has at least one facet statistic
 * (even when its `completed` is 0, R10.7) and omitted entirely when the sender
 * has none (R10.8). `overallPercent` and `percentileRank` are always present.
 */
export interface CuratedProgressStats {
  readonly overallPercent: number;
  readonly topFacet?: { readonly label: string; readonly cell: CompletionCell };
  readonly percentileRank: number;
}

// ---------------------------------------------------------------------------
// Top-facet selection (R10.2, R10.4, R10.7, R10.8)
// ---------------------------------------------------------------------------

/**
 * Select the top per-Facet_Value_Key Coverage_Statistic from the sender's full
 * facet list.
 *
 * "Top" is the facet with the highest `completed` count; ties are broken by the
 * highest `percent`, and any remaining tie by ascending case-insensitive
 * display label (with an exact-string fallback so the choice is deterministic
 * when two labels are equal ignoring case) — R10.4.
 *
 * Returns the chosen `{ label, cell }` — included even when its `completed` is 0
 * as long as the list is non-empty (R10.7) — or `undefined` when the sender has
 * no facet statistic at all (R10.8).
 */
export function selectTopFacet(
  facets: readonly FacetCoverage[],
): { readonly label: string; readonly cell: CompletionCell } | undefined {
  let best: FacetCoverage | undefined;
  for (const facet of facets) {
    if (best === undefined || compareFacetForTop(facet, best) < 0) {
      best = facet;
    }
  }
  if (best === undefined) {
    return undefined;
  }
  return { label: best.label, cell: best.cell };
}

/**
 * Ordering used to pick the top facet: a facet sorts BEFORE another (negative
 * result) when it is the better "top" candidate. Higher `completed` wins first,
 * then higher `percent`, then the case-insensitively-first display label.
 */
function compareFacetForTop(a: FacetCoverage, b: FacetCoverage): number {
  if (a.cell.completed !== b.cell.completed) {
    // Higher completed is better ⇒ sorts first.
    return b.cell.completed - a.cell.completed;
  }
  if (a.cell.percent !== b.cell.percent) {
    // Higher percent is better ⇒ sorts first.
    return b.cell.percent - a.cell.percent;
  }
  // Ascending case-insensitive display label.
  return compareCaseInsensitive(a.label, b.label);
}

/**
 * Compare two labels case-insensitively, falling back to exact comparison so
 * the ordering is total and deterministic when they are equal ignoring case.
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

// ---------------------------------------------------------------------------
// Curated snapshot assembly
// ---------------------------------------------------------------------------

/**
 * Fold a full stats snapshot into the curated Progress_Share fields (R10.1,
 * R10.2, R10.3, R10.5, R10.7, R10.8).
 *
 * The snapshot is expected to have been read with `includePercentile: true` so
 * the Percentile_Rank material is present; when it is `null` (percentile not
 * read) the rank falls back to `0.0`, which also matches the zero-completions
 * rule (R10.3).
 */
export function buildCuratedProgressStats(
  snapshot: StatsSnapshot,
): CuratedProgressStats {
  const coverage = rollUpCoverage(snapshot.coverage);
  const topFacet = selectTopFacet(rollUpFacets(snapshot.facetExperiences));
  const percentileRank =
    snapshot.percentile === null
      ? 0.0
      : computePercentileRank(snapshot.percentile);

  const curated: {
    overallPercent: number;
    topFacet?: { readonly label: string; readonly cell: CompletionCell };
    percentileRank: number;
  } = {
    overallPercent: coverage.overall.percent,
    percentileRank,
  };

  // R10.7 / R10.8: include topFacet only when the sender has >= 1 facet stat.
  if (topFacet !== undefined) {
    curated.topFacet = topFacet;
  }

  return curated;
}
