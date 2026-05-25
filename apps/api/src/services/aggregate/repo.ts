/**
 * Aggregate_Ratings_Service repository.
 *
 * Task 8.3 of the disney-world-tracker plan. The repo is the single
 * point of contact between the aggregate worker (this directory's
 * `worker.ts`) and the `aggregate_ratings` and `ratings` tables (per
 * `migrations/0001_init.sql`):
 *
 *   aggregate_ratings (
 *     experience_id  UUID  PRIMARY KEY,
 *     sum_ratings    BIGINT  DEFAULT 0,
 *     count_ratings  INT     DEFAULT 0,
 *     mean_x10       SMALLINT,    -- NULL when count_ratings < 3
 *     updated_at     TIMESTAMPTZ
 *   )
 *
 * Public surface:
 *
 *   - `updateAggregate(experienceId, oldValue, newValue)` — incremental
 *     path used by the BullMQ worker. Wraps the read/compute/UPSERT in
 *     a single transaction and acquires a Postgres advisory lock keyed
 *     on the experience id so concurrent updates for the same
 *     Experience serialize. The resulting `(sum, count, mean_x10)`
 *     triple is computed by the pure function
 *     {@link updateMeanX10}; that function is mathematically
 *     equivalent to a from-scratch recompute, so the incremental path
 *     is observationally indistinguishable from
 *     {@link recomputeFromScratch} (Property 26).
 *
 *   - `recomputeFromScratch(experienceId)` — deterministic reference
 *     path used by the periodic reconciler (`worker.ts`'s
 *     `startAggregateReconcileScheduler`). Reads every row in
 *     `ratings` for the Experience, sums/counts them, and UPSERTs the
 *     resulting triple. Used both as drift-detection defense in depth
 *     (design.md "Aggregate_Ratings_Service" — "A periodic reconciler
 *     ... recomputes from raw `ratings` rows to detect any drift") and
 *     as a one-shot recovery path on suspected corruption.
 *
 *   - `getAggregate(experienceId)` — SELECT, returns `null` when no
 *     row exists. The route layer (task 8.4) renders the result as
 *     `AggregateRatingDTO` at the API boundary.
 *
 *   - `listExperienceIdsForReconcile()` — enumerate every Experience
 *     that has either an `aggregate_ratings` row or at least one row
 *     in `ratings`. The reconciler walks this list once per period and
 *     calls `recomputeFromScratch` on each id.
 *
 * Advisory lock encoding
 * ----------------------
 *
 * `experiences.id` is a UUID. `pg_advisory_xact_lock` accepts either a
 * single `bigint` or two `int4`s. We hash the UUID's text form with
 * `hashtext($1::text)` (a stable 32-bit hash built into Postgres) and
 * cast to `bigint`. Hash collisions only cause unrelated Experiences to
 * serialize occasionally — that is a throughput concern, not a
 * correctness concern, since the body of the transaction always reads
 * the latest row before writing. The lock auto-releases at COMMIT or
 * ROLLBACK because we use the `_xact_` variant, so a crashed worker
 * cannot leak locks across reconnects.
 *
 * Validates: Requirements R10.7 (and supporting R10.1, R10.2, R10.4,
 * R10.8, R10.9 via {@link updateMeanX10}).
 */

import type { PoolClient, QueryResultRow } from 'pg';

import type { DbPool } from '../../db/pool.js';
import {
  MIN_AGGREGATE_RATING_COUNT,
  roundHalfUp,
  updateMeanX10,
  type AggregateMeanX10State,
} from './updateMeanX10.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Snapshot of a single `aggregate_ratings` row as exposed to consumers.
 *
 * `meanX10` is `null` while `count < MIN_AGGREGATE_RATING_COUNT`
 * (R10.4 threshold gating). The route layer divides by 10 to render
 * the user-visible decimal in `[1.0, 10.0]`.
 */
export interface AggregateRatingState {
  readonly experienceId: string;
  readonly sum: number;
  readonly count: number;
  readonly meanX10: number | null;
  readonly updatedAt: Date;
}

/**
 * Repository surface returned by {@link createAggregateRepo}. Callers
 * (the worker and the route layer) depend on this interface so that
 * tests can swap a fake implementation when convenient.
 */
