/**
 * Repo-level tests for the Trip lodging Stays (trip-lodging-stays task 4), against pg-mem with the real `0073` DDL.
 * They read rows back with plain SQL, so a dropped column or a wrong WHERE fails here.
 *
 * Validates: Requirements 1.1, 1.5, 1.6, 2.1 to 2.8, 4.1 to 4.6, 5.1, 5.3, 5.4, 5.5, 5.7
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import {
  followTripDates,
  isTripStaysAvailable,
  replaceTripStays,
  selectTripStaysByTrip,
  translateLegacyResortIds,
} from '../stays.js';
import { makeStaysFixture, offsiteStay, resortStay, type StaysFixture } from './staysFixture.js';

const ymd = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

async function put(fx: StaysFixture, tripId: string, start: string, end: string, stays: Parameters<typeof replaceTripStays>[2]) {
  return fx.inTransaction((c) => replaceTripStays(c, { id: tripId, startDate: start, endDate: end }, stays));
}

async function legacy(fx: StaysFixture, tripId: string, start: string, end: string, ids: string[]) {
  return fx.inTransaction((c) => translateLegacyResortIds(c, { id: tripId, startDate: start, endDate: end }, ids));
}

async function snapshot(fx: StaysFixture, tripId: string) {
  return { stays: await fx.stayRows(tripId), resorts: await fx.tripResortIds(tripId) };
}

async function expectRejected(promise: Promise<unknown>, field: string): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe('trip_validation_failed');
  expect((err as AppError).field).toBe(field);
}

describe('replaceTripStays (pg-mem)', () => {
  it('creates stays, sets position to the array index, and mirrors the resorts into trip_resorts', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');

    const out = await put(fx, trip, '2027-12-15', '2027-12-31', [
      resortStay(beach, '2027-12-15', '2027-12-20'),
      resortStay(poly, '2027-12-20', '2027-12-26'),
      offsiteStay('Aunt May', '2027-12-26', '2027-12-31'),
    ]);

    expect(out.map((s) => [s.position, s.lodgingKind, s.displayName, s.checkIn, s.checkOut, s.nights])).toEqual([
      [0, 'resort', 'Beach Club', '2027-12-15', '2027-12-20', 5],
      [1, 'resort', 'Polynesian Village', '2027-12-20', '2027-12-26', 6],
      [2, 'offsite', 'Aunt May', '2027-12-26', '2027-12-31', 5],
    ]);
    const rows = await fx.stayRows(trip);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => ymd(r['check_in'])).sort()).toEqual(['2027-12-15', '2027-12-20', '2027-12-26']);
    expect(await fx.tripResortIds(trip)).toEqual([beach, poly].sort());
  });

  it('keeps the id of a named stay when it is updated, creates unnamed ones, and deletes absent ones', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');

    const first = await put(fx, trip, '2027-12-15', '2027-12-31', [
      resortStay(beach, '2027-12-15', '2027-12-20'),
      resortStay(poly, '2027-12-20', '2027-12-26'),
    ]);
    const [a, b] = first;

    // Update `a` (new dates, still named), drop `b`, add an unnamed off-site stay.
    const second = await put(fx, trip, '2027-12-15', '2027-12-31', [
      resortStay(beach, '2027-12-15', '2027-12-18', a!.id),
      offsiteStay('Aunt May', '2027-12-26', '2027-12-31'),
    ]);

    const ids = (await fx.stayRows(trip)).map((r) => r['id']);
    expect(ids).toContain(a!.id);
    expect(ids).not.toContain(b!.id);
    expect(ids).toHaveLength(2);
    expect(second.find((s) => s.id === a!.id)?.checkOut).toBe('2027-12-18');
    expect(second.find((s) => s.lodgingKind === 'offsite')?.id).not.toBe(a!.id);
    // Poly was dropped, so only Beach Club remains in trip_resorts.
    expect(await fx.tripResortIds(trip)).toEqual([beach]);
  });

  it('reorders by writing the new array index into position and keeps ids', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');
    const [a, b] = await put(fx, trip, '2027-12-15', '2027-12-31', [resortStay(beach), resortStay(poly)]);

    await put(fx, trip, '2027-12-15', '2027-12-31', [resortStay(poly, undefined, undefined, b!.id), resortStay(beach, undefined, undefined, a!.id)]);

    const rows = await fx.stayRows(trip);
    const pos = new Map(rows.map((r) => [r['id'] as string, r['position'] as number]));
    expect(pos.get(b!.id)).toBe(0);
    expect(pos.get(a!.id)).toBe(1);
  });

  it('stores partyKeys as a JSON array and null for everyone, and returns them', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');

    const out = await put(fx, trip, '2027-12-15', '2027-12-31', [
      { ...resortStay(beach, '2027-12-15', '2027-12-20'), partyKeys: ['m:abc', 'g:def'] },
      offsiteStay('Aunt May', '2027-12-20', '2027-12-31'),
    ]);

    expect(out[0]?.partyKeys).toEqual(['m:abc', 'g:def']);
    expect(out[1]?.partyKeys).toBeNull();
    const reread = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip);
    expect(reread?.[0]?.partyKeys).toEqual(['m:abc', 'g:def']);
  });

  it('returns scheduled stays by check-in first, then unscheduled ones by position', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');

    const out = await put(fx, trip, '2027-12-15', '2027-12-31', [
      offsiteStay('Undated'),
      offsiteStay('Late', '2027-12-26', '2027-12-31'),
      resortStay(beach, '2027-12-15', '2027-12-20'),
    ]);

    expect(out.map((s) => s.displayName)).toEqual(['Beach Club', 'Late', 'Undated']);
    expect(out[2]?.nights).toBeNull();
  });

  describe('a rejected write changes nothing', () => {
    async function seeded() {
      const fx = makeStaysFixture();
      const user = await fx.seedUser();
      const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
      const otherTrip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
      const beach = await fx.seedResort('Beach Club');
      const poly = await fx.seedResort('Polynesian Village');
      const closed = await fx.seedResort('Closed Resort', false);
      const [a] = await put(fx, trip, '2027-12-15', '2027-12-31', [
        resortStay(beach, '2027-12-15', '2027-12-20'),
        offsiteStay('Aunt May', '2027-12-20', '2027-12-31'),
      ]);
      const [foreign] = await put(fx, otherTrip, '2027-12-15', '2027-12-31', [resortStay(poly, '2027-12-15', '2027-12-20')]);
      return { fx, trip, otherTrip, beach, poly, closed, a: a!, foreign: foreign! };
    }

    const cases: {
      name: string;
      field: string;
      build: (c: Awaited<ReturnType<typeof seeded>>) => Parameters<typeof replaceTripStays>[2];
    }[] = [
      {
        name: 'overlapping nights',
        field: 'stays[1]',
        build: (c) => [resortStay(c.beach, '2027-12-15', '2027-12-22'), offsiteStay('X', '2027-12-20', '2027-12-25')],
      },
      {
        name: 'an id that belongs to another Trip',
        field: 'stays[0].id',
        build: (c) => [resortStay(c.poly, '2027-12-15', '2027-12-20', c.foreign.id)],
      },
      {
        name: 'an id that is not on any Trip',
        field: 'stays[0].id',
        build: (c) => [resortStay(c.poly, '2027-12-15', '2027-12-20', randomUUID())],
      },
      {
        name: 'the same id twice',
        field: 'stays[1].id',
        build: (c) => [resortStay(c.beach, '2027-12-15', '2027-12-18', c.a.id), resortStay(c.beach, '2027-12-18', '2027-12-20', c.a.id)],
      },
      {
        name: 'an inactive resort',
        field: 'stays[0].resortId',
        build: (c) => [resortStay(c.closed, '2027-12-15', '2027-12-20')],
      },
      {
        name: 'a resort that does not exist',
        field: 'stays[1].resortId',
        build: () => [offsiteStay('X'), resortStay(randomUUID())],
      },
      {
        name: 'a resort stay with no resort id (invalid kind)',
        field: 'stays[0].resortId',
        build: () => [{ lodgingKind: 'resort' as const }],
      },
      {
        name: 'an off-site stay with no name (invalid kind)',
        field: 'stays[0].placeName',
        build: () => [{ lodgingKind: 'offsite' as const }],
      },
      {
        name: 'check-out on or before check-in',
        field: 'stays[0].checkOut',
        build: (c) => [resortStay(c.beach, '2027-12-20', '2027-12-20')],
      },
      {
        name: 'more than the stay limit',
        field: 'stays',
        build: () => Array.from({ length: 9 }, (_, i) => offsiteStay(`S${i}`)),
      },
    ];

    for (const c of cases) {
      it(`rejects ${c.name}`, async () => {
        const ctx = await seeded();
        const before = await snapshot(ctx.fx, ctx.trip);
        const otherBefore = await snapshot(ctx.fx, ctx.otherTrip);
        expect(before.stays).toHaveLength(2); // guard: the "unchanged" comparison is not over an empty set

        await expectRejected(put(ctx.fx, ctx.trip, '2027-12-15', '2027-12-31', c.build(ctx)), c.field);

        expect(await snapshot(ctx.fx, ctx.trip)).toEqual(before);
        expect(await snapshot(ctx.fx, ctx.otherTrip)).toEqual(otherBefore);
      });
    }
  });

  it('accepts stays outside the Trip dates and gaps between stays, and reports them as warnings only', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');

    await put(fx, trip, '2027-12-15', '2027-12-31', [
      resortStay(beach, '2027-12-10', '2027-12-17'),
      offsiteStay('Aunt May', '2027-12-25', '2027-12-31'),
    ]);

    const dto = await fx.repo.getTripForMember(trip);
    expect(dto?.stays).toHaveLength(2);
    expect(dto?.stayWarnings.map((w) => w.code).sort()).toEqual(['gap', 'outside_trip']);
  });

  it('cascades: deleting the Trip removes its stays', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const keep = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    await put(fx, trip, '2027-12-15', '2027-12-31', [offsiteStay('A', '2027-12-15', '2027-12-20')]);
    await put(fx, keep, '2027-12-15', '2027-12-31', [offsiteStay('B', '2027-12-15', '2027-12-20')]);

    await fx.pool.query(`DELETE FROM trips WHERE id = $1`, [trip]);

    expect(await fx.stayRows(trip)).toHaveLength(0);
    expect(await fx.stayRows(keep)).toHaveLength(1);
  });
});

describe('translateLegacyResortIds (pg-mem)', () => {
  async function setup() {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');
    const yacht = await fx.seedResort('Yacht Club');
    return { fx, user, trip, beach, poly, yacht };
  }

  it('changes no stay when the requested set equals the current resorts, and keeps trip_resorts in step', async () => {
    const { fx, trip, beach, poly } = await setup();
    const before = await put(fx, trip, '2027-12-15', '2027-12-31', [
      resortStay(beach, '2027-12-15', '2027-12-20'),
      resortStay(poly, '2027-12-20', '2027-12-26'),
    ]);

    await legacy(fx, trip, '2027-12-15', '2027-12-31', [poly, beach, poly]);

    const after = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip);
    expect(after).toEqual(before);
    expect(await fx.tripResortIds(trip)).toEqual([beach, poly].sort());
  });

  it('clears every stay (and trip_resorts) for an empty list, including off-site stays', async () => {
    const { fx, trip, beach } = await setup();
    await put(fx, trip, '2027-12-15', '2027-12-31', [resortStay(beach, '2027-12-15', '2027-12-20'), offsiteStay('Aunt May', '2027-12-20', '2027-12-31')]);

    await legacy(fx, trip, '2027-12-15', '2027-12-31', []);

    expect(await fx.stayRows(trip)).toHaveLength(0);
    expect(await fx.tripResortIds(trip)).toEqual([]);
  });

  it('turns one id into one resort stay spanning the Trip dates', async () => {
    const { fx, trip, beach } = await setup();

    await legacy(fx, trip, '2027-12-15', '2027-12-31', [beach]);

    const stays = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];
    expect(stays.map((s) => [s.lodgingKind, s.resortId, s.checkIn, s.checkOut])).toEqual([
      ['resort', beach, '2027-12-15', '2027-12-31'],
    ]);
    expect(await fx.tripResortIds(trip)).toEqual([beach]);
  });

  it('turns one id on a one-day Trip into an unscheduled stay', async () => {
    const { fx, user, beach } = await setup();
    const oneDay = await fx.seedTrip(user, '2027-12-15', '2027-12-15');

    await legacy(fx, oneDay, '2027-12-15', '2027-12-15', [beach]);

    const stays = (await selectTripStaysByTrip(fx.pool, [oneDay])).get(oneDay) ?? [];
    expect(stays.map((s) => [s.resortId, s.checkIn, s.checkOut])).toEqual([[beach, null, null]]);
  });

  it('turns several ids into that many unscheduled stays in the order given', async () => {
    const { fx, trip, beach, poly, yacht } = await setup();

    await legacy(fx, trip, '2027-12-15', '2027-12-31', [yacht, beach, poly]);

    const stays = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];
    expect(stays.map((s) => [s.position, s.resortId, s.checkIn])).toEqual([
      [0, yacht, null],
      [1, beach, null],
      [2, poly, null],
    ]);
    expect(await fx.tripResortIds(trip)).toEqual([beach, poly, yacht].sort());
  });

  it('rejects more distinct resort ids than the stay limit, changing nothing', async () => {
    const { fx, trip, beach } = await setup();
    await put(fx, trip, '2027-12-15', '2027-12-31', [resortStay(beach, '2027-12-15', '2027-12-31')]);
    const before = await snapshot(fx, trip);
    const nine: string[] = [];
    for (let i = 0; i < 9; i += 1) nine.push(await fx.seedResort(`Resort ${i}`));

    await expectRejected(legacy(fx, trip, '2027-12-15', '2027-12-31', nine), 'resortIds');
    expect(await snapshot(fx, trip)).toEqual(before);
    // Duplicates collapse first, so nine copies of one id are fine.
    await legacy(fx, trip, '2027-12-15', '2027-12-31', Array.from({ length: 9 }, () => nine[0]!));
    expect(await fx.tripResortIds(trip)).toEqual([nine[0]]);
  });

  it('replaces stays when the set differs, and rejects an inactive resort without changing anything', async () => {
    const { fx, trip, beach, poly } = await setup();
    const closed = await fx.seedResort('Closed', false);
    await put(fx, trip, '2027-12-15', '2027-12-31', [resortStay(beach, '2027-12-15', '2027-12-31')]);
    const before = await snapshot(fx, trip);

    await expectRejected(legacy(fx, trip, '2027-12-15', '2027-12-31', [poly, closed]), 'resortIds');
    expect(await snapshot(fx, trip)).toEqual(before);

    await legacy(fx, trip, '2027-12-15', '2027-12-31', [poly]);
    const stays = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];
    expect(stays.map((s) => s.resortId)).toEqual([poly]);
  });
});

describe('followTripDates (pg-mem)', () => {
  async function setup(stays: (c: { beach: string; poly: string }) => Parameters<typeof replaceTripStays>[2]) {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');
    await put(fx, trip, '2027-12-15', '2027-12-31', stays({ beach, poly }));
    return { fx, trip };
  }
  const run = (fx: StaysFixture, trip: string, newStart: string, newEnd: string) =>
    fx.inTransaction((c) =>
      followTripDates(c, trip, { startDate: '2027-12-15', endDate: '2027-12-31' }, { startDate: newStart, endDate: newEnd }),
    );
  const dates = async (fx: StaysFixture, trip: string) =>
    ((await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? []).map((s) => [s.displayName, s.checkIn, s.checkOut]);

  it('moves the single stay that matched the old Trip dates', async () => {
    const { fx, trip } = await setup(({ beach }) => [resortStay(beach, '2027-12-15', '2027-12-31')]);
    await run(fx, trip, '2027-12-10', '2028-01-02');
    expect(await dates(fx, trip)).toEqual([['Beach Club', '2027-12-10', '2028-01-02']]);
  });

  it('leaves a single stay that did not match the old Trip dates', async () => {
    const { fx, trip } = await setup(({ beach }) => [resortStay(beach, '2027-12-15', '2027-12-20')]);
    await run(fx, trip, '2027-12-10', '2028-01-02');
    expect(await dates(fx, trip)).toEqual([['Beach Club', '2027-12-15', '2027-12-20']]);
  });

  it('leaves two dated stays alone', async () => {
    const { fx, trip } = await setup(({ beach, poly }) => [
      resortStay(beach, '2027-12-15', '2027-12-20'),
      resortStay(poly, '2027-12-20', '2027-12-31'),
    ]);
    await run(fx, trip, '2027-12-10', '2028-01-02');
    expect(await dates(fx, trip)).toEqual([
      ['Beach Club', '2027-12-15', '2027-12-20'],
      ['Polynesian Village', '2027-12-20', '2027-12-31'],
    ]);
  });

  it('still moves the one dated stay when an unscheduled stay sits beside it', async () => {
    const { fx, trip } = await setup(({ beach, poly }) => [
      resortStay(beach, '2027-12-15', '2027-12-31'),
      resortStay(poly),
    ]);
    await run(fx, trip, '2027-12-10', '2028-01-02');
    expect(await dates(fx, trip)).toEqual([
      ['Beach Club', '2027-12-10', '2028-01-02'],
      ['Polynesian Village', null, null],
    ]);
  });

  it('leaves an unscheduled stay alone', async () => {
    const { fx, trip } = await setup(({ beach }) => [resortStay(beach)]);
    await run(fx, trip, '2027-12-10', '2028-01-02');
    expect(await dates(fx, trip)).toEqual([['Beach Club', null, null]]);
  });

  it('makes the stay unscheduled when the new Trip is a single day', async () => {
    const { fx, trip } = await setup(({ beach }) => [resortStay(beach, '2027-12-15', '2027-12-31')]);
    await run(fx, trip, '2027-12-20', '2027-12-20');
    expect(await dates(fx, trip)).toEqual([['Beach Club', null, null]]);
  });
});

describe('the Trip projection (repo + pg-mem)', () => {
  it('returns empty stays and warnings for a Trip with none', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.repo.createTrip(user, { name: 'T', description: '', startDate: '2027-12-15', endDate: '2027-12-20' });
    expect(trip.stays).toEqual([]);
    expect(trip.stayWarnings).toEqual([]);
    const reread = await fx.repo.getTripForMember(trip.id);
    expect(reread?.stays).toEqual([]);
    expect(reread?.stayWarnings).toEqual([]);
  });

  it('createTrip with resortIds creates a dated stay and returns it with trip_resorts in step', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const trip = await fx.repo.createTrip(user, {
      name: 'T',
      description: '',
      startDate: '2027-12-15',
      endDate: '2027-12-20',
      resortIds: [beach],
    });
    expect(trip.stays.map((s) => [s.displayName, s.checkIn, s.checkOut])).toEqual([['Beach Club', '2027-12-15', '2027-12-20']]);
    expect(trip.resorts).toEqual([{ id: beach, name: 'Beach Club' }]);
  });

  it('editTrip with resortIds translates them into stays using the NEW dates when both change', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const poly = await fx.seedResort('Polynesian Village');
    const trip = await fx.repo.createTrip(user, { name: 'T', description: '', startDate: '2027-12-15', endDate: '2027-12-20', resortIds: [beach] });

    const edited = await fx.repo.editTrip(trip.id, { startDate: '2027-12-14', endDate: '2027-12-22', resortIds: [poly] });

    expect(edited?.stays.map((s) => [s.displayName, s.checkIn, s.checkOut])).toEqual([['Polynesian Village', '2027-12-14', '2027-12-22']]);
    expect(await fx.tripResortIds(trip.id)).toEqual([poly]);
  });

  it('editTrip follows a date edit for the lone matching stay, even when resortIds is the same set', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const trip = await fx.repo.createTrip(user, { name: 'T', description: '', startDate: '2027-12-15', endDate: '2027-12-20', resortIds: [beach] });

    const edited = await fx.repo.editTrip(trip.id, { endDate: '2027-12-24', resortIds: [beach] });

    expect(edited?.stays.map((s) => [s.checkIn, s.checkOut])).toEqual([['2027-12-15', '2027-12-24']]);
    const reread = await fx.repo.getTripForMember(trip.id);
    expect(reread?.stays.map((s) => [s.checkIn, s.checkOut])).toEqual([['2027-12-15', '2027-12-24']]);
  });

  it('editTrip leaves two stays alone on a date edit and warns about a night outside the Trip', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const trip = await fx.repo.createTrip(user, { name: 'T', description: '', startDate: '2027-12-15', endDate: '2027-12-20' });
    await put(fx, trip.id, '2027-12-15', '2027-12-20', [resortStay(beach, '2027-12-15', '2027-12-17'), offsiteStay('Aunt May', '2027-12-17', '2027-12-20')]);

    const edited = await fx.repo.editTrip(trip.id, { endDate: '2027-12-18' });

    expect(edited?.stays.map((s) => [s.checkIn, s.checkOut])).toEqual([
      ['2027-12-15', '2027-12-17'],
      ['2027-12-17', '2027-12-20'],
    ]);
    expect(edited?.stayWarnings.map((w) => w.code)).toEqual(['outside_trip']);
  });

  it('batches: listing three Trips issues ONE stays statement and each Trip gets only its own stays', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const ids: string[] = [];
    for (const n of [0, 2, 3]) {
      const t = await fx.repo.createTrip(user, { name: `T${n}`, description: '', startDate: '2027-12-15', endDate: '2027-12-31' });
      ids.push(t.id);
      const stays = Array.from({ length: n }, (_, i) =>
        i === 0 ? resortStay(beach, '2027-12-15', '2027-12-18') : offsiteStay(`${t.id.slice(0, 4)}-${i}`, `2027-12-${18 + i}`, `2027-12-${19 + i}`),
      );
      if (n > 0) await put(fx, t.id, '2027-12-15', '2027-12-31', stays);
    }

    fx.statements.length = 0;
    const groups = await fx.repo.listMyTrips(user, new Date('2027-12-16T12:00:00Z'));
    const trips = groups.flatMap((g) => g.trips);

    expect(trips).toHaveLength(3);
    expect(trips.map((t) => t.stays.length).sort()).toEqual([0, 2, 3]);
    for (const t of trips) {
      const own = t.stays.length;
      expect(own).toBe(Number(t.name.slice(1)));
    }
    const staysReads = fx.statements.filter((s) => /FROM trip_stays/iu.test(s) && !/LIMIT 0/iu.test(s));
    expect(staysReads).toHaveLength(1);
  });
});

describe('TripRepo.replaceStays', () => {
  it('answers trip_not_found for a Trip that does not exist and writes nothing', async () => {
    const fx = makeStaysFixture();
    const err = await fx.repo.replaceStays(randomUUID(), [offsiteStay('A', '2027-12-15', '2027-12-16')]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('trip_not_found');
    const all = await fx.pool.query(`SELECT id FROM trip_stays`);
    expect(all.rows).toHaveLength(0);
  });

  it('returns the saved stays with their warnings, computed against the stored Trip dates', async () => {
    const fx = makeStaysFixture();
    const user = await fx.seedUser();
    const trip = await fx.seedTrip(user, '2027-12-15', '2027-12-31');
    const res = await fx.repo.replaceStays(trip, [offsiteStay('A', '2027-12-15', '2027-12-20')]);
    expect(res.stays.map((s) => s.displayName)).toEqual(['A']);
    expect(res.stayWarnings).toEqual([{ code: 'trip_not_covered', from: '2027-12-20', to: '2027-12-31' }]);
  });
});

describe('without the trip_stays table (older migration lists)', () => {
  it('probes false once and every Trip read and write behaves exactly as before', async () => {
    const fx = makeStaysFixture({ withStays: false });
    expect(await isTripStaysAvailable(fx.pool)).toBe(false);

    const user = await fx.seedUser();
    const beach = await fx.seedResort('Beach Club');
    const trip = await fx.repo.createTrip(user, { name: 'T', description: '', startDate: '2027-12-15', endDate: '2027-12-20', resortIds: [beach] });
    expect(trip.stays).toEqual([]);
    expect(trip.stayWarnings).toEqual([]);
    expect(trip.resorts).toEqual([{ id: beach, name: 'Beach Club' }]);

    const edited = await fx.repo.editTrip(trip.id, { endDate: '2027-12-24', resortIds: [] });
    expect(edited?.resorts).toEqual([]);
    expect(edited?.stays).toEqual([]);

    const groups = await fx.repo.listMyTrips(user, new Date('2027-12-16T12:00:00Z'));
    expect(groups.flatMap((g) => g.trips).every((t) => t.stays.length === 0)).toBe(true);
  });
});
