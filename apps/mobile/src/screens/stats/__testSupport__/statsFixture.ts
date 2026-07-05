/**
 * Shared stats test-fixture builder (stats-experience-redesign task 3.4).
 *
 * Produces a valid, fully-populated nested `StatsResponse` (matching the
 * Stats_Service route contract mirrored in `apps/mobile/src/api/statsTypes.ts`)
 * so that no test has to re-derive the shape by hand. Every consumer test
 * (Overview_Hub, the four detail screens, friend profile, share projection,
 * navigation) can build a response from these factories and override only the
 * slice it cares about.
 *
 * The factories cover the axes the stats UI branches on:
 *   - ratings `sufficient` vs. insufficient (gated fields present vs. omitted),
 *   - `complete` / `partial` / `empty` completion cells,
 *   - `percentileRank` present / absent / `percentileUnavailable`,
 *   - populated vs. empty `byLand` / `byFacetValue` / `byResort` lists.
 *
 * This module lives in `__testSupport__` (not `__tests__`) on purpose: Jest's
 * default `testMatch` treats every file under a `__tests__` directory as a test
 * suite, so a shared support module must sit beside it to be importable without
 * being run as an (empty) suite. This mirrors the existing convention in
 * `screens/catalog/__testSupport__/`.
 *
 * All produced `CompletionCell`s satisfy the server-guaranteed invariants
 * (see `makeCell`), so fixtures are indistinguishable from real wire data.
 *
 * This is a test-support module, not a test itself.
 *
 * Validates: Requirements 16.1, 16.4
 */

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';

import type {
  CompletionCell,
  CoverageResponse,
  FacetCoverage,
  LabeledCell,
  RatedExperience,
  RatingDistribution,
  RatingStatistics,
  ResortCoverage,
  StatsResponse,
} from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Completion cells
// ---------------------------------------------------------------------------

/**
 * Build a `CompletionCell` from `completed`/`total`, deriving the remaining
 * fields exactly as the server does so the fixture upholds every invariant:
 *   - `percent` = `(completed / total) * 100` rounded to one decimal via
 *     `toFixed(1)` (`0.0` when `total === 0`),
 *   - `remaining` = `total - completed`,
 *   - `completeBadge` = `total > 0 && completed === total`.
 *
 * Callers are expected to pass `0 <= completed <= total`.
 */
export function makeCell(completed: number, total: number): CompletionCell {
  const percent = total === 0 ? 0 : Number(((completed / total) * 100).toFixed(1));
  return {
    completed,
    total,
    percent,
    remaining: total - completed,
    completeBadge: total > 0 && completed === total,
  };
}

/** A fully-complete cell (`completeBadge === true`, `remaining === 0`). */
export const COMPLETE_CELL: CompletionCell = makeCell(8, 8);

/** A partially-complete cell (some progress, work remaining). */
export const PARTIAL_CELL: CompletionCell = makeCell(3, 8);

/** An empty cell (`total === 0`): the neutral "nothing to complete" state. */
export const EMPTY_CELL: CompletionCell = makeCell(0, 0);

// ---------------------------------------------------------------------------
// Fixed-enum cell maps
// ---------------------------------------------------------------------------

/**
 * Build a fixed-enum `CompletionCell` map that contains an entry for *every*
 * member of `keys` (present even when its `total` is 0), using `fallback` as
 * the default and `perKey` for any specific overrides.
 */
function makeEnumCellMap<K extends string>(
  keys: readonly K[],
  fallback: CompletionCell,
  perKey?: Partial<Record<K, CompletionCell>>,
): Record<K, CompletionCell> {
  const map = {} as Record<K, CompletionCell>;
  for (const key of keys) {
    map[key] = perKey?.[key] ?? fallback;
  }
  return map;
}

/** Build the full `byPark` map (one cell per `Park`). */
export function makeByPark(
  fallback: CompletionCell = PARTIAL_CELL,
  perKey?: Partial<Record<Park, CompletionCell>>,
): Record<Park, CompletionCell> {
  return makeEnumCellMap(PARKS, fallback, perKey);
}

/** Build the full `byCategory` map (one cell per `ExperienceCategory`). */
export function makeByCategory(
  fallback: CompletionCell = PARTIAL_CELL,
  perKey?: Partial<Record<ExperienceCategory, CompletionCell>>,
): Record<ExperienceCategory, CompletionCell> {
  return makeEnumCellMap(EXPERIENCE_CATEGORIES, fallback, perKey);
}

/** Build the full `byAreaType` map (one cell per `AreaType`). */
export function makeByAreaType(
  fallback: CompletionCell = PARTIAL_CELL,
  perKey?: Partial<Record<AreaType, CompletionCell>>,
): Record<AreaType, CompletionCell> {
  return makeEnumCellMap(AREA_TYPES, fallback, perKey);
}

// ---------------------------------------------------------------------------
// Open-ended dimension lists
// ---------------------------------------------------------------------------

/** A default populated `byLand` list (mix of complete/partial cells). */
export const DEFAULT_LANDS: readonly LabeledCell[] = [
  { label: 'Fantasyland', cell: makeCell(5, 12) },
  { label: 'Tomorrowland', cell: makeCell(8, 8) },
  { label: 'World Showcase', cell: makeCell(0, 11) },
];

/** A default populated `byResortArea` list. */
export const DEFAULT_RESORT_AREAS: readonly LabeledCell[] = [
  { label: 'Deluxe Resorts', cell: makeCell(2, 9) },
  { label: 'Value Resorts', cell: makeCell(4, 4) },
];

