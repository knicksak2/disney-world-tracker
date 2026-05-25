/**
 * ShareRecipient DTO.
 *
 * Per-recipient delivery row for a `Share`. `openedAt` distinguishes the
 * unopened preview state (sender, content, and timestamp withheld, R9.8) from
 * the opened state (full disclosure, R9.9). `recipientDeletedAt` is set when
 * the recipient deletes the Share from their inbox; the sender's record of
 * the Share is left unchanged (R9.10).
 *
 * Validates: Requirements 9.8, 9.9, 9.10
 */

export interface ShareRecipientDTO {
  readonly shareId: string;
  readonly recipientId: string;

  /**
   * ISO-8601 timestamp the recipient first opened the Share, or `null` while
   * the Share is still unopened (R9.8, R9.9).
   */
  readonly openedAt: string | null;

  /**
   * ISO-8601 timestamp the recipient soft-deleted the Share from their inbox,
   * or `null` while the Share is still in the inbox (R9.10).
   */
  readonly recipientDeletedAt: string | null;
}
