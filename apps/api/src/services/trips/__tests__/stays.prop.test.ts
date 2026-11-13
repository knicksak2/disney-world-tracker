/**
 * Property tests for the Trip lodging Stays repo (trip-lodging-stays task 4), over pg-mem with the real `0073` DDL.
 * One fixture is shared across runs and every run uses its own Trip, so the generators stay cheap.
 *
 * Properties 4, 5, 6, 7 and 15. The "two concurrent PUTs" half of Property 7 is pinned in the route test (task 5):
 * pg-mem is single-connection and strips `FOR UPDATE`, so it cannot show lock serialization.
 */

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TripStayInput } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { replaceTripStays, selectTripStaysByTrip, translateLegacyResortIds } from '../stays.js';
import { makeStaysFixture, type StaysFixture } from './staysFixture.js';

const RUNS = 100;
const BASE = Date.UTC(2027, 11, 10); // 2027-12-10

const dayAt = (offset: number): string => new Date(BASE + offset * 86_400_000).toISOString().slice(0, 10);
const ymd = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

let fx: StaysFixture;
let user: string;
/** Three active resorts plus one inactive; names sort Alpha < Bravo < Charlie. */
let resorts: string[];
let inactive: string;
let userN = 0;

beforeAll(async () => {
  fx = makeStaysFixture();
  user = await fx.seedUser();
  resorts = [await fx.seedResort('Alpha'), await fx.seedResort('Bravo'), await fx.seedResort('Charlie')];
  inactive = await fx.seedResort('Zulu Closed', false);
});

async function newTrip(startOffset: number, endOffset: number, name = 'T'): Promise<string> {
  userN += 1;
  const trip = await fx.repo.createTrip(user, {
    name: `${name}${userN}`,
    description: '',
    startDate: dayAt(startOffset),
    endDate: dayAt(endOffset),
  });
  return trip.id;
}

const put = (tripId: string, startOffset: number, endOffset: number, stays: readonly TripStayInput[]) =>
  fx.inTransaction((c) =>
    replaceTripStays(c, { id: tripId, startDate: dayAt(startOffset), endDate: dayAt(endOffset) }, stays),
  );

async function distinctStayResorts(tripId: string): Promise<string[]> {
  const rows = await fx.stayRows(tripId);
  return [...new Set(rows.map((r) => r['resort_id']).filter((v): v is string => typeof v === 'string'))].sort();
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A stay spec before ids are resolved: kind, which resort (3 = the inactive one), name, and optional [start, nights]. */
interface StaySpec {
  readonly resort: 0 | 1 | 2 | 3 | null; // null = off-site
  readonly dated: { readonly start: number; readonly nights: number } | null;
}

const resortIndex = fc.constantFrom<0 | 1 | 2>(0, 1, 2);
const datedArb = fc.record({ start: fc.integer({ min: 0, max: 20 }), nights: fc.integer({ min: 1, max: 8 }) });

/** Mostly valid, non-overlapping layouts; sometimes arbitrary ones that overlap or use the inactive resort. */
const staySpecsArb: fc.Arbitrary<StaySpec[]> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .array(
        fc.record({
          resort: fc.oneof(resortIndex, fc.constant(null)),
          gap: fc.integer({ min: 0, max: 2 }),
          nights: fc.integer({ min: 1, max: 6 }),
          dated: fc.boolean(),
        }),
        { maxLength: 4 },
      )
      .map((parts) => {
        let cursor = 2;
        return parts.map<StaySpec>((p) => {
          cursor += p.gap;
          const start = cursor;
          cursor += p.nights;
          return { resort: p.resort, dated: p.dated ? { start, nights: p.nights } : null };
        });
      }),
  },
  {
    weight: 1,
    arbitrary: fc.array(
      fc.record({
        resort: fc.oneof(resortIndex, fc.constant(3 as const), fc.constant(null)),
        dated: fc.oneof(datedArb, fc.constant(null)),
      }),
      { maxLength: 4 },
    ),
  },
);

function toInput(spec: StaySpec, i: number, id?: string): TripStayInput {
  const dates = spec.dated ? { checkIn: dayAt(spec.dated.start), checkOut: dayAt(spec.dated.start + spec.dated.nights) } : {};
  return spec.resort === null
    ? { lodgingKind: 'offsite', placeName: `Place ${i}`, ...dates, ...(id ? { id } : {}) }
    : { lodgingKind: 'resort', resortId: spec.resort === 3 ? inactive : (resorts[spec.resort] as string), ...dates, ...(id ? { id } : {}) };
}

const resortSetArb = fc.array(fc.constantFrom(0, 1, 2), { maxLength: 5 });

// ---------------------------------------------------------------------------

