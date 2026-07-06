/**
 * Zod schemas for Profile-shaped values.
 *
 * The DTO schema mirrors `ProfileDTO` exactly. Two input schemas are also
 * exposed because this is the canonical place where their rules are enforced:
 *   - the display-name update (trim + 1-50 char + non-whitespace, R7.2/R7.5/R7.6)
 *   - the avatar-preset update (must be a known preset id, or `null` to clear)
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6
 */

import { z } from 'zod';

import { AVATAR_PRESET_IDS } from '../constants/avatarPresets.js';
import {
  completionPercentSchema,
  displayNameSchema,
  uuidSchema,
} from './primitives.js';

/**
 * Profile DTO shape. `avatarPreset` is a known preset id or `null` (no avatar
 * chosen). A present `null` is meaningful and round-trips through JSON.
 */
export const profileSchema = z
  .object({
    userId: uuidSchema,
    displayName: displayNameSchema,
    avatarPreset: z.enum(AVATAR_PRESET_IDS).nullable(),
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

/**
 * Avatar-preset update input. `avatarPreset` must be one of the known preset
 * ids, or `null` to clear the avatar back to the placeholder. Any other value
 * is rejected so the server never persists an id it cannot render.
 */
export const profileAvatarInputSchema = z
  .object({
    avatarPreset: z.enum(AVATAR_PRESET_IDS).nullable(),
  })
  .strict();

export type ProfileAvatarInput = z.infer<typeof profileAvatarInputSchema>;
