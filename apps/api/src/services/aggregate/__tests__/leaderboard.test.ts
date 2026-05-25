/**
 * Unit tests for the highest-rated leaderboard service (task 8.5).
 *
 * Drives `createLeaderboard` against a fake pool and a fake Redis so
 * the assertions cover:
 *
 *   - cache miss → DB read + cache write under the canonical key/TTL
 *   - cache hit  → no DB read, payload returned verbatim
 *   - the SQL forwards `mean_x10::float / 10 AS value` so the wire
 *     `value` is a one-decimal `number` in `[1.0, 10.0]`
 *   - threshold filter (`count_ratings >= 3`) and active filter
 *     (`e.active = TRUE`) are encoded in the query text (R11.2)
 *   - ordering keys (`mean_x10 DESC, count_ratings DESC, lower(name) ASC`)
 *     are encoded in the query text (R11.3)
 *   - the limit is `LIMIT 10` (R11.4)
 *   - cache write failure does not swallow the rows the DB returned
 *   - corrupt cache payloads are treated as a miss
 *
 * No real Postgres or Redis is involved.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import {
  LEADERBOARD_LIMIT,
  LEADERBOARD_REDIS_KEY,
  LEADERBOARD_TTL_SECONDS,
  createLeaderboard,
  type LeaderboardCacheWriteFailure,
  type LeaderboardRedis,
} from '../leaderboard.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakePoolCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakePool {
  readonly calls: FakePoolCall[];
  query: (
    text: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: unknown[] }>;
}

/**
 * Build a fake pool that records every `query` call and returns a
 * fixed row set on each call.
 */
function makePool(rows: ReadonlyArray<unknown>): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return { rows: [...rows] };
    },
  };
}

