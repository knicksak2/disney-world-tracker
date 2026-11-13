// Feature: trip-lodging-stays, task 1 (shared module): schemas, validation, the effectiveStays resolver, tonight's stay
// and warnings. Property tests live in tripStays.prop.test.ts.
import { describe, expect, it } from 'vitest';
import * as Shared from '../index.js';
import {
  TRIP_STAY_LIMIT,
  TRIP_STAY_MAX_NIGHTS,
  TRIP_STAY_PARTY_KEYS_MAX,
  TRIP_STAY_PLACE_NAME_MAX,
  TRIP_STAY_SPAN_MAX_DAYS,
  computeStayWarnings,
  effectiveStays,
  stayForNight,
  stayNights,
  tonightsStay,
  tripStayInputSchema,
  tripStaysPutSchema,
  validateStays,
  type StayRecord,
} from '../index.js';

const RESORT_A = '11111111-1111-4111-8111-111111111111';
const RESORT_B = '22222222-2222-4222-8222-222222222222';
const RESORT_C = '33333333-3333-4333-8333-333333333333';

function stay(
  id: string,
  position: number,
  name: string,
  checkIn: string | null,
  checkOut: string | null,
  overrides: Partial<StayRecord> = {},
): StayRecord {
  return {
    id,
    position,
    lodgingKind: 'resort',
    resortId: RESORT_A,
    displayName: name,
    checkIn,
    checkOut,
    partyKeys: null,
    ...overrides,
  };
}

// The trip of the original screenshot: Dec 15 to Dec 31 with three resorts.
const TRIP = { startDate: '2026-12-15', endDate: '2026-12-31' };

