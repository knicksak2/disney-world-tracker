/**
 * Zod schemas for Experience_Log contracts.
 *
 * `experienceLogSchema` mirrors `ExperienceLogDTO`; `experienceVisitHistorySchema`
 * mirrors `ExperienceVisitHistoryDTO`; `createExperienceLogInputSchema` validates
 * the `POST /me/experiences/:id/logs` body.
 *
 * The input allows an optional 1-10 `rating` and an optional 1-2000 char `note`
 * (each may be `null` to mean "no value"), and an optional `tripId` to link the
 * visit to an active Trip (R1.1, R1.2). `note` reuses `noteBodySchema` which
 * trims and enforces the 1-2000 length rule; `rating` reuses `ratingValueSchema`.
 *
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2
 */

import { z } from 'zod';

import {
  ianaTzSchema,
  isoDateSchema,
  isoTimestampSchema,
  noteBodySchema,
  ratingValueSchema,
  uuidSchema,
} from './primitives.js';

export const experienceLogSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    experienceId: uuidSchema,
    visitedOn: isoDateSchema,
    userTz: ianaTzSchema,
    loggedAt: isoTimestampSchema,
    rating: ratingValueSchema.nullable(),
    note: noteBodySchema.nullable(),
  })
  .strict();

export const experienceVisitHistorySchema = z
  .object({
    experienceId: uuidSchema,
    repeatCount: z.number().int().min(0),
    logs: z.array(experienceLogSchema),
  })
  .strict();

/**
 * Body for `POST /me/experiences/:id/logs`. `rating`, `note`, and `tripId`
 * are each optional and may be `null`; the route treats an absent field and a
 * `null` field identically (no rating / no note / no trip link).
 */
export const createExperienceLogInputSchema = z
  .object({
    visitedOn: isoDateSchema,
    userTz: ianaTzSchema,
    rating: ratingValueSchema.nullable().optional(),
    note: noteBodySchema.nullable().optional(),
    tripId: uuidSchema.nullable().optional(),
  })
  .strict();

export type CreateExperienceLogInput = z.infer<
  typeof createExperienceLogInputSchema
>;