function asPool(pool: FakePool): DbPool {
  return pool as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------

interface FakeRedisCall {
  readonly op: 'get' | 'set';
  readonly key: string;
  readonly value?: string;
  readonly args?: ReadonlyArray<string | number>;
}

class FakeRedis implements LeaderboardRedis {
  public readonly calls: FakeRedisCall[] = [];
  private store = new Map<string, string>();

  /**
   * Pre-populate a key. Used by cache-hit tests to seed the cache
   * without going through `set`.
   */
  seed(key: string, value: string): void {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ op: 'get', key });
    return this.store.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.calls.push({ op: 'set', key, value, args });
    this.store.set(key, value);
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ALPHA_ID = '11111111-1111-4111-8111-111111111111';
const BRAVO_ID = '22222222-2222-4222-8222-222222222222';
const CHARLIE_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Three SQL-style rows in the canonical leaderboard order. The SQL
 * itself is responsible for the order — these fixtures arrive
 * pre-sorted so the test assertions only need to check that the
 * service preserves the order verbatim.
 *
 * `value` arrives as the SQL render `mean_x10::float / 10`, so the
 * fixtures use one-decimal numbers. `count` arrives as the integer
 * column directly.
 */
const ROWS = [
  {
    id: ALPHA_ID,
    name: 'Astro Orbiter',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.5,
    count: 8,
  },
  {
    id: BRAVO_ID,
    name: 'Buzz Lightyear',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.3,
    count: 12,
  },
  {
    id: CHARLIE_ID,
    name: 'Carousel of Progress',
    park: 'Magic Kingdom',
    category: 'Show',
    value: 8.7,
    count: 5,
  },
] as const;

const EXPECTED_ENTRIES = [
  {
    experienceId: ALPHA_ID,
    name: 'Astro Orbiter',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.5,
    count: 8,
  },
  {
    experienceId: BRAVO_ID,
    name: 'Buzz Lightyear',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.3,
    count: 12,
  },
  {
    experienceId: CHARLIE_ID,
    name: 'Carousel of Progress',
    park: 'Magic Kingdom',
    category: 'Show',
    value: 8.7,
    count: 5,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLeaderboard.getLeaderboard', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('on cache miss reads the DB, returns the rows, and writes the cache', async () => {
    const pool = makePool(ROWS);
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result).toEqual(EXPECTED_ENTRIES);
    expect(pool.calls).toHaveLength(1);

    // Cache write happened with the canonical key, the JSON payload,
    // and the 5-minute TTL via `EX`.
    const sets = redis.calls.filter((c) => c.op === 'set');
    expect(sets).toHaveLength(1);
    const setCall = sets[0]!;
    expect(setCall.key).toBe(LEADERBOARD_REDIS_KEY);
    expect(setCall.value).toBe(JSON.stringify(EXPECTED_ENTRIES));
    expect(setCall.args).toEqual(['EX', LEADERBOARD_TTL_SECONDS]);
  });

  it('on cache hit returns the cached payload without touching the DB', async () => {
    const pool = makePool([]);
    redis.seed(LEADERBOARD_REDIS_KEY, JSON.stringify(EXPECTED_ENTRIES));
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result).toEqual(EXPECTED_ENTRIES);
    expect(pool.calls).toHaveLength(0);

    // Only a GET on the canonical key. No SET because the cache is fresh.
    expect(redis.calls).toEqual([
      { op: 'get', key: LEADERBOARD_REDIS_KEY },
    ]);
  });

  it('encodes the active filter, threshold, ordering, and limit in the SQL', async () => {
    const pool = makePool(ROWS);
    const service = createLeaderboard({ pool: asPool(pool), redis });

    await service.getLeaderboard();

    const text = pool.calls[0]?.text ?? '';

    // R11.2 — active catalog gate and minimum sample size.
    expect(text).toContain('e.active = TRUE');
    expect(text).toContain('ar.count_ratings >= 3');

    // The wire `value` is rendered at the SQL boundary so node-postgres
    // hands JS a primitive number rather than a SMALLINT string.
    expect(text).toContain('ar.mean_x10::float / 10');

    // R11.3 — ordering keys and direction.
    expect(text).toContain('ORDER BY ar.mean_x10 DESC');
    expect(text).toContain('ar.count_ratings DESC');
    expect(text).toContain('lower(e.name) ASC');

    // R11.4 — top-10 cap.
    expect(text).toContain(`LIMIT ${LEADERBOARD_LIMIT}`);

    // The aggregate join is required to attach Park/Category/name from
    // the experiences table.
    expect(text).toContain('FROM aggregate_ratings ar');
    expect(text).toContain('JOIN experiences');
  });

  it('returns the rows even when the cache write fails, and forwards the error to the logger', async () => {
    const pool = makePool(ROWS);
    const failingRedis: LeaderboardRedis = {
      async get() {
        return null;
      },
      async set() {
        throw new Error('redis down');
      },
    };
    const failures: LeaderboardCacheWriteFailure[] = [];
    const service = createLeaderboard({
      pool: asPool(pool),
      redis: failingRedis,
      logger: (event) => failures.push(event),
    });

    const result = await service.getLeaderboard();

    expect(result).toEqual(EXPECTED_ENTRIES);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.kind).toBe('cache_write_failure');
    expect((failures[0]?.error as Error).message).toBe('redis down');
  });

  it('treats a corrupt cache payload as a miss and overwrites it on the next read', async () => {
    const pool = makePool(ROWS);
    redis.seed(LEADERBOARD_REDIS_KEY, '{not valid json');
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result).toEqual(EXPECTED_ENTRIES);
    expect(pool.calls).toHaveLength(1);

    const sets = redis.calls.filter((c) => c.op === 'set');
    expect(sets).toHaveLength(1);
    expect(sets[0]?.value).toBe(JSON.stringify(EXPECTED_ENTRIES));
  });

  it('treats a structurally invalid cache payload as a miss', async () => {
    const pool = makePool(ROWS);
    // `count: 2` violates the R11.2 threshold; the validator should
    // discard the cached payload and fall through to the DB.
    const stale = JSON.stringify([
      {
        experienceId: ALPHA_ID,
        name: 'Old Entry',
        park: 'Magic Kingdom',
        category: 'Ride',
        value: 9.5,
        count: 2,
      },
    ]);
    redis.seed(LEADERBOARD_REDIS_KEY, stale);
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result).toEqual(EXPECTED_ENTRIES);
    expect(pool.calls).toHaveLength(1);
  });

  it('returns an empty array when no Experience qualifies (R11.11)', async () => {
    const pool = makePool([]);
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result).toEqual([]);

    // Empty payload is still cached so subsequent reads short-circuit.
    const sets = redis.calls.filter((c) => c.op === 'set');
    expect(sets).toHaveLength(1);
    expect(sets[0]?.value).toBe('[]');
  });

  it('propagates a redis.get failure (does not silently fall through to the DB)', async () => {
    const pool = makePool(ROWS);
    const angryRedis: LeaderboardRedis = {
      async get() {
        throw new Error('redis offline');
      },
      async set() {
        return 'OK';
      },
    };
    const service = createLeaderboard({
      pool: asPool(pool),
      redis: angryRedis,
    });

    await expect(service.getLeaderboard()).rejects.toThrow('redis offline');
    expect(pool.calls).toHaveLength(0);
  });

  it('preserves repo ordering verbatim — the service does not re-sort', async () => {
    // Sort order in the fixture is already `mean DESC, count DESC,
    // lower(name) ASC`. If the service mistakenly re-sorted, the
    // tie-break case (Astro Orbiter at 9.5/8 vs. another row at the
    // same value but a higher count) would expose it. We construct
    // such a fixture intentionally.
    const tied = [
      {
        id: ALPHA_ID,
        name: 'Astro Orbiter',
        park: 'Magic Kingdom',
        category: 'Ride',
        value: 9.5,
        count: 8,
      },
      {
        id: BRAVO_ID,
        name: 'Big Thunder', // alphabetically later → tie broken by count
        park: 'Magic Kingdom',
        category: 'Ride',
        value: 9.5,
        count: 50,
      },
    ];
    // The SQL would put Big Thunder first (count 50 > 8). The service
    // must not re-sort; it simply returns the rows in the order the
    // SQL produced them.
    const orderedFromSql = [tied[1]!, tied[0]!];
    const pool = makePool(orderedFromSql);
    const service = createLeaderboard({ pool: asPool(pool), redis });

    const result = await service.getLeaderboard();

    expect(result.map((e) => e.experienceId)).toEqual([BRAVO_ID, ALPHA_ID]);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('leaderboard module defaults', () => {
  it('exposes the canonical Redis key and TTL', () => {
    expect(LEADERBOARD_REDIS_KEY).toBe('highest-rated:v1');
    expect(LEADERBOARD_TTL_SECONDS).toBe(5 * 60);
    expect(LEADERBOARD_LIMIT).toBe(10);
  });

  it('default cache-write logger is a no-op (does not throw)', async () => {
    // Confirm the default logger path does not throw even when invoked
    // via a write failure. We exercise it via the public API rather
    // than reaching into the private noop directly.
    const pool = makePool(ROWS);
    const failingRedis: LeaderboardRedis = {
      async get() {
        return null;
      },
      async set() {
        throw new Error('redis down');
      },
    };
    const service = createLeaderboard({
      pool: asPool(pool),
      redis: failingRedis,
    });
    await expect(service.getLeaderboard()).resolves.toEqual(EXPECTED_ENTRIES);
  });
});
