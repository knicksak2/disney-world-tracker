/**
 * Composition root for the Disney World Tracker API.
 *
 * `buildApp(config)` is the production analogue of the smoke-test harness
 * (`test/smoke/harness.ts`): it constructs the real backend clients
 * (Postgres pool, Redis) from `loadConfig()` output, builds every
 * service repo against them, assembles the `BuildServerServices` object,
 * calls `buildServer(config, services)`, and then registers the auth and
 * profile route plugins that live OUTSIDE `buildServer`. The returned
 * handle also exposes a `dispose()` that the entrypoint calls on
 * SIGINT/SIGTERM to release the Redis socket (the shared pool is closed
 * via `closePool()`).
 *
 * Why this module exists
 * ----------------------
 *
 * `buildServer` only wires the routes whose option blocks it is handed; it
 * does NOT build any repo, and the auth/profile plugins are not part of its
 * `BuildServerServices` surface at all. Without a composition root the
 * running server only exposes `/health` and 404s every real route. This
 * module is that composition root, kept separate from `index.ts` so the
 * entrypoint stays a thin "load config → build → listen → drain" shell.
 *
 * Design choices that differ from a naive port of the harness
 * -----------------------------------------------------------
 *
 *   - **Rating-changed emitter — direct synchronous aggregate update.**
 *     The harness wires `emitRatingChanged` straight to
 *     `aggregateRepo.updateAggregate(...)` rather than enqueuing a BullMQ
 *     job, because that keeps the aggregate consistent in-process without
 *     standing up a `Worker`. We make the same choice here. The BullMQ
 *     emitter (`createRatingChangedEmitter`) plus an in-process
 *     `startAggregateWorker` would also work, but it turns the API process
 *     into a queue consumer, needs a dedicated `maxRetriesPerRequest: null`
 *     Redis connection, and adds another lifecycle to drain on shutdown —
 *     more moving parts than a first booting server needs. The rating repo
 *     only depends on the structural `(evt) => Promise<void>` port, so this
 *     can be swapped for the BullMQ path later without touching the repo or
 *     `buildServer`. See the `emitRatingChanged` definition below.
 *     TODO(ops): when a dedicated aggregate-worker deployment exists, swap
 *     this for `createRatingChangedEmitter({ connection }).emit` and run
 *     `startAggregateWorker`/`startAggregateReconcileScheduler` in that
 *     worker process.
 *
 *   - **Catalog `decideRead` — real read-decision + opportunistic sync.**
 *     Rather than the harness's `async () => ({ staleCache: false })` stub,
 *     production wires the real `decideCatalogRead` flow (R1.11-R1.13,
 *     R1.24) against the catalog repo's `getCacheAge()` and a
 *     `runOrJoinSync` backed by `runSync(...)` (the orchestrator owns the
 *     Redis NX lock that prevents duplicate concurrent syncs).
 */

import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

import type { AppConfig } from './config.js';
import { closePool, getPool, type DbPool } from './db/pool.js';
import { buildServer } from './server.js';

import { authRoutes } from './services/auth/routes.js';
import { profileRoutes } from './services/auth/profileRoutes.js';
import { createLockoutService } from './services/auth/lockout.js';
import { hashToken as hashSessionToken } from './services/auth/sessionToken.js';
import {
  createSessionMiddleware,
  type SessionDbAdapter,
  type SessionRow,
} from './services/auth/sessionMiddleware.js';

import { createCatalogRepo } from './services/catalog/repo.js';
import { decideCatalogRead } from './services/catalog/readDecision.js';
import { runSync } from './services/catalog/sync.js';

import { createCompletionRepo } from './services/tracking/completion/repo.js';
import { createFriendCompletionsRepo } from './services/tracking/friendCompletions/repo.js';
import { createNoteRepo } from './services/tracking/note/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
} from './services/tracking/rating/repo.js';

import { createAggregateRepo } from './services/aggregate/repo.js';
import { createLeaderboard } from './services/aggregate/leaderboard.js';

