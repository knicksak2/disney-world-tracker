/**
 * Rate_Limiter scheduling core (`nextDispatchDelay`).
 *
 * This module holds the *pure* pacing core of the Disney `Rate_Limiter`
 * (design.md → "2. Rate_Limiter"). Given a snapshot of the limiter state
 * (current 1-second window count, in-flight count), the configured
 * Request_Budget, and the current clock, it computes the delay in milliseconds
 * until a dispatch is permitted by both the rate and the concurrency budgets.
 *
 * Following the purity discipline of the sibling decision cores
 * (`classifyFacility.ts`, `classify.ts`, `backoff.ts`), `nextDispatchDelay` is:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no globals, no ambient
 *     clock — `now` is injected so pacing is property-testable without real
 *     timers or Redis.
 *   - **Total**: defined for every state/config/clock; it never throws.
 *   - **Non-rejecting**: it always yields a (possibly zero) wait rather than
 *     rejecting a request (R2.6). Callers pace by waiting the returned delay
 *     instead of failing when the budget is saturated.
 *
 * The full Redis-backed / in-process `RateLimiter` runtime that builds on this
 * core (queue + semaphore, `acquire`/`release`) is implemented separately in
 * task 3.1.
 *
 * Requirements: 2.2 (max requests/second), 2.3 (max concurrency),
 * 2.5 (budget enforcement), 2.6 (wait, never reject).
 */

import type { DisneyTarget, RateLimiterConfig } from '@dwt/shared';

import type { RedisClient } from '../../../redis/client.js';

/**
 * The fixed width of the rate-limiter window, in milliseconds. The
 * Request_Budget rate limit (`maxRequestsPerSecond`, R2.2) is enforced over a
 * rolling one-second window, so the window is exactly 1000 ms wide.
 */
export const RATE_WINDOW_MS = 1000;

/**
 * A snapshot of the `Rate_Limiter` state that {@link nextDispatchDelay} reasons
 * about. The runtime owns advancing this state as requests are dispatched and
 * released; the pure core only reads it.
 *
 * The rate budget is enforced as a true **sliding window** (a sliding *log* of
 * recent dispatch instants) rather than a fixed/tumbling window. A fixed window
 * that merely resets a counter at a boundary admits up to ~2x bursts straddling
 * that boundary (e.g. `maxRequestsPerSecond = 2` dispatching at t=0, t=2,
 * t=1000, t=1001 packs three dispatches into the rolling window `[2, 1002)`).
 * By tracking the actual timestamps we can guarantee the strict invariant of
 * R2.2 as interpreted here: *no* rolling one-second window ever contains more
 * than `maxRequestsPerSecond` dispatches.
 */
export interface RateLimiterState {
  /**
   * Epoch-milliseconds timestamps of the most recent dispatches, in
   * non-decreasing (oldest-first) order. Only the entries falling within the
   * current rolling window (`timestamp > now - RATE_WINDOW_MS`) constrain the
   * next dispatch; the runtime keeps at most `maxRequestsPerSecond` of them
   * since older entries can never be the binding constraint. The pure core
   * tolerates stale or over-length inputs — it filters to the relevant window
   * itself, so it stays total.
   */
  readonly recentDispatches: readonly number[];
  /**
   * The number of in-flight (dispatched but not yet released) requests. Once
   * this reaches `maxConcurrency`, no further dispatch is permitted until a
   * request completes and releases its slot (R2.3).
   */
  readonly inFlight: number;
}

