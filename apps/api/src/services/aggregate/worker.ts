/**
 * Aggregate_Ratings_Service BullMQ worker and reconciler scheduler.
 *
 * Task 8.3 of the disney-world-tracker plan. Two concerns live here:
 *
 *   1. {@link startAggregateWorker} — consumes
 *      `RatingChanged{experienceId, oldValue, newValue}` jobs from the
 *      `aggregate-rating-changed` queue (constants in
 *      `./ratingChangedQueue.ts`) and applies each event to the
 *      `aggregate_ratings` row via
 *      {@link AggregateRepo.updateAggregate}. The repo itself wraps
 *      the read/compute/UPSERT in a single transaction with a per-
 *      experience advisory lock, so concurrent jobs for the same
 *      Experience serialize while jobs for different Experiences run
 *      in parallel up to the worker's configured concurrency.
 *
 *   2. {@link startAggregateReconcileScheduler} — registers a BullMQ
 *      repeatable job that, every `intervalMs` (default 24h), walks
 *      every Experience known to the repo and calls
 *      {@link AggregateRepo.recomputeFromScratch}. This is the
 *      drift-detection defense in depth described in design.md
 *      "Aggregate_Ratings_Service" — "A periodic reconciler ...
 *      recomputes from raw `ratings` rows to detect any drift". It is
 *      explicitly NOT on the 60-second R10.7 SLA path.
 *
 * Connection handling
 * -------------------
 *
 * BullMQ workers issue blocking Redis commands, so the connection
 * passed in MUST have `maxRetriesPerRequest: null`. The shared client
 * exported by `redis/client.ts` is configured with a small retry
 * budget for the request-handler hot path and is NOT suitable here.
 * Production callers should build a dedicated connection (typically
 * via `createRedisClient(config, { maxRetriesPerRequest: null })`) and
 * pass it as `connection`. Tests substitute an in-memory fake (see
 * `__tests__/worker.test.ts`).
 *
 * Lifecycle
 * ---------
 *
 * Each factory returns a handle that owns its queue and worker. The
 * production entrypoint should `close()` both handles as part of the
 * SIGTERM shutdown path so in-flight jobs drain and the BullMQ Redis
 * sockets are released cleanly. The worker factory does NOT itself
 * call `recomputeFromScratch`; jobs that reach the worker are
 * incremental updates only, with the reconciler scheduled separately.
 *
 * The {@link AggregateRepo} is taken by injection rather than imported
 * directly so:
 *   - the worker module compiles independently of the pool,
 *   - tests can substitute a deterministic stub without monkey-patching
 *     the repo,
 *   - the worker stays a single-responsibility module (queue + worker
 *     + dispatch) with the repo owning all DB concerns.
 *
 * Validates: Requirements R10.7
 */

import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type Processor,
  type WorkerOptions,
} from 'bullmq';
import type { Logger } from 'pino';

import {
  RATING_CHANGED_JOB_NAME,
  RATING_CHANGED_QUEUE_NAME,
  type RatingChangedEvent,
} from './ratingChangedQueue.js';
import type { AggregateRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Aggregate worker
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link startAggregateWorker}. `connection` and `repo` are
 * required; everything else is optional with production-sane defaults.
 */
export interface AggregateWorkerOptions {
  /**
   * BullMQ connection. MUST be configured with
   * `maxRetriesPerRequest: null` (BullMQ requires this for the
   * worker's blocking commands). See the module docstring.
   */
  readonly connection: ConnectionOptions;

  /**
   * Aggregate repository. The worker calls
   * {@link AggregateRepo.updateAggregate} once per job.
   */
  readonly repo: AggregateRepo;

  /**
   * Optional logger for queue/worker lifecycle events. When omitted,
   * the worker runs silently; BullMQ's internal logging is unaffected.
   */
  readonly logger?: Logger;

  /**
   * Maximum number of jobs the worker processes in parallel. Different
   * Experiences serialize on a Postgres advisory lock inside the repo,
   * so raising concurrency speeds up unrelated work without risking
   * incremental-update interleaving. Defaults to 4, which is a safe
   * value against the default `pg.Pool` size of 10.
   */
  readonly concurrency?: number;

  /**
   * Whether the worker should auto-start. Defaults to `true`. Tests
   * sometimes set this to `false` so they can register inspectors
   * before the first job runs.
   */
  readonly autorun?: boolean;

  /**
   * Test seam for substituting a fake `Worker` constructor. Production
   * callers omit this; tests can pass a stub that exercises the
   * processor without standing up a real Redis.
   */
  readonly workerFactory?: (
    name: string,
    processor: Processor<RatingChangedEvent>,
    opts: WorkerOptions,
  ) => Worker;
}

