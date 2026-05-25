/**
 * RatingChanged BullMQ emitter.
 *
 * Task 10.4 of the disney-world-tracker plan. Wires the
 * `RatingChanged{experienceId, oldValue, newValue}` domain event emitted
 * by the Tracking_Service rating repo (task 10.2) to a BullMQ queue that
 * the Aggregate_Ratings_Service worker (task 8.3) consumes to apply the
 * incremental update from `updateMeanX10.ts`.
 *
 * Design tie-in
 * -------------
 *
 * The design's "Aggregate_Ratings_Service" section (`design.md`) and the
 * sequence diagram both spell out the data flow:
 *
 *   Track->>Q: enqueue RatingChanged{expId, oldValue, value}
 *   Q->>Agg: process RatingChanged
 *   Agg->>DB: BEGIN; lock aggregate_ratings row
 *   Agg->>DB: UPDATE sum, count, mean_x10
 *
 * The 60-second SLA (R10.7) is met because the event-driven recompute is
 * enqueued synchronously with the rating mutation, the queue depth per
 * experience is small (at most one job in flight per experience due to
 * the advisory lock), and the work itself is O(1).
 *
 * Why a separate module
 * ---------------------
 *
 * The rating repo only depends on a structural
 * `(evt: RatingChangedEvent) => Promise<void>` callback. Keeping the
 * BullMQ wiring in this module means:
 *
 *   - Tests for the rating repo can pass a no-op or in-memory emitter
 *     without ever opening a Redis socket;
 *   - The aggregate worker (task 8.3) can be re-wired to a different
 *     transport (e.g. Postgres LISTEN/NOTIFY, in-process pub/sub) by
 *     swapping this module's implementation only.
 *
 * Connection handling
 * -------------------
 *
 * Producing jobs from a `Queue` does NOT require the `maxRetriesPerRequest:
 * null` BullMQ-friendly Redis client; that constraint applies only to
 * `Worker` blocking commands. Callers may pass either the shared API
 * Redis client or a dedicated `IORedis` instance — whatever satisfies
 * BullMQ's `ConnectionOptions` shape. The worker side (task 8.3) is
 * responsible for building its own `maxRetriesPerRequest: null`
 * connection.
 *
 * Validates: Requirements R10.7, R10.8, R10.9
 */

import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * BullMQ queue name. Stable across deployments because BullMQ persists
 * queue and scheduler metadata in Redis under this prefix; renaming would
 * orphan in-flight jobs and force operator cleanup. The `aggregate-`
 * prefix matches the owning service module.
 */
export const RATING_CHANGED_QUEUE_NAME = 'aggregate-rating-changed';

/**
 * Job name attached to every enqueued rating-changed event. Distinct from
 * the queue name so future ad-hoc maintenance jobs (e.g. a reconciler
 * forcing a recompute for a single Experience) can share the queue and
 * worker without colliding.
 */
export const RATING_CHANGED_JOB_NAME = 'rating-changed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Domain event emitted by the Tracking_Service rating repo on every
 * successful UPSERT or DELETE.
 *
 * Encoding follows `updateMeanX10`:
 *   - `oldValue === null` and `newValue !== null` → user added a rating.
 *   - `oldValue !== null` and `newValue !== null` → user replaced a rating
 *     (R10.8).
 *   - `oldValue !== null` and `newValue === null` → user removed a rating
 *     (R10.9).
 *
 * The event carries only the values needed to advance the aggregate row;
 * it deliberately omits user identity because the aggregate row tracks
 * sum/count, not individual contributors. Keeping `userId` out of the
 * payload also reinforces R10.10 (no other-user rating values exposed via
 * the aggregate path).
 *
 * `experienceId` is the stable internal UUID v5 produced by
 * `services/catalog/internalId.ts`.
 *
 * Both `oldValue` and `newValue` are integers in `[1, 10]` when present;
 * the rating repo enforces this before emitting (R4.1).
 */
