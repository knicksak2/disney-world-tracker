/**
 * Tracking_Service — Completion repository (task 10.1).
 *
 * Single point of contact between the Completion routes and the
 * `completions` table. Per the migration in `0001_init.sql`, the table
 * has a composite PRIMARY KEY on `(user_id, experience_id)` with
 * columns:
 *
 *   - `completed_on  DATE NOT NULL`           — the local calendar date
 *                                                 in the User's TZ.
 *   - `user_tz       TEXT NOT NULL`           — the IANA TZ used to
 *                                                 capture that date so
 *                                                 the server can apply
 *                                                 the same "not in the
 *                                                 future" rule
 *                                                 consistently (R2.6).
 *
 * The repo intentionally exposes a small, focused surface that the route
 * handler composes:
 *
 *   - `mark`     — atomic insert of a brand-new Completion. Returns
 *                  `null` when a Completion already exists for the pair
 *                  (UNIQUE PK collision); the route turns that into the
 *                  appropriate domain response. Why `INSERT` and not
 *                  `UPSERT`: R2.1 separates "mark" from "edit" (R2.5),
 *                  and the wire contract (PUT to mark, PATCH to edit) is
 *                  stronger when each verb maps to one mutation kind.
 *
 *   - `edit`     — UPDATE of an existing Completion's date/TZ. Returns
 *                  `null` when no row exists (the route cannot tell
 *                  "no row" apart from "row not updated" without
 *                  RETURNING; we use it explicitly for that reason).
 *
 *   - `unmark`   — DELETE keyed by `(user_id, experience_id)`. Returns
 *                  the row count so the route can map zero-affected to
 *                  `completion_not_found` (R2.7).
 *
 * The Completion DTO is built locally from the row fields rather than
 * relying on the shared schema's `completionSchema.parse`; the row is
 * already typed and validated by the DB CHECKs and the route's input
 * schema, so re-parsing would only cost CPU.
 *
 * Validates: Requirements 2.1, 2.3, 2.5, 2.7
 */

import type { CompletionDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Inputs to a fresh `mark` (PUT) or to an `edit` (PATCH). */
export interface CompletionUpsertInput {
  readonly userId: string;
  readonly experienceId: string;
  /** ISO-8601 calendar date `YYYY-MM-DD` in the User's local TZ. */
  readonly completedOn: string;
  /** IANA TZ identifier (validated by the route before this call). */
  readonly userTz: string;
}

/** Inputs to `unmark` (DELETE). */
export interface CompletionDeleteInput {
  readonly userId: string;
  readonly experienceId: string;
}

/**
 * Repository surface. Returned by {@link createCompletionRepo}.
 */
export interface CompletionRepo {
  /**
   * Insert a brand-new Completion. Returns the persisted DTO on success
   * or `null` if a Completion already exists for `(userId, experienceId)`.
   * The route maps `null` to a `validation_failed` envelope; per R2.5
   * editing an existing date is a separate operation.
   */
  mark(input: CompletionUpsertInput): Promise<CompletionDTO | null>;

  /**
   * Update an existing Completion's `completed_on` (and `user_tz`).
   * Returns the updated DTO on success or `null` when no Completion
   * exists for the pair. The route maps `null` to `completion_not_found`.
   */
  edit(input: CompletionUpsertInput): Promise<CompletionDTO | null>;

  /**
   * Delete the Completion for `(userId, experienceId)`. Returns `true`
   * when a row was deleted and `false` when no row matched. The route
   * maps `false` to `completion_not_found` per R2.7.
   */
  unmark(input: CompletionDeleteInput): Promise<boolean>;
}

/**
 * Build a `CompletionRepo` bound to the supplied pool. Constructor
 * injection (rather than reaching for `getPool()`) keeps the repo
 * trivially testable: integration tests use a sandbox pool, unit tests
 * pass a fake whose `query` records the SQL.
 */
export function createCompletionRepo(pool: DbPool): CompletionRepo {
  return {
    mark: (input) => mark(pool, input),
    edit: (input) => edit(pool, input),
    unmark: (input) => unmark(pool, input),
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Internal row shape mirroring the SELECT column list. */
interface CompletionRow {
  user_id: string;
  experience_id: string;
  completed_on: Date | string;
  user_tz: string;
}

/** Postgres SQLSTATE for a `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

async function mark(
  pool: DbPool,
  input: CompletionUpsertInput,
): Promise<CompletionDTO | null> {
  try {
    const result = await pool.query<CompletionRow>(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, experience_id, completed_on, user_tz`,
      [input.userId, input.experienceId, input.completedOn, input.userTz],
    );
    const row = result.rows[0];
    return row ? rowToDto(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // PK collision → a Completion already exists; let the caller decide
      // how to surface that.
      return null;
    }
    throw err;
  }
}

async function edit(
  pool: DbPool,
  input: CompletionUpsertInput,
): Promise<CompletionDTO | null> {
  const result = await pool.query<CompletionRow>(
    `UPDATE completions
        SET completed_on = $3,
            user_tz      = $4
      WHERE user_id = $1
        AND experience_id = $2
    RETURNING user_id, experience_id, completed_on, user_tz`,
    [input.userId, input.experienceId, input.completedOn, input.userTz],
  );
  const row = result.rows[0];
  return row ? rowToDto(row) : null;
}

async function unmark(
  pool: DbPool,
  input: CompletionDeleteInput,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM completions
      WHERE user_id = $1
        AND experience_id = $2`,
    [input.userId, input.experienceId],
  );
  // `pg` returns `rowCount` as `number | null`; treat null defensively.
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Project a row to the shared `CompletionDTO` shape. The DB column
 * `completed_on` may arrive as a `Date` (when `pg` is configured with
 * type parsers) or as the raw `YYYY-MM-DD` string (when the date type
 * is left to the default text parser); we normalize to the ISO-8601
 * date string the wire contract expects.
 */
function rowToDto(row: CompletionRow): CompletionDTO {
  return {
    userId: row.user_id,
    experienceId: row.experience_id,
    completedOn: toIsoDate(row.completed_on),
    userTz: row.user_tz,
  };
}

/**
 * Format a date column value as `YYYY-MM-DD`. Accepts either a `Date`
 * (the JS `Date` returned by `pg`'s default `DATE` parser) or a string
 * that already matches the ISO-8601 date shape.
 *
 * For `Date` values we read the **UTC** components rather than the local
 * components: `pg` returns `DATE` columns as `Date` objects pinned to
 * `00:00:00 UTC` of the calendar date, so the UTC view recovers the
 * exact day the User stored regardless of the server's process timezone.
 */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    // Trim a possible time component if the driver ever attaches one;
    // belt-and-braces against driver setting changes.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Detect a Postgres `unique_violation` (SQLSTATE 23505) without depending
 * on the `pg` package's exported error type at compile time. The `code`
 * property is the stable signal across `pg` versions.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