describe('Trip stays (property tests over pg-mem)', () => {
  // Feature: trip-lodging-stays, Property 4: trip_resorts always equals the resorts of the stays
  it('Property 4: trip_resorts equals the distinct resorts of the stays after every step; a rejected step changes nothing', async () => {
    type Op =
      | { kind: 'put'; specs: StaySpec[] }
      | { kind: 'legacy'; ids: number[] }
      | { kind: 'dates'; start: number; length: number };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ kind: fc.constant('put' as const), specs: staySpecsArb }),
      fc.record({ kind: fc.constant('legacy' as const), ids: resortSetArb }),
      fc.record({ kind: fc.constant('dates' as const), start: fc.integer({ min: 0, max: 6 }), length: fc.integer({ min: 0, max: 20 }) }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 5 }), async (ops) => {
        const trip = await newTrip(0, 15);
        let start = 0;
        let end = 15;
        for (const op of ops) {
          const before = { stays: await fx.stayRows(trip), resorts: await fx.tripResortIds(trip) };
          try {
            if (op.kind === 'put') {
              await put(trip, start, end, op.specs.map((s, i) => toInput(s, i)));
            } else if (op.kind === 'legacy') {
              await fx.inTransaction((c) =>
                translateLegacyResortIds(c, { id: trip, startDate: dayAt(start), endDate: dayAt(end) }, op.ids.map((i) => resorts[i] as string)),
              );
            } else {
              const next = { start: op.start, end: op.start + op.length };
              await fx.repo.editTrip(trip, { startDate: dayAt(next.start), endDate: dayAt(next.end) });
              start = next.start;
              end = next.end;
            }
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect({ stays: await fx.stayRows(trip), resorts: await fx.tripResortIds(trip) }).toEqual(before);
          }
          expect(await fx.tripResortIds(trip)).toEqual(await distinctStayResorts(trip));
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 5: The legacy resort write translates as specified
  it('Property 5: an equal set changes nothing, empty clears, one id spans the Trip, several are undated in order', async () => {
    await fc.assert(
      fc.asyncProperty(staySpecsArb, resortSetArb, fc.integer({ min: 0, max: 9 }), async (specs, idxs, tripLength) => {
        const trip = await newTrip(0, tripLength);
        try {
          await put(trip, 0, tripLength, specs.map((s, i) => toInput(s, i)));
        } catch (err) {
          expect(err).toBeInstanceOf(AppError); // an invalid layout is rejected whole, so the Trip starts with no stays
        }
        const requested = idxs.map((i) => resorts[i] as string);
        const distinct = [...new Set(requested)];
        const current = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];
        const currentSet = new Set(current.filter((s) => s.lodgingKind === 'resort').map((s) => s.resortId as string));

        const edited = await fx.repo.editTrip(trip, { resortIds: requested });
        const after = edited?.stays ?? [];

        if (distinct.length === currentSet.size && distinct.every((id) => currentSet.has(id))) {
          expect(after).toEqual(current);
        } else if (distinct.length === 0) {
          expect(after).toEqual([]);
        } else if (distinct.length === 1) {
          const dated = tripLength > 0;
          expect(after.map((s) => [s.lodgingKind, s.resortId, s.checkIn, s.checkOut])).toEqual([
            ['resort', distinct[0], dated ? dayAt(0) : null, dated ? dayAt(tripLength) : null],
          ]);
        } else {
          expect(after.map((s) => [s.position, s.lodgingKind, s.resortId, s.checkIn, s.checkOut])).toEqual(
            distinct.map((id, i) => [i, 'resort', id, null, null]),
          );
        }
        // The projected resorts are exactly the requested set, ordered by name as before (Alpha < Bravo < Charlie).
        const wantNames = distinct.map((id) => ['Alpha', 'Bravo', 'Charlie'][resorts.indexOf(id)] as string).sort();
        expect((edited?.resorts ?? []).map((r) => r.name)).toEqual(wantNames);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 6: Trip-date follow moves only the matching single stay
  it('Property 6: only a lone dated stay equal to the old Trip dates follows a date edit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.array(fc.record({ start: fc.integer({ min: 0, max: 12 }), nights: fc.integer({ min: 1, max: 4 }), dated: fc.boolean() }), { maxLength: 3 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 12 }),
        async (tripNights, extras, includeMatching, newStart, newLength) => {
          const trip = await newTrip(0, tripNights);
          // Non-overlapping layout: the matching stay (if any) spans the Trip, the extras sit after it.
          const inputs: TripStayInput[] = [];
          let cursor = 0;
          if (includeMatching) {
            inputs.push({ lodgingKind: 'offsite', placeName: 'Match', checkIn: dayAt(0), checkOut: dayAt(tripNights) });
            cursor = tripNights;
          }
          extras.forEach((e, i) => {
            const start = cursor + e.start;
            inputs.push(
              e.dated
                ? { lodgingKind: 'offsite', placeName: `E${i}`, checkIn: dayAt(start), checkOut: dayAt(start + e.nights) }
                : { lodgingKind: 'offsite', placeName: `E${i}` },
            );
            cursor = start + e.nights;
          });
          await put(trip, 0, tripNights, inputs);
          const before = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];
          const datedBefore = before.filter((s) => s.checkIn !== null);

          await fx.repo.editTrip(trip, { startDate: dayAt(newStart), endDate: dayAt(newStart + newLength) });
          const after = (await selectTripStaysByTrip(fx.pool, [trip])).get(trip) ?? [];

          const lone = datedBefore.length === 1 ? datedBefore[0] : undefined;
          const follows = lone !== undefined && lone.checkIn === dayAt(0) && lone.checkOut === dayAt(tripNights);
          const byName = (list: typeof after) => new Map(list.map((s) => [s.displayName, [s.checkIn, s.checkOut]]));
          for (const [name, dates] of byName(before)) {
            if (follows && lone!.displayName === name) {
              const dated = newLength > 0;
              expect(byName(after).get(name)).toEqual(dated ? [dayAt(newStart), dayAt(newStart + newLength)] : [null, null]);
            } else {
              expect(byName(after).get(name)).toEqual(dates);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 7: Replace preserves ids and is atomic
  it('Property 7: named stays keep their id and row, absent ones are deleted, unnamed ones are created, foreign ids change nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        staySpecsArb,
        fc.array(fc.record({ keep: fc.boolean(), spec: staySpecsArb.map((l) => l[0] ?? { resort: null, dated: null }) }), { maxLength: 4 }),
        fc.boolean(),
        async (initial, body, useForeignId) => {
          const trip = await newTrip(0, 40);
          const other = await newTrip(0, 40);
          let seeded: Awaited<ReturnType<typeof put>> = [];
          try {
            seeded = await put(trip, 0, 40, initial.map((s, i) => toInput(s, i)));
          } catch {
            return; // invalid initial layout: nothing to replace
          }
          const otherStays = await put(other, 0, 40, [{ lodgingKind: 'offsite', placeName: 'Other', checkIn: dayAt(30), checkOut: dayAt(32) }]);

          // Name existing stays for entries flagged `keep`, in order, each at most once.
          const pool = [...seeded];
          const inputs: TripStayInput[] = body.map((b, i) => {
            const named = b.keep ? pool.shift() : undefined;
            // Space the entries 10 days apart so most bodies are valid; the generator's own dates would all collide.
            const spaced: StaySpec = { ...b.spec, dated: b.spec.dated ? { start: i * 10 + 1, nights: Math.min(b.spec.dated.nights, 8) } : null };
            return toInput(spaced, 100 + i, named?.id);
          });
          if (useForeignId && inputs.length > 0) inputs[0] = { ...inputs[0]!, id: otherStays[0]!.id };

          const before = { stays: await fx.stayRows(trip), resorts: await fx.tripResortIds(trip), other: await fx.stayRows(other) };
          let result: Awaited<ReturnType<typeof put>> | null = null;
          try {
            result = await put(trip, 0, 40, inputs);
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
          }

          if (result === null) {
            expect({ stays: await fx.stayRows(trip), resorts: await fx.tripResortIds(trip), other: await fx.stayRows(other) }).toEqual(before);
            return;
          }
          expect(useForeignId && inputs.length > 0).toBe(false);
          const rows = await fx.stayRows(trip);
          expect(rows).toHaveLength(inputs.length);
          const ids = new Set(rows.map((r) => r['id'] as string));
          for (const s of seeded) {
            const named = inputs.some((i) => i.id === s.id);
            expect(ids.has(s.id)).toBe(named);
          }
          for (const [i, input] of inputs.entries()) {
            const row = rows.find((r) => r['position'] === i);
            expect(row?.['lodging_kind']).toBe(input.lodgingKind);
            expect(ymd(row?.['check_in'])).toBe(input.checkIn ?? null);
            if (input.id) expect(row?.['id']).toBe(input.id);
          }
          expect(await fx.stayRows(other)).toEqual(before.other);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 15: The Trip read path stays batched
  it('Property 15: listing N Trips issues one stays statement and each Trip gets only its own stays', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 4 }), async (counts) => {
        const ids: string[] = [];
        const wanted = new Map<string, string[]>();
        const owner = await fx.seedUser('Lister');
        for (const [n, count] of counts.entries()) {
          const t = await fx.repo.createTrip(owner, { name: `L${n}`, description: '', startDate: dayAt(0), endDate: dayAt(30) });
          ids.push(t.id);
          const specs = Array.from({ length: count }, (_, i) => ({ resort: null, dated: { start: i * 3, nights: 2 } }) as StaySpec);
          const names = specs.map((_, i) => `Place ${i}`);
          if (count > 0) await put(t.id, 0, 30, specs.map((s, i) => toInput(s, i)));
          wanted.set(t.id, names);
        }

        fx.statements.length = 0;
        const groups = await fx.repo.listMyTrips(owner, new Date('2027-12-12T12:00:00Z'));
        const trips = groups.flatMap((g) => g.trips);

        expect(trips).toHaveLength(counts.length);
        for (const t of trips) {
          expect(t.stays.map((s) => s.displayName)).toEqual(wanted.get(t.id));
          expect(t.stays.every((s) => s.id.length > 0)).toBe(true);
        }
        const reads = fx.statements.filter((s) => /FROM trip_stays/iu.test(s) && !/LIMIT 0/iu.test(s));
        expect(reads).toHaveLength(1);
      }),
      { numRuns: RUNS },
    );
  });
});
