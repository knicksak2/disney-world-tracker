/**
 * Auth_Service HTTP routes.
 *
 * Task 6.3 of the disney-world-tracker plan. Wires the four endpoints from
 * the design's Auth_Service "Key endpoints" table that this task owns:
 *
 *   POST /auth/register   create User + Profile + session
 *   POST /auth/login      establish session for an existing User
 *   POST /auth/logout     revoke the caller's current session
 *   GET  /me              return the caller's User and Profile
 *
 * Inputs are validated against the shared Zod schemas
 * (`registerInputSchema`, `loginInputSchema`) so the validation rules cannot
 * drift between the API and the mobile client. Passwords are hashed and
 * verified via the Argon2id helpers (task 6.1, `password.ts`); session
 * tokens are minted by the opaque-token generator (task 6.1,
 * `sessionToken.ts`) and only their sha256 hash is persisted; the
 * session-lifecycle middleware (task 6.2, `sessionMiddleware.ts`) gates the
 * authenticated routes; and the Redis-backed lockout service (task 6.4,
 * `lockout.ts`) is consulted before password verification on login.
 *
 * The plugin is dependency-injected (matching the style of `profileRoutes`)
 * so unit and integration tests can substitute a fake pool, a fake lockout
 * service, or a stubbed pre-handler without monkey-patching modules.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, type z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  type AuthSessionResponseDTO,
  type ForgotPasswordResponseDTO,
  type ResetPasswordSuccessDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { loginRateLimitConfig } from '../../plugins/rateLimit.js';
import {
  classifyLoginEligibility,
  type DeletionState,
} from '../accountDeletion/deletionState.js';
import type { AccountRestorePort } from '../accountDeletion/ports.js';
import { hash as hashPassword, verify as verifyPassword } from './password.js';
import { generateToken, hashToken } from './sessionToken.js';
import type { LockoutService } from './lockout.js';
import { createMailService, type MailService } from './mailService.js';
import {
  createPasswordResetRepo,
  type PasswordResetRepo,
} from './passwordResetRepo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute TTL applied to a freshly-issued session row.
 *
 * Per design.md "Session lifecycle", `absolute_expires_at = created_at + 24h`
 * at issuance. The continuous-activity rule that may roll the window over
 * on subsequent requests is enforced by the session middleware, not here.
 */
const ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000;

/** Postgres SQLSTATE for a `unique_violation` on an INSERT/UPDATE. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Validation issue messages produced by the shared schemas that we map to
 * specific error codes when present. Anything not in this set collapses to
 * the generic `validation_failed` code, which keeps R6.4 satisfied (a
 * validation error response identifying the failing field) while letting
 * R7.6's display-name-specific code surface for the registration display
 * name field.
 */
const VALIDATION_MESSAGE_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  validation_failed: 'validation_failed',
  display_name_invalid: 'display_name_invalid',
};

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `authRoutes`.
 *
 * Dependencies are passed in explicitly so the plugin can be wired in
 * `buildServer` (or in a test harness) without reaching for module-level
 * singletons. The shapes mirror the public surfaces of the peer Auth tasks:
 *
 *   - `pool`              — `apps/api/src/db/pool.ts`
 *   - `lockout`           — task 6.4 `createLockoutService(...)` result
 *   - `requireSession`    — task 6.2 `createSessionMiddleware(...)` result
 *   - `now`               — optional clock injector for deterministic tests
 */
