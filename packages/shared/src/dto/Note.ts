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

  /**
   * Whether the owning User has marked this Note shareable with Friends.
   * Private by default (`false`); only the owner can flip it via the Note
   * write path. The Friend Completions read honors this flag (R4.6, R4.7).
   *
   * Optional on the DTO type because some in-memory callers construct
   * partial DTOs; persisted Notes always carry a boolean since the
   * `notes.shareable` column is `NOT NULL DEFAULT FALSE` (migration 0003).
   */
  readonly shareable?: boolean;

  /** ISO-8601 timestamp of the most recent save/edit. */
  readonly updatedAt: string;
}
