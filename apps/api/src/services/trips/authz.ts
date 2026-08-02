/**
 * Trip authorization gate — the single place the Trip_Member_Rule and the
 * Organizer-action rule are enforced.
 *
 * Modeled directly on the shared `assertOwnerOrFriend` gate
 * (`services/friends/ownerOrFriend.ts`): a small helper that performs exactly
 * one membership lookup and throws a single opaque `AppError` on denial, so
 * every gated Trip endpoint shares one implementation and one audit surface.
 *
 * Two decisions live here:
 *
 *   - `assertTripMember` authorizes any read/contribution request that only
 *     requires the caller to be a Trip_Member of the Trip (R15.1).
 *   - `assertTripOrganizer` authorizes the Organizer-only actions defined in
 *     Requirement 4 (R15.5); it builds on the same lookup and additionally
 *     requires the `organizer` role.
 *
 * The security-critical property (R15.4, R15.6): a **non-member** and a
 * **non-existent Trip** must collapse to the *identical* `trip_forbidden`
 * response. Because both are represented by the absence of a
 * `trip_memberships` row for `(trip_id, user_id)`, a single "does a membership
 * row exist?" lookup naturally produces the same outcome for both — the
 * endpoint cannot be used to probe whether a Trip exists. A former Member whose
 * membership row was removed is likewise indistinguishable from a User who was
 * never a Member (R15.6).
 *
 * The authenticated-session check (R15.3) is enforced *earlier* by the shared
 * `requireSession` pre-handler that assigns `request.userId`; these helpers run
 * only after a session is established, so session-before-membership ordering
 * holds by construction.
 *
 * The deny path performs **no** logging, analytics, audit, or telemetry write:
 * it simply throws, mirroring `assertOwnerOrFriend`.
 *
 * Note: `trip_forbidden` is added to the closed `ErrorCode` union in the shared
 * error catalog by task 1.4; the type reference below resolves once that lands.
 *
 * Validates: Requirements 15.2, 15.4, 15.5, 15.6 (session ordering R15.3 is
 * enforced upstream by `requireSession`).
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { TripRole } from './permissions.js';

/**
 * Authorize `userId` to act on `tripId` as a Trip_Member and return the role
 * they hold on the Trip.
 *
 * Performs exactly one membership lookup. When no membership row exists — the
 * caller is not a Member, or the Trip does not exist (or was deleted), or the
 * caller is a former Member whose row was removed — the function throws the
 * single opaque `trip_forbidden` error so none of those cases can be told
 * apart (R15.2, R15.4, R15.6).
 *
 * Returning the role lets callers that need it (e.g. an Organizer-only route)
 * avoid a second query; `assertTripOrganizer` uses this directly.
 *
 * @param pool   Database pool used for the single membership lookup.
 * @param userId Id of the authenticated requesting User (`request.userId`).
 * @param tripId Id of the Trip being accessed.
 * @returns The requesting User's `TripRole` on the Trip.
 * @throws {AppError} `trip_forbidden` when the caller is not a Member of an
 *         existing Trip — indistinguishable from a non-existent Trip.
 */
export async function assertTripMember(
  pool: DbPool,
  userId: string,
  tripId: string,
): Promise<TripRole> {
  const result = await pool.query<{ role: TripRole }>(
    'SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId],
  );
  const role = result.rows[0]?.role;
  if (role === undefined) {
    throw new AppError('trip_forbidden', 'You may not view this trip.');
  }
  return role;
}

/**
 * Authorize `userId` to perform an Organizer-only action on `tripId` (R15.5).
 *
 * Uses the same single-lookup membership check as {@link assertTripMember}, so
 * a non-member and a non-existent Trip still collapse to the identical
 * `trip_forbidden` response (R15.4, R15.6). A Member who is not an Organizer is
 * likewise denied with the same `trip_forbidden` error, making no change to
 * Trip data (R15.5).
 *
 * @param pool   Database pool used for the single membership lookup.
 * @param userId Id of the authenticated requesting User (`request.userId`).
 * @param tripId Id of the Trip being acted upon.
 * @throws {AppError} `trip_forbidden` when the caller is not an Organizer of
 *         the Trip (non-member, non-existent Trip, or non-organizer Member).
 */
export async function assertTripOrganizer(
  pool: DbPool,
  userId: string,
  tripId: string,
): Promise<void> {
  const role = await assertTripMember(pool, userId, tripId);
  if (role !== 'organizer') {
    throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
  }
}
