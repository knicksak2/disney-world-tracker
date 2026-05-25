/**
 * Catalog_Sync scheduler.
 *
 * Implements R1.10 ("THE Catalog_Service SHALL perform a scheduled
 * Catalog_Sync against the ThemeParks_API at least once every 24 hours")
 * and the design's "Catalog_Sync (R1.9-R1.16)" bullet:
 *
 *   "A scheduled BullMQ job runs every 24 hours. A coordination lock in
 *    Redis prevents duplicate concurrent syncs."
 *
 * The scheduler is intentionally thin: it owns a BullMQ queue, a worker
 * that consumes that queue, and a repeatable job scheduler entry that
 * enqueues one job every 24 hours. The actual upstream fetch, classify,
 * reconcile, and persist work lives in `runSync` (task 9.3, not in this
 * module). `runSync` itself owns the `catalog:sync:lock` Redis NX lock,
 * so concurrent invocations from the scheduler, an opportunistic on-read
 * race (task 9.4), or a manual operator trigger all coalesce safely.
 *
 * Connection handling
 * -------------------
 *
 * BullMQ workers issue blocking Redis commands and therefore require a
 * connection with `maxRetriesPerRequest: null`. The shared client
 * exported by `redis/client.ts` is configured with a small retry budget
 * for the request-handler hot path (lockout, leaderboard cache, etc.)
 * and is NOT suitable for a worker. Callers must build a dedicated
 * connection -- typically via `createRedisClient(config, { maxRetriesPerRequest: null })`
 * from `redis/client.ts` -- and pass it in as `connection`. Re-exporting
 * the BullMQ-friendly `ConnectionOptions` type lets call sites stay
 * decoupled from the underlying library.
 *
 * Lifecycle
 * ---------
 *
 * `startCatalogScheduler` returns a handle that owns the queue and the
 * worker. The production entrypoint should `close()` the handle as part
 * of the SIGTERM shutdown path so in-flight syncs drain and the BullMQ
 * Redis sockets are released cleanly. Tests typically build a handle
 * with a fast `intervalMs` and a fake `runSync`, drive a few iterations
 * via `queue.add` directly, then `close()` to tear everything down.
 *
 * The `runSync` function is taken by injection (rather than imported
 * from `./sync.js`) so:
 *   - this module compiles independently of task 9.3,
 *   - tests can substitute a deterministic stub without monkey-patching
 *     the real implementation,
 *   - the scheduler stays a single-responsibility module (timer + queue +
 *     worker), with the sync orchestrator owning all the upstream/DB
 *     concerns.
 *
 * _Requirements: R1.10_
 */

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * BullMQ queue name. Stable across deployments because BullMQ persists
 * scheduler metadata in Redis under this prefix; renaming would orphan
 * the existing scheduler entry until it is manually cleaned up.
 */
export const CATALOG_SYNC_QUEUE_NAME = 'catalog-sync';

/**
 * Job name attached to every enqueued sync invocation. Distinct from the
 * scheduler id so future ad-hoc syncs (e.g. an admin trigger) can share
 * the same queue and worker without colliding with the repeatable entry.
 */
export const CATALOG_SYNC_JOB_NAME = 'catalog-sync.run';

/**
 * Stable scheduler id used by `Queue.upsertJobScheduler`. Re-running the
 * scheduler factory with the same id updates the existing schedule in
 * place rather than spawning a duplicate, so a process restart cannot
 * double the firing rate.
 */
export const CATALOG_SYNC_SCHEDULER_ID = 'catalog-sync.every-24h';

/**
 * Default 24-hour interval expressed in milliseconds, matching R1.10.
 * Exposed as a constant so tests can compare against it without
 * recomputing the literal.
 */
export const CATALOG_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Contract for the catalog sync entrypoint defined by task 9.3. The
 * scheduler invokes this once per scheduled job. The function is
 * expected to handle its own Redis lock, upstream errors, and partial
 * failures; the scheduler treats any thrown error as a job failure and
 * relies on BullMQ's default retry/backoff behavior plus the next
 * scheduled tick to recover.
 *
 * The return value is intentionally `unknown`: the scheduler does not
 * inspect it. Task 9.3 may return a structured `SyncSummary`; that is
 * preserved as the BullMQ `returnvalue` for observability without
 * coupling this module to the specific shape.
 */
export type RunSync = () => Promise<unknown>;

/**
 * Inputs to `startCatalogScheduler`. All fields except `runSync` and
 * `connection` are optional so the production entrypoint can supply just
 * the essentials.
 */
export interface CatalogSchedulerOptions {
  /** The catalog sync entrypoint to invoke on each scheduled tick (task 9.3). */
  readonly runSync: RunSync;

