/**
 * Redis-backed `Live_Cache` for the `Live_Service`.
 *
 * Task 6.1 of the experience-live-details spec. Implements the cache surface
 * described in design.md "Live_Cache (cache.ts)":
 *
 *   - Store the most recently retrieved `Live_Detail` for an Experience,
 *     keyed by the *internal* Experience id under `live:v1:{experienceId}`.
 *   - Each stored entry carries a `retrievedAt` ISO-8601 UTC stamp (the
 *     Retrieved_At time, R2.4) so the orchestrator can decide freshness in
 *     application code by comparing `now - retrievedAt` against the TTL
 *     (R2.1, R2.2). The cache itself makes no freshness decision.
 *
 * Freshness vs retention
 * ----------------------
 *
 * The 5-minute `LIVE_CACHE_TTL_SECONDS` is a *freshness* budget evaluated in
 * the orchestrator (R2.3). It is deliberately NOT the Redis key expiry,
 * because R2.6/R2.7/R3.1 require serving the most recent cached value
 * *regardless of age* when a fresh retrieval times out or errors. If the key
 * expired at the freshness window, the stale-serve fallback would have
 * nothing to fall back to. The Redis key therefore uses the longer
 * `LIVE_CACHE_RETENTION_SECONDS` expiry so a stale-but-present entry survives
 * well past the freshness window and remains available as a fallback.
 *
 * Key layout
 * ----------
 *
 *   live:v1:{experienceId}  ->  JSON.stringify(CachedLiveDetail)
 *
 * The `:v1` segment scopes the cache to this payload version, matching the
 * leaderboard convention (`highest-rated:v1`). Bumping it invalidates every
 * cached entry across all replicas without an explicit purge.
 *
 * Malformed-payload-as-miss
 * -------------------------
 *
 * A cached blob that fails to parse as JSON, is not the expected
 * `{ liveDetail, retrievedAt }` envelope, or whose `liveDetail` fails the
 * shared `liveDetailSchema` shape check is treated as a cache miss (`get`
 * returns `null`), exactly as the leaderboard cache does. This protects
 * against an operator hand-setting the key, against pre-format-version
 * payloads, and against a Redis client returning a malformed string.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.6, 2.7
 */

import type { LiveDetailDTO } from '@dwt/shared';
import { liveDetailSchema } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Freshness window in seconds. R2.3 mandates a 5-minute `Live_Cache_TTL`.
 * The orchestrator compares `now - retrievedAt` against this value to decide
 * whether a cached entry may be served without contacting upstream (R2.1,
 * R2.2). This is NOT the Redis key expiry — see {@link LIVE_CACHE_RETENTION_SECONDS}.
 */
export const LIVE_CACHE_TTL_SECONDS = 300;

/**
 * Redis key retention in seconds (24 hours). This is the actual expiry set on
 * the Redis key so that a stale-but-present entry survives long past the
 * freshness window and remains available for the stale-serve fallback when a
 * fresh retrieval times out or errors (R2.6, R2.7, R3.1).
 */
export const LIVE_CACHE_RETENTION_SECONDS = 24 * 60 * 60;

/**
 * Build the Redis key for an Experience's cached Live_Detail. The `live:v1:`
 * prefix scopes the payload version for invalidation (matching the
 * leaderboard `:v1` convention).
 */
export function liveCacheKey(experienceId: string): string {
  return `live:v1:${experienceId}`;
}

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

/**
 * The cached envelope: a projected `Live_Detail` plus the Retrieved_At time
 * at which it was fetched from the upstream (R2.4). The orchestrator reads
 * `retrievedAt` to compute the entry's age and decide freshness.
 */
export interface CachedLiveDetail {
  readonly liveDetail: LiveDetailDTO;
  /** ISO-8601 UTC, the Retrieved_At time (R2.4). */
  readonly retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Redis interface (for injection)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `ioredis`'s `Redis` API that this module touches.
 * Accepting a structural interface lets unit tests pass an in-memory fake
 * without standing up a real Redis. The `set` rest signature matches
 * ioredis's many overloads so a real client type-checks without casts; we
 * invoke it as `set(key, value, 'EX', LIVE_CACHE_RETENTION_SECONDS)`.
 */
export interface LiveCacheRedis {
  /** GET. Returns `null` when the key is absent. */
  get(key: string): Promise<string | null>;
  /**
   * SET with options. We invoke as `set(key, value, 'EX', seconds)` so the
   * rest tail covers the TTL flag pair without committing to a narrower
   * overload than ioredis exposes.
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
 * The `Live_Cache` surface. Read returns the most recent cached entry for an
 * Experience *regardless of age* (the freshness decision lives in the
 * orchestrator); write stores a freshly-retrieved entry with its
 * Retrieved_At.
 */
export interface LiveCache {
  /** Most recent cached entry for an Experience, or `null` on miss / malformed. */
  get(experienceId: string): Promise<CachedLiveDetail | null>;
  /** Store a freshly-retrieved Live_Detail with its Retrieved_At time. */
  set(experienceId: string, entry: CachedLiveDetail): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link LiveCache} backed by the supplied Redis client. The cache
 * holds no state of its own; every entry lives in Redis under
 * `live:v1:{experienceId}` with a {@link LIVE_CACHE_RETENTION_SECONDS} expiry.
 */
export function createLiveCache(redis: LiveCacheRedis): LiveCache {
  return {
    async get(experienceId: string): Promise<CachedLiveDetail | null> {
      const raw = await redis.get(liveCacheKey(experienceId));
      if (raw === null) return null;
      return parseCachedLiveDetail(raw);
    },

    async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
      await redis.set(
        liveCacheKey(experienceId),
        JSON.stringify(entry),
        'EX',
        LIVE_CACHE_RETENTION_SECONDS,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Parse and structurally validate a cached blob. Returns the typed envelope
 * on success, `null` on any failure: bad JSON, a non-envelope shape, a
 * missing/invalid `retrievedAt`, or a `liveDetail` that fails the shared
 * `liveDetailSchema`. All failure modes are folded together because they are
 * operationally equivalent — the orchestrator treats them as a cache miss.
 */
function parseCachedLiveDetail(raw: string): CachedLiveDetail | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['retrievedAt'] !== 'string') return null;

  const result = liveDetailSchema.safeParse(obj['liveDetail']);
  if (!result.success) return null;

  // The Zod-inferred output widens optional fields to `T | undefined`, which
  // is incompatible with the DTO's exact-optional declarations under
  // `exactOptionalPropertyTypes`. The schema has already enforced the exact
  // shape, so the validated data is a `LiveDetailDTO`.
  return {
    liveDetail: result.data as LiveDetailDTO,
    retrievedAt: obj['retrievedAt'],
  };
}
