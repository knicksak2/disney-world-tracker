/**
 * Zod schema for `ShareRecipientDTO`.
 *
 * Mirrors the per-recipient delivery row. `openedAt` is `null` until the
 * recipient first opens the Share (R9.8, R9.9); `recipientDeletedAt` is
 * `null` until the recipient soft-deletes it from the inbox (R9.10).
 *
 * Validates: Requirements 9.8, 9.9, 9.10
 */

import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './primitives.js';

export const shareRecipientSchema = z
  .object({
    shareId: uuidSchema,
    recipientId: uuidSchema,
    openedAt: isoTimestampSchema.nullable(),
    recipientDeletedAt: isoTimestampSchema.nullable(),
  })
  .strict();
