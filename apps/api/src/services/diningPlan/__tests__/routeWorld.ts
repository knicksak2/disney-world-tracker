/**
 * A migrated pg-mem database (every migration, through the account-deletion harness) with a Trip, its members, a
 * guest and restaurants, served by the REAL Dining Plan stack: `createDiningPlanServiceFromRepos` over the real
 * Trips, Trip Expenses and Trip Budget repos, and the real routes behind a header-driven session stub.
 *
 * BOB is the organizer, CAROL a member, DAVE not on the Trip.
 */

import type { FastifyInstance } from 'fastify';

import type { DbPool } from '../../../db/pool.js';
import { BOB, buildApp, CAROL, createWorld, sessionStub, type World } from '../../accountDeletion/__tests__/visibility.harness.js';
import { createTripBudgetRepo } from '../../tripBudget/repo.js';
import { createTripExpenseRepo } from '../../tripExpenses/repo.js';
import { createTripRepo, type TripRepoDeps } from '../../trips/repo.js';
import { diningPlanRoutes } from '../routes.js';
import { createDiningPlanServiceFromRepos } from '../wiring.js';

export { as, BOB, CAROL, DAVE } from '../../accountDeletion/__tests__/visibility.harness.js';

export const NOW = new Date('2026-11-09T15:00:00Z');
const TRIP_DEPS = { completions: {}, ratings: {} } as unknown as TripRepoDeps;

export interface RouteWorld {
  readonly w: World;
  readonly app: FastifyInstance;
  readonly tripId: string;
  readonly guestId: string;
  readonly restaurants: { readonly liberty: string; readonly pecos: string };
}

export async function createRouteWorld(opts: { startDate?: string; endDate?: string; wrapPool?: (pool: DbPool) => DbPool } = {}): Promise<RouteWorld> {
  const w = await createWorld();
  const trip = await w.seeder.insertRow('trips', { creator_id: BOB.id, start_date: opts.startDate ?? '2027-03-01', end_date: opts.endDate ?? '2027-03-06' });
  const tripId = String(trip.id);
  await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: BOB.id, role: 'organizer' });
  await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: CAROL.id, role: 'member' });
  const guest = await w.seeder.insertRow('trip_guests', { trip_id: tripId, sponsor_member_id: BOB.id, name: 'Timmy' });
  const restaurant = async (name: string, facets: object) =>
    String((await w.seeder.insertRow('experiences', { name, category: 'Restaurant', active: true, grouped_facets: facets, price_tier: '$$' })).id);
  const restaurants = {
    liberty: await restaurant('Liberty Tree Tavern', { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] }),
    pecos: await restaurant('Pecos Bill Tall Tale Inn and Cafe', { quickService: [{ id: 'counter-service', name: 'Counter Service' }] }),
  };

  const pool = opts.wrapPool === undefined ? w.pool : opts.wrapPool(w.pool);
  const service = createDiningPlanServiceFromRepos({
    pool,
    members: createTripRepo(pool, TRIP_DEPS),
    guests: createTripExpenseRepo(pool),
    budget: createTripBudgetRepo(pool),
    now: () => NOW,
  });
  const app = await buildApp(diningPlanRoutes({ pool, service, requireSession: sessionStub }));
  return { w, app, tripId, guestId: String(guest.id), restaurants };
}
