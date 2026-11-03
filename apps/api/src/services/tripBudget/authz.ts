/**
 * Authorization helper for Trip Budget routes (Requirement 18.2, 18.3, round 5 H1).
 *
 * Implements:
 * - requireBudgetAction(pool, userId, tripId, action): asserts trip membership and permissions.
 *
 * Note: Must NOT import services/trips/effectiveRole.ts (guarded by roleReader.guard.test.ts).
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertTripMember } from '../trips/authz.js';
import { can, type TripAction, type TripRole } from '../trips/permissions.js';

export async function requireBudgetAction(
  pool: DbPool,
  userId: string,
  tripId: string,
  action: TripAction,
): Promise<TripRole> {
  const role = await assertTripMember(pool, userId, tripId);
  if (!can(role, action)) {
    throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
  }
  return role;
}

