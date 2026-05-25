/**
 * Zod schemas for Completion-shaped values.
 *
 * The DTO schema mirrors `CompletionDTO`. The mark/edit input schema captures
 * the body for `PUT /me/experiences/:id/completion` and
 * `PATCH /me/experiences/:id/completion`. The "date not in the future
 * relative to the User's local time zone" check (R2.6) is enforced
 * server-side because it requires the current wall clock; this schema only
 * validates the *shape* of the date string and the IANA TZ identifier.
 *
 * Validates: Requirements 2.1, 2.3, 2.5, 2.6, 2.8
 */

import { z } from 'zod';

import { ianaTzSchema, isoDateSchema, uuidSchema } from './primitives.js';

export const completionSchema = z
  .object({
    userId: uuidSchema,
    experienceId: uuidSchema,
    completedOn: isoDateSchema,
    userTz: ianaTzSchema,
  })
  .strict();

/**
 * Body for `PUT /me/experiences/:id/completion` (mark) and
 * `PATCH /me/experiences/:id/completion` (edit date).
 *
 * R2.8 ("a single operation that both unmarks and edits the date") is
 * structurally rejected at the route level: the unmark route is `DELETE`,
 * so a body that both removes and edits the date cannot exist on a single
 * endpoint. This schema therefore only models the date+tz pair.
 */
export const completionInputSchema = z
  .object({
    completedOn: isoDateSchema,
    userTz: ianaTzSchema,
  })
  .strict();

export type CompletionInput = z.infer<typeof completionInputSchema>;