export interface AuthRoutesOptions {
  /** Process-wide Postgres pool. */
  readonly pool: DbPool;
  /** Redis-backed lockout service from task 6.4. */
  readonly lockout: LockoutService;
  /**
   * Pre-handler from task 6.2 that authenticates the request and assigns
   * `request.userId`. Reused on the routes that require an active session
   * (`POST /auth/logout`, `GET /me`).
   */
  readonly requireSession: preHandlerHookHandler;
  /**
   * Optional injectable clock; defaults to `() => new Date()`. Tests pass a
   * stub to make session-row timestamps deterministic.
   */
  readonly now?: () => Date;
  /**
   * Optional transactional mail service for sending password reset emails.
   */
  readonly mailService?: MailService;
  /**
   * Optional password reset repository.
   */
  readonly passwordResetRepo?: PasswordResetRepo;
  /**
   * Optional public API URL for generating reset links.
   */
  readonly apiPublicUrl?: string;
  /**
   * Restores an account that is pending deletion when its owner signs in or completes a password reset
   * (account-deletion R4). Optional so existing wiring and test doubles keep compiling; when it is absent and the
   * account is restorable, login FAILS CLOSED with `invalid_credentials` and the reset hook is not passed.
   */
  readonly accountRestore?: AccountRestorePort;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Auth_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(authRoutes({ pool, lockout, requireSession }));
 * ```
 *
 * The factory closes over the options so the returned plugin's signature
 * stays the standard `FastifyPluginAsync` and Fastify can register it
 * without bespoke typing.
 */
export function authRoutes(options: AuthRoutesOptions): FastifyPluginAsync {
  const now = options.now ?? (() => new Date());

  return async function authRoutesPlugin(app: FastifyInstance): Promise<void> {
    if (options.accountRestore === undefined) {
      // Fail-closed gap, not a crash: a pending account cannot sign in or reset until the port is wired.
      app.log.error(
        { event: 'auth.account_restore_port_missing' },
        'auth routes registered without an account restore port; accounts pending deletion cannot sign in',
      );
    }

    app.post('/auth/register', (request, reply) =>
      handleRegister(options, now, request, reply),
    );

    // The login route attaches the email-keyed rate limit (task 13.3)
    // via Fastify's per-route `config.rateLimit` block. The plugin
    // registered by `registerRateLimit` honors this override and, when
    // it is not registered (e.g. in unit tests), the field is silently
    // ignored. The lockout service in `handleLogin` runs *after* this
    // limiter on the request lifecycle, so floods are throttled before
    // they can reach the lockout counter (R6.7 defense-in-depth).
    app.post(
      '/auth/login',
      { config: { rateLimit: loginRateLimitConfig() } },
      (request, reply) => handleLogin(options, now, request, reply),
    );

    app.post(
      '/auth/logout',
      { preHandler: options.requireSession },
      (request, reply) => handleLogout(options, request, reply),
    );

    app.post(
      '/auth/change-password',
      { preHandler: options.requireSession },
      (request, reply) => handleChangePassword(options, request, reply),
    );

    app.get(
      '/me',
      { preHandler: options.requireSession },
      (request, reply) => handleMe(options, request, reply),
    );

    const mailer = options.mailService ?? createMailService({ logger: app.log });
    const resetRepo =
      options.passwordResetRepo ?? createPasswordResetRepo(options.pool);
    const apiPublicUrl =
      options.apiPublicUrl ??
      process.env.API_PUBLIC_URL ??
      'https://dwt-api.onrender.com';

    if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
      app.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_req, body, done) => {
          try {
            const bodyStr = typeof body === 'string' ? body : (body as Buffer).toString('utf-8');
            const parsed = Object.fromEntries(new URLSearchParams(bodyStr));
            done(null, parsed);
          } catch (err: unknown) {
            done(err as Error, undefined);
          }
        },
      );
    }

    app.post(
      '/auth/forgot-password',
      { config: { rateLimit: loginRateLimitConfig() } },
      (request, reply) =>
        handleForgotPassword(resetRepo, mailer, apiPublicUrl, now, request, reply),
    );

    app.post(
      '/auth/reset-password',
      { config: { rateLimit: loginRateLimitConfig() } },
      (request, reply) => handleResetPassword(options, resetRepo, now, request, reply),
    );

    app.get('/auth/reset-password', (request, reply) =>
      handleGetResetPasswordWeb(resetRepo, now, request, reply),
    );

    app.post('/auth/reset-password-web', (request, reply) =>
      handlePostResetPasswordWeb(resetRepo, options.accountRestore, now, request, reply),
    );
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * `POST /auth/register` — create a User, Profile, and a fresh session row in
 * a single transaction. Returns 201 with `{ user, profile, token }`.
 *
 * Validates:
 *   - R6.1: creates account + establishes session within the request.
 *   - R6.2: relies on the citext UNIQUE constraint on `users.email`.
 *   - R6.3: duplicate email → `email_in_use` (409).
 *   - R6.4: Zod validation translates to `validation_failed` with `field`.
 *   - R6.11: only the Argon2id hash is persisted; plaintext leaves the
 *           function on the call to `hashPassword` and is never stored.
 */
async function handleRegister(
  opts: AuthRoutesOptions,
  now: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthSessionResponseDTO> {
  const input = parseInput(registerInputSchema, request.body);

  const passwordHash = await hashPassword(input.password);
  const tokenPair = generateToken();
  const issuedAt = now();
  const absoluteExpiresAt = new Date(issuedAt.getTime() + ABSOLUTE_TTL_MS);

  const client = await opts.pool.connect();
  try {
    await client.query('BEGIN');

    let userId: string;
    let userEmail: string;
    try {
      const userInsert = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email`,
        [input.email, passwordHash],
      );
      const userRow = userInsert.rows[0];
      if (!userRow) {
        // Postgres always returns a row for a successful INSERT...RETURNING;
        // an empty rows array would indicate a driver-level fault.
        throw new AppError(
          'internal_error',
          'User row insertion returned no row.',
        );
      }
      userId = userRow.id;
      userEmail = userRow.email;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // R6.3: Translate the citext UNIQUE constraint on `users.email` to
        // the catalog's dedicated `email_in_use` code (HTTP 409).
        throw new AppError('email_in_use', 'Email already in use.', {
          field: 'email',
          cause: err,
        });
      }
      throw err;
    }

    await client.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, $2)`,
      [userId, input.displayName],
    );

    const sessionInsert = await client.query<{ id: string }>(
      `INSERT INTO sessions (
         user_id, token_hash, created_at, last_seen_at, absolute_expires_at
       ) VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
      [userId, tokenPair.tokenHash, issuedAt, absoluteExpiresAt],
    );
    if (!sessionInsert.rows[0]) {
      throw new AppError(
        'internal_error',
        'Session row insertion returned no row.',
      );
    }

    await client.query('COMMIT');

    reply.code(201);
    return {
      user: { id: userId, email: userEmail },
      profile: { displayName: input.displayName },
      token: tokenPair.token,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Surface the original cause; the rollback failure is already
      // structured-logged by the pool and does not change the user-visible
      // error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `POST /auth/login` — establish a session for valid credentials.
 *
 * Order of operations matters:
 *
 *   1. Look up the User by email (citext, case-insensitive).
 *   2. If a User exists, consult the lockout (R6.7) before doing any
 *      password work. We deliberately do not consult the lockout for an
 *      unknown email — there is no userId to key it on, and revealing
 *      "locked" vs "invalid_credentials" for an unknown email would leak
 *      whether the email exists. Both cases return `invalid_credentials`.
 *   3. Verify the Argon2id hash. On failure, record a lockout failure
 *      (only when a User exists, so attackers cannot lock arbitrary
 *      accounts by guessing emails) and throw `invalid_credentials`.
 *   4. On success, clear the lockout counter (R6.7) and issue a session.
 *
 * Validates:
 *   - R6.5: session establishment with 24-hour absolute TTL at issuance.
 *   - R6.6: invalid credentials → 401 `invalid_credentials`.
 *   - R6.11: verification, never plaintext storage or transmission.
 *
 * R6.7's lockout coordination is delegated to the injected `lockout`
 * service (task 6.4), which owns the Redis key shape and window logic.
 */
async function handleLogin(
  opts: AuthRoutesOptions,
  now: () => Date,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<AuthSessionResponseDTO> {
  const input = parseInput(loginInputSchema, request.body);

  const fetchedRow = await fetchUserForLogin(opts.pool, input.email);

  // One clock read serves the eligibility check, the restore and the session timestamps.
  const issuedAt = now();

  // Account deletion (R4.1, R4.3): an account that is purging, a tombstone, or pending past its date is treated
  // EXACTLY like an unknown email: no lockout call, no password work, the same `invalid_credentials`.
  const eligibility =
    fetchedRow === null
      ? 'ineligible'
      : classifyLoginEligibility(
          {
            state: (fetchedRow.deletion_state ?? 'active') as DeletionState,
            scheduledPurgeAt: fetchedRow.scheduled_purge_at ?? null,
          },
          issuedAt,
        );
  const userRow = eligibility === 'ineligible' ? null : fetchedRow;

  if (userRow !== null) {
    if (await opts.lockout.isLocked(userRow.id)) {
      // R6.7: 5 failures within 15 minutes locks the account for 15 minutes.
      throw new AppError('account_locked', 'Account is temporarily locked.');
    }
  }

  const passwordOk =
    userRow !== null
      ? await verifyPassword(userRow.password_hash, input.password)
      : false;

  if (!passwordOk) {
    if (userRow !== null) {
      await opts.lockout.recordFailure(userRow.id);
    }
    throw new AppError('invalid_credentials', 'Invalid email or password.');
  }

  // userRow is guaranteed non-null here: passwordOk is `false` whenever
  // `userRow === null`, so reaching this branch means we have a row.
  const verifiedUser = userRow!;

  // A correct password on an account pending deletion cancels the deletion (R4.2). The restore happens before the
  // session is minted. Without the port, or when the purge claim won the race, this fails closed exactly like a
  // wrong password (R4.5); the lockout counter is untouched in both cases.
  let restored = false;
  if (eligibility === 'restorable') {
    if (opts.accountRestore === undefined) {
      throw new AppError('invalid_credentials', 'Invalid email or password.');
    }
    const outcome = await opts.accountRestore.restore(verifiedUser.id, issuedAt);
    if (outcome !== 'restored') {
      throw new AppError('invalid_credentials', 'Invalid email or password.');
    }
    restored = true;
  }

  await opts.lockout.clearOnSuccess(verifiedUser.id);

  const tokenPair = generateToken();
  const absoluteExpiresAt = new Date(issuedAt.getTime() + ABSOLUTE_TTL_MS);

  const profile = await fetchProfile(opts.pool, verifiedUser.id);

  await opts.pool.query(
    `INSERT INTO sessions (
       user_id, token_hash, created_at, last_seen_at, absolute_expires_at
     ) VALUES ($1, $2, $3, $3, $4)`,
    [verifiedUser.id, tokenPair.tokenHash, issuedAt, absoluteExpiresAt],
  );

  return {
    user: { id: verifiedUser.id, email: verifiedUser.email },
    profile: { displayName: profile.displayName },
    token: tokenPair.token,
    // Present only as `true`, and only when this call restored the account (R16.6).
    ...(restored ? { accountRestored: true as const } : {}),
  };
}

/**
 * `POST /auth/logout` — revoke the current session row.
 *
 * The `requireSession` pre-handler has already validated the bearer token
 * and authorized the request. We re-derive the token hash from the bearer
 * header and stamp `revoked_at = now()` on the matching session row. The
 * session middleware's `revoked_at IS NULL` guard then rejects every
 * subsequent request bearing the same token with `unauthorized`.
 *
 * Why look the row up by `token_hash` rather than by a session id attached
 * to the request: the middleware exposes only `request.user.id` (and its
 * mirror `request.userId`); it does not surface the session row's primary
 * key. Re-hashing the bearer token here is cheap (one sha256), keeps the
 * routes module independent of the middleware's internal shape, and ensures
 * we revoke exactly the session that authorized this request rather than
 * "any one of the user's sessions".
 *
 * Validates:
 *   - R6.8: logout invalidates the session.
 *   - R6.9: any subsequent request using the revoked token is rejected as
 *           unauthorized — enforced by the middleware reading `revoked_at`.
 */
async function handleLogout(
  opts: AuthRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Treat a missing user id as an internal misconfiguration: the
  // requireSession pre-handler should have set it before this handler runs.
  if (!request.userId) {
    throw new AppError('unauthorized', 'Authentication required.');
  }

  const token = extractBearerToken(request);
  if (token === null) {
    // The pre-handler accepted the request, so this branch is essentially
    // unreachable in production; defending here keeps a misconfigured
    // plugin order from silently 204-ing a request without a token.
    throw new AppError('unauthorized', 'Authentication required.');
  }

  const tokenHashValue = hashToken(token);

  await opts.pool.query(
    `UPDATE sessions
        SET revoked_at = now()
      WHERE token_hash = $1
        AND user_id = $2
        AND revoked_at IS NULL`,
    [tokenHashValue, request.userId],
  );

  // 204 No Content matches the design's "terminate session" semantic — there
  // is no useful body to return. Setting the status explicitly so Fastify's
  // empty-body handling does not fall back to 200.
  reply.code(204);
  reply.send();
}

/**
 * `POST /auth/change-password` — change the caller's password.
 *
 * The `requireSession` pre-handler has already authenticated the request and
 * set `request.userId`. The handler then:
 *
 *   1. Validates the body (`currentPassword`, `newPassword`) against the
 *      shared `changePasswordInputSchema`.
 *   2. Loads the caller's current Argon2id hash and verifies the supplied
 *      `currentPassword` against it. A mismatch returns `invalid_credentials`
 *      (401) — the same code login uses — so a stolen session token alone
 *      cannot rotate the password without also knowing the existing one.
 *   3. Hashes `newPassword` with Argon2id and writes it to
 *      `users.password_hash`.
 *   4. Revokes every *other* session for the user: changing a password is a
 *      credential-rotation event (R6.16), so any session that may have been
 *      opened by an attacker is terminated. The caller's current session is
 *      preserved so they are not logged out of the device they just used to
 *      make the change.
 *
 * Returns 204 No Content on success. The new password never leaves the
 * Argon2id helper and is never logged or returned.
 *
 * Validates: Requirements R6.13, R6.14, R6.15, R6.16.
 */
async function handleChangePassword(
  opts: AuthRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.userId) {
    throw new AppError('unauthorized', 'Authentication required.');
  }

  const input = parseInput(changePasswordInputSchema, request.body);

  const userResult = await opts.pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [request.userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) {
    // The session authenticated but the user no longer exists; treat as
    // unauthorized rather than 500 — the token no longer maps to an account.
    throw new AppError('unauthorized', 'Session is no longer valid.');
  }

  const currentOk = await verifyPassword(
    userRow.password_hash,
    input.currentPassword,
  );
  if (!currentOk) {
    // Same code/shape as a failed login so the wrong-current-password path
    // is indistinguishable from any other credential failure.
    throw new AppError('invalid_credentials', 'Current password is incorrect.');
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  // The bearer token of the session that authorized this request. Used to
  // preserve the current session while revoking every other one.
  const currentToken = extractBearerToken(request);
  const currentTokenHash =
    currentToken !== null ? hashToken(currentToken) : null;

  const client = await opts.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newPasswordHash, request.userId],
    );

    // Revoke all of the user's other live sessions. A password change is a
    // credential-rotation event, so any session opened with the old
    // credentials is terminated; the caller's current session is kept so
    // they are not logged out of the device they just used.
    if (currentTokenHash !== null) {
      await client.query(
        `UPDATE sessions
            SET revoked_at = now()
          WHERE user_id = $1
            AND token_hash <> $2
            AND revoked_at IS NULL`,
        [request.userId, currentTokenHash],
      );
    } else {
      await client.query(
        `UPDATE sessions
            SET revoked_at = now()
          WHERE user_id = $1
            AND revoked_at IS NULL`,
        [request.userId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The rollback failure is structured-logged by the pool; surface the
      // original cause.
    }
    throw err;
  } finally {
    client.release();
  }

  reply.code(204);
  reply.send();
}

interface MeResponseBody {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: {
    readonly displayName: string;
    readonly avatarPreset: string | null;
  };
}

/**
 * `GET /me` — return the caller's User and Profile.
 *
 * Validates: serves R6.12-style read-after-auth and provides the canonical
 * "who am I" endpoint the mobile client uses to confirm a stored session is
 * still valid after launch. The session middleware has already enforced the
 * "valid non-expired authenticated session" precondition.
 */
async function handleMe(
  opts: AuthRoutesOptions,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<MeResponseBody> {
  if (!request.userId) {
    throw new AppError('unauthorized', 'Authentication required.');
  }

  const result = await opts.pool.query<{
    id: string;
    email: string;
    display_name: string;
    avatar_preset: string | null;
  }>(
    `SELECT u.id, u.email, p.display_name, p.avatar_preset
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [request.userId],
  );

  const row = result.rows[0];
  if (!row) {
    // The session middleware accepted the token but the user has been
    // deleted between authentication and the lookup. Treat as unauthorized
    // rather than 500: the token no longer maps to a usable account.
    throw new AppError('unauthorized', 'Session is no longer valid.');
  }

  return {
    user: { id: row.id, email: row.email },
    profile: {
      displayName: row.display_name,
      avatarPreset: row.avatar_preset,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserLoginRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  /** Absent in test doubles that predate account deletion: treated as `'active'`. */
  readonly deletion_state?: string;
  readonly scheduled_purge_at?: Date | null;
}

/**
 * `POST /auth/forgot-password` — initiate password reset flow.
 *
 * Anti-enumeration defense (R1.3): Always returns HTTP 200 with an identical
 * message, whether the user exists or not.
 */
async function handleForgotPassword(
  repo: PasswordResetRepo,
  mailer: MailService,
  apiPublicUrl: string,
  now: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ForgotPasswordResponseDTO> {
  const input = parseInput(forgotPasswordInputSchema, request.body);

  // The eligibility boundary uses the application clock (one clock for lookup and restore).
  const user = await repo.findUserByEmail(input.email, now());
  if (user) {
    const code = String(randomInt(100000, 1000000));
    const webToken = randomBytes(24).toString('base64url');

    const codeHash = createHash('sha256').update(code).digest('hex');
    const tokenHash = createHash('sha256').update(webToken).digest('hex');

    const expiresAt = new Date(now().getTime() + 15 * 60 * 1000);
    await repo.createResetRecord(user.id, codeHash, tokenHash, expiresAt);

    const resetUrl = `${apiPublicUrl}/auth/reset-password?token=${encodeURIComponent(webToken)}`;
    try {
      await mailer.sendPasswordReset({ to: user.email, code, resetUrl });
    } catch (err) {
      request.log.error(
        { err, recipient: user.email },
        'Failed to deliver password reset email',
      );
    }
  }

  reply.code(200);
  return {
    message: 'If an account exists with this email, a reset code has been sent.',
  };
}

/**
 * `POST /auth/reset-password` — complete reset using 6-digit verification code.
 *
 * Validates code, updates password with Argon2id, revokes existing sessions,
 * establishes a fresh session, and returns auth token directly (R2.1, R2.2).
 */
async function handleResetPassword(
  opts: AuthRoutesOptions,
  repo: PasswordResetRepo,
  now: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ResetPasswordSuccessDTO> {
  const input = parseInput(resetPasswordInputSchema, request.body);
  const codeHash = createHash('sha256').update(input.code).digest('hex');

  // The same clock value feeds the eligibility lookup and `restoreInTx`, so the two predicates cannot disagree
  // on the `scheduled_purge_at` boundary (account-deletion R4.11).
  const resetAt = now();
  const record = await repo.findActiveByEmail(input.email, resetAt);
  if (!record) {
    throw new AppError('invalid_code', 'Invalid or expired verification code.');
  }

  if (record.attempts >= 5) {
    await repo.invalidateRecord(record.id);
    throw new AppError(
      'too_many_attempts',
      'Too many failed verification attempts. Please request a new code.',
    );
  }

  if (record.codeHash !== codeHash) {
    const attempts = await repo.incrementAttempts(record.id);
    if (attempts >= 5) {
      await repo.invalidateRecord(record.id);
      throw new AppError(
        'too_many_attempts',
        'Too many failed verification attempts. Please request a new code.',
      );
    }
    throw new AppError('invalid_code', 'Invalid or expired verification code.');
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  const restorePort = opts.accountRestore;
  const outcome = await repo.completeReset(
    record.id,
    record.userId,
    newPasswordHash,
    restorePort !== undefined
      ? { restoreInTx: (client) => restorePort.restoreInTx(client, record.userId, resetAt) }
      : undefined,
  );
  if (outcome === 'restore_lost') {
    // The purge claim won the race: nothing changed, the code is not consumed (R4.11).
    throw new AppError('invalid_code', 'Invalid or expired verification code.');
  }
  const restored = outcome === 'restored';
  if (restored && restorePort !== undefined) {
    await notifyRestoredBestEffort(restorePort, record.userId, request);
  }

  // Clear any lockout state
  await opts.lockout.clearOnSuccess(record.userId);

  // Mint fresh session for immediate login
  const tokenPair = generateToken();
  const issuedAt = now();
  const absoluteExpiresAt = new Date(issuedAt.getTime() + ABSOLUTE_TTL_MS);

  await opts.pool.query(
    `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
     VALUES ($1, $2, $3, $3, $4)`,
    [record.userId, tokenPair.tokenHash, issuedAt, absoluteExpiresAt],
  );

  const profile = await fetchProfile(opts.pool, record.userId);

  reply.code(200);
  return {
    user: { id: record.userId, email: record.userEmail },
    profile: { displayName: profile.displayName },
    token: tokenPair.token,
    ...(restored ? { accountRestored: true as const } : {}),
  };
}

/**
 * The "deletion cancelled" email goes out after the reset transaction committed and must never fail the reset.
 * The log line carries no address and no user id.
 */
async function notifyRestoredBestEffort(
  port: AccountRestorePort,
  userId: string,
  request: FastifyRequest,
): Promise<void> {
  try {
    await port.notifyRestored(userId);
  } catch (err) {
    request.log.warn(
      { event: 'auth.restore_notify_failed', error: err instanceof Error ? err.name : 'unknown' },
      'account restored but the confirmation email could not be sent',
    );
  }
}

/**
 * `GET /auth/reset-password` — render web fallback reset form.
 */
async function handleGetResetPasswordWeb(
  repo: PasswordResetRepo,
  now: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = request.query as { token?: string };
  const token = typeof query.token === 'string' ? query.token.trim() : '';

  if (!token) {
    reply.type('text/html').code(400);
    reply.send(
      renderWebMessageHtml(
        'Invalid Request',
        'No reset token was provided. Please request a new link in the Disney World Tracker app.',
        true,
      ),
    );
    return;
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await repo.findActiveByToken(tokenHash, now());

  if (!record) {
    reply.type('text/html').code(400);
    reply.send(
      renderWebMessageHtml(
        'Link Expired or Invalid',
        'This password reset link is invalid or has expired. Please open the Disney World Tracker app and request a new code.',
        true,
      ),
    );
    return;
  }

  reply.type('text/html').code(200);
  reply.send(renderWebResetFormHtml(token));
}

/**
 * `POST /auth/reset-password-web` — handle web fallback form submission.
 */
async function handlePostResetPasswordWeb(
  repo: PasswordResetRepo,
  accountRestore: AccountRestorePort | undefined,
  now: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword =
    typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (!token) {
    reply.type('text/html').code(400);
    reply.send(
      renderWebMessageHtml(
        'Invalid Request',
        'Missing reset token. Please request a new link.',
        true,
      ),
    );
    return;
  }

  // One clock value for the eligibility lookup and `restoreInTx` (account-deletion R4.11).
  const resetAt = now();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await repo.findActiveByToken(tokenHash, resetAt);

  if (!record) {
    reply.type('text/html').code(400);
    reply.send(
      renderWebMessageHtml(
        'Link Expired or Invalid',
        'This password reset link is invalid or has expired. Please open the Disney World Tracker app and request a new code.',
        true,
      ),
    );
    return;
  }

  if (password.length < 8 || password.length > 128) {
    reply.type('text/html').code(400);
    reply.send(
      renderWebResetFormHtml(
        token,
        'Password must be between 8 and 128 characters.',
      ),
    );
    return;
  }

  if (password !== confirmPassword) {
    reply.type('text/html').code(400);
    reply.send(renderWebResetFormHtml(token, 'Passwords do not match.'));
    return;
  }

  const newPasswordHash = await hashPassword(password);
  const outcome = await repo.completeReset(
    record.id,
    record.userId,
    newPasswordHash,
    accountRestore !== undefined
      ? { restoreInTx: (client) => accountRestore.restoreInTx(client, record.userId, resetAt) }
      : undefined,
  );

  if (outcome === 'restore_lost') {
    // The purge claim won the race: nothing changed and the code was not consumed. Same page as an invalid link.
    reply.type('text/html').code(400);
    reply.send(
      renderWebMessageHtml(
        'Link Expired or Invalid',
        'This password reset link is invalid or has expired. Please open the Disney World Tracker app and request a new code.',
        true,
      ),
    );
    return;
  }

  if (outcome === 'restored' && accountRestore !== undefined) {
    await notifyRestoredBestEffort(accountRestore, record.userId, request);
    reply.type('text/html').code(200);
    reply.send(
      renderWebMessageHtml(
        'Password Updated and Account Restored',
        'Your password has been reset and your scheduled account deletion was cancelled, so your account has been restored. You can now return to the Disney World Tracker app and sign in with your new password.',
        false,
      ),
    );
    return;
  }

  reply.type('text/html').code(200);
  reply.send(
    renderWebMessageHtml(
      'Password Updated!',
      'Your password has been successfully reset. You can now return to the Disney World Tracker app and sign in with your new password.',
      false,
    ),
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderWebResetFormHtml(token: string, errorMessage?: string): string {
  const errorAlert = errorMessage
    ? `<div style="background-color: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 20px;">${escapeHtml(errorMessage)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password | Disney World Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 32px 16px; }
    .card { max-width: 440px; margin: 40px auto; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { text-align: center; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; outline: none; }
    input[type="password"]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
    .btn { width: 100%; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; border: none; padding: 14px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .btn:hover { opacity: 0.95; }
    .hint { font-size: 12px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="title">Choose a New Password</h1>
      <p class="subtitle">Disney World Tracker</p>
    </div>
    ${errorAlert}
    <form method="POST" action="/auth/reset-password-web">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <div class="field">
        <label for="password">New Password</label>
        <input type="password" id="password" name="password" required minlength="8" maxlength="128" placeholder="At least 8 characters" />
        <div class="hint">Minimum 8 characters</div>
      </div>
      <div class="field">
        <label for="confirmPassword">Confirm New Password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" required minlength="8" maxlength="128" placeholder="Repeat your new password" />
      </div>
      <button type="submit" class="btn">Update Password</button>
    </form>
  </div>
</body>
</html>`;
}

function renderWebMessageHtml(
  title: string,
  message: string,
  isError: boolean,
): string {
  const iconColor = isError ? '#ef4444' : '#10b981';
  const iconSvg = isError
    ? `<svg width="48" height="48" fill="none" stroke="${iconColor}" viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg width="48" height="48" fill="none" stroke="${iconColor}" viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Disney World Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 32px 16px; }
    .card { max-width: 440px; margin: 40px auto; background: #ffffff; border-radius: 16px; padding: 40px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; text-align: center; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 16px 0 8px 0; }
    .message { font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div>${iconSvg}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="message">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}


/**
 * Look up a User by email for login. Returns `null` rather than throwing on
 * "not found" so the caller can fold it into the `verify-then-decide`
 * branch above and avoid leaking existence through error shapes.
 */
async function fetchUserForLogin(
  pool: DbPool,
  email: string,
): Promise<UserLoginRow | null> {
  const result = await pool.query<UserLoginRow>(
    `SELECT id, email, password_hash, deletion_state, scheduled_purge_at
       FROM users
      WHERE email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

interface ProfileLookupRow {
  readonly displayName: string;
}

async function fetchProfile(
  pool: DbPool,
  userId: string,
): Promise<ProfileLookupRow> {
  const result = await pool.query<{ display_name: string }>(
    `SELECT display_name
       FROM profiles
      WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    // Registration always inserts profiles in the same transaction as the
    // user row, so a missing profile is a data-integrity bug, not a normal
    // error. Surface as `internal_error` rather than 404.
    throw new AppError('internal_error', 'Profile is missing for user.');
  }
  return { displayName: row.display_name };
}

/**
 * Parse `Authorization: Bearer <token>`. Mirrors the helper in
 * `sessionMiddleware.ts` (intentionally duplicated here to keep this module
 * independent of the middleware's internal helpers and to dodge an import
 * cycle).
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(raw);
  if (!match) {
    return null;
  }
  const token = (match[1] ?? '').trim();
  return token.length > 0 ? token : null;
}

/**
 * Run a Zod schema against `body` and translate any `ZodError` into an
 * `AppError`. The shared schemas embed specific error codes in the issue
 * `message` field where appropriate (e.g. `display_name_invalid`); any other
 * message collapses to the catch-all `validation_failed` code. The first
 * issue's path becomes the envelope's `field` so the client can highlight
 * the offending input (R6.4).
 */
function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  try {
    return schema.parse(body) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'Invalid request body.';
  const code: ErrorCode =
    VALIDATION_MESSAGE_TO_CODE[rawMessage] ?? 'validation_failed';
  const humanMessage =
    code === 'display_name_invalid'
      ? 'Display name must be 1-50 characters and contain at least one non-whitespace character.'
      : `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, humanMessage, { field })
    : new AppError(code, humanMessage);
}

/**
 * Detect a Postgres `unique_violation` (SQLSTATE 23505) without depending on
 * the `pg` package's exported error type at compile time. The `code` property
 * is the stable signal across `pg` versions.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
