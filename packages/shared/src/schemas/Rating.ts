/**
 * Zod schemas for Rating-shaped values.
 *
 * The DTO schema mirrors `RatingDTO` (a User's own Rating). The input schema
 * validates `PUT /me/experiences/:id/rating` bodies; integer 1-10 is enforced
 * by `ratingValueSchema` (R4.1, R4.7).
 *
 * Validates: Requirements 4.1, 4.2, 4.7
 */

import { z } from 'zod';

import {
  isoTimestampSchema,
  ratingValueSchema,
  uuidSchema,
} from './primitives.js';

export const ratingSchema = z
  .object({
    userId: uuidSchema,
    experienceId: uuidSchema,
    value: ratingValueSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

/** Body for `PUT /me/experiences/:id/rating`. */
export const ratingInputSchema = z
  .object({
    value: ratingValueSchema,
  })
  .strict();

export type RatingInput = z.infer<typeof ratingInputSchema>;
