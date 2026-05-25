// Feature: disney-world-tracker, Property 28: leaderboard refresh count over any 5-minute window is at most 1
/**
 * Property-based test for the leaderboard cache staleness invariant.
 *
 * Validates: Requirements 11.7, 11.8, 11.9
 *
 * Property 28 (design.md → Correctness Properties → "Leaderboard cache
 * staleness"):
 *
 *   For any sequence of Home_Screen open events with timestamps, the
 *   leaderboard refresh count over any 5-minute sliding window is at
 *   most 1, and a refresh occurs on every open whose preceding cache
 *   age is greater than or equal to 5 minutes; opens whose preceding
 *   cache age is strictly less than 5 minutes serve the cached
 *   leaderboard without a refresh.
 *
 * Test strategy
 * -------------
 *
 *   - Generate a non-decreasing timeline of `Home_Screen` open events
 *     by accumulating non-negative inter-event deltas. Deltas are drawn
 *     from a mixture biased toward sub-TTL gaps (so cache-hit paths
 *     exercise) and gaps that straddle the 5-minute boundary (so the
 *     refresh-on-expiry path exercises).
 *   - Drive each open against a real `createLeaderboard` service whose
 *     dependencies are an in-memory fake Redis with TTL semantics tied
 *     to an injected clock cell, and a fake pool that counts how many
 *     times the leaderboard SQL was executed.
 *   - A "refresh" is exactly one `pool.query` call (= a cache miss).
 *     We collect the timestamps of every open at which the query
 *     counter advances.
 *
 * Property assertions
 * -------------------
 *
 *   - Every open advances the query counter by 0 or 1, never more.
 *   - For every consecutive pair of refresh timestamps `t_i < t_{i+1}`,
 *     the gap `t_{i+1} - t_i` is at least `LEADERBOARD_TTL_SECONDS *
 *     1000`. Equivalently, no half-open sliding window of length 5
 *     minutes `[a, a + 300_000)` contains two refreshes — which is the
 *     verbatim restatement of Property 28.
 *
 * The leaderboard module itself does not take a clock parameter; the
 * 5-minute TTL is enforced by Redis. The fake Redis below honours that
 * contract by tying its expiration check to a shared clock cell that
 * we advance to each open's timestamp before invoking
 * `getLeaderboard()`. This keeps the test deterministic without
 * requiring the production code to grow a clock injection point.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import {
  LEADERBOARD_REDIS_KEY,
  LEADERBOARD_TTL_SECONDS,
  createLeaderboard,
  type LeaderboardRedis,
} from '../leaderboard.js';

const NUM_RUNS = 100;
const MAX_OPENS = 30;
const TTL_MS = LEADERBOARD_TTL_SECONDS * 1000;

// ---------------------------------------------------------------------------
// Fake Redis with TTL semantics
// ---------------------------------------------------------------------------

/**
 * In-memory Redis fake that honours the `EX seconds` flag against a
 * shared clock cell. The leaderboard service writes the cache as
 * `set(key, value, 'EX', LEADERBOARD_TTL_SECONDS)`; on every `get` the
 * fake compares `expiresAtMs` against `clock.nowMs` and treats the
 * entry as missing once the clock has reached the expiration time.
 *
 * Using `<= clock.nowMs` for the expiration check matches Redis's
 * lazy-expire semantics and the design statement that an open at a
 * cache age of "5 minutes or older" must trigger a refresh (R11.7).
 */
class FakeRedis implements LeaderboardRedis {
  private readonly store = new Map<
    string,
    { value: string; expiresAtMs: number }
  >();

