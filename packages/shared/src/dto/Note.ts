/**
 * Note DTO.
 *
 * Free-form text a User has saved against an Experience. At most one Note
 * exists per `(user, experience)` pair (R5.1). Body length is `1..2000`
 * Unicode code points after trimming leading and trailing whitespace
 * (R5.2, R5.10).
 *
 * Validates: Requirements 5.1, 5.2, 5.10
 */

export interface NoteDTO {
  readonly userId: string;
  readonly experienceId: string;

  /** Trimmed body, 1-2000 characters (R5.2). */
  readonly body: string;

  /** ISO-8601 timestamp of the most recent save/edit. */
  readonly updatedAt: string;
}
