/**
 * Pin (collectible achievement) DTOs and the machine-readable Challenge criteria
 * model for the pin-collection feature (Series 1 restructure).
 *
 * A `PinDTO` is a static catalog entry: its id, tier (rarity), track (board
 * grouping), display name, description, and the deterministic `PinCriteria` the
 * Pin_Service evaluates against a User's activity to decide whether it is
 * unlocked. Art/motif assignment lives in the rendered catalogue and the mobile
 * renderer, not here — this contract is the *logical* definition the evaluator
 * and the shared catalog (`packages/shared/src/pins/catalog.ts`) operate on.
 *
 * `UserPinProgressDTO` is the per-User projection returned by `GET /me/pins`:
 * unlocked pins carry an `awardedAt`, locked pins carry progress toward their
 * target (R3.1).
 *
 * Validates: Requirements 1, 3.1, 7, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19
 */

import type { Park, PinCountMetric, PinTier, PinTrack } from '../enums.js';

/** 100% of a park's *attractions* (`attractions`) vs. 100% of *everything* in it. */
export type ParkCompletionScope = 'attractions' | 'everything';

/** 100% of all active *attractions* (All Attractions) vs. the whole catalog. */
export type CatalogCompletionScope = 'attractions' | 'all';

/** A curated/facet set is satisfied by completing `n` of its members, or all. */
export type SetRequirement = number | 'all';

/**
 * A single-day touring feat, evaluated by grouping a User's `experience_logs`
 * on `visited_on` (date granularity only — no time-of-day; R18.1).
 *
 * - `multiPark`: log experiences in `parks` distinct theme parks on one day.
 * - `rideMarathon`: log `rides` ride experiences on one day.
 * - `grandSlam`: all 4 theme parks AND ≥15 rides on one day (Touring pinnacle).
 * - `diningAllParks`: a Restaurant in all 4 theme parks on one day.
 * - `aroundTheWorld`: an experience in all 11 World Showcase countries on one day.
 */
export type SingleDayFeat =
  | { readonly type: 'multiPark'; readonly parks: number }
  | { readonly type: 'rideMarathon'; readonly rides: number }
  | { readonly type: 'grandSlam' }
  | { readonly type: 'diningAllParks' }
  | { readonly type: 'aroundTheWorld' };

/**
 * The deterministic unlock condition for a Pin. A discriminated union on `kind`
 * so the evaluator can exhaustively switch over it.
 *
 * - `count`: a lifetime metric ≥ `threshold` (the ladders).
 * - `firstInPark` / `firstInLand`: ≥1 experience in a park / land (starters).
 * - `landComplete`: 100% of the attractions across the given land(s) — one land,
 *   or a combined-land set (e.g. The Boulevards).
 * - `allLandsVisited`: ≥1 experience in every theme-park land (All Lands Explorer).
 * - `parkComplete`: 100% of a park's attractions (mastery) or everything (sovereign).
 * - `parksAttractionsComplete`: 100% of the attractions across all 4 theme parks
 *   (Four Parks Master).
 * - `catalogComplete`: All Attractions (`attractions`) or The Whole Catalog (`all`).
 * - `set`: complete `required` members of a named curated/facet set (`setId`).
 * - `singleDay`: a single-day feat.
 * - `compound`: every nested criteria must hold (logical AND) — used by the
 *   Prism pinnacles (e.g. Legendary Guide, Global Ambassador).
 */
export type PinCriteria =
  | { readonly kind: 'count'; readonly metric: PinCountMetric; readonly threshold: number }
  | { readonly kind: 'firstInPark'; readonly park: Park }
  | { readonly kind: 'firstInLand'; readonly land: string }
  | { readonly kind: 'landComplete'; readonly lands: readonly string[] }
  | { readonly kind: 'allLandsVisited' }
  | { readonly kind: 'parkComplete'; readonly park: Park; readonly scope: ParkCompletionScope }
  | { readonly kind: 'parksAttractionsComplete' }
  | { readonly kind: 'catalogComplete'; readonly scope: CatalogCompletionScope }
  | { readonly kind: 'set'; readonly setId: string; readonly required: SetRequirement }
  | { readonly kind: 'singleDay'; readonly feat: SingleDayFeat }
  | { readonly kind: 'compound'; readonly all: readonly PinCriteria[] };

/** A static catalog Pin definition (Series 1). */
export interface PinDTO {
  /** Stable id, prefixed by tier (e.g. `gold_coaster_royalty`). */
  readonly id: string;
  readonly tier: PinTier;
  readonly track: PinTrack;
  readonly name: string;
  readonly description: string;
  readonly criteria: PinCriteria;
}

/**
 * Per-User projection of a Pin for the Pin Board (`GET /me/pins`).
 *
 * When `unlocked`, `awardedAt` is the ISO timestamp of the award and the
 * progress fields are `null`. When locked, `awardedAt` is `null` and the
 * progress fields describe how far the User is toward the target, with
 * `percentComplete` clamped to `[0, 99]` (R3.1, Property 4).
 */
export interface UserPinProgressDTO {
  readonly pinId: string;
  readonly unlocked: boolean;
  readonly awardedAt: string | null;
  readonly currentValue: number | null;
  readonly targetValue: number | null;
  readonly percentComplete: number | null;
  /**
   * ISO timestamp the User explicitly claimed this Pin, or `null` if it has
   * not been claimed yet (Requirement 20.2). Only meaningful when
   * `unlocked` is `true` — a locked pin's `claimedAt` is always `null`,
   * since a pin cannot be claimed before it is awarded (Requirement 20.1,
   * Property 13). A pin is **ready to claim** when `unlocked` is `true` and
   * `claimedAt` is `null`.
   *
   * `claimedAt` is purely presentational: it never affects `unlocked`, the
   * board's tier summary, or `overallPercent` (Requirement 20.5, Property 14).
   */
  readonly claimedAt: string | null;
}

/**
 * Per-tier roll-up for the Pin Board header: how many of that tier's Series 1
 * Pins the User has unlocked, out of the tier's total (R3.2).
 */
export interface PinTierSummaryDTO {
  readonly tier: PinTier;
  readonly unlocked: number;
  readonly total: number;
}

/**
 * The full Pin Board projection returned by `GET /me/pins`.
 *
 * `pins` carries every Series 1 Pin the query selected (the tier/track/unlocked
 * filters narrow it; an unfiltered request returns all of them). `tierSummary`
 * and the totals always describe the User's **entire** collection, independent
 * of any active filter, so the header counts do not change as the grid is
 * filtered (R3.1, R3.2, R3.3).
 */
export interface PinBoardDTO {
  readonly pins: readonly UserPinProgressDTO[];
  readonly tierSummary: readonly PinTierSummaryDTO[];
  /** Total Pins the User has unlocked across the whole Series 1 roster. */
  readonly totalUnlocked: number;
  /** Total Series 1 Pins in the catalog. */
  readonly totalPins: number;
  /** `totalUnlocked / totalPins * 100`, floored to an integer in `[0, 100]`. */
  readonly overallPercent: number;
}
