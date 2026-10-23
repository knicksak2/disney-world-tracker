/**
 * User DTO.
 *
 * The public-facing shape of a User account. The `password` field is
 * intentionally absent: per the design, plaintext passwords are never stored,
 * never logged, and never transmitted in any response (R6.11). Only the
 * Argon2id hash representation is persisted on the server, and the hash is
 * never exposed at the API boundary.
 *
 * Validates: Requirements 6.1, 6.11
 */

export interface UserDTO {
  /** Server-assigned unique account identifier (UUID v4). */
  readonly id: string;

  /**
   * Account email address. Stored case-insensitively (citext) per the design,
   * but echoed in responses with its original casing.
   */
  readonly email: string;

  /** ISO-8601 timestamp at which the account was created. */
  readonly createdAt: string;
}

/**
 * Uniform message returned on forgot-password request.
 */
export interface ForgotPasswordResponseDTO {
  readonly message: string;
}

/**
 * Success body of login, register and mobile reset-password: the user, the
 * profile name and a fresh session token (account-deletion R16.6).
 *
 * `accountRestored` is present only as `true`, and only when the call restored
 * an account that was pending deletion. It is absent otherwise; `POST
 * /auth/register` never sets it.
 */
export interface AuthSessionResponseDTO {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: { readonly displayName: string };
  readonly token: string;
  readonly accountRestored?: true;
}

/**
 * Success response returned when password reset succeeds in mobile app,
 * automatically establishing an authenticated session. Same shape as
 * `AuthSessionResponseDTO` (export name unchanged).
 */
export type ResetPasswordSuccessDTO = AuthSessionResponseDTO;

