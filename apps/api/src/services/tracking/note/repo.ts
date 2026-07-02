/**
 * Note repository.
 *
 * Single point of contact between the Tracking_Service note routes and the
 * `notes` table from migration `0001_init.sql`. The repo exposes only the
 * three operations the routes need:
 *
 *   - `upsertNote(userId, experienceId, body)` — INSERT...ON CONFLICT DO
 *     UPDATE so a User saving a Note for an Experience replaces any
 *     prior entry rather than duplicating it. The unique `(user_id,
 *     experience_id)` primary key on the table provides the at-most-one
 *     invariant (R5.1) at the storage layer.
 *
 *   - `deleteNote(userId, experienceId)` — DELETE returning the affected
 *     rowCount so the route can translate `0 rows` into a 404
 *     `note_not_found` (R5.7).
 *
 *   - `getNote(userId, experienceId)` — SELECT used by callers that need
 *     to render the current Note (out of scope for this task's routes
 *     but kept on the surface so the same repo can serve the GET path
 *     introduced by the App detail screen in task 17.3).
 *
 * The repo trusts that the body has already been trimmed and validated
 * 1..2000 characters by the route layer. Defense in depth at the DB level
 * is provided by the `notes_body_length_chk` CHECK constraint, which
 * rejects any body outside `1..2000` regardless of how the row got there.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import type { NoteDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

/**
 * Row projection returned from the UPSERT and SELECT statements. The
 * `updated_at` column is rendered as an ISO-8601 timestamp on the wire so
 * the DTO matches the shared `NoteDTO` shape (which carries `updatedAt:
 * string` per the design).
 */
interface NoteRow {
  user_id: string;
  experience_id: string;
  body: string;
  shareable: boolean;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Note repository surface. Returned by {@link createNoteRepo}.
 */
export interface NoteRepo {
  /**
   * Insert a Note for `(userId, experienceId)`, or replace the body of
   * the existing one in place. Returns the persisted DTO with the post-
   * write `updatedAt` timestamp so the route can echo it back to the
   * caller without a follow-up read.
   *
   * The body is persisted verbatim; trimming is the responsibility of the
   * route layer so the validation rule "1..2000 after trim" (R5.2) is
   * applied before any database round-trip.
   *
   * The optional `shareable` flag controls Friend visibility (R4.6, R4.7).
   * When omitted it defaults to `FALSE` on first write (a new Note is
   * private by default) and preserves the prior stored value on edit, so a
   * caller editing only the body never silently flips the flag.
   */
  upsertNote(
    userId: string,
    experienceId: string,
    body: string,
    shareable?: boolean,
  ): Promise<NoteDTO>;

  /**
   * Delete the Note keyed by `(userId, experienceId)`. Returns `true`
   * when a row was actually removed, `false` when no Note existed. The
   * route layer maps `false` to a 404 `note_not_found` (R5.7).
   */
  deleteNote(userId: string, experienceId: string): Promise<boolean>;

  /**
   * Fetch the Note for `(userId, experienceId)`, or `null` when no Note
   * exists. Provided for symmetry with the rest of the tracking repos so
   * future GET routes do not have to reach into the table directly.
   */
  getNote(userId: string, experienceId: string): Promise<NoteDTO | null>;
}

/**
 * Build a `NoteRepo` bound to the supplied pool.
 *
 * Constructor injection (rather than reaching for `getPool()` at the
 * top-level) keeps the repo testable: integration tests can pass a pool
 * connected to a sandbox database, and unit tests can pass a fake whose
 * `query` method records or rewrites SQL.
 */
export function createNoteRepo(pool: DbPool): NoteRepo {
  return {
    upsertNote: (userId, experienceId, body, shareable) =>
      upsertNote(pool, userId, experienceId, body, shareable),
    deleteNote: (userId, experienceId) =>
      deleteNote(pool, userId, experienceId),
    getNote: (userId, experienceId) => getNote(pool, userId, experienceId),
  };
}

// ---------------------------------------------------------------------------
// upsertNote
// ---------------------------------------------------------------------------

/**
 * INSERT...ON CONFLICT DO UPDATE keyed on the `(user_id, experience_id)`
 * primary key. The `updated_at` column is stamped with `now()` on every
 * write so a "save" and "edit" both refresh the timestamp; this matches
 * the design's `NoteDTO.updatedAt` semantics ("most recent save/edit").
 *
 * The `shareable` flag is bound as a single parameter (`$4`) that is either
 * the caller-supplied boolean or `null` when omitted. `COALESCE` then makes
 * the "preserve on omit" rule a property of the SQL rather than of handler
 * discipline:
 *   - On INSERT (first write), `COALESCE($4, FALSE)` writes the supplied
 *     value or `FALSE`, so a brand-new Note is private by default (R4.6).
 *   - On CONFLICT (edit), `COALESCE($4, notes.shareable)` writes the
 *     supplied value or keeps the previously stored flag, so editing only
 *     the body never flips visibility (R4.7).
 *
 * Validates: R5.1 (one note per user/experience via PK), R5.3 (create on
 * absent), R5.4 (replace on present), R5.5 (create on edit-when-absent),
 * R4.6/R4.7 (shareable default and preserve-on-omit).
 */
async function upsertNote(
  pool: DbPool,
  userId: string,
  experienceId: string,
  body: string,
  shareable?: boolean,
): Promise<NoteDTO> {
  const result = await pool.query<NoteRow>(
    `INSERT INTO notes (user_id, experience_id, body, shareable, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, FALSE), now())
     ON CONFLICT (user_id, experience_id)
       DO UPDATE SET body = EXCLUDED.body,
                     shareable = COALESCE($4, notes.shareable),
                     updated_at = now()
     RETURNING user_id, experience_id, body, shareable, updated_at`,
    [userId, experienceId, body, shareable ?? null],
  );
  const row = result.rows[0];
  if (!row) {
    // The RETURNING clause guarantees a row on a successful UPSERT, so
    // an empty rows array indicates a driver-level inconsistency rather
    // than a domain error. Surface as a generic Error so the global
    // `internal_error` path catches it instead of misclassifying.
    throw new Error('notes upsert returned no row');
  }
  return rowToDTO(row);
}

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

/**
 * DELETE keyed by `(user_id, experience_id)`. Returns `true` when a row
 * was removed, `false` when no Note existed for the pair (R5.7 not-found
 * path).
 */
async function deleteNote(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM notes
       WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  // `pg`'s `QueryResult.rowCount` is `number | null`; treat null as 0 to
  // be defensive against future driver versions.
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------

/**
 * SELECT a single Note by `(user_id, experience_id)` or return `null` when
 * none exists.
 */
async function getNote(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<NoteDTO | null> {
  const result = await pool.query<NoteRow>(
    `SELECT user_id, experience_id, body, shareable, updated_at
       FROM notes
      WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  const row = result.rows[0];
  return row ? rowToDTO(row) : null;
}

// ---------------------------------------------------------------------------
// rowToDTO
// ---------------------------------------------------------------------------

/**
 * Project a `notes` row onto the shared `NoteDTO`. The DB column name
 * mapping is centralized here so the SQL layer can evolve without
 * leaking into the wire shape.
 */
function rowToDTO(row: NoteRow): NoteDTO {
  return {
    userId: row.user_id,
    experienceId: row.experience_id,
    body: row.body,
    shareable: row.shareable,
    updatedAt: row.updated_at.toISOString(),
  };
}
