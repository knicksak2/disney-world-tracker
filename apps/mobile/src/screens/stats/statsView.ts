/**
 * Pure display transforms for the redesigned stats experience
 * (stats-experience-redesign task 4.1).
 *
 * Framework-free, side-effect-free helpers (no React, no JSX, no I/O) that
 * turn the nested `StatsResponse` wire shape (`../../api/statsTypes`) into the
 * ordering, selection, normalization, and phrasing the Overview hub and every
 * detail screen render. All heavy math (percent rounding, gating, remaining,
 * `completeBadge`) is done server-side; these transforms are display-only and
 * therefore unit- and property-testable without rendering (mirroring the
 * existing `screens/navigation/grouping.ts` / `catalog/shareEntryPoint.ts`
 * pure-core pattern).
 *
 * This module is intentionally structured so the Overview-hub highlight
 * selector (`buildOverviewHighlights`, `pickCoverageHighlight`,
 * `pickRatingsHighlight`, `pickInterestsHighlight` — task 4.6) and the migrated
 * `buildProgressShareParams` share projection (task 4.8) can be appended to the
 * marked sections below without disturbing these transforms.
 *
 * Validates: Requirements 2.1, 5.9, 5.10, 6.1, 8.6, 9.2, 12.1, 12.2
 */

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import type { ShareComposerParams } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';

import { MINIMUM_RATINGS_THRESHOLD } from '../../api/statsTypes';
import type {
  CompletionCell,
  CoverageResponse,
  FacetCoverage,
  RatingDistribution,
  RatingStatistics,
  StatsResponse,
} from '../../api/statsTypes';

// Type-only import: the highlight `icon` is a valid Ionicons glyph name, mirrored
// from the existing card/button props in `theme/components.tsx`. No runtime/React
// value is pulled in (this module stays framework-free).
import type { Ionicons } from '@expo/vector-icons';

// ---------------------------------------------------------------------------
// Percent display (R12.1, R12.2)
// ---------------------------------------------------------------------------

/**
 * The numeric displayed-percent of a `Completion_Cell`, rounded to one decimal.
 *
 * The server already rounds `cell.percent` to one decimal in `[0.0, 100.0]`;
 * this normalizes defensively so a `total === 0` cell (or any non-finite
 * percent) yields `0.0` rather than `NaN` (R12.2). Used both for rendering and
 * by the share projection (task 4.8), which needs a number per park/category.
 */
export function displayedPercent(cell: CompletionCell): number {
  if (cell.total === 0 || !Number.isFinite(cell.percent)) return 0;
  return Number(cell.percent.toFixed(1));
}

/**
 * The displayed-percent of a `Completion_Cell` as a one-decimal string (without
 * the `%` glyph), e.g. `"82.0"` or `"0.0"`. Every rendered percent equals
 * `cell.percent.toFixed(1)`, and a `total === 0` cell renders `"0.0"` (R12.1,
 * R12.2). Because `cell.percent` is already server-rounded to one decimal, this
 * is value-identical to `cell.percent.toFixed(1)` for every valid cell.
 */
export function displayedPercentLabel(cell: CompletionCell): string {
  return displayedPercent(cell).toFixed(1);
}

// ---------------------------------------------------------------------------
// Complete badge / "N to go" decision helpers (R5.8, R5.9, R5.10, R12.2)
// ---------------------------------------------------------------------------

/**
 * Whether the celebratory `Complete_Badge` is shown for a cell — true exactly
 * when `cell.completeBadge` is true (⇔ `total > 0 && completed === total`).
 * The server owns this predicate; the view never recomputes it (R5.8).
 */
export function showCompleteBadge(cell: CompletionCell): boolean {
  return cell.completeBadge;
}

/**
 * The count for the "N to go" affordance, or `null` when it must be suppressed.
 *
 * Returns `cell.remaining` only when the cell is incomplete and has any total
 * (`!completeBadge && total > 0`, R5.9); returns `null` when the cell is
 * complete (R5.10) or empty (`total === 0`, R12.2), so the affordance is hidden
 * in both cases.
 */
export function remainingToGo(cell: CompletionCell): number | null {
  if (cell.completeBadge || cell.total === 0) return null;
  return cell.remaining;
}

// ---------------------------------------------------------------------------
// Fixed-enum coverage → ordered grid tiles (R9.2 ordering determinism)
// ---------------------------------------------------------------------------

/**
 * A single fixed-enum coverage grid tile. `key`/`title` identify the enum
 * member, `cell` carries the completion numbers, `accentColor` is the member's
 * accent hue, and `icon` (categories only) is an Ionicons glyph name.
 */
