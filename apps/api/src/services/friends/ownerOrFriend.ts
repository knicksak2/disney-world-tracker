/**
 * Shared Owner_Or_Friend_Rule authorization gate.
 *
 * Single source of truth for the owner-or-friend authorization rule used by
 * every gated read in the application: the Auth_Service Profile read
 * (`GET /users/:userId/profile`), the Stats_Service summary read
 * (`GET /me/stats/summary?for=<userId>`), and the new Tracking_Service Friend
 * Completions read (`GET /users/:userId/completions`).
 *
 * The rule previously lived in two near-identical copies in
 * `auth/profileRoutes.ts` and `stats/routes.ts`. Consolidating it here keeps a
 * security-critical invariant in one place — one implementation means one
 * audit surface — rather than letting copies drift as a third caller is added.
 *
 * Behavior:
 *   - When the requester *is* the target, authorize immediately (the owner may
 *     always read their own data).
 *   - Otherwise, perform **exactly one** friendship lookup against the
 *     canonical pair `(min, max)` invariant of the `friendships` table and
 *     authorize iff a row exists.
 *   - On absence, throw `AppError('profile_forbidden')`.
 *
 * The deny path performs **no** logging, analytics, audit, or telemetry write
 * (R1.4). The function never calls `req.log`/analytics itself; the only log
 * line that can result is the global error hook's standard error-response log,
 * which carries the error code but is not a viewing-attempt analytics record.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 3.6.
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair as canonicalPair } from './canonicalPair.js';

/**
 * Authorize `requesterId` to read `targetId`'s owner-or-friend-gated data.
 *
 * Returns immediately when `requesterId === targetId`. Otherwise performs
 * exactly one friendship lookup against the canonical pair and throws
 * `AppError('profile_forbidden')` on absence. Emits no log/analytics on the
 * deny path (R1.4).
 *
 * @param pool        Database pool used for the single friendship lookup.
 * @param requesterId Id of the authenticated requesting User.
 * @param targetId    Id of the target User whose data is being read.
 * @throws {AppError} `profile_forbidden` when the requester is neither the
 *         target nor an accepted Friend of the target.
 */
export async function assertOwnerOrFriend(
  pool: DbPool,
  requesterId: string,
  targetId: string,
): Promise<void> {
  if (requesterId === targetId) return;

  const { lo, hi } = canonicalPair(requesterId, targetId);
  const result = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2) AS exists',
    [lo, hi],
  );
  const exists = result.rows[0]?.exists === true;
  if (!exists) {
    throw new AppError('profile_forbidden', 'You may not view this profile.');
  }
}
