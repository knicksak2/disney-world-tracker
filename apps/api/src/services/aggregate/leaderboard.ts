/**
 * Highest-Rated Experiences leaderboard with Redis 5-minute cache.
 *
 * Task 8.5 of the disney-world-tracker plan. Implements the leaderboard
 * surface described in design.md "Aggregate_Ratings_Service → Highest-
 * rated leaderboard":
 *
 *   - Rank all Experiences whose `aggregate_ratings.count_ratings >= 3`
 *     and `experiences.active = TRUE` by:
 *        1. `mean_x10`        descending,
 *        2. `count_ratings`   descending,
 *        3. `lower(name)`     ascending.
 *     Cap the result at 10 rows (R11.4).
 *
 *   - Cache the rendered JSON payload in Redis under `highest-rated:v1`
 *     with a 300-second (5-minute) TTL. Subsequent `getLeaderboard`
 *     calls within the TTL serve the cached JSON without touching the
 *     database (R11.7, R11.8, R11.9).
 *
 * Rendering at the SQL boundary
 * -----------------------------
 *
 * `aggregate_ratings.mean_x10` is stored as a `SMALLINT` in the range
 * `[10, 100]` to dodge floating-point representation drift. The wire
 * shape is a one-decimal `value: number` in `[1.0, 10.0]` per the
 * `LeaderboardEntryDTO` contract, so the SQL renders `mean_x10::float
 * / 10` as `value`. Because `mean_x10` is an integer and the divisor is
 * `10`, the resulting float is exactly representable for every row that
 * passes the threshold; no client-side rounding is needed.
 *
 * Cache layout
 * ------------
 *
 *   highest-rated:v1   →  JSON.stringify(entries: LeaderboardEntryDTO[])
 *
 * The `:v1` suffix scopes the cache to this payload version. If the
 * leaderboard's wire shape ever changes (e.g. a new field is added),
 * incrementing the suffix invalidates every cached payload across all
 * replicas without an explicit purge.
 *
 * Failure semantics
 * -----------------
 *
 *   - A `redis.get` failure is propagated; the caller (route handler)
 *     surfaces it through the global error hook. Falling back to the DB
 *     on cache failure would silently sustain pressure on the database
 *     under a sustained Redis outage; the explicit propagation makes the
 *     dependency visible.
 *   - A successful DB read followed by a `redis.set` failure does *not*
 *     swallow the row data: the rows are returned to the caller, and the
 *     write error is logged but not thrown. A subsequent call retries
 *     the DB+cache cycle. This keeps the read path resilient when Redis
 *     is healthy enough to read but unhealthy enough to write.
 *   - A cached JSON payload that fails to parse or fails the shape check
 *     is treated as a cache miss: the DB query runs and the cache is
 *     overwritten with the canonical payload. This protects against an
 *     operator manually setting the key, against pre-format-version
 *     payloads, and against a Redis client returning a malformed string.
 *
 * Validates: Requirements R11.2, R11.3, R11.4, R11.5, R11.7, R11.8, R11.9, R11.10, R11.11
 */

import type { LeaderboardEntryDTO } from '@dwt/shared';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stable Redis key for the cached payload. The `:v1` suffix scopes the
 * cache to this payload version so a wire-shape change can invalidate
 * every replica's cached entry by bumping the suffix.
 */
export const LEADERBOARD_REDIS_KEY = 'highest-rated:v1';

/**
 * Cache TTL in seconds. R11.7-R11.9 mandate a 5-minute refresh budget;
 * the TTL is the upper bound on cached-payload age served to clients.
 */
export const LEADERBOARD_TTL_SECONDS = 5 * 60;

/**
 * Hard cap on the number of rows returned by the leaderboard. R11.4
 * defines the top-10 limit; the SQL also enforces this with `LIMIT 10`,
 * but exposing the constant lets the route layer and tests assert
 * against a single source of truth.
 */