/**
 * Compute the delay, in milliseconds, until a dispatch is permitted under both
 * the rate budget and the concurrency budget.
 *
 * Semantics (R2.2, R2.3, R2.5, R2.6):
 *
 *   - **Concurrency gate (R2.3).** When `inFlight >= maxConcurrency` the budget
 *     is saturated on concurrency. No amount of *waiting on the clock* frees a
 *     slot — only the completion (release) of an in-flight request does — so the
 *     core returns `Number.POSITIVE_INFINITY`. This is still a (non-rejecting)
 *     "wait" per R2.6: the runtime interprets it as "block until a slot is
 *     released" rather than rejecting the request. The concurrency gate takes
 *     precedence because a rate-permitted dispatch would still violate the
 *     concurrency budget.
 *
 *   - **Rate gate (R2.2) — sliding window.** Otherwise the delay is governed by
 *     the sliding log of recent dispatches. Let `relevant` be the dispatch
 *     timestamps still inside the rolling window, i.e. those with
 *     `timestamp > now - RATE_WINDOW_MS`, in ascending order:
 *       - If `relevant.length < maxRequestsPerSecond` there is room in every
 *         rolling one-second window that would include a dispatch at `now`, so
 *         dispatch is permitted immediately (delay `0`).
 *       - Otherwise the window is full. To admit one more dispatch without any
 *         rolling window exceeding the budget, the oldest constraining entry
 *         must first age out of the window. With `L = relevant.length` entries,
 *         the binding entry is `relevant[L - maxRequestsPerSecond]`; it leaves
 *         the window at `entry + RATE_WINDOW_MS`, so the delay is
 *         `relevant[L - maxRequestsPerSecond] + RATE_WINDOW_MS - now`. Because
 *         that entry is relevant (`> now - RATE_WINDOW_MS`), the delay is
 *         strictly positive and at most `RATE_WINDOW_MS`.
 *
 * The returned value is always `>= 0` (never negative) and is `0` whenever
 * dispatch is immediately permitted.
 *
 * @param state - The current limiter state snapshot.
 * @param cfg   - The Request_Budget limits.
 * @param now   - The current time in epoch milliseconds (injected).
 * @returns The non-negative wait in milliseconds; `Number.POSITIVE_INFINITY`
 *          when blocked on concurrency (a slot must be released first).
 */
export function nextDispatchDelay(
  state: RateLimiterState,
  cfg: RateLimiterConfig,
  now: number,
): number {
  // Concurrency gate (R2.3): a full concurrency budget cannot be cleared by
  // waiting on the clock, only by a release. Signal an indefinite wait.
  if (state.inFlight >= cfg.maxConcurrency) {
    return Number.POSITIVE_INFINITY;
  }

  // Rate gate (R2.2): reason about the sliding one-second window. Keep only the
  // dispatches still inside `(now - RATE_WINDOW_MS, now]`, ascending, since only
  // those can constrain a dispatch at `now`.
  const cutoff = now - RATE_WINDOW_MS;
  const relevant = state.recentDispatches
    .filter((t) => t > cutoff)
    .sort((a, b) => a - b);

  // Room remains in the rolling window: dispatch immediately.
  if (relevant.length < cfg.maxRequestsPerSecond) {
    return 0;
  }

  // Window is full. The oldest entry that must age out before a dispatch is
  // admissible is the one `maxRequestsPerSecond` slots back from the newest.
  // Waiting until it exits the window keeps every rolling window within budget.
  const binding = relevant[relevant.length - cfg.maxRequestsPerSecond];
  if (binding === undefined) {
    // Unreachable given the length check above; keeps the core total.
    return 0;
  }
  return binding + RATE_WINDOW_MS - now;
}

// ===========================================================================
// Rate_Limiter runtime (design.md → "2. Rate_Limiter") — task 3.1
// ===========================================================================
//
// The pure `nextDispatchDelay` core above answers the question "given the
// recent-dispatch log and in-flight state, how long until a dispatch is
// allowed?". The runtime below turns that answer into an actual waiting
// `acquire(bucket)` operation and owns the mutable state the core only reads.
//
// Two interchangeable implementations are provided; the composition root picks
// one (design.md):
//
//   - `createRedisRateLimiter` — the *authoritative* multi-process budget. A
//     small Lua script keyed `disney:ratelimit:{bucket}:*` enforces a sliding
//     rate window (a per-bucket sorted set of dispatch timestamps, trimmed to
//     the last second) and a concurrency counter (with an expiry safety net) so
//     every process sharing the egress IP draws from one Request_Budget (R2.4).
//   - `createInProcessRateLimiter` — a same-process fast path / fallback (R2.5)
//     using an in-memory FIFO queue + semaphore, avoiding a Redis round-trip
//     when the sync worker and API share a process.
//
// Both honour R2.6: `acquire` *waits* for capacity and resolves a
// `RateLimitLease`; it never rejects because the budget is saturated. Both are
// built on the pure `nextDispatchDelay` core (directly, in-process; and by the
// same sliding-window/concurrency arithmetic mirrored into Lua, for Redis).

