// Feature: trip-lodging-stays, properties 1, 2, 3, 8, 9 and 16 for the shared tripStays module.
// Oracles below are brute force over explicit night sets; they deliberately do not reuse the module's own helpers
// (other than the date arithmetic in tripBooking, which has its own tests).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  TRIP_STAY_LIMIT,
  TRIP_STAY_MAX_NIGHTS,
  TRIP_STAY_SPAN_MAX_DAYS,
  addCalendarDays,
  computeStayWarnings,
  diffCalendarDays,
  effectiveStays,
  stayForNight,
  tonightsStay,
  tripStayInputSchema,
  tripStaysPutSchema,
  validateStays,
  type StayRecord,
} from '../index.js';

const NUM_RUNS = 100;
const BASE = '2027-03-01';
const day = (offset: number): string => addCalendarDays(BASE, offset);

/** Explicit nights of [checkIn, checkOut) computed by stepping, independent of the module. */
function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut; d = addCalendarDays(d, 1)) out.push(d);
  return out;
}

const tripArb = fc
  .record({ start: fc.integer({ min: 0, max: 40 }), length: fc.integer({ min: 0, max: 30 }) })
  .map(({ start, length }) => ({ startDate: day(start), endDate: day(start + length) }));

interface RawStay {
  readonly dated: boolean;
  readonly inOffset: number;
  readonly nights: number;
  readonly position: number;
  readonly kind: 'resort' | 'partner_hotel' | 'offsite';
}

const rawStayArb: fc.Arbitrary<RawStay> = fc.record({
  dated: fc.boolean(),
  inOffset: fc.integer({ min: -10, max: 70 }),
  nights: fc.integer({ min: 1, max: 20 }),
  position: fc.integer({ min: 0, max: 7 }),
  kind: fc.constantFrom('resort', 'partner_hotel', 'offsite'),
});

function toRecords(raw: readonly RawStay[]): StayRecord[] {
  return raw.map((r, i) => ({
    id: `stay-${String(i).padStart(2, '0')}`,
    position: r.position,
    lodgingKind: r.kind,
    resortId: r.kind === 'resort' ? `resort-${i}` : null,
    displayName: `Hotel ${i}`,
    checkIn: r.dated ? day(r.inOffset) : null,
    checkOut: r.dated ? day(r.inOffset + r.nights) : null,
    partyKeys: null,
  }));
}

const staysArb = fc.array(rawStayArb, { maxLength: 6 }).map(toRecords);

