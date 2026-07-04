/**
 * Push_Registration_Service repository (task 12.1).
 *
 * Single point of contact between the Push_Registration route handlers and the
 * `push_registrations` table (per `migrations/0011_social_sharing_loop.sql`):
 *
 *   push_registrations (
 *     id               UUID PRIMARY KEY,
 *     user_id          UUID NOT NULL REFERENCES users(id),
 *     device_id        TEXT NOT NULL,
 *     expo_push_token  TEXT NOT NULL UNIQUE,          -- one user per token (R8.3)
 *     status           TEXT NOT NULL DEFAULT 'active', -- active | invalidated
 *     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     UNIQUE (user_id, device_id)                      -- one row per device (R8.5)
 *   )
 *
 * The table carries two unique constraints that the registration path must
 * reconcile in one atomic step:
 *
 *   1. `expo_push_token` is globally unique, so a physical device's token can
 *      belong to exactly one User at a time (R8.3, R8.5).
 *   2. `(user_id, device_id)` is unique, so a device that rotates its token
 *      replaces its prior registration rather than accumulating rows (R8.2).
 *
 * Public surface:
 *
 *   - `register(userId, deviceId, expoPushToken)` — upsert the device's
 *     registration as `active`, reconciling both unique constraints in a
 *     single transaction:
 *
 *       BEGIN
 *         -- Reassign the physical token to the requester (R8.3, R8.5):
 *         -- clear it from any other owner/device so the unique(expo_push_token)
 *         -- constraint cannot be violated by the upsert below.
 *         DELETE FROM push_registrations
 *           WHERE expo_push_token = $token
 *             AND NOT (user_id = $user AND device_id = $device);
 *         -- Upsert on (user_id, device_id) so a token rotation for the same
 *         -- device replaces the old token in place (R8.2), and a fresh device
 *         -- inserts a new active row (R8.1).
 *         INSERT INTO push_registrations (user_id, device_id, expo_push_token, status)
 *           VALUES ($user, $device, $token, 'active')
 *           ON CONFLICT (user_id, device_id) DO UPDATE
 *             SET expo_push_token = EXCLUDED.expo_push_token,
 *                 status          = 'active',
 *                 updated_at      = now()
 *           RETURNING ...;
 *       COMMIT
 *
 *     The DELETE-then-upsert ordering guarantees that when the transaction
 *     upserts token `T`, no other row still holds `T`, so the end state is a
 *     single `active` row `(user, device, token)` — the token is active for
 *     exactly one User, the most recent registrant (R8.2, R8.3, R8.5).
 *
 *   - `invalidateDevice(userId, deviceId)` — mark the current device's
 *     registration `invalidated` on logout (R8.4). Returns `true` when a row
 *     was transitioned, `false` when the device had no active registration.
 *
 *   - `listActiveTokensForUser(userId)` — enumerate a User's `active` tokens
 *     for the Notification_Service delivery path; `invalidated` registrations
 *     are excluded so they never receive a notification (R8.6).
 *
 * Validates: Requirements R8.1, R8.2, R8.3, R8.4, R8.5, R8.6.
 */

