/**
 * Unit tests for the Live_Service `Live_Cache` (task 6.2).
 *
 * The cache is exercised against an in-memory, Map-backed fake
 * `LiveCacheRedis` that records every `set` invocation (key, value, and the
 * variadic option tail) so the tests can assert on the exact Redis call shape
 * without standing up a real Redis. Each test is hermetic and deterministic.
 *
 * Coverage focuses on the behaviors the design pins on this module
 * (design.md "Live_Cache (cache.ts)"):
 *
 *   - The freshness budget `LIVE_CACHE_TTL_SECONDS` is the documented 5
 *     minutes (R2.3).
 *   - A stored `CachedLiveDetail` round-trips back out of `get` unchanged
 *     (R2.4).
 *   - The key is `live:v1:{experienceId}` and `set` writes with the `EX`
 *     flag carrying the longer retention seconds (NOT the TTL) so the
 *     stale-serve fallback survives the freshness window (R2.6, R2.7).
 *   - A malformed blob — both unparseable JSON and a structurally valid
 *     envelope whose `liveDetail` fails `liveDetailSchema` — is treated as a
 *     cache miss (`get` returns `null`).
 *
 * Validates: Requirements 2.3, 2.4
 */

import { describe, expect, it } from 'vitest';
import type { LiveDetailDTO } from '@dwt/shared';

import {
  LIVE_CACHE_RETENTION_SECONDS,
  LIVE_CACHE_TTL_SECONDS,
  type CachedLiveDetail,
  type LiveCacheRedis,
  createLiveCache,
  liveCacheKey,
} from '../cache.js';

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------

interface SetCall {
  readonly key: string;
  readonly value: string;
  readonly args: ReadonlyArray<string | number>;
}

/**
 * Minimal in-memory `LiveCacheRedis`. Backed by a `Map`, it ignores TTL
 * expiry (the cache module sets a retention expiry that the unit tests assert
 * on directly via the recorded `set` calls rather than by simulating clock
 * advance). Every `set` is also recorded so tests can inspect the exact call
 * shape, and `seed` lets a test plant a raw blob to drive the
 * malformed-as-miss path.
 */
class FakeRedis implements LiveCacheRedis {
  private readonly store = new Map<string, string>();
  readonly setCalls: SetCall[] = [];

  /** Plant a raw value directly, bypassing the recorded `set` path. */
  seed(key: string, value: string): void {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.store.set(key, value);
    this.setCalls.push({ key, value, args: [...args] });
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = 'exp-123';

/** The minimal projected Live_Detail accepted by `liveDetailSchema`. */
const MINIMAL_LIVE_DETAIL: LiveDetailDTO = {
  status: 'Unknown',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
};

const CACHED_ENTRY: CachedLiveDetail = {
  liveDetail: MINIMAL_LIVE_DETAIL,
  retrievedAt: '2024-05-01T13:00:00Z',
};

// ---------------------------------------------------------------------------
// TTL constant (R2.3)
// ---------------------------------------------------------------------------

describe('Live_Cache — freshness TTL constant', () => {
  it('LIVE_CACHE_TTL_SECONDS is the documented 5 minutes (300s)', () => {
    expect(LIVE_CACHE_TTL_SECONDS).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

describe('Live_Cache — key layout', () => {
  it('keys an Experience under live:v1:{experienceId}', () => {
    expect(liveCacheKey(EXPERIENCE_ID)).toBe(`live:v1:${EXPERIENCE_ID}`);
  });
});

// ---------------------------------------------------------------------------
// Round-trip store/get (R2.4)
// ---------------------------------------------------------------------------

describe('Live_Cache — store/get round-trip', () => {
  it('round-trips a stored CachedLiveDetail back out unchanged', async () => {
    const redis = new FakeRedis();
    const cache = createLiveCache(redis);

    await cache.set(EXPERIENCE_ID, CACHED_ENTRY);
    const got = await cache.get(EXPERIENCE_ID);

    expect(got).toEqual(CACHED_ENTRY);
  });

  it('writes under the canonical key with EX carrying the retention seconds (not the TTL)', async () => {
    const redis = new FakeRedis();
    const cache = createLiveCache(redis);

    await cache.set(EXPERIENCE_ID, CACHED_ENTRY);

    expect(redis.setCalls).toHaveLength(1);
    const call = redis.setCalls[0]!;
    expect(call.key).toBe(`live:v1:${EXPERIENCE_ID}`);
    expect(call.value).toBe(JSON.stringify(CACHED_ENTRY));
    expect(call.args).toEqual(['EX', LIVE_CACHE_RETENTION_SECONDS]);
    // The retention expiry is deliberately longer than the freshness window
    // so the stale-serve fallback (R2.6/R2.7) has something to serve.
    expect(LIVE_CACHE_RETENTION_SECONDS).toBeGreaterThan(LIVE_CACHE_TTL_SECONDS);
  });

  it('returns null on a genuine miss (key absent)', async () => {
    const redis = new FakeRedis();
    const cache = createLiveCache(redis);

    expect(await cache.get('never-stored')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Malformed-payload-as-miss
// ---------------------------------------------------------------------------

describe('Live_Cache — malformed payload is a miss', () => {
  it('treats unparseable JSON as a cache miss', async () => {
    const redis = new FakeRedis();
    const cache = createLiveCache(redis);

    redis.seed(liveCacheKey(EXPERIENCE_ID), '{ this is not json');

    expect(await cache.get(EXPERIENCE_ID)).toBeNull();
  });

  it('treats a payload whose liveDetail fails liveDetailSchema as a miss', async () => {
    const redis = new FakeRedis();
    const cache = createLiveCache(redis);

    // Structurally a valid envelope ({ liveDetail, retrievedAt }), but the
    // liveDetail carries an invalid Operating_Status the schema rejects.
    redis.seed(
      liveCacheKey(EXPERIENCE_ID),
      JSON.stringify({
        liveDetail: { ...MINIMAL_LIVE_DETAIL, status: 'NotARealStatus' },
        retrievedAt: '2024-05-01T13:00:00Z',
      }),
    );

    expect(await cache.get(EXPERIENCE_ID)).toBeNull();
  });
});
