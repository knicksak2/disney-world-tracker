/**
 * Notification preference store — repository (task 13.1).
 *
 * Single point of contact between the preference route handlers and the
 * `notification_preferences` table created by `migrations/0011_social_sharing_loop.sql`:
 *
 *   notification_preferences (
 *     user_id                     UUID PRIMARY KEY REFERENCES users(id),
 *     share_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 *     updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )
 *
 * The store is intentionally isolated in its own module (rather than folded
 * into `services/push/repo.ts`) so it can ship independently of the
 * `Push_Registration_Service` repo and never collide with that concurrently
 * developed file.
 *
 * Public surface:
 *
 *   - `getPreference(userId)` — read the User's `Share_Notification_Preference`.
 *     Absence of a row means the User has never set the preference, which the
 *     store reports as `shareNotificationsEnabled: true` (R9.7). No row is
 *     written on a read.
 *
 *   - `setPreference(userId, enabled)` — upsert the User's preference and
 *     return the persisted value (R9.4, R9.5). The write is a single
 *     `INSERT ... ON CONFLICT (user_id) DO UPDATE` so a first-time set and a
 *     subsequent toggle share one code path. A persistence failure propagates
 *     to the caller so the route can surface an error envelope (R9.8).
 *
 * Validates: Requirements 9.3, 9.4, 9.5, 9.7, 9.8.
 */

import type { NotificationPreferenceDTO } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Persistence surface returned by {@link createNotificationPreferenceRepo}. */
export interface NotificationPreferenceRepo {
  /**
   * Read the User's `Share_Notification_Preference`. Returns
   * `{ shareNotificationsEnabled: true }` when the User has never set a
   * preference (no row) per R9.7.
   */
  getPreference(userId: string): Promise<NotificationPreferenceDTO>;

  /**
   * Persist the User's `Share_Notification_Preference` and return the stored
   * value (R9.4, R9.5). Rejects (propagating the underlying error) when the
   * value cannot be persisted, so the route can return an error envelope
   * (R9.8).
   */
  setPreference(
    userId: string,
    shareNotificationsEnabled: boolean,
  ): Promise<NotificationPreferenceDTO>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `NotificationPreferenceRepo` bound to the supplied pool.
 * Constructor injection (rather than reaching for `getPool()`) keeps the repo
 * testable: unit tests pass a fake whose `query` is recorded.
 */
export function createNotificationPreferenceRepo(
  pool: DbPool,
): NotificationPreferenceRepo {
  return {
    getPreference: (userId) => getPreference(pool, userId),
    setPreference: (userId, enabled) => setPreference(pool, userId, enabled),
  };
}

// ---------------------------------------------------------------------------
// getPreference (R9.3, R9.7)
// ---------------------------------------------------------------------------

interface PreferenceRow {
  share_notifications_enabled: boolean;
}

/**
 * Read the User's preference, defaulting to enabled when no row exists.
 *
 * The default lives here (not in the DB) so a User who has never toggled the
 * setting is treated as opted-in (R9.7) without the read path having to write
 * a row as a side effect.
 */
async function getPreference(
  pool: DbPool,
  userId: string,
): Promise<NotificationPreferenceDTO> {
  const result = await pool.query<PreferenceRow>(
    `SELECT share_notifications_enabled
       FROM notification_preferences
      WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  // R9.7: absence of a row means the User has never set the preference,
  // which is treated as enabled by default.
  return { shareNotificationsEnabled: row?.share_notifications_enabled ?? true };
}

// ---------------------------------------------------------------------------
// setPreference (R9.4, R9.5, R9.8)
// ---------------------------------------------------------------------------

/**
 * Upsert the User's preference and return the persisted value.
 *
 * A single `INSERT ... ON CONFLICT (user_id) DO UPDATE` covers both the
 * first-time set and a subsequent toggle. `updated_at` is refreshed on every
 * write so the row records the last change time. The `RETURNING` clause echoes
 * the stored value so the caller returns exactly what was persisted rather
 * than the request value (R9.4, R9.5).
 *
 * Any error thrown by the query (constraint violation, connectivity loss, ...)
 * propagates unchanged so the route layer can map it to an error envelope
 * (R9.8); we deliberately do not swallow it.
 */
async function setPreference(
  pool: DbPool,
  userId: string,
  shareNotificationsEnabled: boolean,
): Promise<NotificationPreferenceDTO> {
  const result = await pool.query<PreferenceRow>(
    `INSERT INTO notification_preferences (user_id, share_notifications_enabled, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
       DO UPDATE SET share_notifications_enabled = EXCLUDED.share_notifications_enabled,
                     updated_at = now()
     RETURNING share_notifications_enabled`,
    [userId, shareNotificationsEnabled],
  );
  const row = result.rows[0];
  if (!row) {
    // Unreachable on a successful INSERT ... RETURNING; if it ever occurs the
    // write did not persist, so surface it as a failure the route maps to an
    // error envelope (R9.8) rather than silently returning the request value.
    throw new Error('Notification preference upsert returned no row.');
  }
  return { shareNotificationsEnabled: row.share_notifications_enabled };
}
