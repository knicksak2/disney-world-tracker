/**
 * Tracking_Service — Experience_Log repository.
 *
 * Owns the user-scoped `experience_logs` activity stream and its synchronous
 * projection into the canonical `completions` / `ratings` tables:
 *
 *   - `addLog` inserts one `experience_logs` row, dual-writes a `completions`
 *     row (ON CONFLICT DO NOTHING so repeat logs never duplicate coverage),
 *     upserts the canonical `ratings` row when a rating is supplied, and — when
 *     a `tripId` is given — links a `trip_log_entries` row via `log_id`. All of
 *     this runs inside one transaction so a rollback leaves no orphaned
 *     completion/rating/trip-link state (R1.1-R1.3, R2.1-R2.4).
 *   - `getVisitHistory` returns every log for `(user, experience)` ordered
 *     `visited_on DESC, logged_at DESC` with `repeatCount === logs.length`
 *     (R4.1-R4.3).
 *   - `deleteLog` removes one log if it belongs to the caller, cascading its
 *     `trip_log_entries` link via the `log_id` FK, and removes the canonical
 *     `completions` row only when the deleted log was the last for that
 *     experience. The `ratings` row is never touched (R5.1-R5.3).
 *
 * The rating dual-write mirrors `tracking/rating/repo.ts`: the prior value is
 * read `FOR UPDATE`, the row is upserted, and `RatingChanged` is emitted only
 * after COMMIT so a rolled-back transaction never publishes a phantom event
 * and the community aggregate stays consistent.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2,
 *            4.3, 5.1, 5.2, 5.3
 */