describe('Property 1: the resolver is total, ordered and consistent with its source data', () => {
  // Feature: trip-lodging-stays, Property 1: The resolver is total, ordered and consistent with its source data
  it('never throws, is ordered, and matches the shape rules for none, undated and dated stays', () => {
    fc.assert(
      fc.property(tripArb, staysArb, (trip, stays) => {
        const result = effectiveStays(trip, stays);
        expect(result.length).toBeGreaterThan(0);

        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1]!.checkIn <= result[i]!.checkIn).toBe(true);
        }
        for (const s of result) {
          expect(s.nights).toBe(Math.max(0, diffCalendarDays(s.checkOut, s.checkIn)));
        }

        const dated = stays.filter((s) => s.checkIn !== null && s.checkOut !== null);
        if (stays.length === 0) {
          expect(result).toHaveLength(1);
          expect(result[0]).toMatchObject({
            source: 'implicit_no_lodging',
            lodgingKind: 'offsite',
            checkIn: trip.startDate,
            checkOut: trip.endDate,
          });
        } else if (dated.length === 0) {
          expect(result).toHaveLength(1);
          const first = [...stays].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0]!;
          expect(result[0]).toMatchObject({
            source: 'legacy_resorts',
            displayName: first.displayName,
            lodgingKind: first.lodgingKind,
            checkIn: trip.startDate,
            checkOut: trip.endDate,
          });
        } else {
          const fromStays = result.filter((s) => s.source === 'stay');
          expect(fromStays).toHaveLength(dated.length);
          for (const d of dated) {
            const match = fromStays.find((s) => s.id === d.id);
            expect(match).toBeDefined();
            expect(match).toMatchObject({
              checkIn: d.checkIn,
              checkOut: d.checkOut,
              displayName: d.displayName,
              lodgingKind: d.lodgingKind,
            });
          }
          for (const s of result.filter((x) => x.source !== 'stay')) {
            expect(s.source).toBe('implicit_gap');
            expect(s.lodgingKind).toBe('offsite');
            expect(s.id).toBeNull();
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 2: gap filling covers every uncovered trip night exactly once', () => {
  // Feature: trip-lodging-stays, Property 2: Gap filling covers every uncovered Trip night exactly once
  it('covers uncovered nights with maximal gap runs and never a night a stay covers', () => {
    fc.assert(
      fc.property(tripArb, staysArb, (trip, stays) => {
        const dated = stays.filter((s) => s.checkIn !== null && s.checkOut !== null);
        fc.pre(dated.length > 0);

        const stayNights = new Set(dated.flatMap((s) => nightsOf(s.checkIn!, s.checkOut!)));
        const result = effectiveStays(trip, stays);
        const gaps = result.filter((s) => s.source === 'implicit_gap');
        const gapNights = gaps.flatMap((g) => nightsOf(g.checkIn, g.checkOut));

        // No gap night is covered by a stay, and no gap night is listed twice.
        for (const n of gapNights) expect(stayNights.has(n)).toBe(false);
        expect(new Set(gapNights).size).toBe(gapNights.length);

        // Every trip night is covered by a stay or a gap.
        const gapSet = new Set(gapNights);
        for (const n of nightsOf(trip.startDate, trip.endDate)) {
          expect(stayNights.has(n) || gapSet.has(n)).toBe(true);
        }

        // Every gap night is a trip night.
        const tripNights = new Set(nightsOf(trip.startDate, trip.endDate));
        for (const n of gapNights) expect(tripNights.has(n)).toBe(true);

        // Each gap is a maximal run: the night just before and just after it is not an uncovered trip night.
        for (const g of gaps) {
          const before = addCalendarDays(g.checkIn, -1);
          const after = g.checkOut;
          expect(tripNights.has(before) && !stayNights.has(before)).toBe(false);
          expect(tripNights.has(after) && !stayNights.has(after)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 3: validation accepts exactly the valid sets', () => {
  // Feature: trip-lodging-stays, Property 3: Stay validation accepts exactly the valid sets
  const rawDateStayArb = fc.record({
    dated: fc.boolean(),
    inOffset: fc.integer({ min: 0, max: 130 }),
    nights: fc.integer({ min: -3, max: 70 }), // includes inverted and equal dates, and more than 60 nights
  });
  const listArb = fc.array(rawDateStayArb, { maxLength: 10 }).map((raw) =>
    raw.map((r) => ({
      checkIn: r.dated ? day(r.inOffset) : null,
      checkOut: r.dated ? day(r.inOffset + r.nights) : null,
    })),
  );

  it('reports each error code exactly when its brute-force condition holds, independent of order', () => {
    fc.assert(
      fc.property(listArb, (stays) => {
        const codes = new Set(validateStays(stays).map((e) => e.code));

        expect(codes.has('count_exceeded')).toBe(stays.length > TRIP_STAY_LIMIT);

        const dated = stays.filter((s) => s.checkIn !== null && s.checkOut !== null);
        const inverted = dated.some((s) => s.checkOut! <= s.checkIn!);
        expect(codes.has('dates_inverted')).toBe(inverted);
        expect(codes.has('dates_incomplete')).toBe(false); // the generator never produces a single date

        const valid = dated.filter((s) => s.checkOut! > s.checkIn!);
        expect(codes.has('nights_exceeded')).toBe(
          valid.some((s) => diffCalendarDays(s.checkOut!, s.checkIn!) > TRIP_STAY_MAX_NIGHTS),
        );

        let sharesANight = false;
        for (let i = 0; i < valid.length && !sharesANight; i++) {
          const a = new Set(nightsOf(valid[i]!.checkIn!, valid[i]!.checkOut!));
          for (let j = i + 1; j < valid.length; j++) {
            if (nightsOf(valid[j]!.checkIn!, valid[j]!.checkOut!).some((n) => a.has(n))) {
              sharesANight = true;
              break;
            }
          }
        }
        expect(codes.has('overlap')).toBe(sharesANight);

        if (valid.length > 0) {
          const first = valid.reduce((m, s) => (s.checkIn! < m ? s.checkIn! : m), valid[0]!.checkIn!);
          const last = valid.reduce((m, s) => (s.checkOut! > m ? s.checkOut! : m), valid[0]!.checkOut!);
          expect(codes.has('span_exceeded')).toBe(diffCalendarDays(last, first) > TRIP_STAY_SPAN_MAX_DAYS);
        } else {
          expect(codes.has('span_exceeded')).toBe(false);
        }

        // Reversing the input changes only the indexes, never which codes are reported.
        const reversed = new Set(validateStays([...stays].reverse()).map((e) => e.code));
        expect([...reversed].sort()).toEqual([...codes].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never reports an overlap for stays chained end to end (hand-off dates are shared)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 8 }), (lengths) => {
        let cursor = 0;
        const chain = lengths.map((n) => {
          const stay = { checkIn: day(cursor), checkOut: day(cursor + n) };
          cursor += n;
          return stay;
        });
        expect(validateStays(chain).map((e) => e.code)).not.toContain('overlap');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never produces a date error for undated stays', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: TRIP_STAY_LIMIT }), (count) => {
        expect(validateStays(Array.from({ length: count }, () => ({ checkIn: null, checkOut: null })))).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 8: warnings are exactly the documented findings', () => {
  // Feature: trip-lodging-stays, Property 8: Warnings are exactly the documented findings
  it('matches a brute-force classification of uncovered nights, outside nights and undated stays', () => {
    fc.assert(
      fc.property(tripArb, staysArb, (trip, stays) => {
        const warnings = computeStayWarnings(trip, stays);
        const dated = stays.filter((s) => s.checkIn !== null && s.checkOut !== null);

        const unscheduled = warnings.filter((w) => w.code === 'unscheduled');
        expect(unscheduled.map((w) => w.stayId).sort()).toEqual(
          stays.filter((s) => s.checkIn === null).map((s) => s.id).sort(),
        );

        if (dated.length === 0) {
          expect(warnings).toEqual(unscheduled);
          return;
        }

        const covered = new Set(dated.flatMap((s) => nightsOf(s.checkIn!, s.checkOut!)));
        const tripNights = nightsOf(trip.startDate, trip.endDate);
        const uncovered = tripNights.filter((n) => !covered.has(n));
        const coveredList = [...covered];

        // Group uncovered nights into runs and classify each by whether a covered night exists on both sides.
        const expectedRuns: { code: string; from: string; to: string }[] = [];
        let i = 0;
        while (i < uncovered.length) {
          let j = i;
          while (j + 1 < uncovered.length && uncovered[j + 1] === addCalendarDays(uncovered[j]!, 1)) j++;
          const from = uncovered[i]!;
          const lastNight = uncovered[j]!;
          const hasBefore = coveredList.some((n) => n < from);
          const hasAfter = coveredList.some((n) => n > lastNight);
          expectedRuns.push({
            code: hasBefore && hasAfter ? 'gap' : 'trip_not_covered',
            from,
            to: addCalendarDays(lastNight, 1),
          });
          i = j + 1;
        }
        const actualRuns = warnings.filter((w) => w.code === 'gap' || w.code === 'trip_not_covered');
        expect(actualRuns.map((w) => ({ code: w.code, from: w.from, to: w.to }))).toEqual(expectedRuns);

        const tripNightSet = new Set(tripNights);
        const expectedOutside = dated
          .filter((s) => nightsOf(s.checkIn!, s.checkOut!).some((n) => !tripNightSet.has(n)))
          .map((s) => s.id)
          .sort();
        expect(
          warnings
            .filter((w) => w.code === 'outside_trip')
            .map((w) => w.stayId)
            .sort(),
        ).toEqual(expectedOutside);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns nothing for a single dated stay equal to the trip dates', () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        fc.pre(trip.endDate > trip.startDate);
        const only: StayRecord = {
          id: 'only',
          position: 0,
          lodgingKind: 'resort',
          resortId: 'r',
          displayName: 'Only',
          checkIn: trip.startDate,
          checkOut: trip.endDate,
          partyKeys: null,
        };
        expect(computeStayWarnings(trip, [only])).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 9: tonight's stay follows the nights", () => {
  // Feature: trip-lodging-stays, Property 9: Tonight's stay follows the nights
  const chainArb = fc
    .array(fc.record({ nights: fc.integer({ min: 1, max: 8 }), gap: fc.integer({ min: 0, max: 3 }) }), {
      minLength: 1,
      maxLength: 5,
    })
    .map((parts) => {
      let cursor = 0;
      const stays: StayRecord[] = parts.map((p, i) => {
        cursor += p.gap;
        const checkIn = day(cursor);
        cursor += p.nights;
        return {
          id: `c${i}`,
          position: i,
          lodgingKind: 'resort',
          resortId: `r${i}`,
          displayName: `Hotel ${i}`,
          checkIn,
          checkOut: day(cursor),
          partyKeys: null,
        };
      });
      return stays;
    });

  it('returns the segment whose half-open range contains the date, and null otherwise', () => {
    fc.assert(
      fc.property(chainArb, fc.integer({ min: -3, max: 60 }), (stays, offset) => {
        const trip = { startDate: stays[0]!.checkIn!, endDate: stays[stays.length - 1]!.checkOut! };
        const eff = effectiveStays(trip, stays);
        const date = day(offset);

        const expected = eff.find((s) => nightsOf(s.checkIn, s.checkOut).includes(date)) ?? null;
        expect(stayForNight(eff, date)).toEqual(expected);

        const tonight = tonightsStay(eff, date);
        if (expected !== null) {
          expect(tonight).toEqual(expected);
        } else {
          const leaving = eff.find((s) => s.checkOut === date) ?? null;
          expect(tonight).toEqual(leaving);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('names the incoming stay on a hand-off date and the stay being left on the final check-out date', () => {
    fc.assert(
      fc.property(chainArb, (stays) => {
        const trip = { startDate: stays[0]!.checkIn!, endDate: stays[stays.length - 1]!.checkOut! };
        const eff = effectiveStays(trip, stays).filter((s) => s.source === 'stay');

        for (let i = 0; i + 1 < eff.length; i++) {
          if (eff[i]!.checkOut === eff[i + 1]!.checkIn) {
            expect(tonightsStay(eff, eff[i]!.checkOut)?.id).toBe(eff[i + 1]!.id);
          }
        }
        const last = eff[eff.length - 1]!;
        expect(tonightsStay(eff, last.checkOut)?.id).toBe(last.id);
        expect(tonightsStay(eff, addCalendarDays(last.checkOut, 1))).toBeNull();
        expect(tonightsStay(eff, addCalendarDays(eff[0]!.checkIn, -1))).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 16: schemas round-trip and reject malformed input', () => {
  // Feature: trip-lodging-stays, Property 16: Schemas round-trip and reject malformed input
  const keyArb = fc
    .tuple(fc.constantFrom('m', 'g'), fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/u))
    .map(([kind, id]) => `${kind}:${id}`);
  const nameArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.'&-]{0,98}[A-Za-z0-9]$/u);
  const datesArb = fc.oneof(
    fc.constant({} as { checkIn?: string; checkOut?: string }),
    fc.integer({ min: 0, max: 200 }).chain((start) =>
      fc.integer({ min: 1, max: 60 }).map((n) => ({ checkIn: day(start), checkOut: day(start + n) })),
    ),
  );
  const partyArb = fc.option(fc.array(keyArb, { maxLength: 50 }), { nil: undefined });

  // A loose record on purpose: the tests below add, remove and corrupt individual fields to probe the schema.
  type StayShape = Record<string, unknown>;
  const validStayArb: fc.Arbitrary<StayShape> = fc.oneof(
    fc
      .tuple(fc.uuid(), datesArb, partyArb)
      .map(([resortId, dates, partyKeys]): StayShape => ({ lodgingKind: 'resort', resortId, ...dates, ...(partyKeys ? { partyKeys } : {}) })),
    fc
      .tuple(fc.constantFrom('partner_hotel', 'offsite'), nameArb, datesArb, partyArb)
      .map(([lodgingKind, placeName, dates, partyKeys]): StayShape => ({ lodgingKind, placeName, ...dates, ...(partyKeys ? { partyKeys } : {}) })),
  );

  it('parse, serialize and parse again yields an equal value for any valid input', () => {
    fc.assert(
      fc.property(fc.array(validStayArb, { maxLength: TRIP_STAY_LIMIT }), (stays) => {
        const first = tripStaysPutSchema.safeParse({ stays });
        expect(first.success).toBe(true);
        if (!first.success) return;
        const second = tripStaysPutSchema.safeParse(JSON.parse(JSON.stringify(first.data)));
        expect(second.success).toBe(true);
        if (second.success) expect(second.data).toEqual(first.data);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an unknown key, a kind and field mismatch, one date, equal dates and too many keys or stays', () => {
    fc.assert(
      fc.property(validStayArb, (stay) => {
        expect(tripStayInputSchema.safeParse({ ...stay, surprise: true }).success).toBe(false);

        if (stay['lodgingKind'] === 'resort') {
          expect(tripStayInputSchema.safeParse({ ...stay, placeName: 'Extra name' }).success).toBe(false);
          const withoutResort: StayShape = { ...stay };
          delete withoutResort['resortId'];
          expect(tripStayInputSchema.safeParse(withoutResort).success).toBe(false);
        } else {
          expect(tripStayInputSchema.safeParse({ ...stay, resortId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
          const withoutName: StayShape = { ...stay };
          delete withoutName['placeName'];
          expect(tripStayInputSchema.safeParse(withoutName).success).toBe(false);
        }

        expect(tripStayInputSchema.safeParse({ ...stay, checkIn: '2027-04-01', checkOut: undefined }).success).toBe(false);
        expect(tripStayInputSchema.safeParse({ ...stay, checkIn: '2027-04-01', checkOut: '2027-04-01' }).success).toBe(false);
        expect(tripStayInputSchema.safeParse({ ...stay, checkIn: '2027-04-02', checkOut: '2027-04-01' }).success).toBe(false);
        expect(
          tripStayInputSchema.safeParse({ ...stay, partyKeys: Array.from({ length: 51 }, (_, i) => `m:k${i}`) }).success,
        ).toBe(false);
        expect(tripStaysPutSchema.safeParse({ stays: Array.from({ length: TRIP_STAY_LIMIT + 1 }, () => stay) }).success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
