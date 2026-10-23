/**
 * PostgreSQL connection pool.
 *
 * Exposes a single shared `pg.Pool` for the API process. The pool reads its
 * connection string from the typed config module (task 2.1). A single shared
 * pool is preferred over per-request clients so that connection limits are
 * enforced application-wide and prepared statements can be reused.
 */
import pino from "pino";
import pg from "pg";
import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

import { loadConfig } from "../config.js";

const { Pool: PgPool } = pg;

const poolLogger = pino({ name: "db-pool" });

/**
 * Attach the mandatory `error` listener to a pool.
 *
 * `pg.Pool` re-emits errors from *idle* clients (e.g. Neon closing a pooled
 * connection, a network blip, a server restart) as an `error` event on the
 * pool. With no listener, Node treats that as an unhandled 'error' event and
 * crashes the whole process ("Connection terminated unexpectedly"). The pool
 * already evicts the dead client, so logging is all that is needed; the next
 * `query()`/`connect()` transparently opens a fresh connection.
 */
export function attachPoolErrorHandler(
  target: Pick<Pool, "on">,
  log: Pick<typeof poolLogger, "error"> = poolLogger,
): void {
  target.on("error", (err) => {
    log.error({ err }, "idle pg client error (client evicted from pool)");
  });
}

/**
 * The exported pool type. We re-export `pg`'s `Pool` so consumers do not need
 * to depend on the `pg` package directly.
 */
export type DbPool = Pool;

let pool: Pool | undefined;

/**
 * Build a `pg.Pool` from the API config. Exposed for tests and for callers
 * that need a pool not tied to the process-wide singleton.
 */
export function createPool(overrides: Partial<PoolConfig> = {}): Pool {
  const config = loadConfig();
  const poolConfig: PoolConfig = {
    connectionString: config.database.url,
    // Conservative defaults; can be tuned via env if/when needed.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // TCP keep-alive lowers the odds of an idle socket being silently dropped
    // by Neon's pooler / intermediate NATs.
    keepAlive: true,
    ...overrides,
  };
  const created = new PgPool(poolConfig);
  attachPoolErrorHandler(created);
  return created;
}

/**
 * Get the process-wide singleton pool, creating it on first access.
 *
 * Use this from request handlers and services. Tests that need an isolated
 * pool should call `createPool()` directly.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

/**
 * Close the singleton pool. Intended for graceful shutdown and for tests.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

/**
 * Convenience wrapper around `pool.query` that preserves typed row results.
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params as unknown[] | undefined);
}

/**
 * Run `fn` inside a single transaction on a dedicated client. Commits on
 * success, rolls back on any thrown error, and always releases the client.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors so the original cause surfaces.
    }
    throw err;
  } finally {
    client.release();
  }
}
