/**
 * Progress_Comparison derivation (task 24.1).
 *
 * A pure derivation over the viewing User's own stats roll-up and a Friend's
 * stats roll-up — both the shared four-dimension `FriendStatsResponse` shape
 * (`GET /me/stats` for the viewer, `GET /me/stats/summary?for=` for the
 * Friend). The Friend_Profile_View has already retrieved both (task 23.1), so
 * this derivation adds no new reads and simply projects the two roll-ups into
 * side-by-side rows (R12.4).
 *
 * For the overall figure, for every Park, and for every Experience_Category it
 * pairs the viewer's percentage with the Friend's percentage (R12.1, R12.2,
 * R12.3). Each percentage is clamped into `[0.0, 100.0]`; the one-decimal-place
 * presentation is applied at render via `formatComparisonPercent`. The server
 * already rounds/caps the underlying `percent`, so `clampPercent` is a
 * defensive normalization that also neutralizes any non-finite value.
 *
 * The rows carry the raw dimension `key` (the Park name, the
 * Experience_Category value, or `'overall'`); mapping a key to a human display
 * label and attaching the owner labels (viewer vs Friend) are render-layer
 * concerns kept out of this pure function so it stays trivially testable
 * (Property 20).
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 */

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import type { FriendStatsResponse } from '../../api/friendProfile';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * One dimension of the comparison: the viewer's and the Friend's completion
 * percentage for the same Park / Category / overall figure. Both percentages
 * are already normalized into `[0.0, 100.0]`.
 */
export interface ComparisonRow {
  /** `'overall'`, a `Park` name, or an `ExperienceCategory` value. */
  readonly key: string;
  readonly viewerPercent: number;
  readonly friendPercent: number;
}

/**
 * The full Progress_Comparison: the overall row plus one row per Park (in the
 * fixed `PARKS` order) and one per Experience_Category (in the fixed
 * `EXPERIENCE_CATEGORIES` order), so the rendered layout is stable.
 */
export interface ProgressComparison {
  readonly overall: ComparisonRow;
  readonly byPark: readonly ComparisonRow[];
  readonly byCategory: readonly ComparisonRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw percentage into the `[0.0, 100.0]` inclusive range required
 * by R12.1–R12.3. Non-finite inputs (NaN, ±Infinity) collapse to `0`, so the
 * derivation never emits a value outside the range regardless of upstream data.
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Render a comparison percentage with exactly one decimal place (R12.1–R12.3),
 * e.g. `42` → `"42.0%"`, `33.34` → `"33.3%"`. Clamps defensively so a caller
 * that skips `deriveProgressComparison` still cannot render an out-of-range or
 * non-finite value.
 */
export function formatComparisonPercent(value: number): string {
  return `${clampPercent(value).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the Progress_Comparison from the viewer's and the Friend's already
 * retrieved stats roll-ups (R12.4). Emits the overall row, one row per Park,
 * and one row per Experience_Category, each pairing the viewer's clamped
 * percentage with the Friend's (R12.1, R12.2, R12.3).
 */
export function deriveProgressComparison(
  viewer: FriendStatsResponse,
  friend: FriendStatsResponse,
): ProgressComparison {
  return {
    overall: {
      key: 'overall',
      viewerPercent: clampPercent(viewer.overall.percent),
      friendPercent: clampPercent(friend.overall.percent),
    },
    byPark: PARKS.map((park) => ({
      key: park,
      viewerPercent: clampPercent(viewer.byPark[park].percent),
      friendPercent: clampPercent(friend.byPark[park].percent),
    })),
    byCategory: EXPERIENCE_CATEGORIES.map((category) => ({
      key: category,
      viewerPercent: clampPercent(viewer.byCategory[category].percent),
      friendPercent: clampPercent(friend.byCategory[category].percent),
    })),
  };
}