import { createLiveCache } from './services/live/cache.js';
import { createLiveRepo } from './services/live/repo.js';
import { createThemeParksLiveClient } from './services/live/themeParksLiveClient.js';
import { createThemeParksLiveService } from './services/live/themeParksLiveService.js';
import { createThemeParksDirectory } from './services/live/themeParksDirectory.js';
import { createThemeParksClient } from './services/catalog/themeparks.js';
import { createFacilitiesClient } from './services/catalog/disney/facilitiesClient.js';
import { createDisneyTransport } from './services/catalog/disney/transport.js';
import { createRedisRateLimiter } from './services/catalog/disney/rateLimiter.js';
import { createDiningMenuClient } from './services/catalog/disney/diningMenuClient.js';
import { createMenuRetrieval } from './services/catalog/menuRetrieval.js';

import { createFriendsRepo } from './services/friends/repo.js';
import type { FriendRequestReceivedNotice } from './services/friends/routes.js';
import { createSharingRepo } from './services/sharing/repo.js';
import type { ShareDeliveredNotice } from './services/sharing/routes.js';
import { createStatsRepo } from './services/stats/repo.js';
import { buildCuratedProgressStats } from './services/stats/curatedShare.js';

import { createTripRepo } from './services/trips/repo.js';
import type {
  RodeWithTagCreatedNotice,
  TripInviteCreatedNotice,
} from './services/trips/events.js';

import { createPushRepo } from './services/push/repo.js';
import { createNotificationPreferenceRepo } from './services/push/preferenceRepo.js';
import { createReactionsRepo } from './services/reactions/repo.js';
import {
  createNotificationService,
  createExpoPushClient,
  createSenderDisplayNameResolver,
  createExperienceNameResolver,
} from './services/notifications/index.js';

import { IntelligenceRepo } from './services/intelligence/IntelligenceRepo.js';
import { createWeatherClient } from './services/intelligence/weatherClient.js';
import { createPredictionService } from './services/intelligence/predictionService.js';
import { createDerivedStatsService } from './services/intelligence/derivedStatsService.js';
import { createSamplingService } from './services/intelligence/samplingService.js';

import { createLogger } from './logger.js';

/**
 * Handle returned by {@link buildApp}. The `app` is a configured-but-unbound
 * Fastify instance (the caller invokes `listen()`), and `dispose()` releases
 * the composition root's own resources (the Redis client). The shared
 * Postgres pool is owned by `db/pool.ts` and closed via `closePool()` in the
 * entrypoint's shutdown path.
 */
export interface BuiltApp {
  readonly app: FastifyInstance;
  /** Release composition-owned resources (Redis). Safe to call once. */
  dispose(): Promise<void>;
}

/**
 * Build the fully-wired production Fastify instance from the resolved
 * config. Mirrors the harness's service wiring against real backends.
 *
 * The returned `app` has been `register`-ed with every route plugin but is
 * NOT yet `ready()`/`listen()`-ing — Fastify resolves the plugin chain
 * lazily during `ready()`, which `listen()` triggers. The caller (the
 * entrypoint) owns the `listen()` call.
 */
