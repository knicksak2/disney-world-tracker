/**
 * Zod schemas for the Inbox DTOs (recipient view).
 *
 * `inboxItemSchema` mirrors `InboxItemDTO`: it always projects sender,
 * payload, timestamp, and per-recipient `read` state (R4.1, R6.2), validating
 * `payload` as the same discriminated union used in delivery and asserting the
 * `payloadKind` discriminator agrees with `payload.kind`.
 *
 * `myReaction` is the recipient's own `Share_Reaction`, validated against the
 * closed `Reaction_Vocabulary` (R11.2, R11.3), or `null` when the recipient
 * has not reacted.
 *
 * Validates: Requirements 4.1, 6.2, 6.6
 */

import { z } from 'zod';

import {
  displayNameSchema,
  isoTimestampSchema,
  sharePayloadKindSchema,
  shareReactionValueSchema,
  uuidSchema,
} from './primitives.js';
import { sharePayloadSchema } from './Share.js';

export const inboxItemSchema = z
  .object({
    shareId: uuidSchema,
    read: z.boolean(),
    senderId: uuidSchema,
    senderDisplayName: displayNameSchema,
    payloadKind: sharePayloadKindSchema,
    payload: sharePayloadSchema,
    sentAt: isoTimestampSchema,
    myReaction: shareReactionValueSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The wire discriminator must agree with the payload discriminator, so a
    // caller can branch on `payloadKind` without inspecting the snapshot.
    if (value.payloadKind !== value.payload.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'payloadKind must match payload.kind',
        path: ['payloadKind'],
      });
    }
  });

export const inboxResponseSchema = z
  .object({
    unread: z.number().int().nonnegative(),
    items: z.array(inboxItemSchema),
  })
  .strict();
