/**
 * Zod schema for `FriendshipDTO`.
 *
 * The canonical-pair invariant `userLoId < userHiId` (R8.6) is enforced via a
 * `superRefine` so a row with the pair reversed cannot pass validation — this
 * mirrors the database CHECK constraint declared in the design.
 *
 * Validates: Requirements 8.4, 8.6
 */

import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './primitives.js';

export const friendshipSchema = z
  .object({
    userLoId: uuidSchema,
    userHiId: uuidSchema,
    establishedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.userLoId >= value.userHiId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'friendship pair must satisfy userLoId < userHiId',
        path: ['userLoId'],
      });
    }
  });
