/**
 * AggregateRating DTO.
 *
 * Privacy boundary in the type system (R10.10): the response shape exposed for
 * an Experience's userbase aggregate rating contains exactly two fields,
 * `value` and `count`, and nothing else. There is **no** field for any other
 * User's individual Rating value, by construction.
 *
 *   - `value` is `null` when the Experience has fewer than 3 contributing
 *     Ratings (the threshold gate, R10.4); the client renders an empty-state
 *     indicator in that case (R10.6).
 *   - `value` is a `number` in `[1.0, 10.0]` to one decimal place when the
 *     Experience has 3 or more contributing Ratings (R10.1, R10.3, R10.5).
 *
 * Note: this DTO is intentionally narrow. Adding any field that could
 * identify another User's individual rating value would violate the privacy
 * requirement. The accompanying Zod schema in
 * `packages/shared/src/schemas/AggregateRating.ts` enforces the same shape
 * with `.strict()` so unexpected fields are rejected at the boundary.
 *
 * Validates: Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.10
 */

export interface AggregateRatingDTO {
  /**
   * Mean of contributing Ratings rounded to one decimal place, constrained to
   * `[1.0, 10.0]`, or `null` when the threshold of at least 3 contributing
   * Ratings is not met.
   */
  readonly value: number | null;

  /** Count of contributing Ratings. Always present (R10.3, R10.4). */
  readonly count: number;
}
