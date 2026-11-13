/**
 * The read path is bounded and read-only (Property 22): `GET /trips/:id/dining-plan` through `server.inject` over the
 * REAL stack (real authorization, real Trips and Trip Expenses party sources, real Trip Stays read, real dining repo)
 * on a migrated pg-mem database. Every `pool.query` and every query of a client from `pool.connect()` is recorded by
 * the test pool. The Party includes a guest, because `listTripGuests` issues one more statement when there is one.
 *
 * Validates: dining-plan-calculator Requirements 16.5, 16.6, 23.1, 23.2, 25.18; Property 22.
 */

import { DINING_PLAN_READ_MAX_STATEMENTS } from '@dwt/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makePending } from '../../accountDeletion/__tests__/world.js';
import { as, BOB, CAROL, createRouteWorld, type RouteWorld } from './routeWorld.js';

const MEALS = ['breakfast', 'lunch', 'dinner'] as const;

function dateAt(offset: number): string {
  return new Date(Date.UTC(2027, 2, 1 + offset)).toISOString().slice(0, 10);
}

async function addEntries(rw: RouteWorld, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) {
    await rw.w.seeder.insertRow('trip_dining_plan_entries', {
      trip_id: rw.tripId,
      entry_date: dateAt(Math.floor(i / 3)),
      meal_period: MEALS[i % 3],
      kind: 'restaurant',
      experience_id: i % 2 === 0 ? rw.restaurants.liberty : rw.restaurants.pecos,
      placeholder_kind: null,
    });
  }
}

async function addStays(rw: RouteWorld, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) {
    await rw.w.seeder.insertRow('trip_stays', {
      trip_id: rw.tripId,
      position: i,
      lodging_kind: 'offsite',
      resort_id: null,
      place_name: `Rental ${i + 1}`,
      check_in: dateAt(i * 2),
      check_out: dateAt(i * 2 + 2),
    });
  }
}

/** The statements one GET issues, as sent. */
async function readOnce(rw: RouteWorld, caller: string): Promise<string[]> {
  rw.w.resetStatements();
  const res = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(caller) });
  expect(res.statusCode, res.body).toBe(200);
  return rw.w.statements.map((s) => s.text.trim());
}

let rw: RouteWorld | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await rw?.app.close();
});

describe('GET /trips/:id/dining-plan statement count (Property 22)', () => {
  // Feature: dining-plan-calculator, Property 22: The read path is bounded and read-only
  it('Property 22: the same statements for 1 and 100 entries and for 1 and 6 stays, no write, no outbound request', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('the read path must not fetch');
    });
    vi.stubGlobal('fetch', fetchSpy);
    rw = await createRouteWorld({ startDate: '2027-03-01', endDate: '2027-04-10' });
    await addEntries(rw, 0, 1);
    await addStays(rw, 0, 1);

    const oneEntry = await readOnce(rw, CAROL.id);
    await addEntries(rw, 1, 100);
    const hundredEntries = await readOnce(rw, CAROL.id);
    await addStays(rw, 1, 6);
    const sixStays = await readOnce(rw, CAROL.id);

    // The statements by table, so a new read anywhere on the path is named in the failure.
    const tables = (statements: string[]) => statements.map((s) => /\bFROM\s+(\w+)/i.exec(s)?.[1] ?? s.slice(0, 40));
    expect(tables(oneEntry)).toEqual([
      'trip_memberships', // assertTripMember (the caller's role and whether an Organizer is active)
      'trips',
      'trip_dining_plan_scenarios',
      'trip_dining_plan_entries',
      'active_trip_memberships', // listMembers
      'trip_guests', // listTripGuests
      'profile_identity', // listTripGuests' sponsor public ids (only when there is a guest)
      'trip_guests', // findNonVisibleParties: the guests' sponsors
      'users', // findNonVisibleParties: accounts that are not active
      'trip_traveler_profiles',
      'planned_items',
      'trip_stays',
      'experiences', // loadLocations: rules joined
      'experience_menus',
      'dining_plan_prices',
      'dining_plan_config',
    ]);
    expect(hundredEntries.length).toBe(oneEntry.length);
    expect(sixStays.length).toBe(oneEntry.length);
    expect(sixStays).toEqual(hundredEntries);
    for (const statements of [oneEntry, hundredEntries, sixStays]) {
      expect(statements.filter((s) => /^(INSERT|UPDATE|DELETE|BEGIN)\b/i.test(s))).toEqual([]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // While the Trip has no active Organizer, authorization reads the roster once more (the interim organizer).
    await makePending(rw.w, BOB.id);
    const interim = await readOnce(rw, CAROL.id);
    expect(interim.length).toBe(oneEntry.length + 1);
    expect(interim.length).toBeLessThanOrEqual(DINING_PLAN_READ_MAX_STATEMENTS);
    expect({ common: oneEntry.length, interim: interim.length }).toEqual({ common: DINING_PLAN_READ_MAX_STATEMENTS - 1, interim: DINING_PLAN_READ_MAX_STATEMENTS });
  });
});
