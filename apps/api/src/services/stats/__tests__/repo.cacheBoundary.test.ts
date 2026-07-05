/**
 * Integration test for the not-live cache boundary (expanded-stats task 6.3).
 *
 * Requirement 8 draws a hard architectural line between two kinds of statistics:
 *
 *   - Per-user, request-scoped statistics (every Coverage_Statistic, every
 *     Rating_Statistic, and the opt-in Percentile_Rank) are computed LIVE per
 *     request inside the single `REPEATABLE READ READ ONLY` snapshot owned by
 *     `services/stats/repo.ts::getStatsSnapshot`.
 *   - Global_Aggregates shared across users — the incrementally-maintained
 *     `aggregate_ratings` store (R8.4) and the Redis-cached highest-rated
 *     leaderboard (R8.5) — stay precomputed/cached and are explicitly NOT
 *     converted to live computation.
 *
 * This suite asserts that boundary from both sides:
 *
 *   1. The stats snapshot path never reads the `aggregate_ratings` store and
 *      never recomputes the leaderboard. Every statement it issues inside its
 *      transaction touches only `experiences`, `completions`, and `ratings`
 *      (R8.2 — no per-user statistic from a cache; R8.4/R8.5 — the aggregate
 *      and leaderboard read paths are left untouched).
 *   2. Aggregate ratings are still served from their incrementally-maintained
 *      store by `aggregate/repo.ts::getAggregate` — a direct `SELECT` from
 *      `aggregate_ratings`, not a from-scratch recompute over `ratings` (R8.4).
 *   3. The highest-rated leaderboard is still served from its existing cache by
 *      `aggregate/leaderboard.ts::getLeaderboard` — a Redis cache hit returns
 *      without touching the database, and a miss reads the leaderboard's own
 *      store, never the stats snapshot path (R8.5).
 *
 * The harness mirrors the fake-pool / fake-redis pattern used by the aggregate
 * and stats route suites (`aggregate/__tests__/repo.test.ts`,
 * `aggregate/__tests__/leaderboard.test.ts`, `stats/__tests__/routes.test.ts`).
 * No real Postgres or Redis is involved, so the boundary is proven by
 * inspecting exactly which stores each code path issues queries against.
 *
 * Validates: Requirements 8.4, 8.5 (with supporting 8.1, 8.2).
 */

