/**
 * Session lifecycle middleware (task 6.2).
 *
 * Exports a Fastify `preHandler` factory that authorizes a request by
 * resolving the bearer session token, looking up the corresponding row
 * in `sessions` by `token_hash`, and enforcing the lifecycle rules
 * defined in design.md "Auth_Service → Session lifecycle":
 *
 *   1. The header `Authorization: Bearer <token>` must be present and
 *      well-formed; otherwise the request is rejected with the
 *      `unauthorized` error code (R6.10, R6.12).
 *   2. The session row must exist and have `revoked_at IS NULL`
 *      (R6.8 logout, R6.9 administrative termination).
 *   3. The current time must be strictly less than
 *      `absolute_expires_at`, the end of the current 24-hour
 *      continuous-activity burst (R6.5).
 *   4. The idle gap `now − last_seen_at` must be strictly less than
 *      30 days (R6.5).
 *   5. When the idle gap is `>= 30 minutes`, the prior burst is
 *      considered closed and a new 24-hour window starts: the
 *      middleware advances `absolute_expires_at` to `now + 24h`. This
 *      is the implementation of "24 hours of continuous activity" from
 *      design.md: as long as activity stays within 30-minute hops, the
 *      original burst window is preserved; a longer nap ends that burst
 *      and, on the next request, starts a fresh one.
 *   6. `last_seen_at` is updated to `now` on every authorized request.
 *   7. `request.user` is set to `{ id: userId }` and `request.userId`
 *      is mirrored as a string. Both are exposed through Fastify
 *      module augmentation below so handlers (e.g. profileRoutes from
 *      task 6.5) can read the requester id with full type safety.
 *
 * Design choices and trade-offs:
 *
 *   - **Dependency injection over module-level singletons.** The DB
 *     adapter, the token hasher, and the clock are all injected via
 *     `SessionMiddlewareOptions`. This keeps the middleware unit-
 *     testable without standing up Postgres, and lets the property
 *     test (task 6.8) drive a `fast-check` `commands` simulation
 *     against an injected clock as the design specifies. The `clock`
 *     parameter defaults to `() => new Date()`; the others are
 *     required so that callers cannot accidentally bypass them.
 *
 *   - **`hashToken` is an injected dependency, not a module-level
 *     import from `sessionToken.ts`.** The task brief identifies
 *     `sessionToken.ts` (task 6.1) as the canonical source of the
 *     hash function, but the middleware itself never needs to know
 *     where the hash comes from — only that it is the same SHA-256
 *     hash used by session creation. Wiring it in at the call site
 *     (in `routes.ts`, task 6.3) keeps the dependency arrow simple
 *     and avoids a coupling between two tasks that are still in
 *     parallel flight.
 *
 *   - **Single update statement on the happy path.** The middleware
 *     sends one `UPDATE sessions ...` per authorized request,
 *     refreshing `last_seen_at` and (only when the burst rolled
 *     over) `absolute_expires_at`. We do not gate this update on a
 *     change-detection check because writing the same value twice
 *     is harmless and the read-modify-write would otherwise race the
 *     session row across concurrent requests.
 *
 *   - **All rejections collapse to one error code.** Per R6.10 and
 *     R6.12, every distinguishable session-failure mode (missing
 *     header, malformed header, no matching row, revoked, expired,
 *     idle, etc.) produces the same `unauthorized` envelope. We do
 *     not leak which check tripped because that information could
 *     help an attacker probe valid token hashes.
 *
 * Validates: Requirements R6.5, R6.8, R6.9, R6.10, R6.12.
 */

import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';

import { AppError } from '../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Public time-window constants
// ---------------------------------------------------------------------------
//
// These are exported so the property test (task 6.8) and any future
// integration tests can refer to the same constants the middleware uses,
// rather than redeclaring the durations and risking drift.

/** 30 days, expressed as milliseconds; the idle session expiration window. */
export const SESSION_IDLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 30 minutes, expressed as milliseconds. An idle gap at or above this
 * threshold closes the current 24-hour continuous-activity burst.
 */