import type { DbPool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Lifecycle state of a `Push_Registration`. */
export type PushRegistrationStatus = 'active' | 'invalidated';

/**
 * Snapshot of a single `push_registrations` row as exposed to callers. The
 * route layer echoes `deviceId`, `expoPushToken`, and `status` back to the
 * client; the Notification_Service reads only `expoPushToken` via
 * {@link PushRepo.listActiveTokensForUser}.
 */
export interface PushRegistrationState {
  readonly userId: string;
  readonly deviceId: string;
  readonly expoPushToken: string;
  readonly status: PushRegistrationStatus;
  readonly updatedAt: string;
}

/** Persistence surface returned by {@link createPushRepo}. */
export interface PushRepo {
  /**
   * Register (or refresh) a device's `Push_Token` as `active` for the User,
   * reassigning the physical token away from any other owner/device (R8.3,
   * R8.5) and replacing the device's prior token on rotation (R8.2). Always
   * results in exactly one active row for `(userId, deviceId)` carrying
   * `expoPushToken`.
   */
  register(
    userId: string,
    deviceId: string,
    expoPushToken: string,
  ): Promise<PushRegistrationState>;

  /**
   * Invalidate the current device's registration on logout (R8.4). Returns
   * `true` when an active registration was transitioned to `invalidated`,
   * `false` when the device had no active registration.
   */
  invalidateDevice(userId: string, deviceId: string): Promise<boolean>;

  /**
   * Invalidate a registration by its physical `expo_push_token` (R7.6).
   *
   * Called by the Notification_Service when the Expo Push API reports a token
   * is no longer valid (a "DeviceNotRegistered" receipt): the corresponding
   * `Push_Registration` is marked `invalidated` so it is excluded from every
   * subsequent delivery (R8.6). Because `expo_push_token` is globally unique,
   * this touches at most one row regardless of which User currently owns it.
   * Returns `true` when an active registration was transitioned, `false` when
   * no active registration held the token.
   */
  invalidateByToken(expoPushToken: string): Promise<boolean>;

  /**
   * Return the User's `active` push tokens, excluding `invalidated`
   * registrations, for the Notification_Service delivery path (R8.6).
   */
  listActiveTokensForUser(userId: string): Promise<readonly string[]>;
}

// ---------------------------------------------------------------------------
// Internal row shape
// ---------------------------------------------------------------------------

interface PushRegistrationRow {
  user_id: string;
  device_id: string;
  expo_push_token: string;
  status: PushRegistrationStatus;
  updated_at: Date | string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link PushRepo} bound to the supplied pool. Constructor injection
 * (rather than reaching for `getPool()`) keeps the repo testable: unit tests
 * pass a fake whose `query`/`connect` are recorded, and integration tests pass
 * a pool connected to a sandbox database.
 */
export function createPushRepo(pool: DbPool): PushRepo {
  return {
    register: (userId, deviceId, expoPushToken) =>
      register(pool, userId, deviceId, expoPushToken),
    invalidateDevice: (userId, deviceId) =>
      invalidateDevice(pool, userId, deviceId),
    invalidateByToken: (expoPushToken) =>
      invalidateByToken(pool, expoPushToken),
    listActiveTokensForUser: (userId) =>
      listActiveTokensForUser(pool, userId),
  };
}

// ---------------------------------------------------------------------------
// register (R8.1, R8.2, R8.3, R8.5)
// ---------------------------------------------------------------------------

/**
 * Register/refresh a device's token, reconciling both unique constraints in a
 * single transaction. See the module header for the DELETE-then-upsert
 * rationale. The whole sequence runs on one `PoolClient` so a concurrent
 * registration for the same token or device serializes on the row locks the
 * DELETE and INSERT acquire.
 */
async function register(
  pool: DbPool,
  userId: string,
  deviceId: string,
  expoPushToken: string,
): Promise<PushRegistrationState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // R8.3/R8.5: reassign the physical token to the requesting (user, device).
    // Clearing it from any other owner or device first means the upsert below
    // can never trip the UNIQUE(expo_push_token) constraint, and it leaves the
    // token active for the requesting User only.
    await client.query(
      `DELETE FROM push_registrations
        WHERE expo_push_token = $1
          AND NOT (user_id = $2 AND device_id = $3)`,
      [expoPushToken, userId, deviceId],
    );

    // R8.1/R8.2: upsert on (user_id, device_id). A fresh device inserts a new
    // active row; a device that rotated its token updates the existing row's
    // token in place and re-activates it.
    const result = await client.query<PushRegistrationRow>(
      `INSERT INTO push_registrations (user_id, device_id, expo_push_token, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET expo_push_token = EXCLUDED.expo_push_token,
             status          = 'active',
             updated_at      = now()
       RETURNING user_id, device_id, expo_push_token, status, updated_at`,
      [userId, deviceId, expoPushToken],
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    if (!row) {
      // Unreachable on a successful INSERT ... RETURNING; surface as a generic
      // error so the global hook redacts rather than returning an empty body.
      throw new Error('push registration upsert returned no row');
    }
    return rowToState(row);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Swallow rollback failure so the original cause surfaces.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// invalidateDevice (R8.4)
// ---------------------------------------------------------------------------

/**
 * Mark the current device's registration `invalidated` on logout.
 *
 * The UPDATE is gated by `status = 'active'` so a repeated logout (or an
 * already-invalidated device) is a no-op reported as `false`, and an active
 * registration transitions exactly once. Only the requesting User's own device
 * row is touched (the `user_id = $1 AND device_id = $2` predicate), so a caller
 * cannot invalidate another User's registration.
 */
async function invalidateDevice(
  pool: DbPool,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE push_registrations
        SET status = 'invalidated',
            updated_at = now()
      WHERE user_id = $1
        AND device_id = $2
        AND status = 'active'`,
    [userId, deviceId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// invalidateByToken (R7.6)
// ---------------------------------------------------------------------------

/**
 * Mark a registration `invalidated` by its physical `expo_push_token`.
 *
 * Gated by `status = 'active'` so a receipt that arrives after the token was
 * already invalidated (e.g. concurrent logout) is a no-op reported as `false`.
 * The `expo_push_token` column is globally unique, so this transitions at most
 * one row (R7.6); the invalidated registration is then excluded from every
 * subsequent delivery via {@link listActiveTokensForUser}'s `status = 'active'`
 * predicate (R8.6).
 */
async function invalidateByToken(
  pool: DbPool,
  expoPushToken: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE push_registrations
        SET status = 'invalidated',
            updated_at = now()
      WHERE expo_push_token = $1
        AND status = 'active'`,
    [expoPushToken],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// listActiveTokensForUser (R8.6)
// ---------------------------------------------------------------------------

/**
 * Return the User's `active` push tokens, ordered by `updated_at DESC` so the
 * most recently registered device leads. `invalidated` registrations are
 * excluded by the `status = 'active'` predicate, so a token that was rotated
 * away or invalidated on logout never appears in the delivery target set
 * (R8.6).
 */
async function listActiveTokensForUser(
  pool: DbPool,
  userId: string,
): Promise<readonly string[]> {
  const result = await pool.query<{ expo_push_token: string }>(
    `SELECT expo_push_token
       FROM push_registrations
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY updated_at DESC, expo_push_token ASC`,
    [userId],
  );
  return result.rows.map((row) => row.expo_push_token);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Translate a `push_registrations` row into the public state shape. */
function rowToState(row: PushRegistrationRow): PushRegistrationState {
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    expoPushToken: row.expo_push_token,
    status: row.status,
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/**
 * Format a `TIMESTAMPTZ` column value as an ISO-8601 UTC string. Accepts
 * either a `Date` (the `pg` default) or a string already in ISO shape (which
 * can occur with a custom type parser).
 */
function toIsoTimestamp(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