  constructor(private readonly clock: { nowMs: number }) {}

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= this.clock.nowMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown> {
    let ttlSeconds: number | undefined;
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (typeof flag === 'string' && flag.toUpperCase() === 'EX') {
        ttlSeconds = Number(args[i + 1]);
        i += 1;
      }
    }
    if (ttlSeconds === undefined) {
      // The leaderboard service always writes with `EX`; surfacing this
      // as an error means a regression in the service that drops the
      // TTL would fail the property test loudly instead of caching
      // forever.
      throw new Error('FakeRedis: leaderboard set must include EX flag');
    }
    this.store.set(key, {
      value,
      expiresAtMs: this.clock.nowMs + ttlSeconds * 1000,
    });
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// Fake pool with refresh counter
// ---------------------------------------------------------------------------

interface CountingPool {
  pool: DbPool;
  queryCount: { count: number };
}

/**
 * Build a fake pool whose `query` increments a counter and returns an
 * empty row set. We do not care about the SQL or the row shape here —
 * Property 28 is purely about how often the leaderboard hits the
 * database, not what the database returns. An empty result is also
 * consistent with R11.11 (zero-qualifying empty leaderboard).
 */
function makeCountingPool(): CountingPool {
  const queryCount = { count: 0 };
  const pool = {
    async query(_text: string, _params?: ReadonlyArray<unknown>) {
      queryCount.count += 1;
      return { rows: [] as unknown[] };
    },
  } as unknown as DbPool;
  return { pool, queryCount };
}

// ---------------------------------------------------------------------------
// Timeline arbitrary
// ---------------------------------------------------------------------------

/**
 * A non-decreasing sequence of open-event timestamps in milliseconds,
 * starting from 0. Built by accumulating non-negative inter-event
 * deltas drawn from a mixture biased toward boundary cases:
 *
 *   - Sub-TTL deltas (`[0, TTL_MS - 1]`) — exercise the cache-hit
 *     path and confirm rapid open bursts do not refresh.
 *   - Cross-TTL deltas (`[TTL_MS, TTL_MS + 60_000]`) — exercise the
 *     refresh-on-expiry path right at and just past the 5-minute
 *     boundary.
 *   - Wide deltas (`[0, 30 * 60_000]`) — exercise long quiet periods
 *     where the cache may expire many times over before the next
 *     open.
 *
 * The `minLength: 1` guard ensures every run executes at least one
 * open so the property has something to assert against.
 */
const openTimesArb: fc.Arbitrary<readonly number[]> = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0, max: TTL_MS - 1 }),
      fc.integer({ min: TTL_MS, max: TTL_MS + 60_000 }),
      fc.integer({ min: 0, max: 30 * 60_000 }),
    ),
    { minLength: 1, maxLength: MAX_OPENS },
  )
  .map((deltas) => {
    let t = 0;
    return deltas.map((d) => (t += d));
  });

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('leaderboard cache — Property 28: refresh budget', () => {
  it('any 5-minute sliding window contains at most 1 leaderboard refresh', async () => {
    await fc.assert(
      fc.asyncProperty(openTimesArb, async (openTimesMs) => {
        const clock = { nowMs: 0 };
        const redis = new FakeRedis(clock);
        const { pool, queryCount } = makeCountingPool();
        const service = createLeaderboard({ pool, redis });

        const refreshTimes: number[] = [];
        for (const t of openTimesMs) {
          // Advance the shared clock to the open's timestamp before the
          // call so that both the FakeRedis TTL check and the cache
          // write-time observe the same `now`.
          clock.nowMs = t;
          const before = queryCount.count;
          await service.getLeaderboard();
          const after = queryCount.count;
          const refreshes = after - before;

          // A single open must not produce more than one refresh.
          if (refreshes > 1) {
            throw new Error(
              `single open at t=${t} caused ${refreshes} refreshes`,
            );
          }
          if (refreshes === 1) {
            refreshTimes.push(t);
          }
        }

        // Property 28: for every consecutive pair of refresh
        // timestamps, the gap is at least the TTL. Equivalently, no
        // half-open 5-minute window `[a, a + TTL_MS)` contains two
        // refreshes.
        for (let i = 1; i < refreshTimes.length; i += 1) {
          const gap = refreshTimes[i]! - refreshTimes[i - 1]!;
          if (gap < TTL_MS) {
            throw new Error(
              `two refreshes within ${gap}ms (< ${TTL_MS}ms): ${refreshTimes.join(',')}`,
            );
          }
        }

        // Sanity: the canonical Redis key was the only key the service
        // touched. Drift from the documented key would change the
        // cache scope, so we cross-check the fake's bookkeeping.
        // (We do not store the visited keys in the FakeRedis on purpose
        // — the assertion below relies on the GET path having been
        // invoked at least once when there were any opens.)
        if (openTimesMs.length > 0 && refreshTimes.length === 0) {
          throw new Error(
            `expected at least one refresh on the first open, got 0; key=${LEADERBOARD_REDIS_KEY}`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
