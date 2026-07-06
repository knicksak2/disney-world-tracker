/**
 * Smoke test harness.
 *
 * Task 13.1 of the disney-world-tracker plan. Spins up the API end-to-
 * end against an in-memory Postgres (`pg-mem`) and an in-memory Redis
 * (`ioredis-mock`), seeds a representative dataset (N users, M
 * experiences, K ratings), and exposes helpers that measure wall-clock
 * latency of the scenarios the perf-SLA tests in task 13.2 will assert
 * against:
 *
 *   - `GET  /me/stats`                          (R3.4, R3.5)
 *   - `PUT  /me/experiences/:id/note`           (R5.8)
 *   - `POST /auth/register`                     (R6.1)
 *   - `POST /auth/login`                        (R6.5)
 *   - `GET  /home/highest-rated`                (R11)
 *   - aggregate-rating recompute end-to-end     (R10.7)
 *
 * Why an in-memory backend instead of testcontainers
 * --------------------------------------------------
 *
 * `pg-mem` and `ioredis-mock` are pure-JS implementations that start
 * in single-digit milliseconds — there is no Docker daemon involved
 * and CI runs do not have to wait for a Postgres container to clear
 * its readiness probe. The tradeoff is that a small number of
 * Postgres extensions (notably the GIN trigram operator class) and a
 * couple of system functions (`char_length`, `pg_advisory_xact_lock`,
 * `hashtext`) have to be registered on the embedded engine before the
 * canonical `migrations/0001_init.sql` can be applied; we strip the
 * GIN trigram indexes from the SQL because pg-mem doesn't support the
 * `gin_trgm_ops` operator class, but the rest of the schema runs
 * verbatim. The harness's purpose is to surface the wire-shape and
 * end-to-end latency of the API; full schema fidelity (including the
 * trigram indexes) is the integration tests' concern, not the smoke
 * harness's.
 *
 * Service wiring matches `buildServer`'s production wiring as
 * closely as possible:
 *
 *   - real `Argon2id` password hashing,
 *   - real session token generation + sha256 hashing,
 *   - real session middleware reading from the in-memory `sessions`
 *     table,
 *   - real lockout service backed by ioredis-mock,
 *   - real Catalog/Tracking/Stats/Friends/Sharing/Aggregate repos
 *     reading and writing the in-memory pg-mem instance,
 *   - real BullMQ-shaped `RatingChanged` emitter wired to an
 *     in-process consumer that calls `updateAggregate` synchronously
 *     so the harness can measure the recompute latency without
 *     standing up BullMQ.
 *
 * Validates: foundation for the perf-SLA tests in task 13.2 (R3.4,
 * R3.5, R5.8, R5.9, R6.1, R6.5, R10.7, R11).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { AppConfig } from '../../src/config.js';
import { buildServer } from '../../src/server.js';

import { authRoutes } from '../../src/services/auth/routes.js';
import { profileRoutes } from '../../src/services/auth/profileRoutes.js';
import { createLockoutService } from '../../src/services/auth/lockout.js';
import { hash as hashPassword } from '../../src/services/auth/password.js';
import {
  generateToken,
  hashToken as hashSessionToken,
} from '../../src/services/auth/sessionToken.js';
import {
  createSessionMiddleware,
  type SessionDbAdapter,
  type SessionRow,
} from '../../src/services/auth/sessionMiddleware.js';

import { internalId } from '../../src/services/catalog/internalId.js';
import { createCatalogRepo } from '../../src/services/catalog/repo.js';

import { createCompletionRepo } from '../../src/services/tracking/completion/repo.js';
import { createNoteRepo } from '../../src/services/tracking/note/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
} from '../../src/services/tracking/rating/repo.js';

import { createAggregateRepo } from '../../src/services/aggregate/repo.js';
import { createLeaderboard } from '../../src/services/aggregate/leaderboard.js';

import { createFriendsRepo } from '../../src/services/friends/repo.js';
import { createSharingRepo } from '../../src/services/sharing/repo.js';
import { createStatsRepo } from '../../src/services/stats/repo.js';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link setupHarness}. Defaults below produce a
 * dataset large enough to exercise the indexes that back the
 * perf-SLA scenarios without making the harness itself slow to start.
 */
