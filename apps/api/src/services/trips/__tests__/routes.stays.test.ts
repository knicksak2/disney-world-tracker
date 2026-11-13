/**
 * Route tests for `PUT /trips/:id/stays` (trip-lodging-stays task 5), `server.inject` against the real handler, the real
 * Trip repo and pg-mem with the `0073` DDL. The concurrency half of Property 7 needs real row locks and lives in
 * `routes.stays.livedb.test.ts`.
 *
 * Validates: Requirements 5.1 to 5.8, 11.2, 11.3; Property 14 (route half).
 */

import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { tripRoutes } from '../routes.js';
import { makeStaysFixture, type StaysFixture } from './staysFixture.js';

describe('PUT /trips/:id/stays', () => {
  let fx: StaysFixture;
  let app: FastifyInstance;
  let currentUserId: string | null;
  let organizerId: string;
  let memberId: string;
  let outsiderId: string;
  let tripId: string;
  let beach: string;
  let poly: string;
  let closed: string;

  beforeEach(async () => {
    fx = makeStaysFixture();
    organizerId = await fx.seedUser('Organizer');
    memberId = await fx.seedUser('Member');
    outsiderId = await fx.seedUser('Outsider');
    beach = await fx.seedResort('Beach Club');
    poly = await fx.seedResort('Polynesian Village');
    closed = await fx.seedResort('Closed Resort', false);
    const trip = await fx.repo.createTrip(organizerId, {
      name: 'Holiday',
      description: '',
      startDate: '2027-12-15',
      endDate: '2027-12-31',
    });
    tripId = trip.id;
    await fx.pool.query(`INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'member')`, [
      tripId,
      memberId,
    ]);

    currentUserId = organizerId;
    app = Fastify();
    registerErrorHandler(app);
    const requireSession: preHandlerHookHandler = async (request) => {
      if (!currentUserId) throw new AppError('unauthorized', 'Session required');
      (request as unknown as { userId: string }).userId = currentUserId;
    };
    await app.register(tripRoutes({ pool: fx.pool, repo: fx.repo, requireSession }));
  });

  afterEach(async () => {
    await app.close();
  });

  const putStays = (id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/trips/${id}/stays`, payload: payload as Record<string, unknown> });

  const threeStays = () => ({
    stays: [
      { lodgingKind: 'resort', resortId: beach, checkIn: '2027-12-15', checkOut: '2027-12-20' },
      { lodgingKind: 'resort', resortId: poly, checkIn: '2027-12-20', checkOut: '2027-12-26', partyKeys: ['m:abc'] },
      { lodgingKind: 'offsite', placeName: 'Aunt May', checkIn: '2027-12-26', checkOut: '2027-12-31' },
    ],
  });

  it('401 without a session, and nothing is written', async () => {
    currentUserId = null;
    const res = await putStays(tripId, threeStays());
    expect(res.statusCode).toBe(401);
    expect(await fx.stayRows(tripId)).toHaveLength(0);
  });

  it('a non-member and an unknown Trip get the identical trip_forbidden', async () => {
    currentUserId = outsiderId;
    const outsider = await putStays(tripId, threeStays());
    const unknown = await putStays(randomUUID(), threeStays());
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error.code).toBe('trip_forbidden');
    expect(unknown.statusCode).toBe(outsider.statusCode);
    expect(unknown.body).toBe(outsider.body);
    expect(await fx.stayRows(tripId)).toHaveLength(0);
  });

  it('a Member who is not an Organizer gets trip_forbidden and writes nothing', async () => {
    currentUserId = memberId;
    const res = await putStays(tripId, threeStays());
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
    expect(await fx.stayRows(tripId)).toHaveLength(0);
  });

  it('an Organizer creates three stays; the response and the next GET carry stays, warnings and the derived resorts', async () => {
    const res = await putStays(tripId, threeStays());
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stays: { displayName: string; nights: number; partyKeys: string[] | null }[]; stayWarnings: unknown[] };
    expect(body.stays.map((s) => [s.displayName, s.nights, s.partyKeys])).toEqual([
      ['Beach Club', 5, null],
      ['Polynesian Village', 6, ['m:abc']],
      ['Aunt May', 5, null],
    ]);
    expect(body.stayWarnings).toEqual([]);

    // A Member (not only the Organizer) reads the stays back.
    currentUserId = memberId;
    const get = await app.inject({ method: 'GET', url: `/trips/${tripId}` });
    expect(get.statusCode).toBe(200);
    const trip = get.json() as { stays: unknown[]; stayWarnings: unknown[]; resorts: { id: string; name: string }[] };
    expect(trip.stays).toEqual(body.stays);
    expect(trip.stayWarnings).toEqual([]);
    expect(trip.resorts).toEqual([
      { id: beach, name: 'Beach Club' },
      { id: poly, name: 'Polynesian Village' },
    ]);
  });

  it('returns warnings in the response for a gap and an undated stay', async () => {
    const res = await putStays(tripId, {
      stays: [
        { lodgingKind: 'resort', resortId: beach, checkIn: '2027-12-15', checkOut: '2027-12-20' },
        { lodgingKind: 'offsite', placeName: 'Aunt May', checkIn: '2027-12-22', checkOut: '2027-12-31' },
        { lodgingKind: 'offsite', placeName: 'Undated' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { stayWarnings: { code: string; from?: string; to?: string }[] }).stayWarnings;
    expect(codes).toContainEqual({ code: 'gap', from: '2027-12-20', to: '2027-12-22' });
    expect(codes.filter((w) => w.code === 'unscheduled')).toHaveLength(1);
  });

  it('updating by id keeps the id; omitting a stay deletes it', async () => {
    const first = (await putStays(tripId, threeStays())).json() as { stays: { id: string; displayName: string }[] };
    const beachStay = first.stays.find((s) => s.displayName === 'Beach Club')!;

    const res = await putStays(tripId, {
      stays: [{ id: beachStay.id, lodgingKind: 'resort', resortId: beach, checkIn: '2027-12-15', checkOut: '2027-12-31' }],
    });

    expect(res.statusCode).toBe(200);
    const after = res.json() as { stays: { id: string; checkOut: string }[] };
    expect(after.stays.map((s) => [s.id, s.checkOut])).toEqual([[beachStay.id, '2027-12-31']]);
    expect((await fx.stayRows(tripId)).map((r) => r['id'])).toEqual([beachStay.id]);
    expect(await fx.tripResortIds(tripId)).toEqual([beach]);
  });

  describe('each validation error returns trip_validation_failed naming the stay, and writes nothing', () => {
    const cases: { name: string; field: string; body: (ids: { beach: string; closed: string }) => unknown }[] = [
      { name: 'resort stay without a resortId', field: 'stays[1].resortId', body: () => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A' }, { lodgingKind: 'resort' }] }) },
      { name: 'resort stay with a placeName', field: 'stays[0].placeName', body: (i) => ({ stays: [{ lodgingKind: 'resort', resortId: i.beach, placeName: 'X' }] }) },
      { name: 'off-site stay with a resortId', field: 'stays[0].resortId', body: (i) => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A', resortId: i.beach }] }) },
      { name: 'only a check-in date', field: 'stays[0].checkOut', body: () => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A', checkIn: '2027-12-15' }] }) },
      { name: 'a malformed date', field: 'stays[0].checkIn', body: () => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A', checkIn: '12/15/2027', checkOut: '2027-12-20' }] }) },
      { name: 'an unknown key on a stay', field: 'stays[0]', body: () => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A', roomType: 'suite' }] }) },
      { name: 'an unknown top-level key', field: 'resortIds', body: () => ({ stays: [], resortIds: [] }) },
      { name: 'a missing stays array', field: 'stays', body: () => ({}) },
      { name: 'nine stays', field: 'stays', body: () => ({ stays: Array.from({ length: 9 }, (_, n) => ({ lodgingKind: 'offsite', placeName: `S${n}` })) }) },
      { name: 'a bad person key', field: 'stays[0].partyKeys.0', body: () => ({ stays: [{ lodgingKind: 'offsite', placeName: 'A', partyKeys: ['user-1'] }] }) },
      {
        name: 'overlapping stays',
        field: 'stays[1]',
        body: (i) => ({
          stays: [
            { lodgingKind: 'resort', resortId: i.beach, checkIn: '2027-12-15', checkOut: '2027-12-21' },
            { lodgingKind: 'offsite', placeName: 'A', checkIn: '2027-12-20', checkOut: '2027-12-25' },
          ],
        }),
      },
      { name: 'an inactive resort', field: 'stays[0].resortId', body: (i) => ({ stays: [{ lodgingKind: 'resort', resortId: i.closed }] }) },
      { name: 'an id that is not one of this Trip\'s stays', field: 'stays[0].id', body: () => ({ stays: [{ id: randomUUID(), lodgingKind: 'offsite', placeName: 'A' }] }) },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        // Seed one stay so "writes nothing" is checked against a non-empty state.
        expect((await putStays(tripId, { stays: [{ lodgingKind: 'offsite', placeName: 'Keep', checkIn: '2027-12-15', checkOut: '2027-12-16' }] })).statusCode).toBe(200);
        const before = { stays: await fx.stayRows(tripId), resorts: await fx.tripResortIds(tripId) };

        const res = await putStays(tripId, c.body({ beach, closed }));

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('trip_validation_failed');
        expect(res.json().error.field).toBe(c.field);
        expect({ stays: await fx.stayRows(tripId), resorts: await fx.tripResortIds(tripId) }).toEqual(before);
      });
    }
  });

  it('writes only trip_stays and trip_resorts (no Booking, Budget or Dining data)', async () => {
    fx.statements.length = 0;
    expect((await putStays(tripId, threeStays())).statusCode).toBe(200);
    const writes = fx.statements
      .map((s) => s.trim())
      .filter((s) => /^(INSERT|UPDATE|DELETE)\b/iu.test(s))
      .map((s) => /^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/iu.exec(s)?.[1]);
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set(['trip_stays', 'trip_resorts']));
  });
});
