/**
 * Composition root for the Disney World Tracker API.
 *
 * `buildApp(config)` is the production analogue of the smoke-test harness
 * (`test/smoke/harness.ts`): it constructs the real backend clients
 * (Postgres pool, Redis, S3) from `loadConfig()` output, builds every
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

import { S3Client } from '@aws-sdk/client-s3';
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
import { createThemeParksClient } from './services/catalog/themeparks.js';

import { createCompletionRepo } from './services/tracking/completion/repo.js';
import { createNoteRepo } from './services/tracking/note/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
} from './services/tracking/rating/repo.js';

import { createAggregateRepo } from './services/aggregate/repo.js';
import { createLeaderboard } from './services/aggregate/leaderboard.js';

import { createFriendsRepo } from './services/friends/repo.js';
import { createSharingRepo } from './services/sharing/repo.js';
import { createStatsRepo } from './services/stats/repo.js';

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
  // Real S3-compatible client. MinIO requires path-style addressing and a
  // concrete region; both are set explicitly so the same wiring works
  // against MinIO locally and AWS S3 in production.
  const s3Client = new S3Client({
    endpoint: config.s3.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });

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
  const noteRepo = createNoteRepo(pool);
  const ratingRepo = createRatingRepo({ pool, emitRatingChanged });
  const friendsRepo = createFriendsRepo(pool);
  const sharingRepo = createSharingRepo(pool);
  const statsRepo = createStatsRepo(pool);
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

  // --- Auth wiring ----------------------------------------------------
  const lockout = createLockoutService(redis as never);
  const sessionMiddleware = createSessionMiddleware({
    db: makeSessionDbAdapter(pool),
    hashToken: hashSessionToken,
  });

  // --- Catalog read-decision (real opportunistic-sync path) -----------
  // The themeparks client + sync orchestrator are wired so the catalog
  // read endpoints trigger a real opportunistic sync when the cache is
  // stale (R1.11), serve the prior cache with `staleCache: true` on
  // timeout/upstream error (R1.13), and 503 when no prior cache exists
  // and upstream is unreachable (R1.24). `runSync` owns the Redis NX lock
  // that prevents duplicate concurrent syncs (R1.10).
  const themeparksClient = createThemeParksClient({
    baseUrl: config.themeparks.baseUrl,
  });
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
            client: themeparksClient,
            repo: catalogRepo,
            redis,
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
    },
    friends: { repo: friendsRepo, requireSession: sessionMiddleware },
    sharing: { repo: sharingRepo, requireSession: sessionMiddleware },
    stats: { repo: statsRepo, pool, requireSession: sessionMiddleware },
    aggregate: { repo: aggregateRepo },
    leaderboard: { service: leaderboardService },
    tracking: {
      completion: { repo: completionRepo, requireSession: sessionMiddleware },
      rating: { repo: ratingRepo, requireSession: sessionMiddleware },
      note: { repo: noteRepo, requireSession: sessionMiddleware },
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
  // and `@fastify/multipart` (registered inside `profileRoutes`) are both
  // pending never resolves. Queueing both with `void` lets Fastify resolve
  // the whole plugin chain in one pass during `app.listen()`/`ready()`,
  // which is exactly the pattern `buildServer` already relies on. Any
  // registration error surfaces through the entrypoint's `listen()` catch.
  void app.register(
    authRoutes({ pool, lockout, requireSession: sessionMiddleware }),
  );
  void app.register(profileRoutes, {
    pool,
    s3Client,
    bucket: config.s3.bucket,
    endpoint: config.s3.endpoint,
    requireAuth: sessionMiddleware,
  });

  return {
    app,
    async dispose(): Promise<void> {
      // Release the composition-owned Redis socket. The shared pool is
      // closed by the entrypoint via `closePool()`. S3Client holds no
      // long-lived socket that needs an explicit close.
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