export async function buildApp(config: AppConfig): Promise<BuiltApp> {
  // --- Backends -------------------------------------------------------
  // Shared Postgres pool (reads config.database.url internally).
  const pool: DbPool = getPool();
  // Real Redis client. `new Redis(url)` matches what the lockout service
  // and the leaderboard cache expect (both accept the structural ioredis
  // surface), and what `runSync` needs for its NX coordination lock.
  const redis = new Redis(config.redis.url);

  // --- Repos ----------------------------------------------------------
  const aggregateRepo = createAggregateRepo(pool);

  /**
   * In-process rating-changed handler. See the module docstring for why
   * this is the synchronous direct-update path rather than the BullMQ
   * emitter. The rating repo awaits this after each successful UPSERT or
   * DELETE, so a recompute failure surfaces to the client as a 5xx and the
   * mutation can be retried (the aggregate update is idempotent on
   * `(experienceId, oldValue, newValue)`).
   */
  const emitRatingChanged = async (
    event: RatingChangedEvent,
  ): Promise<void> => {
    await aggregateRepo.updateAggregate(
      event.experienceId,
      event.oldValue,
      event.newValue,
    );
  };

  const catalogRepo = createCatalogRepo(pool);
  const completionRepo = createCompletionRepo(pool);
  const friendCompletionsRepo = createFriendCompletionsRepo(pool);
  const noteRepo = createNoteRepo(pool);
  const ratingRepo = createRatingRepo({ pool, emitRatingChanged });
  const friendsRepo = createFriendsRepo(pool);
  const sharingRepo = createSharingRepo(pool);
  const statsRepo = createStatsRepo(pool);

  // The Trip_Service never holds Trip-local copies of Completions or Ratings:
  // it delegates those canonical writes to the existing Tracking_Service repos
  // so the single-source-of-truth and the existing `RatingChanged` propagation
  // are reused unchanged (design decision 2; R12.1). Both repos are already
  // built above and shared with the Tracking route wiring.
  const tripRepo = createTripRepo(pool, {
    completions: completionRepo,
    ratings: ratingRepo,
  });

  // --- Phase 2 sharing services (push / preferences / reactions / notify) ---
  // All four repos are pool-backed and constructor-injected like every other
  // service. The Push_Registration repo and the preference repo also back the
  // Notification_Service's delivery targeting and preference gate, so they are
  // built once and shared between the HTTP route wiring and the notification
  // dispatch below.
  const pushRepo = createPushRepo(pool);
  const notificationPreferenceRepo = createNotificationPreferenceRepo(pool);
  const reactionsRepo = createReactionsRepo(pool);

  // The Notification_Service runs on a background dispatch decoupled from the
  // request lifecycle, so it owns no Fastify request logger; give it an ad-hoc
  // pino logger (the same redacting options the server uses) so its best-effort
  // warnings/errors are still captured. It talks to the real Expo Push API and
  // resolves the sender display name / Experience name from Postgres.
  const notificationLogger = createLogger();
  const notificationService = createNotificationService({
    preferences: notificationPreferenceRepo,
    pushTokens: pushRepo,
    expoClient: createExpoPushClient(),
    resolveSenderDisplayName: createSenderDisplayNameResolver(pool),
    resolveExperienceName: createExperienceNameResolver(pool),
    logger: notificationLogger,
  });

  /**
   * Background `ShareDelivered` dispatch (design decision 4, R7.7).
   *
   * Invoked by the Sharing_Service route AFTER `createShareAtomic` commits. The
   * port returns `void`, so the route handler cannot await it — the request
   * returns `201` immediately regardless of push outcome. `handleShareDelivered`
   * already swallows every internal failure (it never rejects), but the trailing
   * `.catch` is defensive so an unexpected rejection can never surface as an
   * unhandled promise rejection. `ShareDeliveredNotice` is structurally identical
   * to the service's `ShareDeliveredEvent`, so it is handed across directly.
   */
  const emitShareDelivered = (event: ShareDeliveredNotice): void => {
    void notificationService.handleShareDelivered(event).catch((err: unknown) => {
      notificationLogger.error(
        { err, shareId: event.shareId },
        'ShareDelivered dispatch failed',
      );
    });
  };

  /**
   * Background `FriendRequestReceived` dispatch, mirroring `emitShareDelivered`.
   *
   * Invoked by the Friends_Service route AFTER `sendRequest` commits so the
   * recipient gets a push notification. The port returns `void`, so the route
   * handler cannot await it — `POST /me/friend-requests` returns `201`
   * immediately regardless of push outcome. `handleFriendRequestReceived`
   * already swallows every internal failure (it never rejects); the trailing
   * `.catch` is defensive against an unexpected rejection surfacing as an
   * unhandled promise rejection. `FriendRequestReceivedNotice` is structurally
   * identical to the service's `FriendRequestReceivedEvent`, so it is handed
   * across directly.
   */
  const emitFriendRequestReceived = (
    event: FriendRequestReceivedNotice,
  ): void => {
    void notificationService
      .handleFriendRequestReceived(event)
      .catch((err: unknown) => {
        notificationLogger.error(
          { err, requestId: event.requestId },
          'FriendRequestReceived dispatch failed',
        );
      });
  };

  /**
   * Background `TripInviteCreated` dispatch, mirroring `emitFriendRequestReceived`.
   *
   * Invoked by the Trip_Service route AFTER a `pending` Trip_Invite commits so
   * the invited User gets an in-App + push notification whose deep-link target
   * opens the invite (R6.6, R6.7). The port returns `void`, so the route handler
   * cannot await it — `POST /trips/:id/invites` returns `201` immediately
   * regardless of push outcome. `handleTripInviteCreated` already swallows every
   * internal failure (it never rejects); the trailing `.catch` is defensive
   * against an unexpected rejection surfacing as an unhandled promise rejection.
   * `TripInviteCreatedNotice` is structurally identical to the service's
   * `TripInviteCreatedEvent`, so it is handed across directly.
   */
  const emitTripInviteCreated = (event: TripInviteCreatedNotice): void => {
    void notificationService
      .handleTripInviteCreated(event)
      .catch((err: unknown) => {
        notificationLogger.error(
          { err, inviteId: event.inviteId },
          'TripInviteCreated dispatch failed',
        );
      });
  };

  /**
   * Background `RodeWithTagCreated` dispatch, mirroring `emitTripInviteCreated`.
   *
   * Invoked by the Trip_Service route once per `pending` Rode_With_Tag created
   * by a logged Completion, so each Tagged_Member gets an in-App + push
   * notification whose deep-link target opens the tag's confirm/decline view
   * (R10.8). The port returns `void`, so the route handler cannot await it —
   * `POST /trips/:id/log-entries` returns `201` immediately regardless of push
   * outcome. `handleRodeWithTagCreated` already swallows every internal failure
   * (it never rejects); the trailing `.catch` is defensive against an unexpected
   * rejection surfacing as an unhandled promise rejection.
   * `RodeWithTagCreatedNotice` is structurally identical to the service's
   * `RodeWithTagCreatedEvent`, so it is handed across directly.
   */
  const emitRodeWithTagCreated = (event: RodeWithTagCreatedNotice): void => {
    void notificationService
      .handleRodeWithTagCreated(event)
      .catch((err: unknown) => {
        notificationLogger.error(
          { err, tagId: event.tagId },
          'RodeWithTagCreated dispatch failed',
        );
      });
  };
  // The leaderboard cache and the lockout service accept a narrow
  // structural Redis interface whose `set` is a single rest-arg overload;
  // ioredis's `Redis` exposes many `set` overloads that are not assignable
  // to that single signature. The smoke harness casts with `as never` for
  // exactly this reason — the runtime call shape (`set(key, val, 'EX', n)`)
  // is satisfied by the real client. We mirror the harness's cast here.
  const leaderboardService = createLeaderboard({
    pool,
    redis: redis as never,
  });

  // --- Live_Service wiring (ThemeParks.wiki source) ------------------
  // The live read path shares exactly one piece of relational state with the
  // catalog path (`experiences.upstream_entity_id`, read-only via the live
  // repo — which holds the Experience's `Enterprise_Id`) and reuses the same
  // Redis instance as the leaderboard cache for its short-lived Live_Cache.
  // The ThemeParks.wiki live client talks ONLY to ThemeParks.wiki (never a
  // Disney source, R11.10/R12.3), built from `AppConfig.themeparks`. The
  // orchestrator owns the resolve → cache → fetch → stale-fallback decision and
  // projects via the ThemeParks.wiki live projection keyed by Enterprise_Id
  // (R11.1), which equals the ThemeParks.wiki `External_Id` (R11.2).
  const themeParksLiveClient = createThemeParksLiveClient({
    baseUrl: config.themeparks.baseUrl,
  });
  // Resolve an Experience's Enterprise_Id to the ThemeParks.wiki entity id
  // (a GUID) required by the live endpoint: the live feed is keyed by the
  // entity id, not by its `externalId`, so the join (externalId == Enterprise_Id,
  // R11.2) is performed by enumerating the WDW destination's entities. The
  // directory is cached (12h) so this costs one enumeration, not one per read.
  const themeParksDirectory = createThemeParksDirectory({
    client: createThemeParksClient({ baseUrl: config.themeparks.baseUrl }),
  });
  // The Live_Cache accepts the same narrow structural Redis interface as the
  // leaderboard cache; ioredis's many `set` overloads are not assignable to
  // its single rest-arg signature, so we mirror the harness/leaderboard
  // `as never` cast — the runtime call shape (`set(key, val, 'EX', n)`) is
  // satisfied by the real client.
  const liveCache = createLiveCache(redis as never);
  const liveRepo = createLiveRepo(pool);
  const liveService = createThemeParksLiveService({
    repo: liveRepo,
    cache: liveCache,
    client: themeParksLiveClient,
    resolveEntityId: (enterpriseId) =>
      themeParksDirectory.resolveEntityId(enterpriseId),
  });

  // --- Disney egress: shared Rate_Limiter + Transport + Facilities_Client ---
  // Every Disney HTTP call (the Catalog_Sync facilities channel + demand-driven
  // Menu_Service reads) must draw from ONE authoritative Request_Budget across
  // every process sharing the egress IP (R2.4). At the composition root we have
  // a real Redis client, so we wire the Redis-backed Rate_Limiter (rather than
  // the per-call in-process default `runSync`/`runOrJoinSync` would otherwise
  // build) so the budget is shared cluster-wide. The shared Disney_Transport
  // owns User-Agent injection, lease-before-dispatch pacing, and retry/backoff;
  // the Facilities_Client is built on top and injected into the on-read
  // `runSync` call below so the composed limiter/transport are used.
  const disneyRateLimiter = createRedisRateLimiter(config.disney.requestBudget, {
    redis,
  });
  const disneyTransport = createDisneyTransport({
    limiter: disneyRateLimiter,
    backoff: config.disney.backoff,
  });
  const facilitiesClient = createFacilitiesClient({
    transport: disneyTransport,
    baseUrl: config.disney.syncGateway.baseUrl,
    credentials: config.disney.credentials,
  });

  // Demand-driven menu source. The scoped explorer-service finder rejects the
  // app's anonymous token (403 "required scopes"), so menus are sourced from
  // Disney's PUBLIC website dining-menu API (`?searchTerm={Enterprise_Id}`),
  // which serves anonymous callers. It shares the SAME Disney_Transport, so
  // every request still draws from the single authoritative Redis-backed
  // Request_Budget (R2.1, R2.3) — no second transport or limiter is created.
  const diningMenuClient = createDiningMenuClient({
    transport: disneyTransport,
    baseUrl: config.disney.diningMenuBaseUrl,
  });

  // Demand-driven Menu retrieval seam (R1.1-R1.3): fetch on cache miss/stale,
  // serve cache when fresh, degrade to cache on failure. The seam's
  // `logger`/`now` default to production implementations.
  const menuRetrieval = createMenuRetrieval({
    repo: catalogRepo,
    client: diningMenuClient,
    freshnessMs: config.disney.menuFreshnessMs,
  });

  // --- Intelligence Services ------------------------------------------
  const intelligenceRepo = new IntelligenceRepo(pool);
  const weatherClient = createWeatherClient();
  const predictionService = createPredictionService({
    repo: intelligenceRepo,
    weatherClient,
  });
  const derivedStatsService = createDerivedStatsService({
    repo: intelligenceRepo,
    predictionService,
  });
  const samplingService = createSamplingService({
    repo: intelligenceRepo,
    liveClient: themeParksLiveClient,
    catalogClient: createThemeParksClient({ baseUrl: config.themeparks.baseUrl }),
    directory: themeParksDirectory,
    weatherClient,
    derivedStatsService,
  });
  
  // --- Auth wiring ----------------------------------------------------
  const lockout = createLockoutService(redis as never);
  const sessionMiddleware = createSessionMiddleware({
    db: makeSessionDbAdapter(pool),
    hashToken: hashSessionToken,
  });

  // --- Catalog read-decision (real opportunistic-sync path) -----------
  // The Disney Facilities_Client + sync orchestrator are wired so the catalog
  // read endpoints trigger a real opportunistic sync when the cache is
  // stale (R1.11), serve the prior cache with `staleCache: true` on
  // timeout/upstream error (R1.13), and 503 when no prior cache exists
  // and upstream is unreachable (R1.24). `runSync` owns the Redis NX lock
  // that prevents duplicate concurrent syncs (R1.10). The composed
  // Facilities_Client (shared Disney_Transport + Redis-backed Rate_Limiter) is
  // injected so the authoritative cluster-wide Request_Budget is used rather
  // than the per-call in-process default `runSync` would otherwise build.
  const decideRead = (): ReturnType<typeof decideCatalogRead> =>
    decideCatalogRead({
      repo: {
        async getCacheAgeHours() {
          const info = await catalogRepo.getCacheAge();
          return info.hours;
        },
      },
      sync: {
        async runOrJoinSync() {
          const result = await runSync({
            repo: catalogRepo,
            redis,
            client: facilitiesClient,
            // The opportunistic on-read refresh fires precisely because the
            // cache age already exceeded the freshness interval (R9.3); it must
            // bypass the scheduled-run freshness guard (R9.2).
            trigger: 'on_read',
          });
          // `decideCatalogRead` treats a rejected sync as the
          // timeout/error branch. A `skipped` (lock held) result means a
          // concurrent sync is already refreshing the cache; that is not a
          // failure, so we resolve normally and let the cache-age decision
          // serve the existing rows.
          if (result.status === 'failed') {
            throw result.error;
          }
        },
      },
    });

  // --- Build app ------------------------------------------------------
  const app = buildServer(config, {
    catalog: {
      decideRead,
      listActiveExperiences: (filters) =>
        catalogRepo.listActiveExperiences(filters),
      getExperience: (id) => catalogRepo.getExperience(id),
      getMenusFor: (id) => menuRetrieval.getMenuForRestaurant(id),
      listActiveResorts: () => catalogRepo.listActiveResorts(),
      listDestinationCounts: () => catalogRepo.listDestinationCounts(),
      // ThemeParks.wiki-sourced Live_Detail served through the catalog
      // plugin's `/catalog/:experienceId/live` route, keyed by the Experience's
      // Enterprise_Id (R11.1), which equals the ThemeParks.wiki External_Id
      // (R11.2). Contacts only ThemeParks.wiki, never a Disney source
      // (R11.10, R12.3).
      getLiveDetail: (id) => liveService.getLiveDetail(id),
    },
    intelligence: {
      samplingService,
      predictionService,
      requireSession: sessionMiddleware,
    },
    friends: {
      repo: friendsRepo,
      requireSession: sessionMiddleware,
      // Dispatch a push to the recipient on a background port after the
      // request row commits; the request is never blocked or failed by push.
      emitFriendRequestReceived,
    },
    sharing: {
      repo: sharingRepo,
      requireSession: sessionMiddleware,
      // R7.7: dispatch the notification on a background port after the share
      // transaction commits; the request is never blocked or failed by push.
      emitShareDelivered,
      // R10: capture the sender's curated stats (overallPercent, topFacet,
      // percentileRank) as a send-time snapshot when a `progress` Share is
      // created. The stats snapshot is read with `includePercentile: true` so
      // the Percentile_Rank material is present, then folded by the pure
      // `buildCuratedProgressStats`. Reusing the Stats_Service's single
      // `REPEATABLE READ READ ONLY` computation keeps the curated fields
      // consistent with the Stats_Page and immutable for the recipient (R10.6).
      computeProgressShareStats: async (senderId: string) => {
        const snapshot = await statsRepo.getStatsSnapshot({
          targetUserId: senderId,
          includePercentile: true,
        });
        return buildCuratedProgressStats(snapshot);
      },
    },
    trips: {
      repo: tripRepo,
      requireSession: sessionMiddleware,
      pool,
      // Fire-and-forget push to the invited User after a `pending` invite
      // commits (R6.6, R6.7), and one push per `pending` rode-with tag after a
      // Completion is logged (R10.8). Both dispatch ports return void and own
      // their error handling, so the request is never blocked or failed by push.
      emitTripInviteCreated,
      emitRodeWithTagCreated,
    },
    push: { repo: pushRepo, requireSession: sessionMiddleware },
    notificationPreferences: {
      repo: notificationPreferenceRepo,
      requireSession: sessionMiddleware,
    },
    reactions: { repo: reactionsRepo, requireSession: sessionMiddleware },
    stats: { repo: statsRepo, pool, requireSession: sessionMiddleware },
    aggregate: { repo: aggregateRepo },
    leaderboard: { service: leaderboardService },
    tracking: {
      completion: { repo: completionRepo, requireSession: sessionMiddleware },
      rating: { repo: ratingRepo, requireSession: sessionMiddleware },
      note: { repo: noteRepo, requireSession: sessionMiddleware },
      friendCompletions: {
        repo: friendCompletionsRepo,
        pool,
        requireSession: sessionMiddleware,
      },
    },
    // Always set `{}` so the gateway rate limiter (Redis-backed default
    // budgets) applies uniformly across every service route. The
    // login-route override is attached inside `authRoutes`.
    rateLimit: {},
  });

  // --- Auth + profile routes (outside BuildServerServices) ------------
  // These plugins are not part of `buildServer`'s surface, so they are
  // registered on the returned instance before `listen()`.
  //
  // IMPORTANT: these are `void`-registered (not awaited), mirroring how
  // `buildServer` registers every one of its own route plugins. The smoke
  // harness `await`s these two registrations, but the harness never enables
  // the gateway rate limiter. With the limiter enabled (production sets
  // `rateLimit: {}` above), `await`ing the auth registration and then
  // `await`ing the profile registration deadlocks avvio's plugin-loading
  // graph: awaiting `app.register(...)` forces a partial `ready()` of the
  // tree, and doing that twice while `@fastify/rate-limit`'s global hooks
  // are pending never resolves. Queueing both with `void` lets Fastify resolve
  // the whole plugin chain in one pass during `app.listen()`/`ready()`,
  // which is exactly the pattern `buildServer` already relies on. Any
  // registration error surfaces through the entrypoint's `listen()` catch.
  void app.register(
    authRoutes({ pool, lockout, requireSession: sessionMiddleware }),
  );
  void app.register(profileRoutes, {
    pool,
    requireAuth: sessionMiddleware,
  });

  return {
    app,
    async dispose(): Promise<void> {
      // Release the composition-owned Redis socket. The shared pool is
      // closed by the entrypoint via `closePool()`.
      try {
        await redis.quit();
      } catch {
        // Best-effort: a quit failure during shutdown must not mask the
        // primary shutdown path.
      }
    },
  };
}

/**
 * Build a `SessionDbAdapter` against the real pool. Copied verbatim from
 * the smoke harness (`makeSessionDbAdapter`) so the production session
 * middleware reads and writes the `sessions` table with the same SQL the
 * tests exercise.
 */
function makeSessionDbAdapter(pool: DbPool): SessionDbAdapter {
  return {
    async findByTokenHash(tokenHash) {
      const result = await pool.query<SessionRow>(
        `SELECT id, user_id, absolute_expires_at, last_seen_at, revoked_at
           FROM sessions
          WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row ?? null;
    },
    async updateActivity(sessionId, now, absoluteExpiresAt) {
      await pool.query(
        `UPDATE sessions
            SET last_seen_at = $2,
                absolute_expires_at = $3
          WHERE id = $1`,
        [sessionId, now, absoluteExpiresAt],
      );
    },
  };
}

// Re-export for the entrypoint's shutdown path so it has a single import
// surface for composition concerns.
export { closePool };