export interface HarnessOptions {
  /** Number of seeded users. Default 25. */
  readonly users?: number;
  /** Number of seeded active experiences. Default 200. */
  readonly experiences?: number;
  /**
   * Number of seeded ratings. The seeded rows are spread across
   * users × experiences (modulo) so every user gets at least one rating
   * and every experience gets at least one rating once `ratings >=
   * max(users, experiences)`. Default 600.
   */
  readonly ratings?: number;
}

/**
 * One row in the seeded user list. `userId` is the database row id;
 * `email` and `password` are the credentials so callers (and the
 * `auth/login` SLA scenario) can re-authenticate. `token` is the
 * session bearer token issued during seeding so authenticated
 * requests can run without going through `/auth/login` first.
 */
export interface HarnessUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly token: string;
}

/**
 * One row in the seeded experience list. `id` is the stable internal
 * UUIDv5 derived from the upstream entity id (per R1.7); `park` and
 * `category` cycle through the closed enums so every park/category
 * has at least a few rows once `experiences >= |parks| × |categories|`.
 */
export interface HarnessExperience {
  readonly id: string;
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly park: string;
  readonly category: string;
}

/**
 * Wall-clock latency (in milliseconds) of one representative scenario.
 * Returned by {@link Harness.measureScenarios}; task 13.2 asserts
 * each value against the relevant SLA budget.
 */
export interface ScenarioLatencies {
  readonly meStats: number;
  readonly putNote: number;
  readonly authRegister: number;
  readonly authLogin: number;
  readonly homeHighestRatedCold: number;
  readonly homeHighestRatedWarm: number;
  readonly aggregateRecompute: number;
  readonly catalogList: number;
}

/**
 * Handle returned by {@link setupHarness}.
 */
export interface Harness {
  /** Configured but already-`ready` Fastify instance. */
  readonly app: FastifyInstance;
  /** Seeded users; first user is `users[0]`. */
  readonly users: ReadonlyArray<HarnessUser>;
  /** Seeded experiences. */
  readonly experiences: ReadonlyArray<HarnessExperience>;

  /**
   * Make a request as the supplied user. Returns the parsed Fastify
   * `Light-my-Request` response. The bearer token is attached to the
   * `Authorization` header automatically.
   */
  requestAs(
    user: HarnessUser,
    method: string,
    url: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    json: () => unknown;
  }>;

  /**
   * Make an unauthenticated request.
   */
  request(
    method: string,
    url: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    json: () => unknown;
  }>;

  /**
   * Run the SLA-relevant scenarios once and return their wall-clock
   * latency in milliseconds. Implemented as a single sequential
   * traversal so the result is deterministic and fast to inspect.
   */
  measureScenarios(): Promise<ScenarioLatencies>;

  /**
   * Stop the Fastify instance, drain in-flight requests, close the
   * pg-mem-backed pool, and quit the ioredis-mock client. Idempotent.
   */
  teardown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default user count when not specified. */
const DEFAULT_USERS = 25;
/** Default experience count when not specified. */
const DEFAULT_EXPERIENCES = 200;
/** Default rating count when not specified. */
const DEFAULT_RATINGS = 600;

/**
 * Static password used for every seeded user. Argon2id is deliberately
 * slow, so hashing it once and re-using the same encoded hash keeps
 * harness setup well under a second even at high user counts.
 */
const SEED_PASSWORD = 'smoke-harness-pw-1';

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Spin up the API harness.
 *
 * Construction flow:
 *
 *   1. Build an in-memory Postgres via `pg-mem` and apply the
 *      project's `migrations/0001_init.sql` to it (with the GIN
 *      trigram indexes stripped because pg-mem doesn't ship the
 *      `gin_trgm_ops` operator class).
 *   2. Build an in-memory Redis via `ioredis-mock`.
 *   3. Build the seven service repos against the in-memory backends.
 *   4. Build the Fastify app via `buildServer` with every service
 *      wired, then register the auth and profile routes (which live
 *      outside `BuildServerServices` today).
 *   5. Seed the dataset and issue session tokens for every user.
 */
