/**
 * Tracking_Service — Rating repository.
 *
 * Task 10.2 of the disney-world-tracker plan. The repo is the single
 * point of contact between the rating routes and the `ratings` table
 * (per the design ER diagram and `migrations/0001_init.sql`):
 *
 *   ratings (
 *     user_id        UUID,
 *     experience_id  UUID,
 *     value          SMALLINT  CHECK BETWEEN 1 AND 10,
 *     updated_at     TIMESTAMPTZ DEFAULT now(),
 *     PRIMARY KEY (user_id, experience_id)
 *   )
 *
 * Public surface:
 *
 *   - `setRating(userId, experienceId, value)` — UPSERT keyed on the
 *     composite primary key. Reads the prior value first so we can
 *     emit a `RatingChanged{oldValue, newValue}` event with the
 *     correct old value (which is what the Aggregate_Ratings_Service
 *     needs in order to update its incremental state, per design.md
 *     "Aggregate Rating Update on Rating Change"). The whole sequence
 *     runs inside one transaction so the SELECT and UPSERT see a
 *     consistent snapshot — without that, two interleaved PUTs on
 *     the same `(user, experience)` could each read the previous
 *     value and emit redundant events that drive the aggregate to a
 *     wrong sum.
 *
 *   - `removeRating(userId, experienceId)` — DELETE keyed on the same
 *     pair. Reads the existing row first; throws
 *     `AppError('rating_not_found', ...)` when no row exists so the
 *     route layer surfaces a 404 (R4.8). On success emits a
 *     `RatingChanged{oldValue, newValue: null}` event.
 *
 * Both write paths emit through an injected
 * `emitRatingChanged: (evt: RatingChangedEvent) => Promise<void>`
 * port. The injection lets task 10.4 wire the emitter to the BullMQ
 * recompute queue without this module having to import BullMQ. Tests
 * substitute a recording emitter to assert the exact event sequence.
 *
 * The 1..10 integer-range check is applied at the *route* layer using
 * `ratingInputSchema` from `@dwt/shared` (R4.1, R4.7), and again by the
 * Postgres `CHECK (value BETWEEN 1 AND 10)` constraint as defense in
 * depth. The repo itself revalidates the value before issuing the
 * UPSERT so a programming error in a future caller surfaces as a clean
 * `rating_out_of_range` envelope rather than a constraint-violation
 * 500.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7, 4.8
 */

import type { PoolClient } from 'pg';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Domain event
// ---------------------------------------------------------------------------

/**
 * Event emitted on every successful rating set or delete.
 *
 * Encoding mirrors the design's "Aggregate Rating Update on Rating
 * Change" sequence diagram and the `updateMeanX10` pure function in
 * `services/aggregate/updateMeanX10.ts`:
 *
 *   - `set` (no prior rating)        → `{ oldValue: null,    newValue: int }`
 *   - `set` (replacing prior rating) → `{ oldValue: int,     newValue: int }`
 *   - `delete`                       → `{ oldValue: int,     newValue: null }`
 *
 * The aggregate worker uses `(oldValue, newValue)` to advance the
 * incremental triple `(sum_ratings, count_ratings, mean_x10)` in O(1).
 * Because both fields are nullable independently, the same event type
 * cleanly encodes all three transitions without a separate `kind`
 * discriminator.
 *
 * `experienceId` is the stable internal Experience id (UUIDv5 of the
 * upstream entity id per R1.7) so consumers can look the row up
 * directly in `aggregate_ratings.experience_id`.
 */
export interface RatingChangedEvent {
  readonly experienceId: string;
  readonly oldValue: number | null;
  readonly newValue: number | null;
}

/**
 * Port that publishes a `RatingChangedEvent` to downstream consumers.
 *
 * The emitter is awaited by the repo so a transient publish failure
 * surfaces as a 5xx and the client can retry the rating mutation. The
 * production wiring (task 10.4) enqueues a BullMQ job; tests pass a
 * recording function that captures every emitted event.
 *
 * The contract is "at-least-once": consumers must be idempotent on
 * `(experienceId, oldValue, newValue)` because the underlying queue
 * (BullMQ) does not guarantee exactly-once delivery on retries.
 */