  /**
   * BullMQ connection. MUST be configured with `maxRetriesPerRequest: null`
   * (BullMQ requires this for the worker's blocking commands). See the
   * module docstring for the recommended construction.
   */
  readonly connection: ConnectionOptions;

  /**
   * Optional logger for queue/worker lifecycle events. When omitted, the
   * scheduler runs silently; BullMQ's own internal logging is unaffected.
   */
  readonly logger?: Logger;

  /**
   * Override the 24-hour repeat interval. Useful for tests that want
   * to drive several iterations quickly. Production callers should leave
   * this unset so R1.10's "at least once every 24 hours" is honored
   * verbatim.
   */
  readonly intervalMs?: number;

  /**
   * Whether the scheduler should auto-start the worker. Defaults to
   * `true` for the production entrypoint. Tests sometimes set this to
   * `false` so they can register inspectors before the first job runs.
   */
  readonly autorun?: boolean;
}

/**
 * Handle returned by `startCatalogScheduler`. The queue and worker are
 * exposed for direct use (e.g. an admin endpoint enqueueing an immediate
 * sync, or a test inspecting job state) but the typical caller only needs
 * `close()` for graceful shutdown.
 */
export interface CatalogSchedulerHandle {
  readonly queue: Queue;
  readonly worker: Worker;
  /**
   * Stop accepting new jobs, wait for any in-flight job to finish, and
   * release the underlying Redis sockets. Idempotent: subsequent calls
   * resolve without error because BullMQ's `close()` is itself
   * idempotent.
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// startCatalogScheduler
// ---------------------------------------------------------------------------

/**
 * Build and start the catalog sync scheduler.
 *
 * On success, BullMQ will:
 *   1. enqueue a `catalog-sync.run` job approximately every `intervalMs`
 *      (default 24 hours),
 *   2. dispatch each job to the local worker, which calls `runSync`,
 *   3. record the result/error against the BullMQ job for observability.
 *
 * The scheduler resolves once the repeatable scheduler entry has been
 * upserted, guaranteeing that a process which exits immediately after
 * `startCatalogScheduler` resolves still has the schedule registered in
 * Redis for the next process to pick up.
 */
export async function startCatalogScheduler(
  options: CatalogSchedulerOptions,
): Promise<CatalogSchedulerHandle> {
  const {
    runSync,
    connection,
    logger,
    intervalMs = CATALOG_SYNC_INTERVAL_MS,
    autorun = true,
  } = options;

  const queue = new Queue(CATALOG_SYNC_QUEUE_NAME, { connection });

  const worker = new Worker(
    CATALOG_SYNC_QUEUE_NAME,
    async (job: Job): Promise<unknown> => {
      logger?.info(
        { jobId: job.id, jobName: job.name },
        'catalog sync job starting',
      );
      // Concurrency is 1 (see WorkerOptions below) so this is the only
      // in-flight invocation per process. `runSync` itself enforces the
      // cross-process exclusion via the `catalog:sync:lock` Redis NX key.
      return runSync();
    },
    {
      connection,
      // The sync is a heavy I/O operation that should never run in
      // parallel within a single process. Cross-process coordination is
      // the responsibility of `runSync` (task 9.3) via the Redis lock.
      concurrency: 1,
      autorun,
    },
  );

  if (logger) {
    worker.on('failed', (job, err) => {
      logger.error(
        { err, jobId: job?.id, jobName: job?.name },
        'catalog sync job failed',
      );
    });
    worker.on('completed', (job) => {
      logger.info(
        { jobId: job.id, jobName: job.name },
        'catalog sync job completed',
      );
    });
    // `error` covers worker-level faults (connection blips, lock-renewal
    // problems) that are not tied to a specific job.
    worker.on('error', (err) => {
      logger.error({ err }, 'catalog sync worker error');
    });
  }

  // Upsert the repeatable scheduler entry. Using a stable id ensures that
  // restarting the API does not multiply the schedule -- BullMQ replaces
  // the existing entry in place and resumes from the next due tick.
  await queue.upsertJobScheduler(
    CATALOG_SYNC_SCHEDULER_ID,
    { every: intervalMs },
    {
      name: CATALOG_SYNC_JOB_NAME,
      opts: {
        // Keep recent runs for observability without unbounded growth.
        // Tunable; chosen so an operator can inspect the last week of
        // success/failure runs without scrolling Redis manually.
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    },
  );

  return {
    queue,
    worker,
    async close(): Promise<void> {
      // Close the worker first so no new job is picked up after the queue
      // is closed; otherwise BullMQ would log a spurious connection error.
      await worker.close();
      await queue.close();
    },
  };
}