export async function setupHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const userCount = options.users ?? DEFAULT_USERS;
  const experienceCount = options.experiences ?? DEFAULT_EXPERIENCES;
  const ratingCount = options.ratings ?? DEFAULT_RATINGS;

  if (userCount < 1) {
    throw new Error('setupHarness: users must be >= 1');
  }
  if (experienceCount < 1) {
    throw new Error('setupHarness: experiences must be >= 1');
  }
  if (ratingCount < 0) {
    throw new Error('setupHarness: ratings must be >= 0');
  }

  // --- Backends -------------------------------------------------------
  const memDb = buildPgMemDatabase();
  const { Pool } = memDb.adapters.createPg();
  const pool = new Pool() as unknown as DbPoolLike;
  await applyMigration(memDb);

  const redis = buildRedisMock();

  // --- Repos ----------------------------------------------------------
  const ratingChangedEvents: RatingChangedEvent[] = [];
  const aggregateRepo = createAggregateRepo(pool as never);

  /**
   * In-process emitter that mirrors the BullMQ-backed production
   * wiring (`createRatingChangedEmitter` + `startAggregateWorker`).
   * Calling `updateAggregate` synchronously here means the
   * "aggregate-rating recompute end-to-end" scenario in task 13.2 can
   * be measured by timing one rating mutation followed by one
   * `getAggregate` read.
   */
  const emitRatingChanged = async (
    event: RatingChangedEvent,
  ): Promise<void> => {
    ratingChangedEvents.push(event);
    await aggregateRepo.updateAggregate(
      event.experienceId,
      event.oldValue,
      event.newValue,
    );
  };

  const catalogRepo = createCatalogRepo(pool as never);
  const completionRepo = createCompletionRepo(pool as never);
  const noteRepo = createNoteRepo(pool as never);
  const ratingRepo = createRatingRepo({
    pool: pool as never,
    emitRatingChanged,
  });
  const friendsRepo = createFriendsRepo(pool as never);
  const sharingRepo = createSharingRepo(pool as never);
  const statsRepo = createStatsRepo(pool as never);
  const leaderboardService = createLeaderboard({
    pool: pool as never,
    redis: redis as never,
  });

  // --- Auth wiring ----------------------------------------------------
  const lockout = createLockoutService(redis as never);
  const sessionMiddleware = createSessionMiddleware({
    db: makeSessionDbAdapter(pool),
    hashToken: hashSessionToken,
  });

  // --- Build app ------------------------------------------------------
  const config = buildHarnessConfig();
  const app = buildServer(config, {
    catalog: {
      decideRead: async () => ({ staleCache: false }),
      listActiveExperiences: (filters) =>
        catalogRepo.listActiveExperiences(filters),
      getExperience: (id) => catalogRepo.getExperience(id),
    },
    friends: { repo: friendsRepo, requireSession: sessionMiddleware },
    sharing: { repo: sharingRepo, requireSession: sessionMiddleware },
    stats: {
      repo: statsRepo,
      pool: pool as never,
      requireSession: sessionMiddleware,
    },
    aggregate: { repo: aggregateRepo },
    leaderboard: { service: leaderboardService },
    tracking: {
      completion: {
        repo: completionRepo,
        requireSession: sessionMiddleware,
      },
      rating: { repo: ratingRepo, requireSession: sessionMiddleware },
      note: { repo: noteRepo, requireSession: sessionMiddleware },
    },
  });

  // Auth routes live outside BuildServerServices today; register them
  // directly so the auth-register/login SLA scenarios have a target.
  await app.register(
    authRoutes({
      pool: pool as never,
      lockout,
      requireSession: sessionMiddleware,
    }),
  );
  // Profile routes are also outside BuildServerServices; the harness
  // does not exercise them as SLA scenarios but registers them so the
  // app surface matches production for any test that wants to probe
  // them.
  await app.register(profileRoutes, {
    pool: pool as never,
    requireAuth: sessionMiddleware,
  });

  await app.ready();

  // --- Seed -----------------------------------------------------------
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const users = await seedUsers(pool, userCount, passwordHash);
  const experiences = await seedExperiences(pool, experienceCount);
  await seedRatings(
    pool,
    users,
    experiences,
    ratingCount,
    aggregateRepo,
  );

  // --- Return handle --------------------------------------------------
  const harness: Harness = {
    app,
    users,
    experiences,
    request: (method, url, init) => injectRequest(app, method, url, init),
    requestAs: (user, method, url, init) =>
      injectRequest(app, method, url, {
        ...(init ?? {}),
        headers: {
          authorization: `Bearer ${user.token}`,
          ...(init?.headers ?? {}),
        },
      }),
    measureScenarios: () =>
      measureScenarios({ app, users, experiences, pool, redis }),
    async teardown() {
      try {
        await app.close();
      } catch {
        // app.close() is idempotent in practice; swallow secondary
        // errors so the rest of the teardown still runs.
      }
      try {
        await (pool as unknown as { end?: () => Promise<void> }).end?.();
      } catch {
        // pg-mem's Pool#end is a no-op shim; ignore failures.
      }
      try {
        await redis.quit();
      } catch {
        // ioredis-mock quit is best-effort; swallow.
      }
    },
  };

  return harness;
}