/**
 * A granted slot in the Request_Budget. The caller MUST `release()` exactly
 * once when its dispatch completes (success or failure) so the concurrency slot
 * is returned to the budget. `release()` is idempotent — repeated calls after
 * the first are no-ops — so a `finally` that always releases is safe.
 */
export interface RateLimitLease {
  release(): void;
}

/**
 * Enforces the Request_Budget (R2.1–R2.6). `acquire(bucket)` resolves a
 * {@link RateLimitLease} once capacity is available for the target's bucket,
 * waiting (never rejecting) while the budget is saturated (R2.6).
 */
export interface RateLimiter {
  /**
   * Resolve once capacity is available for `bucket`; the resolved lease's
   * `release()` returns the concurrency slot to the budget.
   */
  acquire(bucket: DisneyTarget): Promise<RateLimitLease>;
}

/**
 * Injectable clock/timer seam shared by both runtimes so pacing is testable
 * without real wall-clock time. Defaults wire the real `Date.now` and a
 * `setTimeout`-based sleep.
 */
export interface RateLimiterDeps {
  /** Current epoch-milliseconds clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Resolve after `ms` milliseconds. Defaults to a `setTimeout` sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// In-process limiter (R2.5)
// ---------------------------------------------------------------------------

interface MutableState {
  recentDispatches: number[];
  inFlight: number;
}

interface Waiter {
  readonly resolve: (lease: RateLimitLease) => void;
}

interface BucketRuntime {
  readonly state: MutableState;
  /** FIFO queue of callers awaiting a grant. */
  readonly queue: Waiter[];
  /** True while the pump loop is draining `queue`. */
  pumping: boolean;
  /** Resolver for the pump's current "wait for a release" promise, if any. */
  wake: (() => void) | null;
}

/**
 * Create an in-process {@link RateLimiter} (R2.5). Each `bucket` has its own
 * sliding-window/concurrency state and a single serialising pump so grants are
 * FIFO and the budget is respected even when many `acquire` calls race.
 *
 * The pump repeatedly consults the pure {@link nextDispatchDelay} core:
 *   - `0`        ⇒ grant the head of the queue immediately;
 *   - `Infinity` ⇒ concurrency-saturated: wait until a `release()` frees a slot;
 *   - `d > 0`    ⇒ rate-saturated: sleep `d` ms, then re-evaluate.
 *
 * `acquire` never rejects due to saturation — it enqueues and resolves once the
 * pump reaches it (R2.6).
 */