export interface AggregateRepo {
  updateAggregate(
    experienceId: string,
    oldValue: number | null,
    newValue: number | null,
  ): Promise<AggregateRatingState>;
  recomputeFromScratch(experienceId: string): Promise<AggregateRatingState>;
  getAggregate(experienceId: string): Promise<AggregateRatingState | null>;
  listExperienceIdsForReconcile(): Promise<readonly string[]>;
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

/**
 * Row shape of the `aggregate_ratings` table. `pg` returns BIGINT as a
 * string by default (to avoid silent precision loss above 2^53), so
 * we explicitly project to numeric types in the SELECT statements
 * below. For an Experience with millions of integer ratings in
 * `[1, 10]` the sum still stays well inside the JavaScript safe
 * integer range, so a plain `number` is correct.
 */
interface AggregateRow extends QueryResultRow {
  experience_id: string;
  sum_ratings: number;
  count_ratings: number;
  mean_x10: number | null;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an {@link AggregateRepo} bound to the supplied pool. Constructor
 * injection (rather than reaching for `getPool()` at module top-level)
 * keeps the repo testable: integration tests can pass a pool connected
 * to a sandbox database, and unit tests can pass a fake whose `query`
 * method records or rewrites SQL.
 */
export function createAggregateRepo(pool: DbPool): AggregateRepo {
  return {
    updateAggregate: (experienceId, oldValue, newValue) =>
      updateAggregate(pool, experienceId, oldValue, newValue),
    recomputeFromScratch: (experienceId) =>
      recomputeFromScratch(pool, experienceId),
    getAggregate: (experienceId) => getAggregate(pool, experienceId),
    listExperienceIdsForReconcile: () => listExperienceIdsForReconcile(pool),
  };
}

// ---------------------------------------------------------------------------
// updateAggregate
// ---------------------------------------------------------------------------

/**
 * Apply a single `RatingChanged{oldValue, newValue}` event to the
 * Experience's aggregate row. Sequence:
 *
 *   1. BEGIN.
 *   2. `pg_advisory_xact_lock(hashtext(experience_id::text)::bigint)` —
 *      serializes concurrent updates for the same Experience. The lock
 *      auto-releases on COMMIT or ROLLBACK.
 *   3. SELECT the current `(sum_ratings, count_ratings)` for the row.
 *      Treat a missing row as `(0, 0)` so the very first event for an
 *      Experience inserts the row in step (5).
 *   4. Apply {@link updateMeanX10} to obtain the new triple.
 *   5. INSERT ... ON CONFLICT (experience_id) DO UPDATE the row,
 *      returning `updated_at` so the caller can pin its observable
 *      ordering.
 *   6. COMMIT.
 *
 * The whole sequence runs on a single `PoolClient`. Without the
 * advisory lock, two concurrent workers could each read the same prior
 * `(sum, count)` snapshot and then both UPSERT, double-applying the
 * delta. The advisory lock keeps the read-and-UPSERT pair atomic.
 */
async function updateAggregate(
  pool: DbPool,
  experienceId: string,
  oldValue: number | null,
  newValue: number | null,
): Promise<AggregateRatingState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Acquire the per-experience advisory lock. `hashtext` is a stable
    // 32-bit hash built into Postgres; casting to bigint resolves the
    // overload for the single-bigint form of `pg_advisory_xact_lock`.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1::text)::bigint)`,
      [experienceId],
    );

    const prior = await readAggregateForUpdate(client, experienceId);
    const prevSum = prior?.sum ?? 0;
    const prevCount = prior?.count ?? 0;

    const next = updateMeanX10(prevSum, prevCount, oldValue, newValue);

    const row = await upsertAggregate(client, experienceId, next);

    await client.query('COMMIT');
    return rowToState(row);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// recomputeFromScratch
// ---------------------------------------------------------------------------

/**
 * Recompute the aggregate row for an Experience by scanning every row
 * in `ratings` for that Experience. Used by the periodic reconciler
 * (`worker.ts`) for drift detection, and as a one-shot recovery path
 * if an operator suspects corruption.
 *
 * The same advisory lock as `updateAggregate` is taken so a recompute
 * cannot race with an in-flight incremental update for the same
 * Experience — the recompute would otherwise overwrite an event that
 * had already been applied incrementally, double-counting it on the
 * next event. With the lock, the recompute either runs to completion
 * before the next incremental event, or after; either way the result
 * is consistent.
 *
 * Even when no `ratings` rows exist for the Experience, the function
 * still UPSERTs a `(0, 0, NULL)` row so the reconciler converges to
 * the truth (e.g. after every rating for an Experience has been
 * deleted).
 */
async function recomputeFromScratch(
  pool: DbPool,
  experienceId: string,
): Promise<AggregateRatingState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1::text)::bigint)`,
      [experienceId],
    );

    const result = await client.query<{ sum: string | null; count: string }>(
      `SELECT COALESCE(SUM(value), 0)::bigint AS sum,
              COUNT(*)::bigint                AS count
         FROM ratings
        WHERE experience_id = $1`,
      [experienceId],
    );

    const row0 = result.rows[0];
    // `COUNT(*)` always returns one row, so the SELECT cannot be
    // empty; this guard is a driver-fault safety net.
    const sum = row0 ? Number(row0.sum ?? 0) : 0;
    const count = row0 ? Number(row0.count) : 0;
    const meanX10 =
      count >= MIN_AGGREGATE_RATING_COUNT ? roundHalfUp(sum * 10, count) : null;

    const upserted = await upsertAggregate(client, experienceId, {
      sum,
      count,
      meanX10,
    });

    await client.query('COMMIT');
    return rowToState(upserted);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getAggregate
// ---------------------------------------------------------------------------

/**
 * Read the aggregate row for an Experience. Returns `null` when no
 * row exists (no rating has ever been applied for the Experience).
 * The route layer translates `null` to the empty-state DTO
 * `{ value: null, count: 0 }` on the wire.
 */
async function getAggregate(
  pool: DbPool,
  experienceId: string,
): Promise<AggregateRatingState | null> {
  const result = await pool.query<AggregateRow>(
    `SELECT experience_id,
            sum_ratings::bigint   AS sum_ratings,
            count_ratings,
            mean_x10,
            updated_at
       FROM aggregate_ratings
      WHERE experience_id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? rowToState(row) : null;
}

