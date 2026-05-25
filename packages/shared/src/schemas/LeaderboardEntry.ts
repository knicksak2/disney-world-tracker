/**
 * Zod schema for `LeaderboardEntryDTO`.
 *
 * Mirrors the wire shape of one Highest-Rated Experiences row (R11.5). The
 * threshold gate (`count >= 3`, R11.2) is enforced here because a leaderboard
 * row with `count < 3` should never have been emitted in the first place.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5
 */

import { z } from 'zod';

import {
  experienceCategorySchema,
  parkSchema,
  uuidSchema,
} from './primitives.js';

export const leaderboardEntrySchema = z
  .object({
    experienceId: uuidSchema,
    name: z.string().min(1).max(200),
    park: parkSchema,
    category: experienceCategorySchema,
    /** Aggregate mean rendered to one decimal place; in `[1.0, 10.0]`. */
    value: z.number().min(1).max(10),
    /** Threshold gate (R11.2). */
    count: z.number().int().min(3),
  })
  .strict();