export const SESSION_BURST_GAP_MS = 30 * 60 * 1000;

/**
 * 24 hours, expressed as milliseconds. The width of a continuous-activity
 * burst from the time it begins.
 */
export const SESSION_BURST_DURATION_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module augmentation: typed `request.user` / `request.userId`
// ---------------------------------------------------------------------------
//
// `request.userId` is also declared in `profileRoutes.ts` (task 6.5);
// declaration merging combines the two into a single optional `string`
// property. We add `request.user` here as the canonical authenticated
// principal object; handlers can use whichever form is more convenient.

/**
 * The authenticated principal attached to an authorized request. Limited
 * to the user id for now; future fields (scopes, role) would be added
 * here.
 */
export interface AuthenticatedUser {
  readonly id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated principal set by `createSessionMiddleware`. */
    user?: AuthenticatedUser;
    /**
     * Convenience mirror of `user.id`, kept for compatibility with
     * existing handlers (notably `profileRoutes.ts`) that read
     * `request.userId` directly.
     */
    userId?: string;
  }
}

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------
//
// The middleware never touches `pg` directly: it talks to a small adapter
// interface that the route layer constructs from the real pool. Tests
// substitute an in-memory implementation. The shape mirrors the columns
// declared in `migrations/0001_init.sql` for `sessions`.

/**
 * Snapshot of a `sessions` row needed to evaluate the lifecycle rules.
 * Field names match the DB column names (snake_case) so callers can
 * forward query rows verbatim without remapping.
 */
export interface SessionRow {
  /** Primary key of the session row, used to scope the activity update. */
  readonly id: string;
  /** Owning user; written into `request.user.id` on success. */
  readonly user_id: string;
  /** End of the current 24-hour continuous-activity burst. */
  readonly absolute_expires_at: Date;
  /** Last time this session was used to authorize a request. */
  readonly last_seen_at: Date;
  /** Non-null when the session has been revoked (logout / lockout / admin). */
  readonly revoked_at: Date | null;
}

/**
 * Persistence adapter used by the middleware. The two methods are split
 * so the read path can be served from a read replica or a prepared
 * statement, while the activity update is a focused single-row UPDATE.
 */
