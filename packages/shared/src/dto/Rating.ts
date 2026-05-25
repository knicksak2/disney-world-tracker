/**
 * Rating DTO.
 *
 * A User's Rating of an Experience as an integer in `1..10` inclusive
 * (R4.1, R4.7). At most one Rating exists per `(user, experience)` pair
 * (R4.2). This DTO represents the requesting User's own Rating only — it is
 * never used to expose another User's individual Rating (privacy boundary,
 * R10.10).
 *
 * Validates: Requirements 4.1, 4.2, 4.7
 */

export interface RatingDTO {
  readonly userId: string;
  readonly experienceId: string;

  /** Integer in `[1, 10]` inclusive (R4.1, R4.7). */
  readonly value: number;

  /** ISO-8601 timestamp of the most recent set/replace. */
  readonly updatedAt: string;
}
