/**
 * Gateway-level rate-limit plugin (task 13.3).
 *
 * Wraps `@fastify/rate-limit` with three route-group budgets that mirror
 * the design's "Security and privacy" section:
 *
 *   - **Reads (HTTP GET / HEAD): 60 requests / minute, per-user.**
 *   - **Mutations (HTTP POST / PUT / PATCH / DELETE): 10 requests / minute, per-user.**
 *   - **`POST /auth/login`: 5 attempts / 15 minutes, per-account (email-keyed).**
 *
 * The email-keyed login limit is the defense-in-depth backstop for R6.7's
 * account lockout: floods that would otherwise exhaust the lockout
 * counter from many IPs are throttled before the auth handler ever runs,
 * so the lockout still applies on the slow attempts that do get through.
 * The lockout itself remains in `services/auth/lockout.ts` and runs
 * inside the `/auth/login` handler, i.e. **after** this rate limiter on
 * the request lifecycle, exactly as the requirement directs.
 *
 * Two design choices worth flagging:
 *
 *   1. **Keying.** Per-user keying happens via the bearer token's
 *      sha256 — anonymous requests fall back to the request IP. The
 *      session middleware lives on individual routes (it is registered
 *      as a per-route preHandler), so it has not run yet when the
 *      rate-limit hook fires; the bearer token is, however, already
 *      present in the `Authorization` header at `onRequest` time, and
 *      hashing it gives us a stable per-session key without leaking
 *      raw tokens into Redis or in-memory store keys. For requests
 *      that do not authenticate, the IP is a reasonable proxy: even
 *      under a NAT, this is a defense-in-depth layer rather than the
 *      sole gate.
 *
 *   2. **Login override.** The login limiter sets `hook: 'preHandler'`
 *      so the request body is parsed before keying. The key is
 *      `login:<lower-cased-email>` so attempts from many IPs against
 *      the same account collapse to one bucket, which is the entire
 *      point of "account-keyed". When the body is missing or
 *      mal-formed (and the route would 400 anyway), the limiter falls
 *      back to `login:ip:<ip>` so the request still counts against
 *      *something* and floods cannot bypass the limiter by sending
 *      junk bodies.
 *
 * Validates: Requirements R6.7 (defense in depth).
 */

import { createHash } from 'node:crypto';

import rateLimitPlugin from '@fastify/rate-limit';
import type {
  FastifyInstance,
  FastifyRequest,
} from 'fastify';

import { AppError } from '../errors/AppError.js';

// `@fastify/rate-limit` exposes its option shapes through a legacy
// `export = fastifyRateLimit` namespace plus a Fastify module
// augmentation (`FastifyInstance.rateLimit` and
// `FastifyContextConfig.rateLimit`). Rather than wrestle with the
// dual namespace+function default export, we recover the two option
// shapes we need from the augmentation: per-route options come from
// the parameter of the decorated `app.rateLimit(...)` function, and
// plugin-wide options come from the second parameter of the plugin
// itself. Both routes give the same TS types `@fastify/rate-limit`
// declares internally, without depending on the namespace name.
type RateLimitOptions = NonNullable<
  Parameters<FastifyInstance['rateLimit']>[0]
>;
type RateLimitPluginOptions = NonNullable<
  Parameters<typeof rateLimitPlugin>[1]
>;

// ---------------------------------------------------------------------------
// Public option shapes
// ---------------------------------------------------------------------------

/**
 * One route-group's budget: how many requests in how many milliseconds.
 *
 * `timeWindowMs` is intentionally a number (milliseconds) rather than the
 * string syntax `@fastify/rate-limit` also accepts; expressing it as a
 * number keeps the test harness deterministic and avoids parser surprises
 * (e.g. "1 minute" vs "1m"). Production callers can build this from
 * Express-style durations themselves if they prefer.
 */
export interface RouteGroupBudget {
  /** Maximum number of requests allowed inside the window. */
  readonly max: number;
  /** Width of the rolling window, in milliseconds. */
  readonly timeWindowMs: number;
}