export interface TileSpec {
  readonly key: string;
  readonly title: string;
  readonly cell: CompletionCell;
  readonly accentColor: string;
  readonly icon?: string;
}

/**
 * Ordered park tiles from `coverage.byPark`, always in canonical `PARKS` order
 * and always including every park (even `total === 0` ones) for a stable
 * layout (R5.4, R9.2). Each tile carries the park's accent hue.
 */
export function buildParkTiles(
  byPark: CoverageResponse['byPark'],
): readonly TileSpec[] {
  return PARKS.map((park) => ({
    key: park,
    title: park,
    cell: byPark[park],
    accentColor: theme.parkAccent[park],
  }));
}

/**
 * Ordered category tiles from `coverage.byCategory`, always in canonical
 * `EXPERIENCE_CATEGORIES` order and always including every category (R5.4,
 * R9.2). Each tile carries the category's display label, tint, and glyph from
 * `theme.categoryVisual`.
 */
export function buildCategoryTiles(
  byCategory: CoverageResponse['byCategory'],
): readonly TileSpec[] {
  return EXPERIENCE_CATEGORIES.map((category) => {
    const visual = theme.categoryVisual[category];
    return {
      key: category,
      title: visual.label,
      cell: byCategory[category],
      accentColor: visual.tint,
      icon: visual.glyph,
    };
  });
}

// ---------------------------------------------------------------------------
// Facet ("interests") display ordering (R9.2)
// ---------------------------------------------------------------------------

/**
 * Order facets ("interests") for a brag-worthy display, leading with the
 * most-complete, most-substantial groups: percent descending, then total
 * descending, then case-insensitive label ascending, with an exact-string
 * tiebreak so the order is a total order (R9.2). Pure over the server list
 * (does not mutate the input).
 */
