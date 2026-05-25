/**
 * Zod schemas for Profile-shaped values.
 *
 * The DTO schema mirrors `ProfileDTO` exactly. The display-name update input
 * is also exposed because it is the canonical place where the
 * trim + 1-50 char + non-whitespace rule is enforced (R7.2, R7.5, R7.6).
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6
 */

import { z } from 'zod';

import {
  completionPercentSchema,
  displayNameSchema,
  uuidSchema,
} from './primitives.js';

/**
 * Profile DTO shape. The avatar URL is `string | null` to reflect the
 * "optional avatar" semantics from R7.1 without making the field itself
 * optional (a present `null` is meaningful and round-trips through JSON).
 */
export const profileSchema = z
  .object({
    userId: uuidSchema,
    displayName: displayNameSchema,
    avatarUrl: z.string().url().nullable(),
    overallCompletionPercent: completionPercentSchema,
  })
  .strict();

/** Display-name update input (R7.2, R7.5, R7.6). */
export const profileDisplayNameInputSchema = z
  .object({
    displayName: displayNameSchema,
  })
  .strict();

export type ProfileDisplayNameInput = z.infer<typeof profileDisplayNameInputSchema>;