// ---------------------------------------------------------------------------
// pg-mem setup
// ---------------------------------------------------------------------------

/**
 * Minimal projection of `pg.Pool` the API services actually call.
 *
 * Declared locally so this module does not have to import `pg` types
 * (the production code already does that via `db/pool.ts`); a
 * `pg-mem`-derived `Pool` is structurally compatible with this shape.
 */
interface DbPoolLike {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{
    rows: ReadonlyArray<unknown>;
    rowCount?: number | null;
  }>;
  connect: () => Promise<{
    query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{
      rows: ReadonlyArray<unknown>;
      rowCount?: number | null;
    }>;
    release: () => void;
  }>;
}

/**
 * Build a fresh `pg-mem` database with the extensions and system
 * functions our schema uses pre-registered.
 *
 * pg-mem ships a small set of built-in functions; everything our
 * migration mentions that isn't in that set must be registered before
 * the schema runs. The functions stubbed here are:
 *
 *   - `gen_random_uuid()` — provided by `pgcrypto` in production;
 *      registered as `crypto.randomUUID()` here.
 *   - `char_length(text)` — Postgres built-in not modeled by pg-mem;
 *      registered as a plain JS string-length wrapper.
 *   - `lower(text)`       — present in pg-mem but registered here for
 *      defense in depth so the SQL plans the same expression every
 *      time.
 *   - `pg_advisory_xact_lock(bigint)` — production runtime serializer
 *      for the aggregate worker; we stub it as a no-op because
 *      pg-mem is single-threaded and offers no concurrent visibility
 *      a lock could affect.
 *   - `hashtext(text)` — used by the aggregate repo to derive the
 *      advisory lock key; a deterministic 32-bit JS hash is
 *      sufficient for the harness because the lock itself is a
 *      no-op.
 */
function buildPgMemDatabase(): IMemoryDb {
  // `autoCreateForeignKeyIndices` is left at its default (`false`)
  // because the migration's explicit indexes (e.g.
  // `sessions_user_id_idx`) collide with the indices pg-mem would
  // create automatically — pg-mem treats a same-name collision as
  // an error.
  const db = newDb();

  db.registerExtension('citext', () => {
    // citext is supported natively by pg-mem.
  });
  db.registerExtension('pg_trgm', () => {
    // pg_trgm is consulted only by the GIN trigram indexes which we
    // strip from the migration; nothing else needs to be registered.
  });
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });
  pub.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (): boolean => true,
    impure: true,
  });
  pub.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => {
      if (typeof s !== 'string') return 0;
      let h = 0;
      for (let i = 0; i < s.length; i += 1) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
      }
      return h;
    },
  });

  return db;
}

/**
 * Apply the project's canonical migration to the pg-mem database.
 *
 * pg-mem doesn't support the `gin_trgm_ops` operator class, so the
 * GIN trigram indexes are stripped from the SQL before it is applied.
 * The functional `experiences_lower_name_idx` and the composite
 * `experiences_active_park_category_idx` are preserved verbatim;
 * those are the ones the perf-SLA scenarios actually rely on.
 */
