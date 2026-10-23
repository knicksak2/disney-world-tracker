/**
 * Database wrapper around the pure `effectiveRole` (account-deletion R7.1, R7.2).
 *
 * Exactly three readers use this module, and no other file selects a caller's role from `trip_memberships`
 * (a guard test pins that):
 *   - `trips/authz.ts` `assertTripMember`
 *   - `trips/repo.ts` `lockMemberRole` (the `FOR UPDATE` role read)
 *   - the `roleOf` of the trip-share port in `composeServices.ts`
 *
 * The common case costs nothing extra: the readers' own membership query carries the active-organizer flag
 * (`ACTIVE_ORGANIZER_COUNT_SQL`), and only a persisted `member` of a trip with NO active organizer triggers the
 * roster read in `resolveEffectiveRole`. A row without the flag (a test double that predates this feature)
 * counts as "has an active organizer", so the persisted role is returned unchanged.
 */

import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { effectiveRole, type RosterMember, type TripRole } from './permissions.js';

/**
 * Select-list fragment: whether trip `$1`, the trip the aliased `trip_memberships tm` row belongs to, has at
 * least one ACTIVE organizer. A pending, purging or tombstone organizer does not count.
 *
 * It is an `EXISTS` over the statement's own first parameter, not a `count(*)` and not a correlated reference
 * to `tm`: pg-mem (the test database) resolves neither a correlated outer reference nor an aggregate inside a
 * select-list subquery (it returns a phantom row for a non-member), while `EXISTS` behaves exactly as on
 * Postgres. "No active organizer" is the same condition as a count of zero. Callers pass the trip id as `$1`.
 */
export const ACTIVE_ORGANIZER_COUNT_SQL = `EXISTS (SELECT 1
     FROM trip_memberships o
     JOIN users ou ON ou.id = o.user_id
    WHERE o.trip_id = $1
      AND o.role = 'organizer'
      AND ou.deletion_state = 'active') AS has_active_organizer`;

/** A pool or a transaction client. */
export type RoleReader = DbPool | PoolClient;

interface RosterRow {
  user_id: string;
  role: TripRole;
  joined_at: Date | string;
  active: boolean;
}

/**
 * The effective role of `userId` on `tripId`, read from the full roster. `null` when `userId` is not a member
 * (or the trip does not exist).
 */
export async function resolveEffectiveRole(
  db: RoleReader,
  tripId: string,
  userId: string,
): Promise<TripRole | null> {
  const result = await db.query<RosterRow>(
    `SELECT tm.user_id, tm.role, tm.joined_at, (u.deletion_state = 'active') AS active
       FROM trip_memberships tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.trip_id = $1`,
    [tripId],
  );
  const roster: RosterMember[] = result.rows.map((r) => ({
    userId: r.user_id,
    role: r.role,
    joinedAt: new Date(r.joined_at),
    active: r.active === true,
  }));
  return effectiveRole(roster, userId);
}

/**
 * Turn the caller's own membership row (persisted role plus the active-organizer count) into the role they act
 * with. Organizers and members of a trip that still has an active organizer return the persisted role with no
 * further query; only a persisted `member` of a trip with zero active organizers reads the roster.
 */
export async function actingRole(
  db: RoleReader,
  tripId: string,
  userId: string,
  row: { readonly role: TripRole; readonly has_active_organizer?: boolean | null },
): Promise<TripRole> {
  if (row.role === 'organizer') {
    return 'organizer';
  }
  // Only an explicit `false` means "no active organizer". A row without the column (a test double that predates
  // this feature) counts as "has one", so the persisted role is returned unchanged.
  if (row.has_active_organizer !== false) {
    return row.role;
  }
  return (await resolveEffectiveRole(db, tripId, userId)) ?? row.role;
}
