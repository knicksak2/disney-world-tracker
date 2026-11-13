/**
 * The Dining Plan routes through `server.inject`, over the real stack and a migrated pg-mem database (routeWorld.ts).
 *
 * Validates: dining-plan-calculator Requirements 16.1 to 16.4, 16.8, 23.3, 26.1, 26.2; Property 23.
 */

import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makePending } from '../../accountDeletion/__tests__/world.js';
import { as, BOB, CAROL, createRouteWorld, DAVE, type RouteWorld } from './routeWorld.js';

let rw: RouteWorld;

beforeEach(async () => {
  rw = await createRouteWorld();
});
afterEach(async () => {
  await rw.app.close();
});

const entryUrl = (tripId: string, date = '2027-03-02', mealPeriod = 'dinner') => `/trips/${tripId}/dining-plan/entries/${date}/${mealPeriod}`;

/** Every Trip route with a body that would succeed for a member. */
function tripRoutes(tripId: string, liberty: string) {
  return [
    { method: 'GET' as const, url: `/trips/${tripId}/dining-plan` },
    { method: 'PUT' as const, url: `/trips/${tripId}/dining-plan/settings`, payload: {} },
    { method: 'PUT' as const, url: entryUrl(tripId), payload: { kind: 'restaurant', experienceId: liberty } },
    { method: 'DELETE' as const, url: entryUrl(tripId) },
    { method: 'POST' as const, url: `/trips/${tripId}/dining-plan/import-reservations`, payload: {} },
    { method: 'POST' as const, url: `/trips/${tripId}/dining-plan/export-to-budget`, payload: { preview: true } },
  ];
}

async function entryCount(): Promise<number> {
  const res = await rw.w.pool.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM trip_dining_plan_entries');
  return Number(res.rows[0]!.n);
}

describe('authorization (Property 23, Requirements 16.2, 16.3, 26.2)', () => {
  // Feature: dining-plan-calculator, Property 23: Authorization matches the Trip model
  it('Property 23: a non-member and an unknown Trip get the same trip_forbidden on every Trip route, and nothing is written', async () => {
    const unknown = randomUUID();
    const outsider = tripRoutes(rw.tripId, rw.restaurants.liberty);
    const missing = tripRoutes(unknown, rw.restaurants.liberty);
    for (let i = 0; i < outsider.length; i += 1) {
      const a = await rw.app.inject({ ...outsider[i]!, headers: as(DAVE.id) });
      const b = await rw.app.inject({ ...missing[i]!, headers: as(BOB.id) });
      expect([a.statusCode, b.statusCode], outsider[i]!.url).toEqual([403, 403]);
      expect(a.json().error.code).toBe('trip_forbidden');
      expect(b.json()).toEqual(a.json());
    }
    expect(await entryCount()).toBe(0);
  });

  it('answers trip_forbidden before reading an invalid body', async () => {
    const res = await rw.app.inject({ method: 'PUT', url: `/trips/${rw.tripId}/dining-plan/settings`, payload: { snacksPerPersonPerDay: 9 }, headers: as(DAVE.id) });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['the organizer', BOB.id],
    ['a member', CAROL.id],
  ])('lets %s view and edit', async (_name, caller) => {
    for (const route of tripRoutes(rw.tripId, rw.restaurants.liberty)) {
      const res = await rw.app.inject({ ...route, headers: as(caller) });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(200);
    }
  });

  it('requires a session on every route', async () => {
    for (const route of [...tripRoutes(rw.tripId, rw.restaurants.liberty), { method: 'POST' as const, url: '/dining-plan/calculate', payload: {} }]) {
      const res = await rw.app.inject(route);
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });
});

describe('GET /trips/:id/dining-plan (Requirement 16.1)', () => {
  it('returns the settings, entries, party, stay, suggestions and result, and never the per-Person export amounts', async () => {
    await rw.w.seeder.insertRow('planned_items', {
      trip_id: rw.tripId, added_by: BOB.id, experience_id: rw.restaurants.liberty, planned_date: '2027-03-03',
      planned_time: '2027-03-03T23:00:00Z', reservation_kind: 'dining',
    });
    const res = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(CAROL.id) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['entries', 'party', 'result', 'settings', 'stay', 'suggestions', 'suggestionsNeedingMealPeriod']);
    expect(body.settings.orderStyle).toBe('typical');
    expect(body.entries).toEqual([]);
    expect(body.party.map((p: { key: string; label: string }) => [p.key, p.label])).toEqual([
      [`m:${BOB.id}`, BOB.displayName],
      [`m:${CAROL.id}`, CAROL.displayName],
      [`g:${rw.guestId}`, 'Timmy'],
    ]);
    expect(body.stay).toEqual({ checkIn: '2027-03-01', checkOut: '2027-03-06', nights: 5, days: 6, source: 'trip' });
    expect(body.suggestions.map((s: { experienceId: string; mealPeriod: string }) => [s.experienceId, s.mealPeriod])).toEqual([[rw.restaurants.liberty, 'dinner']]);
    expect(body.result.scenarios.map((s: { code: string }) => s.code)).toEqual(['none', 'quick_service', 'table_service', 'deluxe']);
    expect(res.body).not.toContain('perPerson');
  });

  it('leaves out an account pending deletion and the guest it sponsors (Requirement 3.1)', async () => {
    await makePending(rw.w, BOB.id);
    const res = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(CAROL.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().party.map((p: { key: string }) => p.key)).toEqual([`m:${CAROL.id}`]);
  });

  it("builds the Plan_Stays from the Trip's stored stays (Requirement 25.1)", async () => {
    await rw.w.seeder.insertRow('trip_stays', { trip_id: rw.tripId, position: 0, lodging_kind: 'offsite', resort_id: null, place_name: 'Aunt May', check_in: '2027-03-01', check_out: '2027-03-03' });
    const stayId = String((await rw.w.pool.query<{ id: string }>('SELECT id FROM trip_stays WHERE trip_id = $1', [rw.tripId])).rows[0]!.id);
    const res = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(CAROL.id) });
    expect(res.json().result.stays.map((s: { key: string; label: string; available: boolean }) => [s.key, s.label, s.available])).toEqual([
      [stayId, 'Aunt May', false],
      ['implicit:2027-03-03', 'No lodging recorded', true],
    ]);
  });

  it('rejects a Trip id that is not a uuid with trip_validation_failed', async () => {
    const res = await rw.app.inject({ method: 'GET', url: '/trips/not-a-trip/dining-plan', headers: as(BOB.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'trip_validation_failed', field: 'id' });
  });
});

