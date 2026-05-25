/**
 * Zod schemas for FriendRequest-shaped values.
 *
 * `friendRequestSchema` validates the shape of a `FriendRequestDTO`. The
 * "send" input schema validates the body of `POST /me/friend-requests`;
 * authoritative checks for self-target (R8.8), unknown recipient (R8.10), and
 * duplicate request/friendship (R8.7) live in the Friends_Service because
 * they require a database lookup.
 *
 * Validates: Requirements 8.3, 8.4, 8.5, 8.7, 8.8, 8.10
 */

import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './primitives.js';

export const friendRequestSchema = z
  .object({
    id: uuidSchema,
    senderId: uuidSchema,
    recipientId: uuidSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

/** Body for `POST /me/friend-requests`. */
export const friendRequestInputSchema = z
  .object({
    recipientId: uuidSchema,
  })
  .strict();

export type FriendRequestInput = z.infer<typeof friendRequestInputSchema>;
