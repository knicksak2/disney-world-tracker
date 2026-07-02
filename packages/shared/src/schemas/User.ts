/**
 * Zod schemas for User-shaped values.
 *
 * `userSchema` validates the shape of a `UserDTO` — the public-facing User
 * representation. The plaintext password is intentionally absent from this
 * schema (R6.11): only the registration *input* schema accepts a password,
 * and the registration handler hashes it with Argon2id before any persistence.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.11
 */

import { z } from 'zod';

import {
  displayNameSchema,
  emailSchema,
  isoTimestampSchema,
  passwordSchema,
  uuidSchema,
} from './primitives.js';

/**
 * Public DTO shape. `.strict()` rejects any unexpected fields (in particular,
 * any accidental `password` or `passwordHash` field that might leak from a
 * database row to a response).
 */
export const userSchema = z
  .object({
    id: uuidSchema,
    email: emailSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

/**
 * Registration input (R6.1, R6.4): RFC 5322 email, display name 1-50 chars
 * after trimming, password 8-128 chars. The output type carries the trimmed
 * display name.
 */
export const registerInputSchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerInputSchema>;

/**
 * Login input. The shared schema validates only that an email and a password
 * were supplied; specific failure responses (`invalid_credentials`,
 * `account_locked`) are decided by the Auth_Service after looking up the
 * account and consulting the lockout state.
 */
export const loginInputSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Change-password input (R6.13-R6.16). The caller supplies their current
 * password (re-verified server-side against the stored Argon2id hash before
 * any change) and a new password validated by the same 8-128 character
 * `passwordSchema` used at registration. A wrong current password yields
 * `invalid_credentials` (R6.14); a structurally invalid new password yields
 * `validation_failed` (R6.15). Both passwords flow only into the Argon2id
 * helpers and are never logged or returned.
 */
export const changePasswordInputSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