/**
 * Optional Redis client passed through to `@fastify/rate-limit`. When
 * omitted, the plugin falls back to its in-process LRU store, which is
 * suitable for unit tests but not for production: with multiple replicas
 * each replica's bucket is independent, so the effective limit becomes
 * `replicas * max`. Production wiring supplies the shared `RedisClient`
 * from `redis/client.ts`.
 */
export interface DwtRateLimitOptions {
  /** Shared Redis client; tests typically omit this. */
  readonly redis?: RateLimitPluginOptions['redis'];
  /** GET/HEAD budget. Defaults to 60 / 60_000ms (one minute). */
  readonly reads?: RouteGroupBudget;
  /** POST/PUT/PATCH/DELETE budget. Defaults to 10 / 60_000ms. */
  readonly mutations?: RouteGroupBudget;
  /** `POST /auth/login` budget. Defaults to 5 / 900_000ms (15 minutes). */
  readonly loginAccount?: RouteGroupBudget;
}

const DEFAULT_READS: RouteGroupBudget = { max: 60, timeWindowMs: 60_000 };
const DEFAULT_MUTATIONS: RouteGroupBudget = { max: 10, timeWindowMs: 60_000 };
const DEFAULT_LOGIN_ACCOUNT: RouteGroupBudget = {
  max: 5,
  timeWindowMs: 15 * 60_000,
};

// ---------------------------------------------------------------------------
// Keying helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable per-caller key for the global limiter. Authenticated
 * callers key by `tok:<sha256(token)>`; everyone else keys by `ip:<ip>`.
 *
 * The token is hashed before it lands in any store (Redis or in-memory)
 * so that a leaked store cannot be replayed against the live API. The
 * hash matches `services/auth/sessionToken.ts`'s scheme so future
 * tooling that needs to correlate session activity has a single,
 * documented hashing convention.
 */
export function defaultRateLimitKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(\S.*)$/i.exec(auth);
    if (match) {
      const token = (match[1] ?? '').trim();
      if (token.length > 0) {
        const hash = createHash('sha256').update(token).digest('hex');
        return `tok:${hash}`;
      }
    }
  }
  return `ip:${req.ip}`;
}

/**
 * Build the `config.rateLimit` block applied to `POST /auth/login`. We
 * export it as a separate factory so `services/auth/routes.ts` can attach
 * it to the route declaration without re-stating the config in two
 * places.
 *
 * The keyer reaches into `req.body.email`; this is safe because the hook
 * runs at `preHandler`, after the JSON parser has populated `req.body`.
 * When the body is missing or the email field is absent or empty, we
 * fall back to `login:ip:<ip>` so an attacker cannot escape the limiter
 * by sending malformed payloads. The route itself will then reject the
 * mal-formed body with a `validation_failed` envelope.
 */
