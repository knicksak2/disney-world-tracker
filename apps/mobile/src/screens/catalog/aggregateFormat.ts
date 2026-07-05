// Feature: experience-detail-redesign, Task 6.1 — pure community-aggregate
// formatting helper
//
// Validates: Requirements 8.6
//
// Framework-free core (no React, no react-navigation) for the
// Community_Rating_Section's display projection, mirroring the existing
// `infoTags.ts` / `gating.ts` / `shareEntryPoint.ts` pure-core pattern so the
// aggregate formatting rule is unit- and property-testable without rendering.
//
// The screen's `AggregateContent` renderer maps the result of
// `formatCommunityAggregate` straight to Text:
//   - a `null` aggregate `value` (below the server's count threshold or no
//     row yet) projects to the `empty` variant → "Not enough ratings yet"
//     (R8.5);
//   - a non-null `value` projects to the `populated` variant carrying the
//     mean rendered to one decimal place (exactly `value.toFixed(1)`, R8.6)
//     together with the contributing rating `count`.

import type { AggregateRatingDTO } from '@dwt/shared';

/** The Community_Rating_Section has no publishable mean to display (R8.5). */
export interface CommunityAggregateEmpty {
  readonly kind: 'empty';
}

/** The Community_Rating_Section has a publishable mean to display (R8.6). */
export interface CommunityAggregatePopulated {
  readonly kind: 'populated';
  /**
   * The mean rounded to one decimal place, equal to `value.toFixed(1)` — the
   * exact string the section renders (R8.6).
   */
  readonly mean: string;
  /** Count of contributing Ratings shown alongside the mean (R8.6). */
  readonly count: number;
}

/** Discriminated projection of an aggregate rating for display. */
export type CommunityAggregateDisplay =
  | CommunityAggregateEmpty
  | CommunityAggregatePopulated;

/**
 * Project an `AggregateRatingDTO` into its Community_Rating_Section display
 * shape. Pure and total — never throws.
 *
 * When the aggregate `value` is `null` the result is the `empty` variant so
 * the section renders "Not enough ratings yet" (R8.5). Otherwise the result
 * is the `populated` variant carrying the mean formatted to one decimal place
 * (equal to `value.toFixed(1)`) and the contributing rating count (R8.6).
 */
export function formatCommunityAggregate(
  aggregate: AggregateRatingDTO,
): CommunityAggregateDisplay {
  if (aggregate.value === null) {
    return { kind: 'empty' };
  }
  return {
    kind: 'populated',
    mean: aggregate.value.toFixed(1),
    count: aggregate.count,
  };
}