export interface SessionDbAdapter {
  /**
   * Look up the session row whose `token_hash` matches the supplied hash
   * exactly. Returns `null` when no row matches; the middleware
   * translates that into an `unauthorized` error so that callers cannot
   * distinguish "no session" from "wrong token" by response shape.
   */
  findByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  /**
   * Refresh activity bookkeeping for a session: set `last_seen_at` to
   * `now` and `absolute_expires_at` to the supplied value. The middleware
   * always passes a value for `absoluteExpiresAt`, even when it has not
   * changed in this request, so the implementation can use a single
   * parameter list.
   */
  updateActivity(
    sessionId: string,
    now: Date,
    absoluteExpiresAt: Date,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Construction options for `createSessionMiddleware`.
 */
export interface SessionMiddlewareOptions {
  /** Persistence adapter for the `sessions` table. */
  readonly db: SessionDbAdapter;
  /**
   * SHA-256 (or otherwise injection-stable) hash of the bearer token.
   * Must match the function used by `sessionToken.ts` (task 6.1) when
   * persisting new sessions, because the middleware looks rows up by
   * the hash, not the token itself.
   */
  readonly hashToken: (token: string) => string;
  /**
   * Clock used to evaluate lifecycle windows. Defaults to
   * `() => new Date()`; tests inject a stubbed clock to drive the
   * commands-style property test deterministically.
   */
  readonly clock?: () => Date;
}

/**
 * Build a Fastify `preHandler` that enforces the session lifecycle rules
 * documented at the top of this file. The returned hook is safe to
 * register at the route, plugin, or app scope.
 *
 * On success, the hook resolves silently; the request body proceeds to
 * the next handler with `request.user` populated. On any failure, it
 * throws `AppError('unauthorized', ...)`, which the global error hook
 * (`registerErrorHandler`) translates into a 401 envelope.
 */
export function createSessionMiddleware(
  opts: SessionMiddlewareOptions,
): preHandlerAsyncHookHandler {
  const clock = opts.clock ?? defaultClock;
  const { db, hashToken } = opts;

  return async function sessionMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    // 1) Pull the bearer token. A missing or malformed header is an
    //    immediate `unauthorized`; we deliberately do not record any
    //    detail in the error message to avoid leaking probe results.
    const token = extractBearerToken(request);
    if (token === null) {
      throw unauthorizedError();
    }

    // 2) Hash the token and look up the row. The token itself never
    //    leaves this stack frame.
    const tokenHash = hashToken(token);
    const session = await db.findByTokenHash(tokenHash);
    if (session === null) {
      throw unauthorizedError();
    }

    const now = clock();
    const nowMs = now.getTime();

    // 3) Revoked sessions are rejected unconditionally (R6.8, R6.9).
    if (session.revoked_at !== null) {
      throw unauthorizedError();
    }

    // 4) The current burst window must not have ended (R6.5: "24 hours
    //    of continuous activity"). Boundary semantics: at `nowMs ===
    //    absolute_expires_at` the window has elapsed and the session
    //    is rejected.
    if (nowMs >= session.absolute_expires_at.getTime()) {
      throw unauthorizedError();
    }

    // 5) Idle window: the user must have used the session within the
    //    last 30 days (R6.5: "30 days of inactivity"). The comparison
    //    is again at-or-over: a gap exactly equal to 30 days expires
    //    the session.
    const idleGapMs = nowMs - session.last_seen_at.getTime();
    if (idleGapMs >= SESSION_IDLE_WINDOW_MS) {
      throw unauthorizedError();
    }

    // 6) Burst rollover. A 30-minute or longer idle gap closes the
    //    current burst; the next request opens a new 24-hour window.
    //    Inside a burst, `absolute_expires_at` is preserved exactly so
    //    that genuine 24-hour-continuous use does end the session as
    //    R6.5 requires.
    let absoluteExpiresAt = session.absolute_expires_at;
    if (idleGapMs >= SESSION_BURST_GAP_MS) {
      absoluteExpiresAt = new Date(nowMs + SESSION_BURST_DURATION_MS);
    }

    // 7) Persist activity update. Even when `absoluteExpiresAt` has not
    //    changed, we still send it — the SQL is parameterized either
    //    way and the adapter is free to short-circuit if it wants.
    await db.updateActivity(session.id, now, absoluteExpiresAt);

    // 8) Hand the principal off to downstream handlers.
    request.user = { id: session.user_id };
    request.userId = session.user_id;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default clock; broken out so tests can assert that the override path
 * is taken when an explicit `clock` is supplied.
 */
function defaultClock(): Date {
  return new Date();
}

/**
 * Parse `Authorization: Bearer <token>` from a Fastify request. Returns
 * the raw token string, or `null` when:
 *   - the header is missing,
 *   - the header is present more than once (Fastify exposes that as an
 *     array; multiple credentials on a single request are inherently
 *     ambiguous and we refuse to disambiguate),
 *   - the scheme is anything other than `Bearer` (case-insensitive),
 *   - the token portion is empty after trimming.
 *
 * The match is anchored to ensure we never accept a partial header that
 * happens to contain the literal "Bearer" elsewhere in the value.
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string') {
    return null;
  }
  // Case-insensitive scheme; one or more whitespace characters between
  // scheme and credentials per RFC 7235 §2.1.
  const match = /^Bearer\s+(\S.*)$/i.exec(raw);
  if (!match) {
    return null;
  }
  const token = (match[1] ?? '').trim();
  return token.length > 0 ? token : null;
}

/**
 * Centralized constructor for the lifecycle-rejection error. Using a
 * single builder keeps the message identical across every failure mode
 * so callers and tests can match on a stable string.
 */
function unauthorizedError(): AppError {
  return new AppError('unauthorized', 'Authentication is required.');
}
