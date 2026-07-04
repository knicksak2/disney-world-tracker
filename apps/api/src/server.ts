/**
 * Fastify server factory.
 *
 * `buildServer(config, services?)` returns a configured but unbound Fastify
 * instance: routes and plugins are registered, but the server is not
 * listening yet. The production entrypoint in `index.ts` is responsible
 * for the `listen()` call. Tests can call `buildServer` and use
 * `app.inject()` without ever opening a network port.
 *
 * Per design.md "Request Lifecycle", subsequent tasks layer additional
 * concerns onto this skeleton (auth middleware, additional service
 * routes, rate limiting). Each service is opt-in via the `services`
 * argument so a unit-test harness can spin up a partial server without
 * having to satisfy every service's dependency contract.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import { registerErrorHandler } from './errors/handler.js';
import { registerLatencyMetrics } from './observability/requestId.js';
import { genRequestId, registerRequestId } from './plugins/requestId.js';
import {
  registerRateLimit,
  type DwtRateLimitOptions,
} from './plugins/rateLimit.js';
import { loggerOptions } from './logger.js';
import {
  aggregateRoutes,
  type AggregateRoutesOptions,
} from './services/aggregate/routes.js';
import {
  catalogRoutes,
  type CatalogRoutesOptions,
} from './services/catalog/routes.js';
import {
  friendsRoutes,
  type FriendsRoutesOptions,
} from './services/friends/routes.js';
import {
  sharingRoutes,
  type SharingRoutesOptions,
} from './services/sharing/routes.js';
import {
  pushRoutes,
  type PushRoutesOptions,
} from './services/push/routes.js';
import {
  notificationPreferenceRoutes,
  type NotificationPreferenceRoutesOptions,
} from './services/push/preferenceRoutes.js';
import {
  reactionRoutes,
  type ReactionRoutesOptions,
} from './services/reactions/routes.js';
import {
  statsRoutes,
  type StatsRoutesOptions,
} from './services/stats/routes.js';
import {
  completionRoutes,
  type CompletionRoutesOptions,
} from './services/tracking/completion/routes.js';
import {
  friendCompletionsRoutes,
  type FriendCompletionsRoutesOptions,
} from './services/tracking/friendCompletions/routes.js';
import {
  noteRoutes,
  type NoteRoutesOptions,
} from './services/tracking/note/routes.js';
import {
  ratingRoutes,
  type RatingRoutesOptions,
} from './services/tracking/rating/routes.js';
import {
  leaderboardRoutes,
  type LeaderboardRoutesOptions,
} from './services/aggregate/leaderboardRoutes.js';
import type { RatingChangedEvent } from './services/aggregate/ratingChangedQueue.js';

/**
 * Async callback the rating repo (task 10.2 `createRatingRepo`) invokes
 * after every successful UPSERT or DELETE. Production wiring uses
 * `createRatingChangedEmitter(...).emit` from
 * `services/aggregate/ratingChangedQueue.ts` (task 10.4) so the event
 * lands on the BullMQ recompute queue consumed by the aggregate worker
 * (task 8.3). Tests pass either a no-op (`async () => {}`) or a
 * recorder that pushes events into an in-memory array for assertions.
 *
 * The contract is intentionally re-declared here (rather than imported
 * from `services/tracking/rating/repo.ts`) so the server-builder
 * boundary does not depend on an internal repo type. Both ends agree
 * on the structural `(evt: RatingChangedEvent) => Promise<void>`
 * shape; that is the only coupling needed.
 */
export type EmitRatingChanged = (evt: RatingChangedEvent) => Promise<void>;

/**
 * Optional service-layer dependencies that `buildServer` will wire into
 * the returned Fastify instance.
 *
 * Each service is keyed by its module name (`catalog`, `auth`, ...). A
 * key being absent means the corresponding routes are not registered;
 * this lets focused unit tests exercise a single service without forcing
 * stubs for the rest of the surface.
 *
 * As subsequent tasks land their route plugins (auth, profile, friends,
 * sharing, aggregate, stats, tracking) they extend this interface with
 * their own option blocks.
 */