describe('trip lodging stays: barrel exports (guards the explicit export list in index.ts)', () => {
  it('exports every new name from the package entry', () => {
    const names = [
      'TRIP_STAY_LIMIT',
      'TRIP_STAY_MAX_NIGHTS',
      'TRIP_STAY_SPAN_MAX_DAYS',
      'TRIP_STAY_PLACE_NAME_MAX',
      'TRIP_STAY_PARTY_KEYS_MAX',
      'TRIP_STAY_NO_LODGING_NAME',
      'personKeySchema',
      'tripStayInputSchema',
      'tripStaysPutSchema',
      'isScheduledStay',
      'stayNights',
      'validateStays',
      'effectiveStays',
      'stayForNight',
      'tonightsStay',
      'computeStayWarnings',
    ] as const;
    for (const name of names) {
      expect((Shared as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('keeps the stay limit within the existing trip_resorts limit', () => {
    expect(TRIP_STAY_LIMIT).toBe(8);
    expect(TRIP_STAY_LIMIT).toBeLessThanOrEqual(Shared.TRIP_RESORT_LIMIT);
  });
});

describe('tripStayInputSchema', () => {
  const resortStay = { lodgingKind: 'resort', resortId: RESORT_A, checkIn: '2026-12-15', checkOut: '2026-12-20' };

  it('accepts a dated resort stay, an undated one, an off-site stay and one with party keys', () => {
    expect(tripStayInputSchema.safeParse(resortStay).success).toBe(true);
    expect(tripStayInputSchema.safeParse({ lodgingKind: 'resort', resortId: RESORT_A }).success).toBe(true);
    expect(
      tripStayInputSchema.safeParse({
        lodgingKind: 'offsite',
        placeName: 'Hampton Inn',
        checkIn: '2026-12-20',
        checkOut: '2026-12-22',
      }).success,
    ).toBe(true);
    expect(
      tripStayInputSchema.safeParse({ ...resortStay, partyKeys: ['m:abc', 'g:def'] }).success,
    ).toBe(true);
    expect(tripStayInputSchema.safeParse({ ...resortStay, partyKeys: null }).success).toBe(true);
  });

  it('accepts an id for an existing stay and rejects a malformed one', () => {
    expect(tripStayInputSchema.safeParse({ ...resortStay, id: RESORT_B }).success).toBe(true);
    expect(tripStayInputSchema.safeParse({ ...resortStay, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a resort stay without a resort id or with a place name', () => {
    expect(tripStayInputSchema.safeParse({ lodgingKind: 'resort' }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, placeName: 'Room 4412' }).success).toBe(false);
  });

  it('rejects a non-resort stay without a name or with a resort id', () => {
    expect(tripStayInputSchema.safeParse({ lodgingKind: 'offsite' }).success).toBe(false);
    expect(
      tripStayInputSchema.safeParse({ lodgingKind: 'partner_hotel', placeName: 'Swan', resortId: RESORT_A }).success,
    ).toBe(false);
    expect(tripStayInputSchema.safeParse({ lodgingKind: 'partner_hotel', placeName: '   ' }).success).toBe(false);
  });

  it('rejects a name over the maximum and accepts exactly the maximum', () => {
    const base = { lodgingKind: 'offsite' } as const;
    expect(tripStayInputSchema.safeParse({ ...base, placeName: 'x'.repeat(TRIP_STAY_PLACE_NAME_MAX) }).success).toBe(true);
    expect(tripStayInputSchema.safeParse({ ...base, placeName: 'x'.repeat(TRIP_STAY_PLACE_NAME_MAX + 1) }).success).toBe(false);
  });

  it('rejects one date without the other, equal dates and inverted dates', () => {
    expect(tripStayInputSchema.safeParse({ ...resortStay, checkOut: undefined }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, checkIn: undefined }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, checkOut: '2026-12-15' }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, checkOut: '2026-12-14' }).success).toBe(false);
  });

  it('rejects a malformed date, a bad person key and too many keys', () => {
    expect(tripStayInputSchema.safeParse({ ...resortStay, checkIn: '12/15/2026' }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, partyKeys: ['x:abc'] }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, partyKeys: ['m:'] }).success).toBe(false);
    const fifty = Array.from({ length: TRIP_STAY_PARTY_KEYS_MAX }, (_, i) => `m:u${i}`);
    expect(tripStayInputSchema.safeParse({ ...resortStay, partyKeys: fifty }).success).toBe(true);
    expect(tripStayInputSchema.safeParse({ ...resortStay, partyKeys: [...fifty, 'm:extra'] }).success).toBe(false);
  });

  it('rejects an unknown key and an unknown lodging kind', () => {
    expect(tripStayInputSchema.safeParse({ ...resortStay, extra: 1 }).success).toBe(false);
    expect(tripStayInputSchema.safeParse({ ...resortStay, lodgingKind: 'cruise' }).success).toBe(false);
  });
});

describe('tripStaysPutSchema', () => {
  const one = { lodgingKind: 'resort', resortId: RESORT_A } as const;

  it('accepts an empty list and exactly the maximum number of stays', () => {
    expect(tripStaysPutSchema.safeParse({ stays: [] }).success).toBe(true);
    expect(tripStaysPutSchema.safeParse({ stays: Array.from({ length: TRIP_STAY_LIMIT }, () => one) }).success).toBe(true);
  });

  it('rejects one stay too many and unknown keys', () => {
    expect(tripStaysPutSchema.safeParse({ stays: Array.from({ length: TRIP_STAY_LIMIT + 1 }, () => one) }).success).toBe(false);
    expect(tripStaysPutSchema.safeParse({ stays: [], extra: true }).success).toBe(false);
    expect(tripStaysPutSchema.safeParse({}).success).toBe(false);
  });
});

describe('stayNights', () => {
  it('lists check-in up to but not including check-out', () => {
    expect(stayNights('2026-12-15', '2026-12-18')).toEqual(['2026-12-15', '2026-12-16', '2026-12-17']);
  });

  it('is empty when check-out is not after check-in', () => {
    expect(stayNights('2026-12-15', '2026-12-15')).toEqual([]);
    expect(stayNights('2026-12-15', '2026-12-14')).toEqual([]);
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(stayNights('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(stayNights('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29']);
  });
});

describe('validateStays', () => {
  const codes = (list: Parameters<typeof validateStays>[0]) => validateStays(list).map((e) => e.code);

  it('accepts an empty list, undated stays and a valid chain', () => {
    expect(validateStays([])).toEqual([]);
    expect(codes([{}, { checkIn: null, checkOut: null }])).toEqual([]);
    expect(codes([{ checkIn: '2026-12-15', checkOut: '2026-12-20' }, { checkIn: '2026-12-20', checkOut: '2026-12-26' }])).toEqual([]);
  });

  it('allows two stays that only touch at a hand-off date', () => {
    expect(codes([{ checkIn: '2026-12-20', checkOut: '2026-12-26' }, { checkIn: '2026-12-15', checkOut: '2026-12-20' }])).toEqual([]);
  });

  it('rejects stays that share even one night', () => {
    const result = validateStays([
      { checkIn: '2026-12-15', checkOut: '2026-12-20' },
      { checkIn: '2026-12-19', checkOut: '2026-12-26' },
    ]);
    expect(result.map((e) => e.code)).toEqual(['overlap']);
    expect(result[0]!.stayIndex).toBe(1);
  });

  it('reports a stay that sits entirely inside another', () => {
    expect(codes([{ checkIn: '2026-12-15', checkOut: '2026-12-30' }, { checkIn: '2026-12-20', checkOut: '2026-12-22' }])).toContain('overlap');
  });

  it('reports inverted, equal and incomplete dates', () => {
    expect(codes([{ checkIn: '2026-12-20', checkOut: '2026-12-19' }])).toEqual(['dates_inverted']);
    expect(codes([{ checkIn: '2026-12-20', checkOut: '2026-12-20' }])).toEqual(['dates_inverted']);
    expect(codes([{ checkIn: '2026-12-20', checkOut: null }])).toEqual(['dates_incomplete']);
  });

  it('allows exactly the maximum nights and rejects one more', () => {
    expect(codes([{ checkIn: '2026-10-01', checkOut: '2026-11-30' }])).toEqual([]); // 60 nights
    expect(TRIP_STAY_MAX_NIGHTS).toBe(60);
    expect(codes([{ checkIn: '2026-10-01', checkOut: '2026-12-01' }])).toContain('nights_exceeded'); // 61 nights
  });

  it('allows exactly the maximum span and rejects one more day', () => {
    // 90 days from the first check-in to the last check-out.
    const ok = [
      { checkIn: '2026-10-01', checkOut: '2026-10-31' },
      { checkIn: '2026-12-01', checkOut: '2026-12-30' },
    ];
    expect(TRIP_STAY_SPAN_MAX_DAYS).toBe(90);
    expect(codes(ok)).toEqual([]);
    const tooLong = [ok[0]!, { checkIn: '2026-12-01', checkOut: '2026-12-31' }];
    expect(codes(tooLong)).toEqual(['span_exceeded']);
  });

  it('rejects more than the maximum number of stays', () => {
    const many = Array.from({ length: TRIP_STAY_LIMIT + 1 }, () => ({}));
    expect(codes(many)).toEqual(['count_exceeded']);
    expect(codes(Array.from({ length: TRIP_STAY_LIMIT }, () => ({})))).toEqual([]);
  });

  it('does not depend on input order for the set of error codes', () => {
    const a = [
      { checkIn: '2026-12-15', checkOut: '2026-12-20' },
      { checkIn: '2026-12-19', checkOut: '2026-12-26' },
    ];
    expect(codes([...a].reverse()).sort()).toEqual(codes(a).sort());
  });
});

describe('effectiveStays: the three-hotel trip of the screenshot', () => {
  const allStar = stay('s1', 0, "Disney's All-Star Movies Resort", null, null, { resortId: RESORT_A });
  const akl = stay('s2', 1, "Disney's Animal Kingdom Lodge", null, null, { resortId: RESORT_B });
  const beachClub = stay('s3', 2, "Disney's Beach Club Resort", null, null, { resortId: RESORT_C });

  it('with only undated stays returns one legacy segment named for the first stay by position', () => {
    const result = effectiveStays(TRIP, [beachClub, allStar, akl]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: null,
      source: 'legacy_resorts',
      lodgingKind: 'resort',
      displayName: "Disney's All-Star Movies Resort",
      resortId: RESORT_A,
      checkIn: '2026-12-15',
      checkOut: '2026-12-31',
      nights: 16,
      partyKeys: null,
    });
  });

  it('with the three stays dated end to end returns three stay segments and no gaps', () => {
    const result = effectiveStays(TRIP, [
      { ...beachClub, checkIn: '2026-12-26', checkOut: '2026-12-31' },
      { ...allStar, checkIn: '2026-12-15', checkOut: '2026-12-20' },
      { ...akl, checkIn: '2026-12-20', checkOut: '2026-12-26' },
    ]);
    expect(result.map((s) => [s.source, s.displayName, s.checkIn, s.checkOut, s.nights])).toEqual([
      ['stay', "Disney's All-Star Movies Resort", '2026-12-15', '2026-12-20', 5],
      ['stay', "Disney's Animal Kingdom Lodge", '2026-12-20', '2026-12-26', 6],
      ['stay', "Disney's Beach Club Resort", '2026-12-26', '2026-12-31', 5],
    ]);
  });

  it('fills a gap left by a removed middle stay with an off-site segment', () => {
    const result = effectiveStays(TRIP, [
      { ...allStar, checkIn: '2026-12-15', checkOut: '2026-12-20' },
      { ...beachClub, checkIn: '2026-12-26', checkOut: '2026-12-31' },
    ]);
    expect(result.map((s) => [s.source, s.checkIn, s.checkOut, s.nights])).toEqual([
      ['stay', '2026-12-15', '2026-12-20', 5],
      ['implicit_gap', '2026-12-20', '2026-12-26', 6],
      ['stay', '2026-12-26', '2026-12-31', 5],
    ]);
    expect(result[1]).toMatchObject({ id: null, lodgingKind: 'offsite', displayName: 'No lodging recorded', partyKeys: null });
  });
});

describe('effectiveStays: other shapes', () => {
  it('returns one implicit off-site segment spanning the trip when there are no stays', () => {
    const result = effectiveStays(TRIP, []);
    expect(result).toEqual([
      {
        id: null,
        source: 'implicit_no_lodging',
        lodgingKind: 'offsite',
        displayName: 'No lodging recorded',
        resortId: null,
        checkIn: '2026-12-15',
        checkOut: '2026-12-31',
        nights: 16,
        partyKeys: null,
      },
    ]);
  });

  it('returns a zero-night segment for a one-day trip with no or only undated stays', () => {
    const oneDay = { startDate: '2026-12-15', endDate: '2026-12-15' };
    expect(effectiveStays(oneDay, [])[0]).toMatchObject({ source: 'implicit_no_lodging', nights: 0 });
    expect(effectiveStays(oneDay, [stay('s1', 0, 'Pop', null, null)])[0]).toMatchObject({ source: 'legacy_resorts', nights: 0 });
  });

  it('adds a gap segment before a stay that starts after the trip start', () => {
    const result = effectiveStays(TRIP, [stay('s1', 0, 'Pop', '2026-12-18', '2026-12-31')]);
    expect(result.map((s) => [s.source, s.checkIn, s.checkOut])).toEqual([
      ['implicit_gap', '2026-12-15', '2026-12-18'],
      ['stay', '2026-12-18', '2026-12-31'],
    ]);
  });

  it('keeps a stay that begins before the trip, with no gap added', () => {
    const result = effectiveStays(TRIP, [stay('s1', 0, 'Pop', '2026-12-13', '2026-12-31')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: 'stay', checkIn: '2026-12-13', nights: 18 });
  });

  it('carries partyKeys through unchanged and treats a malformed one-date row as unscheduled', () => {
    const keyed = stay('s1', 0, 'Pop', '2026-12-15', '2026-12-31', { partyKeys: ['m:a'] });
    expect(effectiveStays(TRIP, [keyed])[0]!.partyKeys).toEqual(['m:a']);
    const malformed = stay('s2', 0, 'Pop', '2026-12-15', null);
    expect(effectiveStays(TRIP, [malformed])[0]!.source).toBe('legacy_resorts');
  });

  it('keeps the stay kind of an off-site stay', () => {
    const offsite = stay('s1', 0, 'Hampton Inn', '2026-12-15', '2026-12-31', { lodgingKind: 'offsite', resortId: null });
    expect(effectiveStays(TRIP, [offsite])[0]).toMatchObject({ lodgingKind: 'offsite', resortId: null });
  });
});

describe('stayForNight and tonightsStay', () => {
  const eff = effectiveStays(TRIP, [
    stay('a', 0, 'First', '2026-12-15', '2026-12-20'),
    stay('b', 1, 'Second', '2026-12-20', '2026-12-31'),
  ]);

  it('finds the stay whose night is the date', () => {
    expect(stayForNight(eff, '2026-12-15')?.id).toBe('a');
    expect(stayForNight(eff, '2026-12-19')?.id).toBe('a');
    expect(stayForNight(eff, '2026-12-25')?.id).toBe('b');
  });

  it('returns null before the first night, on the final check-out date and after', () => {
    expect(stayForNight(eff, '2026-12-14')).toBeNull();
    expect(stayForNight(eff, '2026-12-31')).toBeNull();
    expect(stayForNight(eff, '2027-01-02')).toBeNull();
  });

  it('names the incoming stay on a hand-off date', () => {
    expect(stayForNight(eff, '2026-12-20')?.id).toBe('b');
    expect(tonightsStay(eff, '2026-12-20')?.id).toBe('b');
  });

  it('names the stay being left on the final check-out date', () => {
    expect(tonightsStay(eff, '2026-12-31')?.id).toBe('b');
  });

  it('returns null outside every range', () => {
    expect(tonightsStay(eff, '2026-12-10')).toBeNull();
    expect(tonightsStay(eff, '2027-01-05')).toBeNull();
    expect(tonightsStay([], '2026-12-20')).toBeNull();
  });
});

describe('computeStayWarnings', () => {
  it('returns nothing for a single stay that equals the trip dates', () => {
    expect(computeStayWarnings(TRIP, [stay('a', 0, 'Pop', '2026-12-15', '2026-12-31')])).toEqual([]);
  });

  it('returns nothing for a trip with no stays', () => {
    expect(computeStayWarnings(TRIP, [])).toEqual([]);
  });

  it('flags each unscheduled stay and nothing else when none is dated', () => {
    expect(
      computeStayWarnings(TRIP, [stay('a', 0, 'Pop', null, null), stay('b', 1, 'Beach Club', null, null)]),
    ).toEqual([
      { code: 'unscheduled', stayId: 'a' },
      { code: 'unscheduled', stayId: 'b' },
    ]);
  });

  it('flags a gap between two dated stays', () => {
    expect(
      computeStayWarnings(TRIP, [
        stay('a', 0, 'First', '2026-12-15', '2026-12-20'),
        stay('b', 1, 'Second', '2026-12-26', '2026-12-31'),
      ]),
    ).toEqual([{ code: 'gap', from: '2026-12-20', to: '2026-12-26' }]);
  });

  it('flags trip nights before the first and after the last dated stay as not covered', () => {
    expect(computeStayWarnings(TRIP, [stay('a', 0, 'Mid', '2026-12-18', '2026-12-25')])).toEqual([
      { code: 'trip_not_covered', from: '2026-12-15', to: '2026-12-18' },
      { code: 'trip_not_covered', from: '2026-12-25', to: '2026-12-31' },
    ]);
  });

  it('flags a dated stay with nights outside the trip', () => {
    expect(computeStayWarnings(TRIP, [stay('a', 0, 'Early', '2026-12-13', '2026-12-31')])).toEqual([
      { code: 'outside_trip', stayId: 'a' },
    ]);
    expect(computeStayWarnings(TRIP, [stay('a', 0, 'Late', '2026-12-15', '2027-01-02')])).toEqual([
      { code: 'outside_trip', stayId: 'a' },
    ]);
  });

  it('combines findings: unscheduled first, then uncovered nights, then outside_trip', () => {
    expect(
      computeStayWarnings(TRIP, [
        stay('u', 0, 'Undated', null, null),
        stay('a', 1, 'First', '2026-12-13', '2026-12-18'),
        stay('b', 2, 'Second', '2026-12-22', '2026-12-31'),
      ]),
    ).toEqual([
      { code: 'unscheduled', stayId: 'u' },
      { code: 'gap', from: '2026-12-18', to: '2026-12-22' },
      { code: 'outside_trip', stayId: 'a' },
    ]);
  });
});