async function applyMigration(db: IMemoryDb): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Apply the full migration chain (0001 → 0004) in order so the harness
  // schema matches production: 0002 adds image columns, 0003 adds the note
  // `shareable` flag, and 0004 reshapes `experiences` for the Disney sources
  // (nullable park, area_type + enrichment columns, expanded category /
  // area_type CHECKs, dropped image_attribution) plus the new resorts /
  // experience_menus / catalog_id_bridge tables. The seeded category set
  // (`EXPERIENCE_CATEGORIES` from @dwt/shared) now includes the expanded
  // taxonomy, so only the 0004 category CHECK admits values like `Tour`.
  const migrations = [
    '0001_init.sql',
    '0002_experience_images.sql',
    '0003_note_shareable.sql',
    '0004_disney_sources.sql',
    '0006_experience_land.sql',
    // 0009 adds the additive `experiences.represents_resort_id` column (plus its
    // partial-unique and active indexes) that the stats snapshot query now reads
    // via `(represents_resort_id IS NOT NULL) AS is_resort_representation`. Its
    // only dependency is the `resorts` table from 0004, so it applies cleanly on
    // top of this curated chain; without it `/me/stats` fails with a 500.
    '0009_resort_representing_experiences.sql',
    // 0010 widens the category CHECK to admit the `Resort` category the harness
    // now cycles through (`EXPERIENCE_CATEGORIES` includes `Resort`); without it
    // the seeded rows whose category lands on `Resort` violate the constraint.
    '0010_resort_experience_category.sql',
  ];
  for (const name of migrations) {
    const migrationPath = resolve(here, '..', '..', 'migrations', name);
    let sql = readFileSync(migrationPath, 'utf8');
    // Strip the GIN trigram indexes (`USING gin (... gin_trgm_ops)`); pg-mem
    // does not ship the `gin_trgm_ops` operator class. Only 0001 declares
    // any, but the strip is harmless on the others.
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    db.public.none(sql);
  }
}

// ---------------------------------------------------------------------------
// ioredis-mock setup
// ---------------------------------------------------------------------------

/**
 * Build a fresh ioredis-mock client. The harness uses Redis only for
 * the leaderboard cache and the lockout counter; both surfaces live
 * happily on the mock.
 */
function buildRedisMock(): InstanceType<typeof RedisMock> {
  // RedisMock's default options give us a self-contained, in-process
  // store that does not share state across instances. That isolation
  // is what makes the harness safe to spin up multiple times in the
  // same Vitest run.
  return new RedisMock();
}

// ---------------------------------------------------------------------------
// Session DB adapter
// ---------------------------------------------------------------------------

/**
 * Build a `SessionDbAdapter` against the harness pool. Mirrors the
 * production wiring (which lives in `auth/routes.ts`'s caller, since
 * the middleware does not own its own adapter).
 */
