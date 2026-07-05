/**
 * Shared nested stats wire types (stats-experience-redesign task 3.1).
 *
 * Mobile mirror of the Stats_Service route contract returned by both
 * `GET /me/stats[?percentile=true]` and `GET /me/stats/summary?for=<id>`
 * (see `apps/api/src/services/stats/routes.ts`, `coverage.ts`, `facets.ts`,
 * `resorts.ts`, and `ratingStats.ts`).
 *
 * These shapes replace the removed flat `FriendStatsResponse` /
 * `FriendStatsBreakdown` (and the inline flat `StatsResponse` in `StatsScreen`)
 * so every mobile stats consumer reads only through `coverage.*`, `ratings.*`,
 * and `percentileRank` / `percentileUnavailable` (R16.1, R16.2, R16.3).
 *
 * Per Decision (b) / R17.3, the shapes are mirrored locally on the mobile side
 * (matching the existing convention that the mobile client depends on the
 * public route contract, not backend internals). Each type is byte-identical to
 * its backend counterpart; `ResortCoverage` in particular mirrors the backend
 * `{ resortId, label, cell }` shape exactly.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 17.3
 */

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The rating-count threshold below which the rich ratings view is gated behind
 * an unlock / neutral state. Mirrors `MINIMUM_RATINGS_THRESHOLD` in
 * `apps/api/src/services/stats/ratingStats.ts` (value 3, R8.5).
 */
export const MINIMUM_RATINGS_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Coverage cells
// ---------------------------------------------------------------------------

/**
 * A coverage cell (`Completion_Cell`), mirroring the backend `CompletionCell`.
 *
 * Invariants guaranteed by the server:
 *   - `0 <= completed <= total`
 *   - `percent` ∈ `[0.0, 100.0]`, one decimal, server-rounded
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
 * A coverage cell tagged with a human-readable display label, used for the
 * open-ended per-Land and per-Resort_Area dimensions. Mirrors the backend
 * `LabeledCell`.
 */
export interface LabeledCell {
  readonly label: string;
  readonly cell: CompletionCell;
}

/**
 * A per-facet ("interest") coverage entry. Mirrors the backend `FacetCoverage`.
 * `key` is the exact Facet_Value id (case- and whitespace-sensitive); `label`
 * is the chosen display name.
 */
export interface FacetCoverage {
  readonly key: string;
  readonly label: string;
  readonly cell: CompletionCell;
}

/**
 * A per-resort *activity* completion entry (`Resort_Coverage`). Mirrors the
 * backend `ResortCoverage` shape byte-identically: `resortId` is `resorts.id`,
 * `label` is `resorts.name`, and `cell` is the completion cell (R17.3).
 *
 * Distinct from the hotels-visited `coverage.resort` cell (whether the user has
 * *stayed* at a hotel).
 */
export interface ResortCoverage {
  /** `resorts.id` — stable resort identity for navigation / identification. */
  readonly resortId: string;
  /** Display label = `resorts.name`. */
  readonly label: string;
  /** Completion cell: `{ completed, total, percent, remaining, completeBadge }`. */
  readonly cell: CompletionCell;
}

/**
 * The coverage half of the response (`Coverage_Response`). Mirrors the backend
 * `CoverageResponse`, extended with the additive `byResort` per-resort activity
 * dimension (R7.12).
 *
 * Each fixed-enum dimension carries a `CompletionCell` for every enum member
 * (present even when its `total` is 0); the open-ended per-Land /
 * per-Resort_Area / per-Facet_Value / per-Resort dimensions are data-driven
 * lists.
 */
export interface CoverageResponse {
  readonly overall: CompletionCell;
  readonly byPark: { readonly [park in Park]: CompletionCell };
  readonly byCategory: {
    readonly [category in ExperienceCategory]: CompletionCell;
  };
  readonly byAreaType: { readonly [areaType in AreaType]: CompletionCell };
  readonly byLand: readonly LabeledCell[];
  readonly byResortArea: readonly LabeledCell[];
  readonly byFacetValue: readonly FacetCoverage[];
  /** Hotels-visited (stayed) cell — distinct from `byResort`. */
  readonly resort: CompletionCell;
  /** NEW: per-resort activity completion (R6, R7). */
  readonly byResort: readonly ResortCoverage[];
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * A single rated experience result (highest- or lowest-rated). Mirrors the
 * backend `RatedExperience`.
 */
export interface RatedExperience {
  readonly experienceId: string;
  readonly name: string;
  /** The user's rating value, 1..10. */
  readonly value: number;
}

/**
 * The rating distribution: exactly one count per integer value 1 through 10.
 * Mirrors the backend `RatingDistribution`. When reported, the ten counts sum
 * to `ratedCompletionsCount`.
 */
export type RatingDistribution = Readonly<
  Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, number>
>;

/**
 * The personal rating statistics (`Rating_Statistics`). Mirrors the backend
 * `RatingStatistics`.
 *
 * `sufficient` is `true` exactly when the active-rating count is at least
 * `MINIMUM_RATINGS_THRESHOLD`. When `false`, every gated field (`average`,
 * `averageByPark`, `averageByCategory`, `distribution`, `highest`, `lowest`) is
 * omitted; `ratedCompletionsCount` is reported regardless.
 */
export interface RatingStatistics {
  readonly sufficient: boolean;
  readonly ratedCompletionsCount: number;
  readonly average?: number;
  readonly averageByPark?: Partial<Record<Park, number>>;
  readonly averageByCategory?: Partial<Record<ExperienceCategory, number>>;
  readonly distribution?: RatingDistribution;
  readonly highest?: RatedExperience;
  readonly lowest?: RatedExperience;
}

// ---------------------------------------------------------------------------
// Top-level response
// ---------------------------------------------------------------------------

/**
 * The nested Stats_Service response (`Stats_Response`), structurally identical
 * for self and friend reads. Mirrors the backend `StatsResponse`.
 *
 * `percentileRank` is present only when the request opted in with
 * `?percentile=true` AND the value was computed. `percentileUnavailable` is
 * present only on an isolated percentile failure; the two are mutually
 * exclusive.
 */
export interface StatsResponse {
  readonly coverage: CoverageResponse;
  readonly ratings: RatingStatistics;
  readonly percentileRank?: number;
  readonly percentileUnavailable?: boolean;
}