export interface RatingChangedEvent {
  readonly experienceId: string;
  readonly oldValue: number | null;
  readonly newValue: number | null;
}

/**
 * Minimal structural contract this module needs from a BullMQ `Queue`.
 *
 * Pinning the contract instead of importing `Queue` directly lets unit
 * tests substitute an in-memory stub (see `__tests__/ratingChangedQueue.test.ts`)
 * without spinning up a real Redis. The `add` signature mirrors the
 * subset of `Queue.prototype.add` that this module actually uses.
 */
export interface RatingChangedQueueLike {
  add(
    name: string,
    data: RatingChangedEvent,
    opts?: JobsOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Handle returned by `createRatingChangedEmitter`. The `emit` callback
 * matches the structural type that the rating repo (task 10.2) expects
 * for its injected `emitRatingChanged` dependency.
 *
 * `close` releases the underlying queue's Redis socket and is intended to
 * be called as part of graceful shutdown.
 */
export interface RatingChangedEmitter {
  emit(evt: RatingChangedEvent): Promise<void>;
  close(): Promise<void>;
}

/**
 * Inputs to `createRatingChangedEmitter`.
 *
 * `connection` is required and is forwarded verbatim to the BullMQ
 * `Queue` constructor. `queueFactory` is an optional seam used by tests
 * to swap in an in-memory queue stub; production callers omit it.
 *
 * `defaultJobOptions` are merged into every emitted job. Defaults chosen
 * here keep recent jobs around for observability without unbounded
 * growth; they can be overridden at the per-emit call site if needed.
 */
export interface RatingChangedEmitterOptions {
  readonly connection: ConnectionOptions;
  readonly queueFactory?: (
    connection: ConnectionOptions,
  ) => RatingChangedQueueLike;
  readonly defaultJobOptions?: JobsOptions;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Production-default per-job options.
 *
 * - `removeOnComplete`/`removeOnFail` keep recent runs in Redis for
 *   observability without unbounded retention.
 * - `attempts` plus exponential backoff cover transient DB advisory-lock
 *   contention on the worker side. The 60-second R10.7 budget allows for
 *   3 retries spaced at 250ms-1s-4s without overrunning.
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 250 },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a BullMQ-backed emitter for `RatingChangedEvent`s.
 *
 * The returned `emit` enqueues one job per call carrying
 * `{ experienceId, oldValue, newValue }` under
 * {@link RATING_CHANGED_JOB_NAME} on the
 * {@link RATING_CHANGED_QUEUE_NAME} queue. The rating repo (task 10.2)
 * is expected to bind this to its `emitRatingChanged` dependency:
 *
 *   const { emit, close } = createRatingChangedEmitter({ connection });
 *   const ratingRepo = buildRatingRepo({ ..., emitRatingChanged: emit });
 *
 * `close` shuts the queue down and should be called from the API's
 * graceful-shutdown path before the Redis client itself is closed.
 */
export function createRatingChangedEmitter(
  options: RatingChangedEmitterOptions,
): RatingChangedEmitter {
  const {
    connection,
    queueFactory,
    defaultJobOptions = DEFAULT_JOB_OPTIONS,
  } = options;

  const queue: RatingChangedQueueLike = queueFactory
    ? queueFactory(connection)
    : new Queue(RATING_CHANGED_QUEUE_NAME, { connection });

  return {
    async emit(evt: RatingChangedEvent): Promise<void> {
      // Strip any extra keys before enqueueing so the on-wire payload is
      // exactly the documented event shape. Defensive: if the rating
      // repo (task 10.2) ever passes a richer object by mistake, the
      // worker still receives the minimal contract.
      const payload: RatingChangedEvent = {
        experienceId: evt.experienceId,
        oldValue: evt.oldValue,
        newValue: evt.newValue,
      };
      await queue.add(RATING_CHANGED_JOB_NAME, payload, defaultJobOptions);
    },
    async close(): Promise<void> {
      await queue.close();
    },
  };
}
