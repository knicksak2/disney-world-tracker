/**
 * Builds the Dining Plan service from the existing Trips, Trip Expenses, Trip Stays and Trip Budget code (design.md
 * "Party assembly", "Multi-Stay Extension / Service, party port and read path" and "Budget export / Port").
 * `composeServices.ts` calls it with the production repos; the route tests call it with the same repos over pg-mem,
 * so the tests exercise this wiring and not a copy of it.
 */

import type { TripGuestDTO, TripMemberDTO } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { findNonVisibleParties } from '../tripExpenses/repo.js';
import { assertTripMember } from '../trips/authz.js';
import { selectTripStaysByTrip } from '../trips/stays.js';
import { createTripBudgetWritePort, type BudgetLineStore } from './budgetPort.js';
import { createDiningPlanRepo } from './repo.js';
import { createDiningPlanService, type DiningPlanService } from './service.js';
import type { DiningPlanLogger } from './types.js';

export interface DiningPlanWiringDeps {
  readonly pool: DbPool;
  /** The Trips repo (`listMembers` reads `active_trip_memberships`). */
  readonly members: { listMembers(tripId: string): Promise<readonly TripMemberDTO[]> };
  /** The Trip Expenses repo. */
  readonly guests: { listTripGuests(tripId: string): Promise<readonly TripGuestDTO[]> };
  /** The Trip Budget repo instance the Budget routes use. */
  readonly budget: BudgetLineStore;
  readonly logger?: DiningPlanLogger;
  readonly now?: () => Date;
}

export function createDiningPlanServiceFromRepos(deps: DiningPlanWiringDeps): DiningPlanService {
  const { pool, members, guests, budget } = deps;
  return createDiningPlanService({
    repo: createDiningPlanRepo({ pool, ...(deps.logger === undefined ? {} : { logger: deps.logger }) }),
    partyPort: {
      listMembers: (tripId) => members.listMembers(tripId),
      listTripGuests: (tripId) => guests.listTripGuests(tripId),
      findNonVisible: (tripId, parties) => findNonVisibleParties(pool, tripId, parties),
    },
    staysPort: {
      listStays: async (tripId) => (await selectTripStaysByTrip(pool, [tripId])).get(tripId) ?? [],
    },
    budgetPort: createTripBudgetWritePort({ pool, budget }),
    membership: { roleOf: (userId, tripId) => assertTripMember(pool, userId, tripId) },
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
}
