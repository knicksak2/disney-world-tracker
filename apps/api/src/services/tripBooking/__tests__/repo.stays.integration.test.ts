/**
 * Booking repo and route wiring for lodging Stays (trip-lodging-stays task 6), over pg-mem: the single-Trip read and
 * the reminder runner's many-Trip read each load Stays in one statement, both omit them when the `trip_stays` table is
 * absent (the older suites' fixed migration list), and `GET /trips/:id/booking-timeline` returns the per-stay result.
 *
 * Validates: Requirements 9.1, 9.7, 9.8, 4.5.
 */

import Fastify, { type preHandlerHookHandler } from 'fastify';
import type { BookingTimelineDTO } from '@dwt/shared';
import { DataType } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBookingRepo } from '../repo.js';
import { tripBookingRoutes } from '../routes.js';
import { applyMigration, setupTestDb } from './testDb.js';

const USER = '11111111-1111-1111-1111-111111111111';
const TRIP_A = '44444444-4444-4444-4444-444444444444';
const TRIP_B = '66666666-6666-4666-8666-666666666666';
const RESORT_1 = '77777777-7777-4777-8777-777777777777';
const RESORT_2 = '88888888-8888-4888-8888-888888888888';

async function seeded(withStays: boolean) {
  const setup = setupTestDb();
  if (withStays) {
    setup.db.public.registerFunction({
      name: 'btrim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (s: unknown) => (typeof s === 'string' ? s.trim() : ''),
    });
    setup.db.public.registerFunction({
      name: 'jsonb_typeof',
      args: [DataType.jsonb],
      returns: DataType.text,
      implementation: (v: unknown) => (Array.isArray(typeof v === 'string' ? JSON.parse(v) : v) ? 'array' : 'object'),
    });
    applyMigration(setup.db, '0073_trip_lodging_stays.sql');
  }
  const pool = setup.pool as unknown as DbPool;
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'a@example.com', 'hash')`, [USER]);
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, 'Alice')`, [USER]);
  for (const [id, start, end] of [
    [TRIP_A, '2027-12-15', '2027-12-31'],
    [TRIP_B, '2027-12-16', '2027-12-20'],
  ] as const) {
    await pool.query(`INSERT INTO trips (id, name, start_date, end_date, creator_id) VALUES ($1, 'T', $2, $3, $4)`, [
      id,
      start,
      end,
      USER,
    ]);
    await pool.query(`INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`, [id, USER]);
  }
  await pool.query(`INSERT INTO resorts (id, name) VALUES ($1, 'Beach Club'), ($2, 'Polynesian Village')`, [RESORT_1, RESORT_2]);
  await pool.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2), ($1, $3)`, [TRIP_A, RESORT_1, RESORT_2]);
  if (withStays) {
    await pool.query(
      `INSERT INTO trip_stays (trip_id, position, lodging_kind, resort_id, check_in, check_out)
       VALUES ($1, 1, 'resort', $3, '2027-12-20', '2027-12-26'),
              ($1, 0, 'resort', $2, '2027-12-15', '2027-12-20')`,
      [TRIP_A, RESORT_1, RESORT_2],
    );
    await pool.query(
      `INSERT INTO trip_stays (trip_id, position, lodging_kind, place_name, check_in, check_out)
       VALUES ($1, 0, 'offsite', 'Aunt May', '2027-12-16', '2027-12-20')`,
      [TRIP_B],
    );
  }
  return { ...setup, pool, repo: createTripBookingRepo(pool) };
}

describe('booking repo with lodging stays (pg-mem)', () => {
  it('getTimelineInputs loads the Trip stays in check-in order in one statement', async () => {
    const { repo, recordedQueries } = await seeded(true);
    recordedQueries.length = 0;
    const rm = await repo.getTimelineInputs(TRIP_A, USER);
    expect(rm?.stays?.map((s) => [s.displayName, s.checkIn, s.checkOut])).toEqual([
      ['Beach Club', '2027-12-15', '2027-12-20'],
      ['Polynesian Village', '2027-12-20', '2027-12-26'],
    ]);
    expect(recordedQueries.filter((q) => /FROM trip_stays/iu.test(q) && !/LIMIT 0/iu.test(q))).toHaveLength(1);
  });

  it('listCandidateTrips loads every candidate Trip its own stays in ONE statement', async () => {
    const { repo, recordedQueries } = await seeded(true);
    recordedQueries.length = 0;
    const trips = await repo.listCandidateTrips({ today: '2027-10-01', horizon: '2028-01-31', limit: 10 });
    const byId = new Map(trips.map((t) => [t.id, t.stays?.map((s) => s.displayName)]));
    expect(byId.get(TRIP_A)).toEqual(['Beach Club', 'Polynesian Village']);
    expect(byId.get(TRIP_B)).toEqual(['Aunt May']);
    expect(recordedQueries.filter((q) => /FROM trip_stays/iu.test(q) && !/LIMIT 0/iu.test(q))).toHaveLength(1);
  });

  it('omits stays entirely when the trip_stays table does not exist', async () => {
    const { repo } = await seeded(false);
    const rm = await repo.getTimelineInputs(TRIP_A, USER);
    expect(rm).not.toBeNull();
    expect(rm && 'stays' in rm).toBe(false);
    const trips = await repo.listCandidateTrips({ today: '2027-10-01', horizon: '2028-01-31', limit: 10 });
    expect(trips.every((t) => !('stays' in t))).toBe(true);
  });
});

describe('GET /trips/:id/booking-timeline with lodging stays', () => {
  async function appFor(withStays: boolean) {
    const { pool, repo } = await seeded(withStays);
    const app = Fastify();
    registerErrorHandler(app);
    const requireSession: preHandlerHookHandler = async (request) => {
      request.userId = USER;
    };
    await app.register(tripBookingRoutes({ repo, pool, requireSession, now: () => new Date('2027-10-01T12:00:00Z') }));
    await app.ready();
    return app;
  }

  it("returns windows per stay, 'stays' sources, and the segments", async () => {
    const app = await appFor(true);
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_A}/booking-timeline` });
    expect(res.statusCode).toBe(200);
    const dto = res.json() as BookingTimelineDTO;
    expect(dto.stayType).toEqual({ value: 'resort', source: 'stays' });
    expect(dto.arrivalDate).toEqual({ value: '2027-12-15', source: 'stays' });
    expect(dto.stays.map((s) => [s.lodgingKind, s.checkIn, s.checkOut, s.source])).toEqual([
      ['resort', '2027-12-15', '2027-12-20', 'stay'],
      ['resort', '2027-12-20', '2027-12-26', 'stay'],
      ['offsite', '2027-12-26', '2027-12-31', 'implicit_gap'],
    ]);
    // The second reservation books from its own check-in (Dec 20 − 60 days).
    expect(dto.windows.map((w) => w.windowKey)).toContain('dining:2027-10-21');
    await app.close();
  });

  it("marks done a window that exists only because of the second stay", async () => {
    const app = await appFor(true);
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${TRIP_A}/booking-windows/dining/2027-10-21/done`,
      payload: { done: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ windowKey: 'dining:2027-10-21', done: true });
    await app.close();

    // Without the stays the same key is not a window of this Trip.
    const legacy = await appFor(false);
    const rejected = await legacy.inject({
      method: 'PUT',
      url: `/trips/${TRIP_A}/booking-windows/dining/2027-10-21/done`,
      payload: { done: true },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('trip_validation_failed');
    await legacy.close();
  });

  it('returns the original response with an empty stays list when the table is absent', async () => {
    const app = await appFor(false);
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_A}/booking-timeline` });
    expect(res.statusCode).toBe(200);
    const dto = res.json() as BookingTimelineDTO;
    expect(dto.stays).toEqual([]);
    expect(dto.stayType).toEqual({ value: 'resort', source: 'auto' });
    expect(dto.windows.map((w) => w.windowKey)).not.toContain('dining:2027-10-21');
    await app.close();
  });
});