function makeSessionDbAdapter(pool: DbPoolLike): SessionDbAdapter {
  return {
    async findByTokenHash(tokenHash) {
      const result = await pool.query(
        `SELECT id, user_id, absolute_expires_at, last_seen_at, revoked_at
           FROM sessions
          WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = (result.rows as ReadonlyArray<SessionRow>)[0];
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

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `AppConfig` for the harness. The values are
 * meaningful only insofar as they satisfy the production config's
 * Zod constraints (URL shapes, 32-char session secret); the in-memory
 * backends ignore the URLs entirely.
 */
function buildHarnessConfig(): AppConfig {
  return {
    env: 'test',
    server: {
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
    },
    database: { url: 'postgres://harness/dwt' },
    redis: { url: 'redis://harness:6379' },
    session: {
      secret: 'harness-session-secret-must-be-at-least-32-chars',
    },
    themeparks: { baseUrl: 'https://api.themeparks.example.invalid/v1' },
    disney: {
      syncGateway: { baseUrl: 'https://sync-gw.example.invalid/park-platform-pub/' },
      credentials: { username: 'harness-user', password: 'harness-pass' },
    },
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Insert N users + profiles + sessions in one round-trip per row.
 *
 * Every user gets the same `password_hash` (argon2id of
 * {@link SEED_PASSWORD}) so the harness only pays the argon2 cost
 * once. The session token is freshly generated per user so each
 * `requestAs(user, ...)` call carries a distinct bearer.
 */
async function seedUsers(
  pool: DbPoolLike,
  count: number,
  passwordHash: string,
): Promise<HarnessUser[]> {
  const out: HarnessUser[] = [];
  const now = new Date();
  // 24-hour absolute window from issuance, matching authRoutes.handleRegister.
  const absoluteExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  for (let i = 0; i < count; i += 1) {
    const email = `user${i}@harness.example`;
    const displayName = `Harness User ${i}`;
    const userInsert = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [email, passwordHash],
    );
    const userId = (userInsert.rows as ReadonlyArray<{ id: string }>)[0]?.id;
    if (!userId) {
      throw new Error('seedUsers: INSERT did not return a row');
    }
    await pool.query(
      `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
      [userId, displayName],
    );
    const tokenPair = generateToken();
    await pool.query(
      `INSERT INTO sessions (
         user_id, token_hash, created_at, last_seen_at, absolute_expires_at
       ) VALUES ($1, $2, $3, $3, $4)`,
      [userId, tokenPair.tokenHash, now, absoluteExpiresAt],
    );
    out.push({
      userId,
      email,
      password: SEED_PASSWORD,
      displayName,
      token: tokenPair.token,
    });
  }
  return out;
}

/**
 * Insert M experiences cycling through the closed `Park` and
 * `Experience_Category` enums. Each experience also gets a
 * deterministic upstream id (`harness-entity-${i}`) so the row's
 * primary key is a stable UUIDv5, matching production behavior.
 */
async function seedExperiences(
  pool: DbPoolLike,
  count: number,
): Promise<HarnessExperience[]> {
  const out: HarnessExperience[] = [];
  for (let i = 0; i < count; i += 1) {
    const upstreamEntityId = `harness-entity-${i}`;
    const id = internalId(upstreamEntityId);
    const park = PARKS[i % PARKS.length] as string;
    const category = EXPERIENCE_CATEGORIES[
      i % EXPERIENCE_CATEGORIES.length
    ] as string;
    const name = `Harness Experience ${i}`;
    await pool.query(
      `INSERT INTO experiences (
         id, upstream_entity_id, name, park, category, description, active
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [id, upstreamEntityId, name, park, category, ''],
    );
    out.push({ id, upstreamEntityId, name, park, category });
  }
  return out;
}

/**
 * Insert K ratings spread across the seeded users and experiences.
 *
 * Pair selection walks experiences in the inner loop and users in the
 * outer loop, so the first `experiences` ratings cover every Experience
 * with one user, the next `experiences` ratings cover every Experience
 * with the second user, and so on. This guarantees:
 *
 *   - every `(user, experience)` pair is unique (so the `ratings` PK is
 *     never violated);
 *   - if `K >= experiences`, every Experience has at least one rating;
 *   - if `K >= experiences * MIN_AGGREGATE_RATING_COUNT`, every
 *     Experience qualifies for the leaderboard's 3-rating threshold.
 *
 * After every successful insert, the aggregate row is also rolled
 * forward via `updateAggregate` so the `count_ratings`/`mean_x10`
 * surfaces are consistent with the seeded `ratings` rows. This
 * mirrors the production write path where the rating repo emits a
 * `RatingChanged` event the aggregate worker consumes; the harness
 * does the same work synchronously.
 */
async function seedRatings(
  pool: DbPoolLike,
  users: ReadonlyArray<HarnessUser>,
  experiences: ReadonlyArray<HarnessExperience>,
  count: number,
  aggregateRepo: ReturnType<typeof createAggregateRepo>,
): Promise<void> {
  if (count === 0) return;
  const maxPairs = users.length * experiences.length;
  if (count > maxPairs) {
    throw new Error(
      `seedRatings: requested ${count} ratings exceeds users * experiences = ${maxPairs}`,
    );
  }

  let inserted = 0;
  // Outer loop = users, inner = experiences. Deterministic, distinct
  // pairs, and walks experiences quickly so even small K seeds many
  // experiences.
  outer: for (let u = 0; u < users.length; u += 1) {
    for (let e = 0; e < experiences.length; e += 1) {
      if (inserted >= count) break outer;
      const userRow = users[u];
      const experienceRow = experiences[e];
      if (!userRow || !experienceRow) continue;
      // Distribute rating values 1..10 cyclically so the aggregate
      // means are non-trivial (not all 5.5).
      const value = ((inserted % 10) + 1) as number;
      await pool.query(
        `INSERT INTO ratings (user_id, experience_id, value)
         VALUES ($1, $2, $3)`,
        [userRow.userId, experienceRow.id, value],
      );
      // Update the aggregate row through the same code path the
      // production worker uses, so leaderboard/aggregate reads see
      // realistic counts.
      await aggregateRepo.updateAggregate(experienceRow.id, null, value);
      inserted += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Request injection
// ---------------------------------------------------------------------------

/**
 * Wrap `app.inject` in a typed helper that exposes the bits the
 * harness actually needs (status, headers, body string, and a `json`
 * accessor).
 */
async function injectRequest(
  app: FastifyInstance,
  method: string,
  url: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}> {
  const payload = init.body;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let resolvedPayload: string | undefined;
  if (payload === undefined || payload === null) {
    resolvedPayload = undefined;
  } else if (
    typeof payload === 'object' &&
    !Buffer.isBuffer(payload) &&
    !(payload instanceof Uint8Array)
  ) {
    if (
      headers['content-type'] === undefined &&
      headers['Content-Type'] === undefined
    ) {
      headers['content-type'] = 'application/json';
    }
    resolvedPayload = JSON.stringify(payload);
  } else {
    resolvedPayload = String(payload);
  }

  const injectOptions = {
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url,
    headers,
    ...(resolvedPayload !== undefined ? { payload: resolvedPayload } : {}),
  };
  const response = await app.inject(injectOptions);

  return {
    statusCode: response.statusCode,
    headers: response.headers as Record<
      string,
      string | string[] | undefined
    >,
    body: response.body,
    json: () => JSON.parse(response.body) as unknown,
  };
}

// ---------------------------------------------------------------------------
// Scenario measurement
// ---------------------------------------------------------------------------

interface MeasureContext {
  readonly app: FastifyInstance;
  readonly users: ReadonlyArray<HarnessUser>;
  readonly experiences: ReadonlyArray<HarnessExperience>;
  readonly pool: DbPoolLike;
  readonly redis: InstanceType<typeof RedisMock>;
}

/**
 * Run the SLA-relevant scenarios once and return the wall-clock
 * latencies. The results feed task 13.2's perf-SLA assertions.
 *
 * The scenarios are run sequentially so each measurement reflects
 * the cost of a single request against a quiescent server (the
 * way each SLA's user perception is described in the requirements
 * document). The leaderboard scenario is run twice — once cold
 * (cache miss → DB read → Redis write) and once warm (cache hit) —
 * because R11.7-R11.9 specifies the warm-cache budget.
 */
async function measureScenarios(
  ctx: MeasureContext,
): Promise<ScenarioLatencies> {
  const { app, users, experiences, redis } = ctx;
  const user = users[0];
  if (!user) {
    throw new Error('measureScenarios: harness has no seeded users');
  }
  const experience = experiences[0];
  if (!experience) {
    throw new Error(
      'measureScenarios: harness has no seeded experiences',
    );
  }

  const meStats = await timeMs(async () => {
    await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { authorization: `Bearer ${user.token}` },
    });
  });

  const putNote = await timeMs(async () => {
    await app.inject({
      method: 'PUT',
      url: `/me/experiences/${experience.id}/note`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ body: 'Smoke harness note' }),
    });
  });

  const authRegister = await timeMs(async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: `register-smoke-${Date.now()}@harness.example`,
        password: SEED_PASSWORD,
        displayName: 'Register Smoke User',
      }),
    });
  });

  const authLogin = await timeMs(async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: user.email,
        password: user.password,
      }),
    });
  });

  // Aggregate-rating recompute end-to-end: emit a rating change and
  // wait for the in-process emitter to flush before the aggregate
  // read returns. The synchronous emitter wired in `setupHarness`
  // means the recompute is complete by the time the rating-PUT
  // response returns; we still measure the full round-trip
  // (rating-PUT followed by aggregate-rating GET) so the value
  // reflects the perceived end-to-end latency.
  const aggregateRecompute = await timeMs(async () => {
    await app.inject({
      method: 'PUT',
      url: `/me/experiences/${experience.id}/rating`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ value: 7 }),
    });
    await app.inject({
      method: 'GET',
      url: `/experiences/${experience.id}/aggregate-rating`,
    });
  });

  // Cold leaderboard: drop the cache key first so the request takes
  // the DB → Redis-write path.
  await redis.del('highest-rated:v1');
  const homeHighestRatedCold = await timeMs(async () => {
    await app.inject({ method: 'GET', url: '/home/highest-rated' });
  });
  // Warm leaderboard: the previous request populated the cache;
  // this one hits Redis only.
  const homeHighestRatedWarm = await timeMs(async () => {
    await app.inject({ method: 'GET', url: '/home/highest-rated' });
  });

  const catalogList = await timeMs(async () => {
    await app.inject({ method: 'GET', url: '/catalog' });
  });

  return {
    meStats,
    putNote,
    authRegister,
    authLogin,
    aggregateRecompute,
    homeHighestRatedCold,
    homeHighestRatedWarm,
    catalogList,
  };
}

/**
 * Time a single async operation in milliseconds using
 * `performance.now()`. Used for every scenario in
 * {@link measureScenarios}.
 */
async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}