import type { ExperienceLogDTO, ExperienceVisitHistoryDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Inputs & results
// ---------------------------------------------------------------------------

/** Inputs to `addLog`. Validated by the route before this call. */
export interface CreateLogInput {
  readonly userId: string;
  readonly experienceId: string;
  /** ISO-8601 calendar date `YYYY-MM-DD` in the User's local TZ. */
  readonly visitedOn: string;
  /** IANA TZ identifier. */
  readonly userTz: string;
  /** Optional per-visit rating in `[1, 10]`; `null`/absent means unrated. */
  readonly rating?: number | null;
  /** Optional per-visit note (1-2000 chars); `null`/absent means none. */
  readonly note?: string | null;
  /** Optional active Trip to link this visit to; `null`/absent means none. */
  readonly tripId?: string | null;
}

/** Result of `deleteLog`. */
export interface DeleteLogResult {
  /** `true` when a row owned by the caller was removed. */
  readonly deleted: boolean;
  /** `true` when the canonical completion was also removed (last log gone). */
  readonly completionRemoved: boolean;
}

/**
 * `RatingChanged` emitter port, structurally identical to the one the rating
 * repo consumes. The logs repo publishes on it after a rated log commits so
 * the community aggregate is updated exactly as a direct rating write would.
 */
export type RatingChangedEmitter = (event: {
  readonly experienceId: string;
  readonly oldValue: number | null;
  readonly newValue: number | null;
}) => Promise<void>;

export interface ExperienceLogRepoOptions {
  readonly pool: DbPool;
  readonly emitRatingChanged: RatingChangedEmitter;
}

/** Public repo surface. */
export interface ExperienceLogRepo {
  addLog(input: CreateLogInput): Promise<ExperienceLogDTO>;
  getVisitHistory(
    userId: string,
    experienceId: string,
  ): Promise<ExperienceVisitHistoryDTO>;
  deleteLog(
    userId: string,
    experienceId: string,
    logId: string,
  ): Promise<DeleteLogResult>;
}

/** Build an `ExperienceLogRepo` bound to the supplied pool and emitter. */
export function createExperienceLogRepo(
  opts: ExperienceLogRepoOptions,
): ExperienceLogRepo {
  return {
    addLog: (input) => addLog(opts, input),
    getVisitHistory: (userId, experienceId) =>
      getVisitHistory(opts.pool, userId, experienceId),
    deleteLog: (userId, experienceId, logId) =>
      deleteLog(opts.pool, userId, experienceId, logId),
  };
}

// ---------------------------------------------------------------------------
// Row shape & mapping
// ---------------------------------------------------------------------------

interface ExperienceLogRow {
  id: string;
  user_id: string;
  experience_id: string;
  visited_on: Date | string;
  user_tz: string;
  logged_at: Date | string;
  rating: number | string | null;
  note: string | null;
}

function rowToDto(row: ExperienceLogRow): ExperienceLogDTO {
  return {
    id: row.id,
    userId: row.user_id,
    experienceId: row.experience_id,
    visitedOn: toIsoDate(row.visited_on),
    userTz: row.user_tz,
    loggedAt: toIsoTimestamp(row.logged_at),
    rating: row.rating === null ? null : Number(row.rating),
    note: row.note,
  };
}

/** Normalize a DATE column to `YYYY-MM-DD` (UTC components for `Date`). */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Normalize a TIMESTAMPTZ column to an ISO-8601 UTC string. */
function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  // `pg` returns a parsed Date for TIMESTAMPTZ by default; the string branch
  // is defensive for drivers configured to leave it as text.
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// addLog
// ---------------------------------------------------------------------------

async function addLog(
  opts: ExperienceLogRepoOptions,
  input: CreateLogInput,
): Promise<ExperienceLogDTO> {
  const rating = input.rating ?? null;
  const note = input.note ?? null;
  const tripId = input.tripId ?? null;

  // Defense-in-depth bound check; the route's Zod schema is the primary guard.
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) {
    throw new AppError(
      'rating_out_of_range',
      'Rating must be an integer between 1 and 10 inclusive.',
      { field: 'rating' },
    );
  }

  const client = await opts.pool.connect();
  let dto: ExperienceLogDTO;
  let ratingChange: { oldValue: number | null; newValue: number } | null = null;
  try {
    await client.query('BEGIN');

    // If linking to a Trip, the caller must be a current member of it. A
    // non-member (or non-existent Trip) collapses to `trip_forbidden` so Trip
    // existence cannot be probed (R1.2, design Error Handling 403).
    if (tripId !== null) {
      const member = await client.query(
        `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
        [tripId, input.userId],
      );
      if (member.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new AppError(
          'trip_forbidden',
          'You are not a member of this trip.',
          { field: 'tripId' },
        );
      }
    }

    // 1. The activity-stream row.
    const logResult = await client.query<ExperienceLogRow>(
      `INSERT INTO experience_logs
         (user_id, experience_id, visited_on, user_tz, rating, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, experience_id, visited_on, user_tz, logged_at, rating, note`,
      [input.userId, input.experienceId, input.visitedOn, input.userTz, rating, note],
    );
    const logRow = logResult.rows[0];
    if (!logRow) {
      throw new AppError('internal_error', 'Experience log insert returned no row.');
    }

    // 2. Canonical completion dual-write. ON CONFLICT DO NOTHING guarantees
    //    exactly one completion per (user, experience) — a repeat log for an
    //    already-completed experience does not create a duplicate (R2.1, R1.3).
    await client.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, experience_id) DO NOTHING`,
      [input.userId, input.experienceId, input.visitedOn, input.userTz],
    );

    // 3. Canonical rating dual-write (only when a rating was supplied). The
    //    prior value is locked and read so the post-commit RatingChanged event
    //    carries the correct old/new pair for the aggregate worker (R2.2).
    if (rating !== null) {
      const prior = await client.query<{ value: number | string }>(
        `SELECT value FROM ratings
          WHERE user_id = $1 AND experience_id = $2
          FOR UPDATE`,
        [input.userId, input.experienceId],
      );
      const oldValue =
        prior.rows[0]?.value === undefined ? null : Number(prior.rows[0].value);
      await client.query(
        `INSERT INTO ratings (user_id, experience_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, experience_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [input.userId, input.experienceId, rating],
      );
      ratingChange = { oldValue, newValue: rating };
    }

    // 4. Trip linkage. `member_id`/`experience_id` mirror the log's
    //    `user_id`/`experience_id` so existing trip reads are unaffected; the
    //    `log_id` FK makes deleting the log cascade this row away (R1.2, R1.4).
    if (tripId !== null) {
      await client.query(
        `INSERT INTO trip_log_entries (trip_id, member_id, experience_id, log_id)
         VALUES ($1, $2, $3, $4)`,
        [tripId, input.userId, input.experienceId, logRow.id],
      );
    }

    await client.query('COMMIT');
    dto = rowToDto(logRow);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  // Emit after COMMIT so a rollback never publishes a phantom event.
  if (ratingChange !== null) {
    await opts.emitRatingChanged({
      experienceId: input.experienceId,
      oldValue: ratingChange.oldValue,
      newValue: ratingChange.newValue,
    });
  }

  return dto;
}

// ---------------------------------------------------------------------------
// getVisitHistory
// ---------------------------------------------------------------------------

async function getVisitHistory(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<ExperienceVisitHistoryDTO> {
  const result = await pool.query<ExperienceLogRow>(
    `SELECT id, user_id, experience_id, visited_on, user_tz, logged_at, rating, note
       FROM experience_logs
      WHERE user_id = $1 AND experience_id = $2
      ORDER BY visited_on DESC, logged_at DESC`,
    [userId, experienceId],
  );
  const logs = result.rows.map(rowToDto);
  return {
    experienceId,
    repeatCount: logs.length,
    logs,
  };
}

// ---------------------------------------------------------------------------
// deleteLog
// ---------------------------------------------------------------------------

async function deleteLog(
  pool: DbPool,
  userId: string,
  experienceId: string,
  logId: string,
): Promise<DeleteLogResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Scope the delete to the caller AND the experience: a log id that does
    // not exist, belongs to another User, or is under a different experience
    // all yield zero rows → the route maps this to `log_not_found` (R5.1).
    const del = await client.query<{ id: string }>(
      `DELETE FROM experience_logs
        WHERE id = $1 AND user_id = $2 AND experience_id = $3
      RETURNING id`,
      [logId, userId, experienceId],
    );
    if (del.rows.length === 0) {
      await client.query('ROLLBACK');
      return { deleted: false, completionRemoved: false };
    }

    // R5.2: if that was the last log for this experience, drop the canonical
    // completion so lifetime coverage stays accurate. The `ratings` row is
    // deliberately left untouched (R5.3).
    const remaining = await client.query(
      `SELECT 1 FROM experience_logs
        WHERE user_id = $1 AND experience_id = $2
        LIMIT 1`,
      [userId, experienceId],
    );
    let completionRemoved = false;
    if (remaining.rows.length === 0) {
      await client.query(
        `DELETE FROM completions WHERE user_id = $1 AND experience_id = $2`,
        [userId, experienceId],
      );
      completionRemoved = true;
    }

    await client.query('COMMIT');
    return { deleted: true, completionRemoved };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Roll back without masking the original error. A rollback failure (e.g. the
 * connection already dropped) is swallowed so the caller sees the real cause.
 */
async function safeRollback(client: {
  query(text: string): Promise<unknown>;
}): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Swallow so the original error surfaces.
  }
}
