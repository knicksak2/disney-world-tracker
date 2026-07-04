/**
 * Tracking_Service — Friend Completions read repository (task 3.1).
 *
 * Single point of contact between the new Friend Completions route
 * (`GET /users/:userId/completions`) and the `completions` table, joined to
 * `experiences`, `ratings`, and `notes`. Unlike the per-Experience Completion
 * repo (`createCompletionRepo`), this repo serves a *target-scoped list* read:
 * given a User id it returns up to 5,000 of that User's Completions over
 * Active Experiences, each enriched with the User's Rating (when present) and
 * the body of the User's Note (only when that Note is marked shareable).
 *
 * The entire read is a single SQL statement (see {@link listCompletions}):
 *
 *   - `JOIN experiences e ON ... AND e.active = TRUE` drops Completions whose
 *     Experience is inactive without deleting the underlying rows (R4.5).
 *   - `LEFT JOIN ratings` yields `rating = NULL` when the User has no Rating
 *     for the Experience (R4.3, R4.4).
 *   - `LEFT JOIN notes` with `CASE WHEN n.shareable THEN n.body ELSE NULL END`
 *     emits the body only for a shareable Note and makes a present-but-private
 *     Note indistinguishable from no Note at all (R4.6, R4.7).
 *   - `ORDER BY c.completed_on DESC, lower(e.name), lower(e.park),
 *     lower(e.category)` matches the required case-insensitive ordering (R4.8).
 *   - `LIMIT 5000` plus the date-descending order delivers the most-recent
 *     5,000 entries when more exist (R4.1).
 *
 * Constructor injection (rather than reaching for `getPool()`) keeps the repo
 * testable, matching the `createNoteRepo` / `createCompletionRepo` pattern.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on the number of Completion_Entries returned (R4.1). */
const MAX_ENTRIES = 5000;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * One item in a Friend's Completions list. Mirrors the shared
 * `CompletionEntryDTO` wire shape; the route maps this 1:1 onto the DTO.
 */
export interface CompletionEntry {
  /** Catalog Experience_Id (UUID) — the ExperienceDetail navigation target (R1.1, R1.2, R1.3). */
  readonly experienceId: string;
  /** Completed Experience's name. */
  readonly experienceName: string;
  /**
   * Park the Experience belongs to, or `null` for resort-area and
   * resort-representing entries that have no owning Park.
   */
  readonly park: Park | null;
  /**
   * The kind of place the Experience belongs to, from the closed set
   * `AREA_TYPES`. Surfaces the Area_Type on each entry for the mobile grouping
   * fold and the resort group (R5.2, R5.3).
   */
  readonly areaType: AreaType;
  /** Experience_Category of the Experience. */
  readonly category: ExperienceCategory;
  /** Completion date as an ISO-8601 calendar date `YYYY-MM-DD`. */
  readonly completedOn: string;
  /** Integer Rating `1..10`, or `null` when the User has no Rating (R4.3, R4.4). */
  readonly rating: number | null;
  /** Shareable Note body, or `null` for no-Note / present-but-private (R4.6, R4.7). */
  readonly sharedNote: string | null;
}

/**
 * Friend Completions repository surface. Returned by
 * {@link createFriendCompletionsRepo}.
 */
export interface FriendCompletionsRepo {
  /**
   * Return up to {@link MAX_ENTRIES} (5000) Completion_Entries for `userId`
   * over Active Experiences, ordered by Completion date descending with
   * case-insensitive name/park/category tie-breaks (R4.8). When more than
   * 5,000 exist, the most-recent by date are returned (R4.1).
   */
  listCompletions(userId: string): Promise<readonly CompletionEntry[]>;
}

/**
 * Build a `FriendCompletionsRepo` bound to the supplied pool.
 */
export function createFriendCompletionsRepo(pool: DbPool): FriendCompletionsRepo {
  return {
    listCompletions: (userId) => listCompletions(pool, userId),
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Internal row shape mirroring the SELECT column list. */
interface CompletionEntryRow {
  experience_id: string;
  experience_name: string;
  park: Park | null;
  area_type: AreaType;
  category: ExperienceCategory;
  completed_on: Date | string;
  rating: number | string | null;
  shared_note: string | null;
}

async function listCompletions(
  pool: DbPool,
  userId: string,
): Promise<readonly CompletionEntry[]> {
  const result = await pool.query<CompletionEntryRow>(
    `SELECT e.id AS experience_id,
            e.name AS experience_name,
            e.park,
            e.area_type,
            e.category,
            c.completed_on,
            r.value AS rating,
            CASE WHEN n.shareable THEN n.body ELSE NULL END AS shared_note
       FROM completions c
       JOIN experiences e ON e.id = c.experience_id AND e.active = TRUE
       LEFT JOIN ratings r ON r.user_id = c.user_id AND r.experience_id = c.experience_id
       LEFT JOIN notes   n ON n.user_id = c.user_id AND n.experience_id = c.experience_id
      WHERE c.user_id = $1
      ORDER BY c.completed_on DESC,
               lower(e.name) ASC,
               lower(e.park) ASC,
               lower(e.category) ASC
      LIMIT ${MAX_ENTRIES}`,
    [userId],
  );
  return result.rows.map(rowToEntry);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Project a joined row onto a {@link CompletionEntry}. `rating` may arrive as
 * a number or a numeric string depending on the `pg` type parser for the
 * underlying column; it is normalized to a `number` (or left `null`).
 */
function rowToEntry(row: CompletionEntryRow): CompletionEntry {
  return {
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    park: row.park,
    areaType: row.area_type,
    category: row.category,
    completedOn: toIsoDate(row.completed_on),
    rating: row.rating === null ? null : Number(row.rating),
    sharedNote: row.shared_note,
  };
}

/**
 * Format a `DATE` column value as `YYYY-MM-DD`. Accepts either a `Date`
 * (pinned to `00:00:00 UTC` of the calendar date by `pg`'s default `DATE`
 * parser) or a string already in ISO-8601 date shape. Mirrors the helper in
 * the per-Experience Completion repo so both reads emit the same date format.
 */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
