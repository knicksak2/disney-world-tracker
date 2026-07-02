// Feature: disney-source-resilience, Task 3.2: shared budget across processes
/**
 * Integration test for the Redis-backed shared Request_Budget
 * (`createRedisRateLimiter`, rateLimiter.ts → design.md "2. Rate_Limiter").
 *
 * Validates: Requirements 2.4
 *
 * R2.4: "WHERE the sync worker and the API serving the application run as
 * separate operating-system processes, THE Rate_Limiter SHALL enforce the
 * Request_Budget across all such processes using a Redis-backed shared limiter,
 * so that the combined outbound rate from one egress IP does not exceed the
 * configured maximum."
 *
 * This is an example-based integration test (per the design's Testing Strategy,
 * R2.4 is covered by an integration test rather than a property). It stands up a
 * single in-memory Redis (`ioredis-mock`, which executes the limiter's real Lua
 * `eval` against genuine sorted-set/counter commands — ZREMRANGEBYSCORE, ZCARD,
 * ZRANGE ... WITHSCORES, ZADD, PEXPIRE, GET, INCR, DECR) and drives **two
 * independent limiter clients** (standing in for two OS processes) against it.
 *
 * The two limiter instances coordinate *only* through the shared Redis keys
 * (`disney:ratelimit:{bucket}:*`); they share no in-process state. The test
 * drives a burst of `acquire`s alternating between the two clients on one
 * bucket and asserts that the COMBINED dispatch schedule never packs more than
 * `maxRequestsPerSecond` dispatches into any rolling one-second window — i.e.
 * the budget is enforced across both clients, not per-client.
 *
 * Determinism: an injected virtual clock replaces wall-clock time. `now()`
 * reads a shared mutable clock and the injected `sleep(ms)` advances that clock
 * (rather than waiting), so the test exercises the real pacing arithmetic
 * without real timers. The driver bumps the clock by 1ms before each acquire so
 * every granted dispatch lands on a distinct instant; that keeps each Lua
 * sorted-set member unique (members are `{now}-{pid}-{seq}`) so nothing is
 * under-counted when both clients share the same process id under test.
 */

import { afterEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';

import type { RateLimiterConfig } from '@dwt/shared';

import type { RedisClient } from '../../../../redis/client.js';
import {
  createRedisRateLimiter,
  RATE_WINDOW_MS,
  type RateLimiter,
} from '../rateLimiter.js';

/**
 * A shared, injectable virtual clock. `now()` reads it; `sleep(ms)` advances it
 * (never waits) so the limiter's rate-pacing sleeps move simulated time forward
 * deterministically. Both limiter clients share one clock — they present a
 * single egress "wall clock" to Redis, exactly as two processes on one host do.
 */
function makeVirtualClock(start: number): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  bump: (ms: number) => void;
} {
  let clock = start;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += Math.max(0, Math.ceil(ms));
    },
    bump: (ms: number) => {
      clock += ms;
    },
  };
}

/**
 * The maximum number of dispatches falling within any rolling
 * `RATE_WINDOW_MS`-wide window `[t, t + RATE_WINDOW_MS)`. Dispatch times are
 * non-decreasing, so anchoring a window at each dispatch and counting forward
 * finds the peak.
 */
function maxRollingWindowCount(dispatchTimes: readonly number[]): number {
  let peak = 0;
  for (let i = 0; i < dispatchTimes.length; i += 1) {
    const anchor = dispatchTimes[i];
    if (anchor === undefined) {
      continue;
    }
    const windowEnd = anchor + RATE_WINDOW_MS;
    let count = 0;
    for (let j = i; j < dispatchTimes.length; j += 1) {
      const t = dispatchTimes[j];
      if (t === undefined || t >= windowEnd) {
        break;
      }
      count += 1;
    }
    peak = Math.max(peak, count);
  }
  return peak;
}

interface DriveResult {
  /** Combined dispatch instants (epoch-ms), one per acquire, in grant order. */
  readonly dispatchTimes: readonly number[];
  /** How many dispatches each client obtained, by client index. */
  readonly perClientCounts: readonly number[];
}

/**
 * Drive `totalRequests` acquires on a single `bucket`, alternating round-robin
 * across the supplied limiter clients. Each acquire is released immediately, so
 * concurrency is never the binding constraint (configs use a high
 * `maxConcurrency`); the rate window is what paces the combined schedule.
 *
 * The clock is bumped 1ms before each acquire so grant instants are strictly
 * increasing and every Lua sorted-set member is unique.
 */