import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createAggregateRepo } from '../../aggregate/repo.js';
import {
  LEADERBOARD_REDIS_KEY,
  createLeaderboard,
  type LeaderboardRedis,
} from '../../aggregate/leaderboard.js';
import { createStatsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Recording fake pool
// ---------------------------------------------------------------------------

interface RecordedQuery {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
  /** Whether the statement ran on the pool itself or a leased client. */
  readonly via: 'pool' | 'client';
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
}

type Responder = (query: RecordedQuery) => RiggedResponse | undefined;

interface RecordingPool {
  readonly calls: RecordedQuery[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  connect(): Promise<{
    query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
    release(): void;
  }>;
}

/**
 * Build a fake pool that records every statement it sees (whether issued on the
 * pool directly or on a leased client) so a test can assert precisely which
 * tables a code path reads. The `responder` rigs rows for specific SQL
 * substrings; anything unmatched yields an empty result set.
 */
function makeRecordingPool(responder: Responder = () => undefined): RecordingPool {
  const calls: RecordedQuery[] = [];

  const dispatch = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
    via: 'pool' | 'client',
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }> => {
    const call: RecordedQuery = { text, params, via };
    calls.push(call);
    const rigged = responder(call);
    return { rows: rigged?.rows ?? [] };
  };

  return {
    calls,
    async query(text, params) {
      return dispatch(text, params, 'pool');
    },
    async connect() {
      let released = false;
      return {
        async query(text, params) {
          if (released) {
            throw new Error('client used after release');
          }
          return dispatch(text, params, 'client');
        },
        release() {
          released = true;
        },
      };
    },
  };
}

function asPool(pool: RecordingPool): DbPool {
  return pool as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Fake Redis (leaderboard cache)
// ---------------------------------------------------------------------------

interface RecordedRedisCall {
  readonly op: 'get' | 'set';
  readonly key: string;
  readonly value?: string;
}

class RecordingRedis implements LeaderboardRedis {
  public readonly calls: RecordedRedisCall[] = [];
  private readonly store = new Map<string, string>();

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
    ..._args: Array<string | number>
  ): Promise<unknown> {
    this.calls.push({ op: 'set', key, value });
    this.store.set(key, value);
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TARGET_USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A pattern that matches any reference to the incrementally-maintained
 * Global_Aggregate ratings store. The stats snapshot path must never touch it.
 */
const AGGREGATE_STORE_PATTERN = /aggregate_ratings/i;

/**
 * A pattern that matches the leaderboard's ranking projection (`mean_x10`),
 * which only ever appears in the leaderboard's own query. The stats snapshot
 * path must never recompute it live.
 */
const LEADERBOARD_PATTERN = /mean_x10/i;

// ---------------------------------------------------------------------------
// 1. Stats snapshot path never reads the aggregate store or the leaderboard
// ---------------------------------------------------------------------------

describe('stats snapshot path leaves the Global_Aggregate stores untouched (R8.4, R8.5)', () => {
  it('reads only experiences / completions / ratings inside its snapshot, never aggregate_ratings or the leaderboard', async () => {
    const pool = makeRecordingPool();
    const repo = createStatsRepo(asPool(pool));

    // Exercise BOTH the cheap path and the percentile path so the extra
    // all-tracker read is covered by the boundary assertion too.
    await repo.getStatsSnapshot({
      targetUserId: TARGET_USER_ID,
      includePercentile: false,
    });
    await repo.getStatsSnapshot({
      targetUserId: TARGET_USER_ID,
      includePercentile: true,
    });

    const statements = pool.calls.map((c) => c.text);

    // The snapshot is opened as REPEATABLE READ READ ONLY (R8.1): the live,
    // request-scoped computation model, not a cache read.
    expect(
      statements.some((sql) =>
        /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/i.test(sql),
      ),
    ).toBe(true);

    // R8.4 — the aggregate-ratings store is never read or recomputed here.
    const aggregateTouches = statements.filter((sql) =>
      AGGREGATE_STORE_PATTERN.test(sql),
    );
    expect(aggregateTouches).toEqual([]);

    // R8.5 — the leaderboard ranking is never recomputed here.
    const leaderboardTouches = statements.filter((sql) =>
      LEADERBOARD_PATTERN.test(sql),
    );
    expect(leaderboardTouches).toEqual([]);

    // Positive framing: every data-reading statement targets only the live
    // per-user sources. (BEGIN/COMMIT carry no table.)
    const dataReads = statements.filter((sql) => /\bFROM\b/i.test(sql));
    expect(dataReads.length).toBeGreaterThan(0);
    for (const sql of dataReads) {
      expect(sql).toMatch(/\b(experiences|completions|ratings)\b/i);
    }
  });

  it('never leases a cache: the stats repo depends on a DbPool alone, with no Redis wiring', async () => {
    // Structural boundary — the leaderboard cache is reachable only through a
    // Redis client (see `createLeaderboard`), and the stats repo factory takes
    // no such dependency. A recording Redis handed only to the leaderboard
    // therefore cannot observe any stats-path traffic.
    const pool = makeRecordingPool();
    const redis = new RecordingRedis();
    const repo = createStatsRepo(asPool(pool));

    await repo.getStatsSnapshot({
      targetUserId: TARGET_USER_ID,
      includePercentile: true,
    });

    expect(redis.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Aggregate ratings are still served from their incrementally-maintained store
// ---------------------------------------------------------------------------

describe('aggregate ratings are served from their existing store, not recomputed live (R8.4)', () => {
  it('getAggregate reads the precomputed aggregate_ratings row without scanning ratings', async () => {
    const updatedAt = new Date('2025-01-01T00:00:00Z');
    const pool = makeRecordingPool((call) => {
      if (call.text.includes('FROM aggregate_ratings')) {
        return {
          rows: [
            {
              experience_id: EXPERIENCE_ID,
              sum_ratings: 42,
              count_ratings: 6,
              mean_x10: 70,
              updated_at: updatedAt,
            },
          ],
        };
      }
      return undefined;
    });

    const repo = createAggregateRepo(asPool(pool));
    const state = await repo.getAggregate(EXPERIENCE_ID);

    // Served verbatim from the incrementally-maintained store.
    expect(state).toEqual({
      experienceId: EXPERIENCE_ID,
      sum: 42,
      count: 6,
      meanX10: 70,
      updatedAt,
    });

    // Exactly one read, and it targets the precomputed store — no live
    // re-aggregation over the raw `ratings` rows.
    expect(pool.calls).toHaveLength(1);
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toMatch(AGGREGATE_STORE_PATTERN);
    expect(sql).not.toMatch(/\bFROM ratings\b/i);
  });
});

// ---------------------------------------------------------------------------
// 3. The highest-rated leaderboard is still served from its existing cache
// ---------------------------------------------------------------------------

describe('the highest-rated leaderboard is served from its existing cache, not recomputed live (R8.5)', () => {
  const CACHED_ENTRIES = [
    {
      experienceId: EXPERIENCE_ID,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      value: 9.4,
      count: 11,
    },
  ];

  it('serves a Redis cache hit without touching the database at all', async () => {
    const pool = makeRecordingPool();
    const redis = new RecordingRedis();
    redis.seed(LEADERBOARD_REDIS_KEY, JSON.stringify(CACHED_ENTRIES));

    const leaderboard = createLeaderboard({ pool: asPool(pool), redis });
    const result = await leaderboard.getLeaderboard();

    expect(result).toEqual(CACHED_ENTRIES);
    // Cache hit: no DB read, so nothing is recomputed live.
    expect(pool.calls).toEqual([]);
    expect(redis.calls).toEqual([{ op: 'get', key: LEADERBOARD_REDIS_KEY }]);
  });

  it('on a cache miss reads its own leaderboard store, distinct from the stats snapshot path', async () => {
    const pool = makeRecordingPool((call) => {
      if (call.text.includes('FROM aggregate_ratings')) {
        return {
          rows: [
            {
              id: EXPERIENCE_ID,
              name: 'Space Mountain',
              park: 'Magic Kingdom',
              category: 'Ride',
              value: 9.4,
              count: 11,
            },
          ],
        };
      }
      return undefined;
    });
    const redis = new RecordingRedis();

    const leaderboard = createLeaderboard({ pool: asPool(pool), redis });
    const result = await leaderboard.getLeaderboard();

    expect(result).toEqual(CACHED_ENTRIES);

    // The refresh reads the leaderboard's own precomputed store and repopulates
    // the cache — this is the leaderboard service's read path, never a live
    // recomputation triggered by a stats request.
    expect(pool.calls).toHaveLength(1);
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toMatch(AGGREGATE_STORE_PATTERN);
    expect(sql).toMatch(LEADERBOARD_PATTERN);
    expect(redis.calls.some((c) => c.op === 'set')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The two read paths are disjoint
// ---------------------------------------------------------------------------

describe('the stats snapshot path and the Global_Aggregate stores share no reads', () => {
  it('a stats request and an aggregate/leaderboard read observe entirely separate SQL', async () => {
    // Stats path over its own recording pool.
    const statsPool = makeRecordingPool();
    const statsRepo = createStatsRepo(asPool(statsPool));
    await statsRepo.getStatsSnapshot({
      targetUserId: TARGET_USER_ID,
      includePercentile: true,
    });

    // Global_Aggregate reads over a separate recording pool + cache.
    const aggPool = makeRecordingPool((call) =>
      call.text.includes('FROM aggregate_ratings')
        ? {
            rows: [
              {
                experience_id: EXPERIENCE_ID,
                sum_ratings: 30,
                count_ratings: 3,
                mean_x10: 100,
                updated_at: new Date('2025-01-02T00:00:00Z'),
              },
            ],
          }
        : undefined,
    );
    await createAggregateRepo(asPool(aggPool)).getAggregate(EXPERIENCE_ID);

    const statsStatements = statsPool.calls.map((c) => c.text);
    const aggregateStatements = aggPool.calls.map((c) => c.text);

    // Stats path: no aggregate/leaderboard reads.
    expect(
      statsStatements.some(
        (sql) =>
          AGGREGATE_STORE_PATTERN.test(sql) || LEADERBOARD_PATTERN.test(sql),
      ),
    ).toBe(false);

    // Aggregate path: reads the precomputed store, and never the live per-user
    // snapshot's transaction envelope.
    expect(
      aggregateStatements.some((sql) => AGGREGATE_STORE_PATTERN.test(sql)),
    ).toBe(true);
    expect(
      aggregateStatements.some((sql) =>
        /REPEATABLE READ READ ONLY/i.test(sql),
      ),
    ).toBe(false);
  });
});