/** A default populated `byFacetValue` ("interests") list. */
export const DEFAULT_FACETS: readonly FacetCoverage[] = [
  { key: 'thrill', label: 'Thrill Rides', cell: makeCell(6, 15) },
  { key: 'dark-ride', label: 'Dark Rides', cell: makeCell(10, 10) },
  { key: 'water', label: 'Water Rides', cell: makeCell(0, 5) },
];

/** A default populated `byResort` per-resort activity-completion list. */
export const DEFAULT_BY_RESORT: readonly ResortCoverage[] = [
  { resortId: 'resort-grand-floridian', label: "Disney's Grand Floridian Resort & Spa", cell: makeCell(3, 7) },
  { resortId: 'resort-contemporary', label: "Disney's Contemporary Resort", cell: makeCell(5, 5) },
  { resortId: 'resort-pop-century', label: "Disney's Pop Century Resort", cell: makeCell(0, 4) },
];

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Build a valid `CoverageResponse`. Defaults describe a partially-complete
 * profile with every fixed-enum dimension fully populated and every open-ended
 * list non-empty. Any field can be replaced via `overrides` (shallow merge);
 * the fields are mutually independent, so overriding one never violates an
 * invariant. Pass empty arrays to exercise the empty-list branches:
 *
 *   makeCoverageResponse({ byLand: [], byFacetValue: [], byResort: [] })
 */
export function makeCoverageResponse(
  overrides: Partial<CoverageResponse> = {},
): CoverageResponse {
  return {
    overall: makeCell(31, 78),
    byPark: makeByPark(),
    byCategory: makeByCategory(),
    byAreaType: makeByAreaType(),
    byLand: DEFAULT_LANDS,
    byResortArea: DEFAULT_RESORT_AREAS,
    byFacetValue: DEFAULT_FACETS,
    resort: makeCell(1, 4),
    byResort: DEFAULT_BY_RESORT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

const DEFAULT_DISTRIBUTION: RatingDistribution = {
  1: 0,
  2: 0,
  3: 1,
  4: 1,
  5: 2,
  6: 3,
  7: 4,
  8: 3,
  9: 1,
  10: 1,
};

/** Sum of `DEFAULT_DISTRIBUTION` (= 16), used as the default rated count. */
const DEFAULT_RATED_COUNT = Object.values(DEFAULT_DISTRIBUTION).reduce(
  (sum, count) => sum + count,
  0,
);

const DEFAULT_HIGHEST: RatedExperience = {
  experienceId: 'exp-space-mountain',
  name: 'Space Mountain',
  value: 10,
};

const DEFAULT_LOWEST: RatedExperience = {
  experienceId: 'exp-tomorrowland-speedway',
  name: 'Tomorrowland Speedway',
  value: 3,
};

/**
 * Build a `sufficient: true` `RatingStatistics` with every gated field present
 * (`average`, `averageByPark`, `averageByCategory`, `distribution`, `highest`,
 * `lowest`). Override any field via `overrides` (shallow merge).
 */
export function makeSufficientRatings(
  overrides: Partial<RatingStatistics> = {},
): RatingStatistics {
  return {
    sufficient: true,
    ratedCompletionsCount: DEFAULT_RATED_COUNT,
    average: 6.8,
    averageByPark: {
      'Magic Kingdom': 7.2,
      EPCOT: 6.5,
    },
    averageByCategory: {
      Ride: 7.0,
      Show: 6.1,
    },
    distribution: DEFAULT_DISTRIBUTION,
    highest: DEFAULT_HIGHEST,
    lowest: DEFAULT_LOWEST,
    ...overrides,
  };
}

/**
 * Build a `sufficient: false` `RatingStatistics`. Only `ratedCompletionsCount`
 * is reported; every gated field is omitted, matching the server contract for
 * an under-threshold user. `ratedCompletionsCount` may be overridden.
 */
export function makeInsufficientRatings(
  ratedCompletionsCount = 2,
): RatingStatistics {
  return {
    sufficient: false,
    ratedCompletionsCount,
  };
}

// ---------------------------------------------------------------------------
// Top-level response
// ---------------------------------------------------------------------------

/**
 * Overrides for {@link makeStatsResponse}. `coverage` is shallow-merged over the
 * default coverage; `ratings` fully *replaces* the default ratings (use the
 * `makeSufficientRatings` / `makeInsufficientRatings` factories to keep the
 * gated-field invariants intact). The percentile fields are set verbatim and
 * are mutually exclusive on the wire.
 */
export interface StatsFixtureOverrides {
  coverage?: Partial<CoverageResponse>;
  ratings?: RatingStatistics;
  percentileRank?: number;
  percentileUnavailable?: boolean;
}

/**
 * Build a complete, valid nested `StatsResponse`. By default it describes a
 * partially-complete profile with sufficient ratings and no percentile fields.
 *
 * Common variations:
 *   makeStatsResponse()                                  // sufficient, no percentile
 *   makeStatsResponse({ ratings: makeInsufficientRatings() })
 *   makeStatsResponse({ percentileRank: 87.5 })          // percentile present
 *   makeStatsResponse({ percentileUnavailable: true })   // percentile failed
 *   makeStatsResponse({ coverage: { byResort: [] } })    // empty per-resort list
 */
export function makeStatsResponse(
  overrides: StatsFixtureOverrides = {},
): StatsResponse {
  const { coverage, ratings, percentileRank, percentileUnavailable } = overrides;

  return {
    coverage: makeCoverageResponse(coverage),
    ratings: ratings ?? makeSufficientRatings(),
    ...(percentileRank !== undefined ? { percentileRank } : {}),
    ...(percentileUnavailable !== undefined ? { percentileUnavailable } : {}),
  };
}