describe('PUT /trips/:id/dining-plan/settings (Requirement 6.3)', () => {
  it('saves valid settings and returns them, and the next GET shows them', async () => {
    const res = await rw.app.inject({ method: 'PUT', url: `/trips/${rw.tripId}/dining-plan/settings`, payload: { orderStyle: 'splurge', mugsWanted: 2 }, headers: as(CAROL.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({ orderStyle: 'splurge', mugsWanted: 2 });
    const again = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(BOB.id) });
    expect(again.json().settings).toMatchObject({ orderStyle: 'splurge', mugsWanted: 2 });
  });

  it.each([
    ['an out-of-range value', { snacksPerPersonPerDay: 9 }, 'snacksPerPersonPerDay'],
    ['an unknown order style', { orderStyle: 'lavish' }, 'orderStyle'],
    ['more mugs than eligible people', { mugsWanted: 4 }, 'mugsWanted'],
  ])('rejects %s with trip_validation_failed naming the field', async (_name, payload, field) => {
    const res = await rw.app.inject({ method: 'PUT', url: `/trips/${rw.tripId}/dining-plan/settings`, payload, headers: as(BOB.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'trip_validation_failed', field });
  });

  it('rejects an unknown key', async () => {
    const res = await rw.app.inject({ method: 'PUT', url: `/trips/${rw.tripId}/dining-plan/settings`, payload: { dessert: true }, headers: as(BOB.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('trip_validation_failed');
  });
});

describe('entries (Requirements 4.1 to 4.4)', () => {
  it('PUT stores an entry that GET then shows, and DELETE clears it', async () => {
    const put = await rw.app.inject({ method: 'PUT', url: entryUrl(rw.tripId), payload: { kind: 'restaurant', experienceId: rw.restaurants.liberty, excludedKeys: [`g:${rw.guestId}`] }, headers: as(CAROL.id) });
    expect(put.statusCode).toBe(200);
    const get = await rw.app.inject({ method: 'GET', url: `/trips/${rw.tripId}/dining-plan`, headers: as(BOB.id) });
    expect(get.json().entries).toEqual([
      { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: rw.restaurants.liberty, experienceName: 'Liberty Tree Tavern', placeholderKind: null, plannedItemId: null, excludedKeys: [`g:${rw.guestId}`] },
    ]);
    expect(get.json().result.scenarios[0].meals).toHaveLength(1);
    const del = await rw.app.inject({ method: 'DELETE', url: entryUrl(rw.tripId), headers: as(CAROL.id) });
    expect(del.statusCode).toBe(200);
    expect(del.json().entries).toEqual([]);
    expect(await entryCount()).toBe(0);
  });

  it.each([
    ['a meal period that is not one', entryUrl('TRIP', '2027-03-02', 'brunch'), 'mealPeriod'],
    ['a date that is not a calendar date', entryUrl('TRIP', '2027-3-2', 'dinner'), 'date'],
  ])('rejects %s in the path', async (_name, url, field) => {
    const res = await rw.app.inject({ method: 'PUT', url: url.replace('TRIP', rw.tripId), payload: { kind: 'skip' }, headers: as(BOB.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'trip_validation_failed', field });
  });

  it('rejects a restaurant entry for an Experience that is not a Restaurant', async () => {
    const ride = String((await rw.w.seeder.insertRow('experiences', { name: 'Space Mountain', category: 'Ride', active: true })).id);
    const res = await rw.app.inject({ method: 'PUT', url: entryUrl(rw.tripId), payload: { kind: 'restaurant', experienceId: ride }, headers: as(BOB.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('trip_validation_failed');
    expect(await entryCount()).toBe(0);
  });
});

describe('POST /trips/:id/dining-plan/import-reservations (Requirement 5.4)', () => {
  it('imports the in-stay reservations and returns the counts', async () => {
    const reservation = async (date: string, time: string) =>
      rw.w.seeder.insertRow('planned_items', { trip_id: rw.tripId, added_by: BOB.id, experience_id: rw.restaurants.liberty, planned_date: date, planned_time: time, reservation_kind: 'dining' });
    await reservation('2027-03-02', '2027-03-02T23:00:00Z');
    await reservation('2027-03-09', '2027-03-09T23:00:00Z');
    const res = await rw.app.inject({ method: 'POST', url: `/trips/${rw.tripId}/dining-plan/import-reservations`, payload: {}, headers: as(CAROL.id) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect({ created: body.created, skippedExisting: body.skippedExisting, skippedOutOfStay: body.skippedOutOfStay }).toEqual({ created: 1, skippedExisting: 0, skippedOutOfStay: 1 });
    expect(body.plan.entries.map((e: { date: string; mealPeriod: string }) => [e.date, e.mealPeriod])).toEqual([['2027-03-02', 'dinner']]);
    expect(await entryCount()).toBe(1);
  });
});

describe('POST /trips/:id/dining-plan/export-to-budget (Requirement 26)', () => {
  it('previews without writing, then writes the Budget lines for a member', async () => {
    await rw.app.inject({ method: 'PUT', url: entryUrl(rw.tripId), payload: { kind: 'restaurant', experienceId: rw.restaurants.liberty }, headers: as(BOB.id) });
    const combination = { 'implicit:2027-03-01': 'table_service' };
    const preview = await rw.app.inject({ method: 'POST', url: `/trips/${rw.tripId}/dining-plan/export-to-budget`, payload: { combination, preview: true }, headers: as(CAROL.id) });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().lines.map((l: { key: string; lineId: string | null }) => [l.key, l.lineId])).toEqual([['dining_plan:plan:implicit:2027-03-01', null], ['dining_plan:oop', null], ['dining_plan:tips', null]]);
    const lines = async () => (await rw.w.pool.query<{ suggestion_key: string; created_by: string }>('SELECT suggestion_key, created_by FROM trip_budget_lines WHERE trip_id = $1', [rw.tripId])).rows;
    expect(await lines()).toEqual([]);

    const real = await rw.app.inject({ method: 'POST', url: `/trips/${rw.tripId}/dining-plan/export-to-budget`, payload: { combination }, headers: as(CAROL.id) });
    expect(real.statusCode).toBe(200);
    expect([real.json().created, real.json().updated, real.json().deleted]).toEqual([3, 0, 0]);
    expect((await lines()).map((l) => [l.suggestion_key, l.created_by]).sort()).toEqual([
      ['dining_plan:oop', CAROL.id],
      ['dining_plan:plan:implicit:2027-03-01', CAROL.id],
      ['dining_plan:tips', CAROL.id],
    ]);
  });

  it('rejects an invalid body and an invalid combination with trip_validation_failed', async () => {
    const bad = await rw.app.inject({ method: 'POST', url: `/trips/${rw.tripId}/dining-plan/export-to-budget`, payload: { include: [] }, headers: as(BOB.id) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({ code: 'trip_validation_failed', field: 'include' });
    const wrong = await rw.app.inject({ method: 'POST', url: `/trips/${rw.tripId}/dining-plan/export-to-budget`, payload: { combination: { elsewhere: 'none' } }, headers: as(BOB.id) });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toMatchObject({ code: 'trip_validation_failed', field: 'combination' });
  });
});

describe('POST /dining-plan/calculate (Requirements 16.8, 20, 23.3)', () => {
  const body = (people: number) => ({
    party: Array.from({ length: people }, (_, i) => ({ key: `g:p${i}`, label: `Person ${i}`, ageBracket: 'adult' })),
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-04' },
    settings: {},
    entries: [{ date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', placeholderKind: 'table_service' }],
  });

  it('computes a result for a session without writing anything', async () => {
    const res = await rw.app.inject({ method: 'POST', url: '/dining-plan/calculate', payload: body(2), headers: as(DAVE.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().stay).toEqual({ checkIn: '2027-03-01', checkOut: '2027-03-04', nights: 3, days: 4, source: 'custom' });
    expect(res.json().scenarios[0].meals).toHaveLength(1);
    expect(await entryCount()).toBe(0);
  });

  it('rejects 51 people with validation_failed naming the party', async () => {
    const res = await rw.app.inject({ method: 'POST', url: '/dining-plan/calculate', payload: body(51), headers: as(DAVE.id) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'validation_failed', field: 'party' });
  });
});