async function driveRoundRobin(
  clients: readonly RateLimiter[],
  bucket: 'sync_gateway' | 'web',
  totalRequests: number,
  clock: { now: () => number; bump: (ms: number) => void },
): Promise<DriveResult> {
  const dispatchTimes: number[] = [];
  const perClientCounts = new Array<number>(clients.length).fill(0);

  for (let i = 0; i < totalRequests; i += 1) {
    const clientIdx = i % clients.length;
    const client = clients[clientIdx];
    if (!client) {
      continue;
    }
    clock.bump(1);
    const lease = await client.acquire(bucket);
    // The grant instant equals the clock at the successful `eval` (no sleep
    // happens after a grant), and equals the score recorded in the Redis ZSET.
    dispatchTimes.push(clock.now());
    perClientCounts[clientIdx] = (perClientCounts[clientIdx] ?? 0) + 1;
    lease.release();
  }

  return { dispatchTimes, perClientCounts };
}

describe('createRedisRateLimiter shared budget across two clients (Task 3.2, R2.4)', () => {
  let redis: RedisClient | undefined;

  afterEach(async () => {
    if (redis) {
      await redis.flushall();
      await redis.quit();
      redis = undefined;
    }
  });

  it('Example 1: two clients on one bucket never exceed maxRequestsPerSecond=3 combined', async () => {
    const cfg: RateLimiterConfig = { maxRequestsPerSecond: 3, maxConcurrency: 1000 };
    const clock = makeVirtualClock(10_000);

    // One shared Redis backing store; two independent limiter clients standing
    // in for two OS processes. They coordinate solely through the shared keys.
    redis = new RedisMock() as unknown as RedisClient;
    const deps = { redis, now: clock.now, sleep: clock.sleep };
    const clientA = createRedisRateLimiter(cfg, deps);
    const clientB = createRedisRateLimiter(cfg, deps);

    const { dispatchTimes, perClientCounts } = await driveRoundRobin(
      [clientA, clientB],
      'sync_gateway',
      12,
      clock,
    );

    // Every request was eventually dispatched (the limiter waits, never rejects).
    expect(dispatchTimes.length).toBe(12);
    // Both clients actually participated (the budget is genuinely shared, not
    // starving one client).
    expect(perClientCounts[0]).toBe(6);
    expect(perClientCounts[1]).toBe(6);
    // The COMBINED outbound rate honours the shared budget: no rolling second
    // holds more than maxRequestsPerSecond dispatches across both clients.
    expect(maxRollingWindowCount(dispatchTimes)).toBeLessThanOrEqual(
      cfg.maxRequestsPerSecond,
    );
  });

  it('Example 2: a strict maxRequestsPerSecond=1 budget serialises both clients across the window', async () => {
    const cfg: RateLimiterConfig = { maxRequestsPerSecond: 1, maxConcurrency: 1000 };
    const clock = makeVirtualClock(50_000);

    redis = new RedisMock() as unknown as RedisClient;
    const deps = { redis, now: clock.now, sleep: clock.sleep };
    const clientA = createRedisRateLimiter(cfg, deps);
    const clientB = createRedisRateLimiter(cfg, deps);

    const { dispatchTimes, perClientCounts } = await driveRoundRobin(
      [clientA, clientB],
      'sync_gateway',
      6,
      clock,
    );

    expect(dispatchTimes.length).toBe(6);
    expect(perClientCounts[0]).toBe(3);
    expect(perClientCounts[1]).toBe(3);
    // At most one dispatch per rolling second, combined across both clients.
    expect(maxRollingWindowCount(dispatchTimes)).toBeLessThanOrEqual(1);
    // With a 1-rps budget each successive grant must be at least a full window
    // after the previous one, so consecutive dispatches are >= RATE_WINDOW_MS
    // apart — a direct witness that the two clients share one budget.
    for (let i = 1; i < dispatchTimes.length; i += 1) {
      const prev = dispatchTimes[i - 1];
      const cur = dispatchTimes[i];
      if (prev !== undefined && cur !== undefined) {
        expect(cur - prev).toBeGreaterThanOrEqual(RATE_WINDOW_MS);
      }
    }
  });
});
