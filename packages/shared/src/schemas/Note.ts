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
    updatedAt: isoTimestampSchema,
  })
  .strict();

/** Body for `PUT /me/experiences/:id/note`. */
export const noteInputSchema = z
  .object({
    body: noteBodySchema,
  })
  .strict();

export type NoteInput = z.infer<typeof noteInputSchema>;
