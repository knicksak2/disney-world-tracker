/**
 * Zod schemas for the account-deletion wire contract (account-deletion R16.1, R16.4, R16.6).
 *
 * Every object schema is `.strict()` so an accidental extra field (in
 * particular anything password-shaped) is rejected rather than silently kept.
 */

import { z } from 'zod';

import { isoTimestampSchema, uuidSchema, emailSchema } from './primitives.js';

/** `POST /me/account/deletion/reauth` body: the caller's current password (R2.1). */
export const reauthRequestSchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();

export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

/** `200` body of the reauth route (R2.2). */
export const reauthResponseSchema = z
  .object({
    reauthGrant: z.string().min(1),
    expiresAt: isoTimestampSchema,
    graceDays: z.number().int().min(1).max(365),
  })
  .strict();

export type ReauthResponse = z.infer<typeof reauthResponseSchema>;

/** `POST /me/account/deletion` body (R2.7). The phrase is checked server-side. */
export const deleteAccountRequestSchema = z
  .object({
    reauthGrant: z.string().min(1),
    confirmation: z.string(),
  })
  .strict();

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/** `200` body of the deletion route (R3.4). */
export const deleteAccountResponseSchema = z
  .object({
    status: z.literal('pending_deletion'),
    scheduledPurgeAt: isoTimestampSchema,
    graceDays: z.number().int().min(1).max(365),
  })
  .strict();

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

/**
 * Login / register / mobile reset-password success body (R16.6). `accountRestored`
 * is present only as the literal `true`, and only when the call restored a
 * pending-deletion account; `false` is invalid by design.
 */
export const authSessionResponseSchema = z
  .object({
    user: z.object({ id: uuidSchema, email: emailSchema }).strict(),
    profile: z.object({ displayName: z.string() }).strict(),
    token: z.string().min(1),
    accountRestored: z.literal(true).optional(),
  })
  .strict();

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