export function createInProcessRateLimiter(
  cfg: RateLimiterConfig,
  deps: RateLimiterDeps = {},
): RateLimiter {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;

  const buckets = new Map<DisneyTarget, BucketRuntime>();

  const runtimeFor = (bucket: DisneyTarget): BucketRuntime => {
    let rt = buckets.get(bucket);
    if (!rt) {
      rt = {
        state: { recentDispatches: [], inFlight: 0 },
        queue: [],
        pumping: false,
        wake: null,
      };
      buckets.set(bucket, rt);
    }
    return rt;
  };

  /** Consume one unit of both budgets for a granted dispatch. */
  const grant = (rt: BucketRuntime): void => {
    const t = now();
    // Append this dispatch to the sliding log, drop entries that have aged out
    // of the rolling window, and keep at most `maxRequestsPerSecond` of the
    // newest survivors (older ones can never be the binding constraint).
    const cutoff = t - RATE_WINDOW_MS;
    const kept = rt.state.recentDispatches.filter((ts) => ts > cutoff);
    kept.push(t);
    if (kept.length > cfg.maxRequestsPerSecond) {
      kept.splice(0, kept.length - cfg.maxRequestsPerSecond);
    }
    rt.state.recentDispatches = kept;
    rt.state.inFlight += 1;
  };

  const makeLease = (rt: BucketRuntime): RateLimitLease => {
    let released = false;
    return {
      release(): void {
        if (released) {
          return;
        }
        released = true;
        rt.state.inFlight = Math.max(0, rt.state.inFlight - 1);
        // Wake a pump that is blocked waiting for a concurrency slot, and make
        // sure a pump is running to serve any remaining waiters.
        if (rt.wake) {
          const wake = rt.wake;
          rt.wake = null;
          wake();
        }
        void pump(rt);
      },
    };
  };

  const pump = async (rt: BucketRuntime): Promise<void> => {
    if (rt.pumping) {
      return;
    }
    rt.pumping = true;
    try {
      while (rt.queue.length > 0) {
        const delay = nextDispatchDelay(rt.state, cfg, now());

        if (delay === 0) {
          const waiter = rt.queue.shift();
          if (waiter) {
            grant(rt);
            waiter.resolve(makeLease(rt));
          }
          continue;
        }

        if (delay === Number.POSITIVE_INFINITY) {
          // Concurrency-saturated: only a `release()` can free a slot. Park the
          // pump until one arrives (or is already pending).
          await new Promise<void>((resolve) => {
            rt.wake = resolve;
          });
          continue;
        }

        // Rate-saturated: wait until the oldest in-window dispatch ages out,
        // then retry.
        await sleep(delay);
      }
    } finally {
      rt.pumping = false;
    }
  };

  return {
    acquire(bucket: DisneyTarget): Promise<RateLimitLease> {
      const rt = runtimeFor(bucket);
      return new Promise<RateLimitLease>((resolve) => {
        rt.queue.push({ resolve });
        void pump(rt);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Redis-backed shared limiter (R2.4, authoritative)
// ---------------------------------------------------------------------------

/** Default key prefix for the shared budget counters (design.md). */
export const REDIS_RATE_LIMIT_PREFIX = 'disney:ratelimit';

/**
 * Injectable dependencies for the Redis-backed limiter. Adds the shared client
 * and a couple of tuning knobs on top of the common clock/sleep seam.
 */
export interface RedisRateLimiterDeps extends RateLimiterDeps {
  /** The shared Redis client all processes coordinate through. */
  readonly redis: RedisClient;
  /** Key prefix override (tests). Defaults to {@link REDIS_RATE_LIMIT_PREFIX}. */
  readonly keyPrefix?: string;
  /**
   * How long to wait before re-attempting when concurrency is saturated. A
   * cross-process concurrency slot frees on another process's `release`, which
   * we cannot be signalled about directly, so we poll. Defaults to 25ms.
   */
  readonly concurrencyPollMs?: number;
  /**
   * Safety-net TTL (ms) on the concurrency counter so a crashed process's held
   * slots eventually self-heal instead of leaking the budget forever. Defaults
   * to 60_000ms. Refreshed on every successful acquire.
   */
  readonly concurrencyTtlMs?: number;
}

/**
 * Lua acquire attempt, evaluated atomically on Redis so the concurrency and
 * sliding-window rate checks-and-increments cannot interleave across processes.
 *
 * The rate limit is enforced as a true sliding window: KEYS[2] is a sorted set
 * of recent dispatch timestamps (score = member = dispatch instant, made unique
 * by a caller-supplied suffix). Stale entries older than one window are trimmed
 * on every attempt, so the set's cardinality is exactly the number of
 * dispatches inside the current rolling second.
 *
 *   KEYS[1] = concurrency counter key
 *   KEYS[2] = rate sliding-window sorted set key
 *   ARGV[1] = maxConcurrency
 *   ARGV[2] = maxRequestsPerSecond
 *   ARGV[3] = now (epoch ms)
 *   ARGV[4] = RATE_WINDOW_MS
 *   ARGV[5] = concurrency counter safety TTL (ms)
 *   ARGV[6] = unique sorted-set member for this dispatch
 *
 * Returns a two-element array `{ status, waitMs }`:
 *   - `{0, 0}` granted (one rate slot + one concurrency slot consumed);
 *   - `{1, 0}` concurrency-saturated (nothing consumed);
 *   - `{2, waitMs}` rate-saturated (nothing consumed); `waitMs` is the delay
 *     until the oldest in-window dispatch ages out, mirroring the pure core.
 * Nothing is consumed unless the status is 0, so a saturated attempt never
 * erodes budget.
 */
const REDIS_ACQUIRE_SCRIPT = [
  "local conc = tonumber(redis.call('GET', KEYS[1]) or '0')",
  'if conc >= tonumber(ARGV[1]) then return {1, 0} end',
  'local now = tonumber(ARGV[3])',
  'local windowMs = tonumber(ARGV[4])',
  'local cutoff = now - windowMs',
  // Trim dispatches that have aged out of the rolling window (scores <= cutoff).
  "redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)",
  "local count = redis.call('ZCARD', KEYS[2])",
  'if count >= tonumber(ARGV[2]) then',
  // Rate-saturated: wait until the oldest in-window dispatch exits the window.
  "  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')",
  '  local wait = (tonumber(oldest[2]) + windowMs) - now',
  '  if wait < 1 then wait = 1 end',
  '  return {2, wait}',
  'end',
  // Grant: record this dispatch and consume one concurrency slot.
  "redis.call('ZADD', KEYS[2], now, ARGV[6])",
  "redis.call('PEXPIRE', KEYS[2], windowMs)",
  "redis.call('INCR', KEYS[1])",
  "redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))",
  'return {0, 0}',
].join('\n');

/**
 * Lua release: return one concurrency slot to the shared budget without ever
 * driving the counter below zero (a double release or a post-TTL release must
 * not corrupt the count).
 *
 *   KEYS[1] = concurrency counter key
 */
const REDIS_RELEASE_SCRIPT = [
  "local conc = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if conc > 0 then redis.call('DECR', KEYS[1]) end",
  'return 0',
].join('\n');

/**
 * Create the authoritative Redis-backed {@link RateLimiter} (R2.4). All
 * processes sharing the egress IP draw from one budget per bucket via the
 * `disney:ratelimit:{bucket}:*` keys.
 *
 * `acquire` polls the atomic Lua attempt, pacing itself with the same
 * arithmetic as the pure core: on rate saturation it sleeps for exactly the
 * wait the script computes (until the oldest in-window dispatch ages out of the
 * sliding window); on concurrency saturation it sleeps a short poll interval
 * and retries. It waits, never rejecting (R2.6).
 */
export function createRedisRateLimiter(
  cfg: RateLimiterConfig,
  deps: RedisRateLimiterDeps,
): RateLimiter {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const redis = deps.redis;
  const prefix = deps.keyPrefix ?? REDIS_RATE_LIMIT_PREFIX;
  const concurrencyPollMs = deps.concurrencyPollMs ?? 25;
  const concurrencyTtlMs = deps.concurrencyTtlMs ?? 60_000;

  // Monotonic per-process counter that (combined with the timestamp) makes each
  // sorted-set member unique so concurrent dispatches sharing a millisecond do
  // not collide on the same ZADD member and under-count the window.
  let dispatchSeq = 0;

  const concurrencyKey = (bucket: DisneyTarget): string =>
    `${prefix}:${bucket}:concurrency`;
  const rateKey = (bucket: DisneyTarget): string => `${prefix}:${bucket}:rate`;

  const makeLease = (bucket: DisneyTarget): RateLimitLease => {
    let released = false;
    return {
      release(): void {
        if (released) {
          return;
        }
        released = true;
        // Best-effort: a failed release is recovered by the counter's TTL.
        void redis
          .eval(REDIS_RELEASE_SCRIPT, 1, concurrencyKey(bucket))
          .catch(() => undefined);
      },
    };
  };

  return {
    async acquire(bucket: DisneyTarget): Promise<RateLimitLease> {
      for (;;) {
        const t = now();
        dispatchSeq += 1;
        const member = `${t}-${process.pid}-${dispatchSeq}`;
        const result = (await redis.eval(
          REDIS_ACQUIRE_SCRIPT,
          2,
          concurrencyKey(bucket),
          rateKey(bucket),
          cfg.maxConcurrency,
          cfg.maxRequestsPerSecond,
          t,
          RATE_WINDOW_MS,
          concurrencyTtlMs,
          member,
        )) as [number, number];

        const [status, waitMs] = result;

        if (status === 0) {
          return makeLease(bucket);
        }

        if (status === 2) {
          // Rate-saturated: wait exactly until the oldest in-window dispatch
          // ages out of the sliding window (as computed atomically by Lua).
          await sleep(Math.max(1, waitMs));
          continue;
        }

        // Concurrency-saturated: a slot frees on another process's release,
        // which we cannot observe directly, so poll after a short pause (R2.6).
        await sleep(concurrencyPollMs);
      }
    },
  };
}