export function sortFacetsForDisplay(
  facets: readonly FacetCoverage[],
): readonly FacetCoverage[] {
  return [...facets].sort((a, b) => {
    if (b.cell.percent !== a.cell.percent) return b.cell.percent - a.cell.percent;
    if (b.cell.total !== a.cell.total) return b.cell.total - a.cell.total;
    const al = a.label.toLowerCase();
    const bl = b.label.toLowerCase();
    if (al !== bl) return al < bl ? -1 : 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Rating distribution normalization for the histogram (R8.6)
// ---------------------------------------------------------------------------

/** One normalized histogram bar: the 1–10 value, its raw count, and a `[0,1]`
 * fraction of the tallest non-zero bin. */
export interface DistributionBar {
  readonly value: number;
  readonly count: number;
  readonly fraction: number;
}

/**
 * Map the 1–10 distribution counts to bar fractions in `[0,1]` of the tallest
 * non-zero bin so bars scale to the available height (R8.6): the tallest
 * non-zero bin maps to fraction `1`, and a zero-count value maps to fraction
 * `0` (a baseline bar). When every bin is zero, `Math.max(1, ...)` keeps the
 * denominator positive so all fractions are `0` rather than `NaN`.
 */
export function normalizeDistribution(
  distribution: RatingDistribution,
): readonly DistributionBar[] {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  const max = Math.max(1, ...values.map((v) => distribution[v]));
  return values.map((v) => ({
    value: v,
    count: distribution[v],
    fraction: distribution[v] / max,
  }));
}

// ---------------------------------------------------------------------------
// Percentile phrasing / visibility (R10.3, R10.4)
// ---------------------------------------------------------------------------

/**
 * Phrase the `percentileRank` ("percentage of OTHER trackers strictly behind
 * you", `[0,100]`) warmly, degrading gracefully at the extremes and the
 * only-tracker case.
 */
export function phrasePercentile(rank: number): string {
  const pct = rank.toFixed(1);
  if (rank <= 0) {
    return "You're just getting started — plenty of magic ahead.";
  }
  if (rank >= 99.5) {
    return `You're ahead of ${pct}% of trackers — legendary status.`;
  }
  return `You're ahead of ${pct}% of trackers.`;
}

/**
 * Whether the `Percentile_Banner` should render: shown iff `percentileRank` is
 * a number (R10.3). An absent rank or `percentileUnavailable === true` hides the
 * banner without blocking any other section (R10.4).
 */
export function shouldShowPercentile(stats: StatsResponse): boolean {
  return typeof stats.percentileRank === 'number';
}

// ---------------------------------------------------------------------------
// Ratings gating / unlock affordance (R8.2, R8.4, R8.5)
// ---------------------------------------------------------------------------

/**
 * Choose between the rich ratings view and the unlock empty state purely from
 * `ratings.sufficient` (R8.1, R8.2). Callers must not read the gated fields
 * (`average`, `distribution`, `highest`, `lowest`, `averageByPark`,
 * `averageByCategory`) when this returns `'unlock'` (R8.3).
 */
export function ratingsView(ratings: RatingStatistics): 'rich' | 'unlock' {
  return ratings.sufficient ? 'rich' : 'unlock';
}

/**
 * Ratings remaining before the rich view unlocks, using the always-present
 * `ratedCompletionsCount` (readable in both states, R8.4). Never negative.
 */
export function unlockRemaining(
  ratings: RatingStatistics,
  threshold: number,
): number {
  return Math.max(0, threshold - ratings.ratedCompletionsCount);
}

// ---------------------------------------------------------------------------
// Overview-hub highlight selector — task 4.6
// (buildOverviewHighlights, pickCoverageHighlight, pickRatingsHighlight,
// pickInterestsHighlight), reusing sortFacetsForDisplay above.
//
// Validates: Requirements 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9
// ---------------------------------------------------------------------------

/**
 * The optional `focus` hint a coverage `Highlight_Card` may carry so a deep-link
 * into `CoverageDetail` can jump straight to a lens/section. Mirrors the
 * `StatsStackParamList['CoverageDetail']['focus']` union (defined by the
 * navigation layer in task 9.1); every value is a small, serializable string so
 * no `StatsResponse` ever travels through navigation params (R3.5).
 */
export type CoverageFocus =
  | 'parks'
  | 'categories'
  | 'areas'
  | 'lands'
  | 'resortAreas'
  | 'resort'
  | 'resorts';

/**
 * The drill-in destination of a `Highlight_Card`. Every variant's `route` is an
 * existing StatsStack detail route (`CoverageDetail`, `RatingsDetail`,
 * `InterestsDetail`, `ExperiencesDetail`) — never the hub `StatsOverview` — so
 * every produced highlight targets a real navigable detail screen (R2.9, R1.5).
 * Only `CoverageDetail` carries an optional serializable `focus` hint (R3.5).
 */
export type HighlightTarget =
  | { readonly route: 'CoverageDetail'; readonly focus?: CoverageFocus }
  | { readonly route: 'RatingsDetail' }
  | { readonly route: 'InterestsDetail' }
  | { readonly route: 'ExperiencesDetail' };

/**
 * A curated `Highlight_Card` derived from the stats snapshot: a per-dimension
 * "best story" tease plus its drill-in `target`. Produced only by
 * `buildOverviewHighlights` (and its `pick*` helpers), so it is pure and
 * deterministic. `complete` flags the celebratory accent (a just-earned park
 * badge); `locked` flags the not-yet-sufficient ratings unlock tease; `percent`
 * is an optional mini progress affordance in `[0, 100]`.
 */
export interface OverviewHighlight {
  readonly id: 'coverage' | 'ratings' | 'interests' | 'experiences';
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly headline: string;
  readonly subtext?: string;
  readonly percent?: number;
  readonly complete?: boolean;
  readonly locked?: boolean;
  readonly target: HighlightTarget;
}

/**
 * Pick the coverage `Highlight_Card` for the hub.
 *
 * Prefers celebrating a just-completed park: WHERE at least one `byPark` cell
 * has `completeBadge` true, the highlight is `complete: true` with `percent:
 * 100` (R2.6). Otherwise, WHERE no park is complete but at least one `byPark`
 * cell has `total > 0`, it leads with the highest-percent park, ties broken by
 * canonical `PARKS` order (R2.7) — the left-to-right `reduce` keeps the earlier
 * (canonical-order) entry on a tie because it replaces only on a strictly
 * greater percent. When no park has any total, it falls back to the overall
 * cell. Always targets `CoverageDetail` (R2.9).
 */
export function pickCoverageHighlight(
  coverage: CoverageResponse,
): OverviewHighlight {
  const parkEntries = PARKS.map((park) => ({
    park,
    cell: coverage.byPark[park],
  }));

  const completePark = parkEntries.find((entry) => entry.cell.completeBadge);
  if (completePark) {
    return {
      id: 'coverage',
      icon: 'map',
      title: 'Coverage',
      headline: `${completePark.park} complete!`,
      complete: true,
      percent: 100,
      target: { route: 'CoverageDetail', focus: 'parks' },
    };
  }

  const best = parkEntries
    .filter((entry) => entry.cell.total > 0)
    .reduce<{ park: Park; cell: CompletionCell } | null>((acc, entry) => {
      if (acc === null) return entry;
      return entry.cell.percent > acc.cell.percent ? entry : acc;
    }, null);

  if (best) {
    return {
      id: 'coverage',
      icon: 'map',
      title: 'Coverage',
      headline: `Best park: ${best.park} ${displayedPercentLabel(best.cell)}%`,
      ...(best.cell.remaining > 0
        ? { subtext: `${best.cell.remaining} to go` }
        : {}),
      percent: displayedPercent(best.cell),
      target: { route: 'CoverageDetail', focus: 'parks' },
    };
  }

  return {
    id: 'coverage',
    icon: 'map',
    title: 'Coverage',
    headline: `${displayedPercentLabel(coverage.overall)}% overall`,
    percent: displayedPercent(coverage.overall),
    target: { route: 'CoverageDetail' },
  };
}

/**
 * Pick the ratings `Highlight_Card` for the hub.
 *
 * WHERE `ratings.sufficient` is false, produces a locked unlock tease showing
 * `ratedCompletionsCount` of `MINIMUM_RATINGS_THRESHOLD` and targeting
 * `RatingsDetail` (R2.8) — without reading any gated field. Otherwise teases the
 * average (out of 10) and, when present, the top-rated experience name. Always
 * targets `RatingsDetail` (R2.9).
 */
export function pickRatingsHighlight(
  ratings: RatingStatistics,
): OverviewHighlight {
  if (!ratings.sufficient) {
    return {
      id: 'ratings',
      icon: 'star-outline',
      title: 'Ratings',
      headline: `Unlock ratings (${ratings.ratedCompletionsCount}/${MINIMUM_RATINGS_THRESHOLD})`,
      locked: true,
      target: { route: 'RatingsDetail' },
    };
  }

  const average = ratings.average ?? 0;
  return {
    id: 'ratings',
    icon: 'star',
    title: 'Ratings',
    headline: `Average ${average.toFixed(1)}/10`,
    ...(ratings.highest ? { subtext: `Top-rated: ${ratings.highest.name}` } : {}),
    target: { route: 'RatingsDetail' },
  };
}

/**
 * Pick the interests `Highlight_Card`, or `null` when there are no facets.
 *
 * Returns `null` when `coverage.byFacetValue` is empty so the caller omits the
 * card (R2.4). Otherwise teases the top facet in display order (percent desc,
 * total desc, case-insensitive label asc — via `sortFacetsForDisplay`) and
 * targets `InterestsDetail` (R2.5, R2.9).
 */
export function pickInterestsHighlight(
  coverage: CoverageResponse,
): OverviewHighlight | null {
  const top = sortFacetsForDisplay(coverage.byFacetValue)[0];
  if (!top) return null;
  return {
    id: 'interests',
    icon: 'sparkles',
    title: 'Interests',
    headline: `${top.label} ${displayedPercentLabel(top.cell)}%`,
    percent: displayedPercent(top.cell),
    target: { route: 'InterestsDetail' },
  };
}

/**
 * Build the ordered, curated set of `Highlight_Card`s for the Overview hub.
 *
 * Total over any valid `StatsResponse` and deterministic — equal inputs yield
 * equal ordered outputs (R2.1, R2.2). The order is fixed: coverage, ratings,
 * interests (only when facets exist), experiences (R2.3). The result has length
 * 3 when `coverage.byFacetValue` is empty (interests omitted, R2.4) or length 4
 * when facets are present (R2.5). The trailing experiences card is a
 * navigational entry point rather than a stat tease. Every card's `target` is a
 * real StatsStack detail route (R2.9, R1.3).
 */
export function buildOverviewHighlights(
  stats: StatsResponse,
): readonly OverviewHighlight[] {
  const highlights: OverviewHighlight[] = [
    pickCoverageHighlight(stats.coverage),
    pickRatingsHighlight(stats.ratings),
  ];

  const interests = pickInterestsHighlight(stats.coverage);
  if (interests) highlights.push(interests);

  highlights.push({
    id: 'experiences',
    icon: 'list',
    title: 'Experiences',
    headline: 'Browse your experiences',
    target: { route: 'ExperiencesDetail' },
  });

  return highlights;
}

// ---------------------------------------------------------------------------
// Progress share projection — task 4.8 (buildProgressShareParams), reusing
// displayedPercent above.
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5
// ---------------------------------------------------------------------------

/**
 * Build the `progress` `ShareComposerParams` from a loaded nested
 * `StatsResponse`, reading only through `coverage.*` (R13.1). Migrated from the
 * flat `StatsScreen` projection onto the nested wire shape.
 *
 * Emits `kind: 'progress'`, `overallPercent`, `perParkPercent`, and
 * `perCategoryPercent` (R13.2). `perParkPercent` carries one entry for every
 * member of `PARKS` (R13.3) and `perCategoryPercent` one for every member of
 * `EXPERIENCE_CATEGORIES` (R13.4); iterating the canonical enum arrays (rather
 * than `Object.keys`) keeps the maps complete, in canonical order, and typed to
 * the `Park` / `ExperienceCategory` unions. Every value — `overallPercent` and
 * each per-park / per-category entry — is the `displayedPercent` of the
 * corresponding `coverage` Completion_Cell, so a `total === 0` cell yields
 * `0.0` (R13.5).
 */
export function buildProgressShareParams(
  stats: StatsResponse,
): ShareComposerParams {
  const { coverage } = stats;

  const perParkPercent: { [park in Park]?: number } = {};
  for (const park of PARKS) {
    perParkPercent[park] = displayedPercent(coverage.byPark[park]);
  }

  const perCategoryPercent: { [category in ExperienceCategory]?: number } = {};
  for (const category of EXPERIENCE_CATEGORIES) {
    perCategoryPercent[category] = displayedPercent(coverage.byCategory[category]);
  }

  return {
    kind: 'progress',
    overallPercent: displayedPercent(coverage.overall),
    perParkPercent,
    perCategoryPercent,
  };
}

// ---------------------------------------------------------------------------
// Coverage "at a glance" summary (Coverage detail header strip)
// ---------------------------------------------------------------------------

/**
 * The compact "at a glance" summary shown atop the Coverage detail screen: the
 * overall completion cell for the hero mini-ring, how many parks are fully
 * complete, and the closest still-incomplete park (highest percent among parks
 * with `total > 0 && !completeBadge`, canonical `PARKS` tiebreak) with its
 * remaining count. Pure over `coverage`; `closest` is `null` when every park is
 * complete or empty.
 */
export interface CoverageGlance {
  readonly overall: CompletionCell;
  readonly parksComplete: number;
  readonly summary: string;
  readonly closest: { readonly label: string; readonly remaining: number } | null;
}

export function buildCoverageGlance(coverage: CoverageResponse): CoverageGlance {
  const parkEntries = PARKS.map((park) => ({ park, cell: coverage.byPark[park] }));
  const parksComplete = parkEntries.filter((e) => e.cell.completeBadge).length;

  const closestEntry = parkEntries
    .filter((e) => e.cell.total > 0 && !e.cell.completeBadge)
    .reduce<{ park: Park; cell: CompletionCell } | null>((acc, entry) => {
      if (acc === null) return entry;
      return entry.cell.percent > acc.cell.percent ? entry : acc;
    }, null);

  const summary =
    parksComplete === 1 ? '1 park complete' : `${parksComplete} parks complete`;

  return {
    overall: coverage.overall,
    parksComplete,
    summary,
    closest: closestEntry
      ? { label: closestEntry.park, remaining: closestEntry.cell.remaining }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Ranked comparison rows (Coverage lenses render dimensions as ranked bars)
// ---------------------------------------------------------------------------

/**
 * A ranked comparison row for the Coverage lenses / Interests: a stable `key`,
 * a display `label`, its `Completion_Cell`, and an accent `color` used for the
 * row's dot and bar fill.
 */
export interface RankedRow {
  readonly key: string;
  readonly label: string;
  readonly cell: CompletionCell;
  readonly color: string;
}

/** Sort ranked rows most→least complete: percent desc, then total desc, then
 * case-insensitive label asc (a total order, matching the facet display sort). */
function byCompletionDesc(a: RankedRow, b: RankedRow): number {
  if (b.cell.percent !== a.cell.percent) return b.cell.percent - a.cell.percent;
  if (b.cell.total !== a.cell.total) return b.cell.total - a.cell.total;
  const al = a.label.toLowerCase();
  const bl = b.label.toLowerCase();
  if (al !== bl) return al < bl ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** Park rows ranked most→least complete, each carrying its park accent hue. */
export function rankParkRows(
  byPark: CoverageResponse['byPark'],
): readonly RankedRow[] {
  return PARKS.map((park) => ({
    key: park,
    label: park,
    cell: byPark[park],
    color: theme.parkAccent[park],
  })).sort(byCompletionDesc);
}

/** Category rows ranked most→least complete, each carrying its category tint. */
export function rankCategoryRows(
  byCategory: CoverageResponse['byCategory'],
): readonly RankedRow[] {
  return EXPERIENCE_CATEGORIES.map((category) => {
    const visual = theme.categoryVisual[category];
    return {
      key: category,
      label: visual.label,
      cell: byCategory[category],
      color: visual.tint,
    };
  }).sort(byCompletionDesc);
}
