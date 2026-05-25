/**
 * Shared Redis client (ioredis).
 *
 * Mirrors the pattern of `db/pool.ts`: a small factory plus a process-wide
 * singleton, with the connection URL read from the typed config module
 * (task 2.1) so that no other code has to know about `REDIS_URL` or the
 * underlying provider.
 *
 * Per design.md "Cache and counters", Redis is used for:
 *   - the highest-rated leaderboard cache (5-minute TTL),
 *   - opportunistic Catalog_Sync coordination,
 *   - failed-login counters and the lockout window (this task, 6.4),
 *   - session blacklist on logout.
 *
 * Consumers should normally use `getRedisClient()` from request handlers
 * and services. Tests and isolated benchmarks can build a dedicated client
 * with `createRedisClient(config, overrides)`.
 */

import { Redis, type RedisOptions } from 'ioredis';

import { type AppConfig, loadConfig } from '../config.js';

/**
 * Re-exported `Redis` type so consumers do not have to depend on `ioredis`
 * directly. New service modules (`auth/lockout.ts`, leaderboard cache, etc.)
 * accept this type via constructor injection so they can be unit-tested
 * against a fake conforming to the same structural interface.
 */
export type RedisClient = Redis;

let client: Redis | undefined;

/**
 * Construct a fresh `Redis` client using the supplied `AppConfig`. Optional
 * `overrides` are merged on top of the base options for tests (e.g. forcing
 * `lazyConnect: true` so the test can drive connect manually).
 *
 * `maxRetriesPerRequest` is bounded so that a Redis outage does not stall
 * request handlers indefinitely; the lockout service in particular is on
 * the login hot path and must fail fast under degradation.
 */
export function createRedisClient(
  config: AppConfig,
  overrides: RedisOptions = {},
): Redis {
  const base: RedisOptions = {
    // Eagerly connect so any URL/auth misconfiguration surfaces during
    // process start instead of on the first request.
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    enableReadyCheck: true,
  };
  return new Redis(config.redis.url, { ...base, ...overrides });
}

/**
 * Get the process-wide singleton client, creating it on first access. Use
 * this from request handlers and services.
 */
export function getRedisClient(): Redis {
  if (!client) {
    client = createRedisClient(loadConfig());
  }
  return client;
}

/**
 * Close the singleton client. Intended for graceful shutdown and for
 * tests that want a clean slate between cases. After this returns, the
 * next `getRedisClient()` call will lazily build a fresh client.
 */
export async function closeRedisClient(): Promise<void> {
  if (client) {
    const current = client;
    client = undefined;
    await current.quit();
  }
}