export type RatingChangedEmitter = (
  event: RatingChangedEvent,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

/**
 * Construction options for `createRatingRepo`.
 *
 * `pool` is the process-wide Postgres pool; `emitRatingChanged` is the
 * domain-event port.
 */
export interface RatingRepoOptions {
  readonly pool: DbPool;
  readonly emitRatingChanged: RatingChangedEmitter;
}

/**
 * Result returned to the route handler on a successful set.
 *
 * `previousValue` is the prior rating value if one existed, else
 * `null` — this is the same value carried in the emitted event so the
 * route can include it in its response if useful (currently not
 * exposed on the wire, but retained for parity with the event).
 */
export interface SetRatingResult {
  readonly experienceId: string;
  readonly value: number;
  readonly previousValue: number | null;
  readonly updatedAt: Date;
}

/**
 * Result returned to the route handler on a successful delete.
 *
 * `previousValue` is always non-null (we threw `rating_not_found` if
 * no row existed). Carried so the route can echo the deletion if
 * useful and for parity with the event payload.
 */
export interface RemoveRatingResult {
  readonly experienceId: string;
  readonly previousValue: number;
}

/**
 * Result returned to the route handler on a successful read.
 *
 * Mirrors the shared `RatingDTO` shape so the GET route can return it
 * directly. `updatedAt` is the post-write timestamp the DB stamped on
 * the most recent set/replace.
 */
export interface GetRatingResult {
  readonly experienceId: string;
  readonly value: number;
  readonly updatedAt: Date;
}

/**
 * Public repo surface.
 */
export interface RatingRepo {
  setRating(
    userId: string,
    experienceId: string,
    value: number,
  ): Promise<SetRatingResult>;
  removeRating(
    userId: string,
    experienceId: string,
  ): Promise<RemoveRatingResult>;
  /**
   * Fetch the Rating for `(userId, experienceId)`, or `null` when no
   * Rating exists. Used by the read path `GET /me/experiences/:id/rating`;
   * the route maps `null` to `rating_not_found` so the App can render its
   * empty state (R4.6).
   */
  getRating(
    userId: string,
    experienceId: string,
  ): Promise<GetRatingResult | null>;
}

/**
 * Build a `RatingRepo` bound to the given pool and event emitter.
 *
 * The repo is intentionally a closure factory rather than a class so
 * tests can spy on individual methods without subclassing.
 */
export function createRatingRepo(opts: RatingRepoOptions): RatingRepo {
  return {
    setRating: (userId, experienceId, value) =>
      setRating(opts, userId, experienceId, value),
    removeRating: (userId, experienceId) =>
      removeRating(opts, userId, experienceId),
    getRating: (userId, experienceId) =>
      getRating(opts, userId, experienceId),
  };
}

// ---------------------------------------------------------------------------
// Set (UPSERT)
// ---------------------------------------------------------------------------

/**
 * UPSERT a rating for `(userId, experienceId)`.
 *
 * Sequence inside one transaction:
 *   1. SELECT the current value (FOR UPDATE so a concurrent UPSERT on
 *      the same key blocks until we commit; R4.2's "at most one rating"
 *      stays sound under concurrency).
 *   2. INSERT ... ON CONFLICT (user_id, experience_id) DO UPDATE SET
 *      value = EXCLUDED.value, updated_at = now() — replaces the prior
 *      value (R4.3) without producing a duplicate row.
 *   3. After COMMIT, emit `RatingChanged{oldValue, newValue}`.
 *
 * Emitting after COMMIT is deliberate: on a transient DB failure the
 * transaction is rolled back and no event is emitted, so the
 * aggregate worker never receives an event for a rating that did not
 * actually persist. This costs us "at-least-once" rather than
 * "exactly-once" delivery on the rare case where the COMMIT succeeds
 * and the emitter then fails — but the aggregate worker is required
 * to be idempotent anyway, and a refused emit surfaces as a 5xx so
 * the client retries, eventually re-emitting the event.
 */
async function setRating(
  opts: RatingRepoOptions,
  userId: string,
  experienceId: string,
  value: number,
): Promise<SetRatingResult> {
  // Defense-in-depth bound check; the route layer's Zod schema is the
  // primary guard (R4.1, R4.7).
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new AppError(
      'rating_out_of_range',
      'Rating must be an integer between 1 and 10 inclusive.',
      { field: 'value' },
    );
  }

  const client = await opts.pool.connect();
  let previousValue: number | null = null;
  let updatedAt: Date;
  try {
    await client.query('BEGIN');

    const prior = await client.query<{ value: number }>(
      `SELECT value FROM ratings
       WHERE user_id = $1 AND experience_id = $2
       FOR UPDATE`,
      [userId, experienceId],
    );
    previousValue = prior.rows[0]?.value ?? null;

    const upsert = await client.query<{ updated_at: Date }>(
      `INSERT INTO ratings (user_id, experience_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, experience_id)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING updated_at`,
      [userId, experienceId, value],
    );
    const row = upsert.rows[0];
    if (!row) {
      // Postgres always returns a row for a successful INSERT/UPSERT
      // ... RETURNING; an empty result would indicate a driver fault.
      throw new AppError(
        'internal_error',
        'Rating upsert returned no row.',
      );
    }
    updatedAt = row.updated_at;

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  // Emit *after* commit so a rollback never publishes a phantom event.
  await opts.emitRatingChanged({
    experienceId,
    oldValue: previousValue,
    newValue: value,
  });

  return {
    experienceId,
    value,
    previousValue,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Remove (DELETE)
// ---------------------------------------------------------------------------

/**
 * DELETE the rating for `(userId, experienceId)`.
 *
 * 404 semantics (R4.8): if no row exists, throw
 * `AppError('rating_not_found', ...)`. The route layer surfaces this
 * via the global error hook with HTTP status 404.
 *
 * Like `setRating`, this runs inside a transaction so the SELECT and
 * DELETE see a consistent snapshot, and emits the
 * `RatingChanged{oldValue: int, newValue: null}` event only after the
 * COMMIT succeeds.
 */
async function removeRating(
  opts: RatingRepoOptions,
  userId: string,
  experienceId: string,
): Promise<RemoveRatingResult> {
  const client = await opts.pool.connect();
  let previousValue: number;
  try {
    await client.query('BEGIN');

    const prior = await client.query<{ value: number }>(
      `SELECT value FROM ratings
       WHERE user_id = $1 AND experience_id = $2
       FOR UPDATE`,
      [userId, experienceId],
    );
    const priorRow = prior.rows[0];
    if (!priorRow) {
      // Roll back the empty BEGIN before throwing so the connection is
      // returned to the pool in a clean state.
      await client.query('ROLLBACK');
      throw new AppError(
        'rating_not_found',
        'No rating exists for this user and experience.',
      );
    }
    previousValue = priorRow.value;

    await client.query(
      `DELETE FROM ratings
       WHERE user_id = $1 AND experience_id = $2`,
      [userId, experienceId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  await opts.emitRatingChanged({
    experienceId,
    oldValue: previousValue,
    newValue: null,
  });

  return { experienceId, previousValue };
}

// ---------------------------------------------------------------------------
// Get (SELECT)
// ---------------------------------------------------------------------------

/**
 * SELECT the rating for `(userId, experienceId)` or return `null` when no
 * row exists. A plain read needs no transaction — there is no companion
 * write to keep consistent — so this issues a single pooled query.
 *
 * The route maps a `null` result to `AppError('rating_not_found', ...)`
 * (404) which the App's `fetchOrNullOnCode` swallows into the empty
 * state (R4.6).
 */
async function getRating(
  opts: RatingRepoOptions,
  userId: string,
  experienceId: string,
): Promise<GetRatingResult | null> {
  const result = await opts.pool.query<{ value: number; updated_at: Date }>(
    `SELECT value, updated_at FROM ratings
      WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    experienceId,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

/**
 * Roll back a transaction without throwing if the rollback itself fails
 * (e.g. the connection is already in an aborted state). Mirrors the
 * pattern used in `db/pool.ts::withTransaction`.
 */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Swallow rollback errors so the original cause surfaces.
  }
}
