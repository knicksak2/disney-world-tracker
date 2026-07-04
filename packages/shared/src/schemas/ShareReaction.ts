/**
 * Zod schema for `ShareReactionDTO` (sender view).
 *
 * Mirrors one recipient's `Share_Reaction` as disclosed to the sender
 * (R11.7): the value is validated against the closed `Reaction_Vocabulary`
 * (R11.3), alongside the reactor's identity, display name, and reaction time.
 *
 * Validates: Requirements 11.3, 11.7
 */

import { z } from 'zod';

import {
  displayNameSchema,
  isoTimestampSchema,
  shareReactionValueSchema,
  uuidSchema,
} from './primitives.js';

export const shareReactionSchema = z
  .object({
    reaction: shareReactionValueSchema,
    reactorId: uuidSchema,
    reactorDisplayName: displayNameSchema,
    reactedAt: isoTimestampSchema,
  })
  .strict();