export interface BuildServerServices {
  /** Catalog_Service routes (task 9.6). */
  readonly catalog?: CatalogRoutesOptions;
  /** Friends_Service routes (task 7.2). */
  readonly friends?: FriendsRoutesOptions;
  /** Sharing_Service routes (task 12.1). */
  readonly sharing?: SharingRoutesOptions;
  /**
   * Push_Registration_Service routes (task 12.1, Phase 2). Wires
   * `POST/DELETE /me/push-registrations` so a device can register/refresh and
   * invalidate its Expo push token (R8). Opt-in like every other service so a
   * focused unit-test harness need not satisfy the push repo contract.
   */
  readonly push?: PushRoutesOptions;
  /**
   * Notification preference store routes (task 13.1, Phase 2). Wires
   * `GET/PUT /me/notification-preferences` so a User can read and set their
   * `Share_Notification_Preference` (R9.3-R9.5, R9.7, R9.8).
   */
  readonly notificationPreferences?: NotificationPreferenceRoutesOptions;
  /**
   * Reaction_Service routes (task 14.1, Phase 2). Wires the reaction
   * submit/replace/remove endpoints and the sender's reaction view (R11).
   */
  readonly reactions?: ReactionRoutesOptions;
  /** Stats_Service routes (task 11.1). */
  readonly stats?: StatsRoutesOptions;
  /**
   * Aggregate_Ratings_Service routes (task 8.4). The single route
   * `GET /experiences/:id/aggregate-rating` returns the canonical
   * `AggregateRatingDTO` `{ value, count }`. The injected
   * `repo.getAggregate(...)` is provided by task 8.3
   * (`apps/api/src/services/aggregate/repo.ts`); production wiring
   * builds it against the shared `pool`, while tests substitute an
   * in-memory implementation that never touches Postgres.
   */
  readonly aggregate?: AggregateRoutesOptions;
  /**
   * Aggregate_Ratings_Service home leaderboard (task 8.5).
   *
   * Wires `GET /home/highest-rated` against a `LeaderboardService`
   * produced by `createLeaderboard({ pool, redis })` from
   * `services/aggregate/leaderboard.ts`. The service is responsible
   * for the Redis 5-minute cache (R11.7-R11.9), the SQL query, and
   * the threshold/active filter (R11.2). Tests pass an in-memory
   * implementation satisfying the same `LeaderboardService` interface
   * so the route layer can be exercised without standing up Postgres
   * or Redis.
   */
  readonly leaderboard?: LeaderboardRoutesOptions;
  /**
   * Tracking_Service route options. Each tracking sub-domain
   * (`completion`, `rating`, `note`) is opt-in so a focused unit-test
   * harness can wire only the routes it needs.
   *
   * `emitRatingChanged` is exposed at this level (rather than buried
   * inside the rating repo construction) so the production entrypoint
   * can build it from `createRatingChangedEmitter(...)` in
   * `services/aggregate/ratingChangedQueue.ts` (task 10.4) and tests
   * can substitute a no-op or in-memory recorder. The rating repo
   * itself is constructed by the caller and passed in via
   * `tracking.rating.repo`; the field documented here is the
   * canonical hand-off point between the BullMQ wiring and the repo
   * builder.
   */
  readonly tracking?: {
    /** Completion routes (task 10.1). */
    readonly completion?: CompletionRoutesOptions;
    /** Rating routes (task 10.2). */
    readonly rating?: RatingRoutesOptions;
    /** Note routes (task 10.3). */
    readonly note?: NoteRoutesOptions;
    /**
     * Friend Completions read route (task 4.1, Friend Stats Viewing).
     * Wires `GET /users/:userId/completions` behind the shared
     * owner-or-friend rule. Opt-in like the other tracking sub-domains
     * so focused unit tests can register only the routes they need.
     */
    readonly friendCompletions?: FriendCompletionsRoutesOptions;
    /**
     * Emitter used by the rating repo to publish
     * `RatingChanged{experienceId, oldValue, newValue}` events on every
     * successful UPSERT or DELETE (task 10.4). Production callers wire
     * this to the BullMQ-backed emitter; tests typically pass a no-op
     * or a recording callback.
     *
     * This field is informational at the server-builder layer: the
     * rating repo it belongs to is constructed by the caller (see
     * `tracking.rating.repo`). Keeping it on the option block makes
     * the contract discoverable and lets future tasks (a single
     * factory that builds repo + routes together) consume it without
     * an option-shape break.
     */
    readonly emitRatingChanged?: EmitRatingChanged;
  };
  /**
   * Gateway-level rate-limit configuration (task 13.3). When provided,
   * `registerRateLimit` is invoked before any service-level routes are
   * registered so the limiter sees every request. The defense-in-depth
   * coverage (R6.7) lives in `loginRateLimitConfig` from
   * `plugins/rateLimit.ts`, which the Auth_Service routes attach to
   * `POST /auth/login` directly via `config.rateLimit`.
   *
   * Tests typically omit this field (the limiter is unnecessary noise
   * for unit tests of individual route plugins). The production
   * entrypoint always sets `{}` at minimum so the default budgets and
   * the shared Redis-backed store apply uniformly.
   */
  readonly rateLimit?: DwtRateLimitOptions;
}

