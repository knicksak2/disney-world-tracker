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

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, type z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import { loginInputSchema, registerInputSchema } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { loginRateLimitConfig } from '../../plugins/rateLimit.js';
import { hash as hashPassword, verify as verifyPassword } from './password.js';
import { generateToken, hashToken } from './sessionToken.js';
import type { LockoutService } from './lockout.js';

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

    app.get(
      '/me',
      { preHandler: options.requireSession },
      (request, reply) => handleMe(options, request, reply),
    );
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

interface AuthSuccessBody {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: { readonly displayName: string };
  readonly token: string;
}

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
): Promise<AuthSuccessBody> {
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
): Promise<AuthSuccessBody> {
  const input = parseInput(loginInputSchema, request.body);

  const userRow = await fetchUserForLogin(opts.pool, input.email);

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

  await opts.lockout.clearOnSuccess(verifiedUser.id);

  const tokenPair = generateToken();
  const issuedAt = now();
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

interface MeResponseBody {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: { readonly displayName: string };
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
  }>(
    `SELECT u.id, u.email, p.display_name
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
    profile: { displayName: row.display_name },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserLoginRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
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
    `SELECT id, email, password_hash
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
