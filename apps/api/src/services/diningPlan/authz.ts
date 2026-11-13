/**
 * Authorization for the Dining Plan Trip routes (dining-plan-calculator Requirements 16.2, 16.3).
 *
 * `assertTripMember` answers `trip_forbidden` alike for a non-member and an unknown Trip; `can` applies the role
 * matrix. This module must not import `services/trips/effectiveRole.ts` (guarded by `roleReader.guard.test.ts` and
 * the dining-plan source guard).
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertTripMember } from '../trips/authz.js';
import { can, type TripAction, type TripRole } from '../trips/permissions.js';

export async function requireDiningPlanAction(pool: DbPool, userId: string, tripId: string, action: TripAction): Promise<TripRole> {
  const role = await assertTripMember(pool, userId, tripId);
  if (!can(role, action)) {
    throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
  }
  return role;
}