// ---------------------------------------------------------------------------
// listExperienceIdsForReconcile
// ---------------------------------------------------------------------------

/**
 * Return the union of Experience ids that appear in either
 * `aggregate_ratings` or `ratings`. The reconciler walks this list and
 * calls `recomputeFromScratch` on each.
 *
 * Both tables contribute because:
 *   - An Experience with current ratings but a stale aggregate row
 *     (or no row yet) needs reconciliation.
 *   - An Experience whose ratings have all been deleted but whose
 *     aggregate row remains stale also needs reconciliation; without
 *     it, the row would forever report the last known value.
 *
 * The result is ordered by `experience_id` so the reconciler walks a
 * stable sequence — useful when a single reconciliation run is split
 * across multiple ticks.
 */
async function listExperienceIdsForReconcile(
  pool: DbPool,
): Promise<readonly string[]> {
  const result = await pool.query<{ experience_id: string }>(
    `SELECT experience_id FROM aggregate_ratings
     UNION
     SELECT experience_id FROM ratings
     ORDER BY experience_id ASC`,
  );
  return result.rows.map((row: { experience_id: string }) => row.experience_id);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * SELECT the aggregate row inside the calling transaction with `FOR
 * UPDATE`, so a concurrent transaction that somehow bypassed the
 * advisory lock (e.g. a future caller forgot to take it) still
 * serializes on the row lock. Returns `null` when no row exists.
 */
async function readAggregateForUpdate(
  client: PoolClient,
  experienceId: string,
): Promise<{ sum: number; count: number } | null> {
  const result = await client.query<{ sum: string; count: number }>(
    `SELECT sum_ratings::bigint AS sum, count_ratings AS count
       FROM aggregate_ratings
      WHERE experience_id = $1
      FOR UPDATE`,
    [experienceId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { sum: Number(row.sum), count: row.count };
}

/**
 * INSERT ... ON CONFLICT (experience_id) DO UPDATE the aggregate row
 * with the supplied triple. Returns the resulting row including the
 * server-assigned `updated_at` so callers can render it.
 *
 * The migration's CHECK constraints enforce `count_ratings >= 0`,
 * `sum_ratings >= 0`, and `mean_x10 IS NULL OR mean_x10 BETWEEN 10
 * AND 100`. The pure function {@link updateMeanX10} preserves all
 * three invariants for any sequence of valid `(oldValue, newValue)`
 * deltas, so this UPSERT cannot fail those checks under correct
 * upstream usage.
 */
async function upsertAggregate(
  client: PoolClient,
  experienceId: string,
  next: AggregateMeanX10State,
): Promise<AggregateRow> {
  const result = await client.query<AggregateRow>(
    `INSERT INTO aggregate_ratings (
       experience_id, sum_ratings, count_ratings, mean_x10, updated_at
     )
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (experience_id) DO UPDATE SET
       sum_ratings   = EXCLUDED.sum_ratings,
       count_ratings = EXCLUDED.count_ratings,
       mean_x10      = EXCLUDED.mean_x10,
       updated_at    = now()
     RETURNING experience_id,
               sum_ratings::bigint AS sum_ratings,
               count_ratings,
               mean_x10,
               updated_at`,
    [experienceId, next.sum, next.count, next.meanX10],
  );
  const row = result.rows[0];
  if (!row) {
    // Postgres always returns a row for a successful INSERT/UPSERT
    // ... RETURNING; an empty result would indicate a driver fault.
    throw new Error('aggregate UPSERT returned no row');
  }
  return row;
}

/**
 * Translate an `AggregateRow` into the public {@link AggregateRatingState}.
 * BIGINT comes back as either `number` or `string` depending on the
 * driver's parser configuration; `Number(row.sum_ratings)` is total over
 * the realistic value range and is the same coercion used in
 * `readAggregateForUpdate` and `recomputeFromScratch`.
 */
function rowToState(row: AggregateRow): AggregateRatingState {
  return {
    experienceId: row.experience_id,
    sum: Number(row.sum_ratings),
    count: row.count_ratings,
    meanX10: row.mean_x10,
    updatedAt: row.updated_at,
  };
}

/**
 * Roll back a transaction without throwing if the rollback itself
 * fails (e.g. the connection is already in an aborted state). Mirrors
 * the pattern used in `db/pool.ts::withTransaction` and
 * `tracking/rating/repo.ts`.
 */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Swallow rollback errors so the original cause surfaces.
  }
}
