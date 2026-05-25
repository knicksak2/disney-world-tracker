/**
 * Redis-backed login lockout service.
 *
 * Implements the lockout rule from R6.7 and the design's "Password handling"
 * section:
 *
 *   On the 5th failure within a 15-minute window, set a Redis lock
 *   `locked:{userId}` with 15-minute TTL; subsequent logins return
 *   `account_locked` until the key expires.
 *
 * Storage layout in Redis:
 *
 *   - `lockout:{userId}`  - sorted set of failure timestamps (ms-since-epoch
 *                            as score and as member). Acts as a sliding 15-
 *                            minute window: on every failure we ZADD the new
 *                            timestamp, ZREMRANGEBYSCORE to drop entries
 *                            older than now - 15 min, then ZCARD to count
 *                            the remaining failures. EXPIRE is reset to 15
 *                            minutes so the key self-cleans after inactivity.
 *
 *   - `locked:{userId}`   - opaque marker key with a 15-minute TTL. Set when
 *                            the failure count crosses the threshold. While
 *                            this key exists, `isLocked` returns true and the
 *                            login route must reject with `account_locked`,
 *                            regardless of credential validity.
 *
 * On successful login, `clearOnSuccess` deletes both keys so the next
 * unrelated login attempt starts from a clean slate.
 *
 * The service takes its `Redis` client by constructor injection. Tests can
 * pass any object shaped like `LockoutRedis` (a fake in-memory Redis) so
 * the unit tests do not need a real Redis server. The companion property
 * test for Property 15 in task 6.9 exercises this contract.
 *
 * Validates: Requirements 6.7
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sliding window for counting failed login attempts. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Threshold of failures within the window that triggers a lock. */
export const LOCKOUT_THRESHOLD = 5;

/** TTL applied to the `locked:{userId}` marker key (and also reused for the counter). */
export const LOCKOUT_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Redis interface (for injection)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `ioredis`'s `Redis` API that this module touches. By
 * accepting this structural interface, the unit tests can supply an in-
 * memory fake without having to mock the full client.
 *
 * Argument shapes intentionally match ioredis's TS overloads we rely on so
 * that passing a real `Redis` instance type-checks without casts.
 */
export interface LockoutRedis {
  /** Sorted set add. We use `score == member == timestamp`. */
  zadd(key: string, score: number, member: string): Promise<number>;
  /** Drop entries with score in `[min, max]`. */
  zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number>;
  /** Cardinality of the sorted set. */
  zcard(key: string): Promise<number>;
  /** Set TTL in seconds. */
  expire(key: string, seconds: number): Promise<number>;
  /**
   * SET with options. We only use `EX` + `NX` here, but typing the third
   * argument as a flexible rest array keeps the signature compatible with
   * ioredis's many overloads.
   */
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  /** EXISTS. Returns the number of keys that exist. */
  exists(key: string): Promise<number>;
  /** DEL. Returns the number of keys actually removed. */
  del(...keys: string[]): Promise<number>;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function counterKey(userId: string): string {
  return `lockout:${userId}`;
}

function lockKey(userId: string): string {
  return `locked:${userId}`;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Public surface of the lockout service. Each method is keyed by an opaque
 * `userId` (the Auth_Service resolves the email to a user id before
 * recording a failure so that probing nonexistent emails cannot inflate any
 * counter).
 */
export interface LockoutService {
  /**
   * Record a failed login attempt for `userId` at `now`. Returns whether
   * the threshold was crossed by this call (and therefore the account is
   * now newly locked). Callers can use the return value to decide whether
   * to surface `account_locked` immediately versus `invalid_credentials`,
   * but the canonical check before each login is `isLocked`.
   */
  recordFailure(userId: string, now?: number): Promise<boolean>;

  /** True iff a `locked:{userId}` marker currently exists. */
  isLocked(userId: string): Promise<boolean>;

  /**
   * Clear both the failure counter and any active lock on a successful
   * login. Idempotent: deleting a missing key is a no-op in Redis.
   */
  clearOnSuccess(userId: string): Promise<void>;
}

/**
 * Build a `LockoutService` bound to the supplied Redis client. The factory
 * style matches the design's preference for constructor injection so unit
 * tests can substitute a fake.
 *
 * @param redis  Redis client (real `ioredis` in production, a fake in tests).
 * @param now    Optional clock injector. Defaults to `Date.now`. Used by
 *               `recordFailure` when its caller does not supply an explicit
 *               timestamp; surfaced to the public API so the lockout property
 *               test can drive a deterministic clock.
 */
export function createLockoutService(
  redis: LockoutRedis,
  now: () => number = Date.now,
): LockoutService {
  return {
    async recordFailure(userId: string, at?: number): Promise<boolean> {
      const t = at ?? now();
      const key = counterKey(userId);
      const lock = lockKey(userId);

      // Slide the window: drop everything older than `t - LOCKOUT_WINDOW_MS`.
      // We use `t - WINDOW` (not `now - WINDOW`) so that an explicit `at`
      // value gives a deterministic, testable result; in production callers
      // typically omit `at` and rely on `Date.now`.
      const windowStartExclusive = t - LOCKOUT_WINDOW_MS;
      // ZREMRANGEBYSCORE is inclusive on both ends; drop everything strictly
      // older than `t - WINDOW` by using `-inf` to `windowStart - 1`.
      await redis.zremrangebyscore(key, '-inf', windowStartExclusive - 1);

      // Record this failure. Each entry uses a unique member so that
      // multiple failures sharing a millisecond all count toward the
      // sliding-window total (the score still equals the timestamp, which
      // is what the ZREMRANGEBYSCORE pruning relies on).
      await redis.zadd(key, t, `${t}:${randomUUID()}`);

      // Refresh TTL so the counter self-cleans after inactivity.
      await redis.expire(key, LOCKOUT_TTL_SECONDS);

      // Count current failures within the window.
      const count = await redis.zcard(key);

      if (count >= LOCKOUT_THRESHOLD) {
        // SET NX so we only stamp the lock once per window; the TTL is set
        // unconditionally on this branch to keep the lock alive for a full
        // 15 minutes from this triggering failure.
        await redis.set(lock, '1', 'EX', LOCKOUT_TTL_SECONDS);
        return true;
      }
      return false;
    },

    async isLocked(userId: string): Promise<boolean> {
      const present = await redis.exists(lockKey(userId));
      return present > 0;
    },

    async clearOnSuccess(userId: string): Promise<void> {
      // DEL accepts both keys in one round-trip; missing keys are silently
      // ignored, which is fine because a clean slate is the goal here.
      await redis.del(counterKey(userId), lockKey(userId));
    },
  };
}