/**
 * Build a Fastify instance configured for the given application config.
 *
 * The returned instance:
 *   - emits structured logs at the configured level via the redacting
 *     pino options from `./logger.ts`,
 *   - assigns a UUID v4 `request_id` to every incoming request via
 *     `genRequestId`, exposes it on the per-request logger, and echoes
 *     it back to the client in the `x-request-id` response header,
 *   - applies the uniform `ErrorEnvelope` hook so domain `AppError`s and
 *     unhandled exceptions both surface as `{ error: { code, message } }`
 *     responses (task 2.3),
 *   - exposes a single `/health` route returning a static OK payload,
 *   - registers each opted-in service plugin from `services`.
 */
export function buildServer(
  config: AppConfig,
  services: BuildServerServices = {},
): FastifyInstance {
  const app = Fastify({
    logger: {
      ...loggerOptions,
      level: config.server.logLevel,
    },
    // `genRequestId` runs once per request; using a UUID v4 keeps request
    // IDs globally unique across replicas without needing a coordinator,
    // and honors a valid inbound `x-request-id` so multi-service traces
    // can correlate.
    genReqId: genRequestId,
    // Trust the upstream proxy so `request.ip` reflects the real client
    // address behind the gateway/load balancer. Hosting-specific
    // tightening (e.g. only trust a known CIDR) is layered on later.
    trustProxy: true,
    disableRequestLogging: false,
  });

  // Decorate the instance with the resolved config so route handlers can
  // reach it without re-reading environment state.
  app.decorate('config', config);

  // Tolerant body parsing for bodyless "action" endpoints.
  //
  // Several endpoints are pure action calls that carry no request body
  // (e.g. POST /me/friend-requests/:id/accept and .../decline). Mobile HTTP
  // stacks (React Native / Expo) commonly send these as a POST with a
  // zero-length body but *no* `Content-Type` header. Fastify's default
  // content-type handling rejects that shape two different ways, both of
  // which the global error hook (see `errors/handler.ts`) surfaces as
  // `validation_failed` — which the client renders as the misleading
  // "Please check your input and try again." for a request that has no
  // input to get wrong:
  //
  //   1. `Content-Type: application/json` + empty body
  //      → `FST_ERR_CTP_EMPTY_JSON_BODY` (400).
  //   2. No (or blank) `Content-Type` but a body is signalled via
  //      Content-Length/Transfer-Encoding
  //      → `FST_ERR_CTP_INVALID_MEDIA_TYPE` ("Unsupported Media Type:
  //      undefined", 415).
  //
  // We install two parsers so an empty (or whitespace-only) body parses to
  // `undefined` regardless of the content-type header, and a stray
  // non-empty body under an unsupported content-type is tolerated rather
  // than rejected. Valid JSON under `application/json` is still parsed
  // normally, and malformed JSON under `application/json` still fails with a
  // 4xx `FST_ERR_CTP_*` code (mapped to `validation_failed`, the correct
  // code for a genuinely broken JSON payload). The more specific
  // `application/json` parser takes precedence over the `*` catch-all, and
  // `@fastify/multipart`'s `multipart/form-data` parser (registered by the
  // profile routes) is more specific still, so avatar uploads are
  // unaffected.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = typeof body === 'string' ? body : String(body ?? '');
      if (text.trim().length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        const parseError = err as Error & {
          statusCode?: number;
          code?: string;
        };
        parseError.statusCode = 400;
        // Reuse Fastify's own code prefix so the error hook's
        // `FST_ERR_CTP_*` branch maps this to `validation_failed`.
        parseError.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
        done(parseError, undefined);
      }
    },
  );
  app.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    (req, body, done) => {
      const text = typeof body === 'string' ? body : String(body ?? '');
      if (text.trim().length === 0) {
        // A bodyless request with a missing/unknown content-type is a
        // legitimate action call — accept it with an undefined body.
        done(null, undefined);
        return;
      }
      // A non-empty body arrived under a content-type we have no parser for
      // (some mobile HTTP stacks attach a stray body and a non-JSON or blank
      // content-type to bodyless action POSTs). Our API only *consumes*
      // application/json (handled by the parser above) and multipart
      // (handled by @fastify/multipart); no route reads a body of any other
      // type. So rather than reject with 415 — which the client surfaces as
      // a confusing `validation_failed` — we best-effort parse the body as
      // JSON and otherwise ignore it. Routes that actually require a body
      // still validate `request.body` via Zod and reject an undefined/own
      // shape with the appropriate field error.
      req.log.warn(
        {
          contentType: req.headers['content-type'] ?? null,
          bodyLength: text.length,
        },
        'request with unsupported content-type; ignoring body',
      );
      try {
        done(null, JSON.parse(text));
      } catch {
        done(null, undefined);
      }
    },
  );

  // The request-id and error-envelope hooks are registered before any
  // route plugin so every route, including the ones registered below,
  // produces the uniform shape on both success and failure paths.
  // `void`-returning the registration promises is intentional: Fastify
  // executes plugin chains lazily during `ready()`, and the catch path
  // will surface failures through the same logger.
  void registerRequestId(app);
  // Per-response latency line ties `request_id` to a structured
  // `duration_ms` metric (task 13.4). Registered at the same level as
  // the request-id hook so every response — including 4xx/5xx and
  // routes that the error envelope handles — produces a latency log
  // entry that downstream tooling can turn into histograms.
  void registerLatencyMetrics(app);
  registerErrorHandler(app);

  // Gateway-level rate limits (task 13.3). When opted in, this must be
  // registered after the error handler (so 429 responses still go
  // through the uniform envelope path) and before any service routes
  // (so its hooks run before per-route preHandlers like the session
  // middleware). The login-route override is attached at the auth
  // route level via `loginRateLimitConfig`.
  if (services.rateLimit !== undefined) {
    void registerRateLimit(app, services.rateLimit);
  }

  // Liveness probe. Intentionally minimal: no DB or Redis dependency so a
  // failing dependency cannot mark the instance dead. A separate
  // readiness probe is added in a later task.
  app.get('/health', async () => ({ status: 'ok' }));

  if (services.catalog !== undefined) {
    void app.register(catalogRoutes(services.catalog));
  }

  if (services.friends !== undefined) {
    void app.register(friendsRoutes(services.friends));
  }

  if (services.sharing !== undefined) {
    void app.register(sharingRoutes(services.sharing));
  }

  if (services.push !== undefined) {
    void app.register(pushRoutes(services.push));
  }

  if (services.notificationPreferences !== undefined) {
    void app.register(
      notificationPreferenceRoutes(services.notificationPreferences),
    );
  }

  if (services.reactions !== undefined) {
    void app.register(reactionRoutes(services.reactions));
  }

  if (services.stats !== undefined) {
    void app.register(statsRoutes(services.stats));
  }

  if (services.aggregate !== undefined) {
    void app.register(aggregateRoutes(services.aggregate));
  }

  if (services.leaderboard !== undefined) {
    void app.register(leaderboardRoutes(services.leaderboard));
  }

  if (services.tracking?.completion !== undefined) {
    void app.register(completionRoutes(services.tracking.completion));
  }

  if (services.tracking?.rating !== undefined) {
    void app.register(ratingRoutes(services.tracking.rating));
  }

  if (services.tracking?.note !== undefined) {
    void app.register(noteRoutes(services.tracking.note));
  }

  if (services.tracking?.friendCompletions !== undefined) {
    void app.register(
      friendCompletionsRoutes(services.tracking.friendCompletions),
    );
  }

  return app;
}

// Augment Fastify's type to surface the decorated config to handlers.
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}
