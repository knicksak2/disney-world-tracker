/**
 * Visit Summary DTO.
 *
 * Batched per-Experience visit stats (repeat count, rated count, average
 * rating) returned by `GET /me/experiences/visit-summary`, keyed by
 * Experience id, so consumers (Park_Passport_Card, Experience_List detail
 * rows) can render visit/rating badges without recomputing an average from
 * raw logs client-side.
 *
 * Validates: Requirements 13.1, 13.2
 */

/**
 * One Experience's visit summary for the current User.
 */
export interface VisitSummaryDTO {
  readonly repeatCount: number;
  readonly ratedCount: number;
  /** `[1.0, 10.0]`, one decimal; `null` when `ratedCount` is 0. */
  readonly averageRating: number | null;
}

/** GET /me/experiences/visit-summary response shape. */
export type VisitSummaryResponseDTO = Readonly<Record<string, VisitSummaryDTO>>;

/**
 * Cap on distinct Experience ids the `ids` query param may request in one
 * call before the route rejects with `400 validation_failed`.
 *
 * Validates: Requirement 13.2
 */
export const VISIT_SUMMARY_MAX_IDS = 100;