/**
 * Handle returned by {@link startAggregateWorker}.
 */
export interface AggregateWorkerHandle {
  readonly worker: Worker;
  /**
   * Stop accepting new jobs, wait for any in-flight job to finish,
   * and release the underlying Redis socket. Idempotent: subsequent
   * calls resolve without error because BullMQ's `close()` is itself
   * idempotent.
   */
  close(): Promise<void>;
}

/**
 * Build and start the aggregate-recompute worker. The returned handle
 * owns a single BullMQ {@link Worker} bound to the
 * `aggregate-rating-changed` queue. Each delivered job's payload is a
 * {@link RatingChangedEvent}; the processor forwards
 * `(experienceId, oldValue, newValue)` to
 * {@link AggregateRepo.updateAggregate}.
 *
 * Job-level retry/backoff is configured at the producer (see
 * `ratingChangedQueue.ts`); the worker simply rethrows any error so
 * BullMQ schedules the next attempt.
 */
export function startAggregateWorker(
  options: AggregateWorkerOptions,
): AggregateWorkerHandle {
  const {
    connection,
    repo,
    logger,
    concurrency = 4,
    autorun = true,
    workerFactory,
  } = options;

  const processor: Processor<RatingChangedEvent> = async (
    job: Job<RatingChangedEvent>,
  ): Promise<void> => {
    const { experienceId, oldValue, newValue } = job.data;
    logger?.debug(
      { jobId: job.id, jobName: job.name, experienceId },
      'aggregate worker: applying rating-changed event',
    );
    await repo.updateAggregate(experienceId, oldValue, newValue);
  };

  const workerOptions: WorkerOptions = {
    connection,
    concurrency,
    autorun,
  };

  const worker = workerFactory
    ? workerFactory(RATING_CHANGED_QUEUE_NAME, processor, workerOptions)
    : new Worker<RatingChangedEvent>(
        RATING_CHANGED_QUEUE_NAME,
        processor,
        workerOptions,
      );

  if (logger) {
    worker.on('failed', (job, err) => {
      logger.error(
        {
          err,
          jobId: job?.id,
          jobName: job?.name,
          experienceId: job?.data?.experienceId,
        },
        'aggregate worker: job failed',
      );
    });
    worker.on('completed', (job) => {
      logger.debug(
        {
          jobId: job.id,
          jobName: job.name,
          experienceId: job.data?.experienceId,
        },
        'aggregate worker: job completed',
      );
    });
    // `error` covers worker-level faults (connection blips, lock-renewal
    // problems) that are not tied to a specific job.
    worker.on('error', (err) => {
      logger.error({ err }, 'aggregate worker: error');
    });
  }

  return {
    worker,
    async close(): Promise<void> {
      await worker.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Reconciler scheduler
// ---------------------------------------------------------------------------

/**
 * BullMQ queue name for the periodic reconciler. Distinct from the
 * `aggregate-rating-changed` queue so reconciler jobs never block (or
 * are blocked by) the SLA-path incremental updates. Stable across
 * deployments because BullMQ persists scheduler metadata in Redis
 * under this prefix.
 */
export const AGGREGATE_RECONCILE_QUEUE_NAME = 'aggregate-reconcile';

/**
 * Job name attached to every enqueued reconciliation run. Matches the
 * task-brief naming so operators can grep BullMQ logs by event type.
 */
export const AGGREGATE_RECONCILE_JOB_NAME = 'aggregate-reconcile';

/**
 * Stable scheduler id used by `Queue.upsertJobScheduler`. Re-running
 * the factory with the same id updates the existing schedule in place
 * rather than spawning a duplicate, so a process restart cannot double
 * the firing rate.
 */
export const AGGREGATE_RECONCILE_SCHEDULER_ID =
  'aggregate-reconcile.every-24h';

/**
 * Default 24-hour interval between reconciliation runs, expressed in
 * milliseconds. Exposed as a constant so tests can compare against it
 * without recomputing the literal.
 */
export const AGGREGATE_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Inputs to {@link startAggregateReconcileScheduler}. `connection` and
 * `repo` are required; everything else is optional with production-
 * sane defaults.
 */
export interface AggregateReconcileSchedulerOptions {
  readonly connection: ConnectionOptions;
  readonly repo: AggregateRepo;
  readonly logger?: Logger;

  /**
   * Override the 24-hour reconciliation interval. Useful for tests
   * that want to drive several iterations quickly. Production callers
   * should leave this unset.
   */
  readonly intervalMs?: number;

  /**
   * Whether the worker should auto-start. Defaults to `true`.
   */
  readonly autorun?: boolean;

  /**
   * Optional batch size cap. The reconciler walks
   * {@link AggregateRepo.listExperienceIdsForReconcile} and calls
   * {@link AggregateRepo.recomputeFromScratch} on each id; passing a
   * cap stops the run after the first `batchSize` ids so a single
   * pathological batch does not block the worker indefinitely. By
   * default the run processes the entire list.
   */
  readonly batchSize?: number;

  /**
   * Test seam for substituting a fake `Worker` constructor. Production
   * callers omit this.
   */
  readonly workerFactory?: (
    name: string,
    processor: Processor,
    opts: WorkerOptions,
  ) => Worker;
}

/**
 * Handle returned by {@link startAggregateReconcileScheduler}. Owns
 * the queue and worker and exposes a unified `close()` for graceful
 * shutdown.
 */
export interface AggregateReconcileSchedulerHandle {
  readonly queue: Queue;
  readonly worker: Worker;
  close(): Promise<void>;
}

/**
 * Build and start the aggregate reconciler.
 *
 * On success, BullMQ will:
 *   1. enqueue an `aggregate-reconcile` job approximately every
 *      `intervalMs` (default 24 hours);
 *   2. dispatch each job to the local worker, which walks every
 *      Experience known to the repo and recomputes its aggregate
 *      from the raw `ratings` rows;
 *   3. record the result/error against the BullMQ job for
 *      observability.
 *
 * The function resolves once the repeatable scheduler entry has been
 * upserted, guaranteeing that a process which exits immediately after
 * the call returns still has the schedule registered in Redis for the
 * next process to pick up.
 *
 * Concurrency is forced to 1 so a single in-process reconciler run is
 * the only writer at a time — the per-experience advisory lock inside
 * `recomputeFromScratch` then handles cross-process coordination with
 * the incremental-update path.
 */
export async function startAggregateReconcileScheduler(
  options: AggregateReconcileSchedulerOptions,
): Promise<AggregateReconcileSchedulerHandle> {
  const {
    connection,
    repo,
    logger,
    intervalMs = AGGREGATE_RECONCILE_INTERVAL_MS,
    autorun = true,
    batchSize,
    workerFactory,
  } = options;

  const queue = new Queue(AGGREGATE_RECONCILE_QUEUE_NAME, { connection });

  const processor: Processor = async (job: Job): Promise<{
    processed: number;
  }> => {
    logger?.info(
      { jobId: job.id, jobName: job.name },
      'aggregate reconcile job starting',
    );

    const ids = await repo.listExperienceIdsForReconcile();
    const slice =
      batchSize !== undefined && batchSize >= 0
        ? ids.slice(0, batchSize)
        : ids;

    let processed = 0;
    for (const experienceId of slice) {
      try {
        await repo.recomputeFromScratch(experienceId);
        processed += 1;
      } catch (err) {
        // Log and continue: a single bad row should not poison the
        // whole reconciliation pass. The next scheduled run will
        // pick the row up again.
        logger?.error(
          { err, experienceId },
          'aggregate reconcile job: per-experience recompute failed',
        );
      }
    }

    return { processed };
  };

  const workerOptions: WorkerOptions = {
    connection,
    concurrency: 1,
    autorun,
  };

  const worker = workerFactory
    ? workerFactory(AGGREGATE_RECONCILE_QUEUE_NAME, processor, workerOptions)
    : new Worker(AGGREGATE_RECONCILE_QUEUE_NAME, processor, workerOptions);

  if (logger) {
    worker.on('failed', (job, err) => {
      logger.error(
        { err, jobId: job?.id, jobName: job?.name },
        'aggregate reconcile job failed',
      );
    });
    worker.on('completed', (job) => {
      logger.info(
        {
          jobId: job.id,
          jobName: job.name,
          returnvalue: job.returnvalue,
        },
        'aggregate reconcile job completed',
      );
    });
    worker.on('error', (err) => {
      logger.error({ err }, 'aggregate reconcile worker error');
    });
  }

  // Upsert the repeatable scheduler entry. Using a stable id ensures
  // that restarting the API does not multiply the schedule -- BullMQ
  // replaces the existing entry in place and resumes from the next due
  // tick.
  await queue.upsertJobScheduler(
    AGGREGATE_RECONCILE_SCHEDULER_ID,
    { every: intervalMs },
    {
      name: AGGREGATE_RECONCILE_JOB_NAME,
      opts: {
        // Keep recent runs for observability without unbounded growth.
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    },
  );

  return {
    queue,
    worker,
    async close(): Promise<void> {
      // Close the worker first so no new job is picked up after the
      // queue is closed; otherwise BullMQ would log a spurious
      // connection error.
      await worker.close();
      await queue.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { RATING_CHANGED_JOB_NAME, RATING_CHANGED_QUEUE_NAME };
