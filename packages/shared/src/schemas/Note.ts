/**
 * Zod schemas for Note-shaped values.
 *
 * The DTO schema mirrors `NoteDTO`. The input schema validates
 * `PUT /me/experiences/:id/note` bodies. The trim + 1-2000 character rule
 * (R5.2, R5.10) is enforced by `noteBodySchema` and rejects whitespace-only
 * inputs because the trimmed length is 0.
 *
 * Validates: Requirements 5.1, 5.2, 5.10
 */

import { z } from 'zod';

import {
  isoTimestampSchema,
  noteBodySchema,
  uuidSchema,
} from './primitives.js';

export const noteSchema = z
  .object({
    userId: uuidSchema,
    experienceId: uuidSchema,
    body: noteBodySchema,
    shareable: z.boolean().optional(),
    updatedAt: isoTimestampSchema,
  })
  .strict();

/**
 * Body for `PUT /me/experiences/:id/note`.
 *
 * `shareable` is optional so callers editing only the note text never have
 * to restate the flag; the repo's UPSERT preserves the prior stored value
 * when it is omitted and defaults a brand-new Note to private (R4.6, R4.7).
 */
export const noteInputSchema = z
  .object({
    body: noteBodySchema,
    shareable: z.boolean().optional(),
  })
  .strict();

export type NoteInput = z.infer<typeof noteInputSchema>;