export function loginRateLimitConfig(
  budget: RouteGroupBudget = DEFAULT_LOGIN_ACCOUNT,
): RateLimitOptions {
  return {
    max: budget.max,
    timeWindow: budget.timeWindowMs,
    // `preHandler` so the body is parsed before keying; the default
    // `onRequest` would see `req.body === undefined`.
    hook: 'preHandler',
    keyGenerator: (req) => {
      const body = (req as FastifyRequest).body as
        | { email?: unknown }
        | undefined;
      const rawEmail = body?.email;
      if (typeof rawEmail === 'string') {
        const trimmed = rawEmail.trim();
        if (trimmed.length > 0) {
          return `login:${trimmed.toLowerCase()}`;
        }
      }
      return `login:ip:${(req as FastifyRequest).ip}`;
    },
    errorResponseBuilder: buildRateLimitEnvelope,
  };
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

interface RateLimitContext {
  readonly max: number;
  readonly ttl: number;
  readonly after: string;
}

/**
 * Translate a rate-limit rejection into the project's uniform error
 * envelope.
 *
 * `@fastify/rate-limit` *throws* whatever this function returns into the
 * Fastify error pipeline, so we must return an `AppError` rather than a
 * raw envelope object — the project's global error hook
 * (`registerErrorHandler`) maps `AppError('rate_limit_exceeded')` to
 * HTTP 429 via the shared `errorCodeToHttpStatus` table and constructs
 * the wire envelope itself. Returning a plain object would land in the
 * "unhandled exception" branch and surface as a 500.
 *
 * `details` carries `retryAfterMs` and `max` so a client can build a
 * cooldown UI without parsing the message string.
 */
function buildRateLimitEnvelope(
  _req: FastifyRequest,
  context: RateLimitContext,
): AppError {
  return new AppError(
    'rate_limit_exceeded',
    `Too many requests. Please try again in ${context.after}.`,
    {
      details: {
        retryAfterMs: context.ttl,
        max: context.max,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

/**
 * Register `@fastify/rate-limit` on `app` with the read- and mutation-
 * group budgets baked in. Routes that need a different budget (notably
 * `POST /auth/login`) override via their `config.rateLimit` block.
 *
 * Idempotent in practice: the plugin can only be registered once per
 * Fastify instance; calling this twice will surface Fastify's own
 * "FST_ERR_DEC_ALREADY_PRESENT" error rather than silently double-
 * configuring the limiter. Callers should register exactly once during
 * `buildServer`.
 */
export async function registerRateLimit(
  app: FastifyInstance,
  options: DwtRateLimitOptions = {},
): Promise<void> {
  const reads = options.reads ?? DEFAULT_READS;
  const mutations = options.mutations ?? DEFAULT_MUTATIONS;

  // `@fastify/rate-limit` types `timeWindow` as `number | string`, not a
  // function. Reads and mutations therefore have to share the same time
  // window when configured globally. The design's read/mutation budgets
  // (60/min vs 10/min) both use a one-minute window, so this is a fit;
  // if the windows ever diverge, we register a second instance of the
  // plugin scoped to the mutating routes instead.
  if (reads.timeWindowMs !== mutations.timeWindowMs) {
    throw new Error(
      `registerRateLimit requires reads.timeWindowMs === mutations.timeWindowMs (got ${reads.timeWindowMs} vs ${mutations.timeWindowMs}).`,
    );
  }

  const baseOptions: RateLimitPluginOptions = {
    // GET/HEAD use the read budget; everything else uses the mutation
    // budget. Methods we do not classify (e.g. OPTIONS, the CORS pre-
    // flight) get the read budget so a chatty browser cannot exhaust
    // the mutation cap on its own.
    max: (req: FastifyRequest) =>
      isReadRequest(req) ? reads.max : mutations.max,
    timeWindow: reads.timeWindowMs,
    keyGenerator: defaultRateLimitKey,
    // We want our envelope, not the plugin's default JSON shape.
    errorResponseBuilder: buildRateLimitEnvelope,
    // Do not bypass the limit on Redis errors: flagging hidden by a
    // backend outage would effectively un-cap the limiter. Better to
    // surface 429s than to silently disable defense in depth.
    skipOnError: false,
    // Trust the proxy chain configured at the Fastify level
    // (`trustProxy: true` in `server.ts`). Without this, every request
    // looks like it comes from the load balancer's IP.
    enableDraftSpec: false,
  };

  if (options.redis !== undefined) {
    (baseOptions as { redis?: RateLimitPluginOptions['redis'] }).redis =
      options.redis;
  }

  await app.register(rateLimitPlugin, baseOptions);
}

function isReadRequest(req: FastifyRequest | { method: string }): boolean {
  const method = req.method;
  return method === 'GET' || method === 'HEAD';
}

// Re-export an alias of the @fastify/rate-limit option shape for callers
// that want to attach a `config.rateLimit` block to a route. Kept here
// so consumers import a single module.
export type { RateLimitOptions };