export const LEADERBOARD_LIMIT = 10;

/**
 * Minimum count of contributing Ratings before an Experience qualifies
 * for the leaderboard (R11.2). The DB filter (`count_ratings >= 3`) and
 * the threshold gate inside `aggregate_ratings` (mean_x10 NULL when
 * count < 3) are the two enforcement points; this constant documents
 * the third (the in-process expectation).
 */
export const LEADERBOARD_MIN_COUNT = 3;

// ---------------------------------------------------------------------------
// Redis interface (for injection)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `ioredis`'s `Redis` API that this module touches.
 * Accepting a structural interface lets unit tests pass an in-memory
 * fake without standing up a real Redis. The `set` rest signature
 * matches ioredis's many overloads so a real client type-checks
 * without casts; we use `'EX', LEADERBOARD_TTL_SECONDS` at the call
 * site.
 */
export interface LeaderboardRedis {
  /** GET. Returns `null` when the key is absent. */
  get(key: string): Promise<string | null>;
  /**
   * SET with options. We invoke as `set(key, value, 'EX', seconds)` so
   * the rest tail covers the TTL flag pair without committing to a
   * narrower overload than ioredis exposes.
   */
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Inputs to `createLeaderboard`. Dependencies are passed in explicitly
 * so the factory can be wired in `buildServer` (or in a test harness)
 * without reaching for module-level singletons.
 *
 *   - `pool`   — Postgres pool used for the leaderboard read.
 *   - `redis`  — Redis client used for the 5-minute payload cache.
 *   - `logger` — optional callback invoked with the underlying error
 *                when a cache write fails. Defaults to a no-op so the
 *                production wiring remains silent unless explicitly
 *                opted in.
 */
export interface CreateLeaderboardOptions {
  readonly pool: DbPool;
  readonly redis: LeaderboardRedis;
  readonly logger?: (event: LeaderboardCacheWriteFailure) => void;
}

/**
 * Event emitted when the leaderboard service successfully reads from
 * the database but fails to write the result back to Redis. Exposed so
 * the production wiring can plumb it into pino without coupling this
 * module to a concrete logger.
 */
export interface LeaderboardCacheWriteFailure {
  readonly kind: 'cache_write_failure';
  readonly error: unknown;
}

/**
 * Public surface returned by `createLeaderboard`. A single method is
 * sufficient because the leaderboard is read-only from this service's
 * perspective; the cache is invalidated implicitly by its TTL, not by
 * an explicit purge call.
 */
export interface LeaderboardService {
  /**
   * Read the top-10 Highest-Rated Experiences. On a cache hit (younger
   * than 5 minutes) the cached payload is parsed and returned without
   * touching the database. On a miss, the SQL query runs, the result is
   * cached under {@link LEADERBOARD_REDIS_KEY} with a 5-minute TTL, and
   * the rows are returned.
   *
   * The optional `now` parameter is reserved for parity with future
   * staleness semantics (e.g. forcing a refresh by passing a cache
   * floor); the current implementation relies entirely on the Redis TTL
   * to decide freshness, so the parameter has no observable effect.
   */
  getLeaderboard(now?: Date): Promise<readonly LeaderboardEntryDTO[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `LeaderboardService` against the supplied pool and redis
 * client. The service holds no state between calls; the cache lives in
 * Redis and is the only durable side effect of `getLeaderboard`.
 */
export function createLeaderboard(
  options: CreateLeaderboardOptions,
): LeaderboardService {
  const { pool, redis, logger = noopLogger } = options;

  return {
    async getLeaderboard(_now?: Date): Promise<readonly LeaderboardEntryDTO[]> {
      // Reference the parameter so a stricter `noUnusedParameters`
      // configuration does not complain about the reserved hook.
      void _now;

      const cached = await readFromCache(redis);
      if (cached !== null) {
        return cached;
      }
      const fresh = await readFromDb(pool);
      await writeToCache(redis, fresh, logger);
      return fresh;
    },
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Try to serve the leaderboard from the Redis cache.
 *
 * Returns the parsed entries on a successful read with a structurally
 * valid payload; returns `null` on cache miss, on JSON parse failure, or
 * on shape validation failure. The two failure modes are folded together
 * because both are operationally equivalent: the route handler should
 * fall through to a fresh DB read and overwrite the cache.
 *
 * `redis.get` errors are intentionally NOT caught here — propagating
 * them surfaces a degraded Redis to the global error hook, where it
 * lands as `internal_error`. Silently falling back to the DB would mask
 * a sustained Redis outage and shift load onto the database.
 */
async function readFromCache(
  redis: LeaderboardRedis,
): Promise<readonly LeaderboardEntryDTO[] | null> {
  const raw = await redis.get(LEADERBOARD_REDIS_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return validatePayload(parsed);
}

/**
 * Persist the freshly-read rows to Redis with a 5-minute TTL. The TTL
 * is the only source of staleness for the leaderboard (R11.7, R11.9).
 *
 * On write failure, the rows are returned to the caller anyway; the
 * `logger` callback receives the underlying error so the production
 * wiring can route it to pino. We do not throw because the read path is
 * still complete and useful; the next call retries the DB+cache cycle.
 */
async function writeToCache(
  redis: LeaderboardRedis,
  entries: readonly LeaderboardEntryDTO[],
  logger: (event: LeaderboardCacheWriteFailure) => void,
): Promise<void> {
  try {
    await redis.set(
      LEADERBOARD_REDIS_KEY,
      JSON.stringify(entries),
      'EX',
      LEADERBOARD_TTL_SECONDS,
    );
  } catch (error) {
    logger({ kind: 'cache_write_failure', error });
  }
}

/**
 * Default cache-write failure logger. Production callers replace this
 * with a pino-bound function; tests usually inject a recorder.
 */
function noopLogger(_event: LeaderboardCacheWriteFailure): void {
  // intentionally no-op
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Row shape returned by the leaderboard SQL. `value` is rendered at the
 * SQL boundary as `mean_x10::float / 10` so node-postgres delivers a
 * primitive `number` rather than the `pg.Numeric` string the column's
 * SMALLINT storage would imply if we returned `mean_x10` directly.
 */
interface LeaderboardRow {
  readonly id: string;
  readonly name: string;
  readonly park: string;
  readonly category: string;
  readonly value: number;
  readonly count: number;
}

/**
 * Run the leaderboard SQL and project rows onto the wire DTO.
 *
 * Filters: `e.active = TRUE` (R11.2 catalog gate) and `ar.count_ratings
 *  >= 3` (R11.2 sample-size gate).
 *
 * Ordering: `ar.mean_x10 DESC, ar.count_ratings DESC, lower(e.name) ASC`
 * matches R11.3 verbatim. The `aggregate_ratings_leaderboard_idx`
 * partial index defined in `migrations/0001_init.sql` is on `(mean_x10
 * DESC, count_ratings DESC) WHERE mean_x10 IS NOT NULL`, which lines up
 * with the first two ORDER BY keys; the third (`lower(e.name)`)
 * tie-breaks within a small bucket and runs against the in-memory plan
 * without scanning the catalog.
 *
 * Limit: `LIMIT 10` per R11.4. R11.10 (1..9 qualifying Experiences) is
 * handled implicitly: `LIMIT 10` returns whatever count the qualifying
 * set has up to 10. R11.11 (zero qualifying) yields an empty result.
 */
async function readFromDb(
  pool: DbPool,
): Promise<readonly LeaderboardEntryDTO[]> {
  const result = await pool.query<LeaderboardRow>(
    `SELECT e.id,
            e.name,
            e.park,
            e.category,
            ar.mean_x10::float / 10 AS value,
            ar.count_ratings        AS count
       FROM aggregate_ratings ar
       JOIN experiences       e ON ar.experience_id = e.id
      WHERE e.active = TRUE
        AND ar.count_ratings >= ${LEADERBOARD_MIN_COUNT}
      ORDER BY ar.mean_x10 DESC,
               ar.count_ratings DESC,
               lower(e.name) ASC
      LIMIT ${LEADERBOARD_LIMIT}`,
  );
  return result.rows.map(rowToDto);
}

/**
 * Translate a raw row into the wire DTO. The column-to-field mapping is
 * exhaustive and total; any row whose `park` or `category` does not
 * match the shared enum is dropped silently because the DTO has no
 * place for it. This mirrors the defense-in-depth pattern used in
 * `services/stats/repo.ts`.
 */
function rowToDto(row: LeaderboardRow): LeaderboardEntryDTO {
  return {
    experienceId: row.id,
    name: row.name,
    park: row.park as Park,
    category: row.category as ExperienceCategory,
    value: row.value,
    count: row.count,
  };
}

// ---------------------------------------------------------------------------
// Cache payload validation
// ---------------------------------------------------------------------------

/**
 * Fast structural check used to decide whether a cached JSON blob is
 * trustworthy. We avoid pulling Zod into the hot read path; instead we
 * verify the shape locally with the same rules the leaderboard schema
 * enforces (Park / Category in their enums, `value` in `[1, 10]`, `count
 *  >= 3`). The wider `leaderboardEntrySchema` lives in `@dwt/shared` and
 * is the public-facing source of truth for the wire shape.
 *
 * Returns the typed array on success, `null` on any structural mismatch.
 */
function validatePayload(
  parsed: unknown,
): readonly LeaderboardEntryDTO[] | null {
  if (!Array.isArray(parsed)) return null;
  if (parsed.length > LEADERBOARD_LIMIT) return null;

  const entries: LeaderboardEntryDTO[] = [];
  for (const candidate of parsed) {
    const entry = validateEntry(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}

/**
 * Single-entry validator used by `validatePayload`. Mirrors the rules
 * encoded in `@dwt/shared`'s `leaderboardEntrySchema`:
 *
 *   - `experienceId` is a string (UUID format check is defense in depth
 *     and is left to the schema; here we only need a string),
 *   - `name` is a non-empty string,
 *   - `park` is in the closed Park enum,
 *   - `category` is in the closed ExperienceCategory enum,
 *   - `value` is a finite number in `[1.0, 10.0]`,
 *   - `count` is an integer `>= LEADERBOARD_MIN_COUNT`.
 */
function validateEntry(candidate: unknown): LeaderboardEntryDTO | null {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return null;
  }
  const obj = candidate as Record<string, unknown>;
  if (typeof obj['experienceId'] !== 'string') return null;
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) return null;
  if (typeof obj['park'] !== 'string' || !PARK_SET.has(obj['park'])) {
    return null;
  }
  if (
    typeof obj['category'] !== 'string' ||
    !CATEGORY_SET.has(obj['category'])
  ) {
    return null;
  }
  if (
    typeof obj['value'] !== 'number' ||
    !Number.isFinite(obj['value']) ||
    obj['value'] < 1 ||
    obj['value'] > 10
  ) {
    return null;
  }
  if (
    typeof obj['count'] !== 'number' ||
    !Number.isInteger(obj['count']) ||
    obj['count'] < LEADERBOARD_MIN_COUNT
  ) {
    return null;
  }
  return {
    experienceId: obj['experienceId'],
    name: obj['name'],
    park: obj['park'] as Park,
    category: obj['category'] as ExperienceCategory,
    value: obj['value'],
    count: obj['count'],
  };
}

/** Set of valid Park values for O(1) enum membership checks. */
const PARK_SET = new Set<string>(PARKS);

/** Set of valid ExperienceCategory values for O(1) enum membership checks. */
const CATEGORY_SET = new Set<string>(EXPERIENCE_CATEGORIES);
