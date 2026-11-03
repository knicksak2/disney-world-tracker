import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TicketPriceRef } from '@dwt/shared';
import { resolveTicketPrice, type TicketBook } from '../resolveTicketPrice.js';
import type { LabelCfg, TicketPriceRow, TicketPriceSetMeta } from '../types.js';
import { addDays } from '../dates.js';

const DEFAULT_LABEL_CFG: LabelCfg = {
  freshDays: 45,
  estimateAfterDays: 120,
};

function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

describe('resolveTicketPrice', () => {
  const today = '2026-10-25';
  const horizonDate = '2027-10-25';
  const asOf = new Date('2026-10-25T10:00:00.000Z');

  const baseSet: TicketPriceSetMeta = {
    discountGroup: 'std-gst',
    numDays: 1,
    asOf,
    horizonDate,
    lastError: null,
  };

  const multiSet: TicketPriceSetMeta = {
    discountGroup: 'std-gst',
    numDays: 4,
    asOf,
    horizonDate,
    lastError: null,
  };

  it('step 0: startDate before today returns null price, add_your_price, estimateReason: none', () => {
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-10-20',
      park: 'mk',
    };
    const book: TicketBook = {
      sets: [baseSet],
      rows: [
        {
          discountGroup: 'std-gst',
          numDays: 1,
          ageGroup: 'adult',
          optionCode: 'base',
          park: 'mk',
          startDate: '2026-10-20',
          priceCents: 15000,
          taxCents: 975,
        },
      ],
    };
    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res).toEqual({
      priceCents: null,
      taxCents: null,
      resolvedStartDate: null,
      parkAssumed: false,
      labelKind: 'add_your_price',
      asOf: null,
      estimateReason: 'none',
      flUnavailable: false,
    });
  });

  it('step 1 (round 5 M3): Florida resident availability and estimateReason rules', () => {
    const reqFl: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'fl-resident',
      numDays: 3,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-11-01',
    };

    // (a) fl-resident with pairPermitted = false
    const resNotPermitted = resolveTicketPrice(reqFl, { sets: [], rows: [] }, today, DEFAULT_LABEL_CFG, false);
    expect(resNotPermitted.flUnavailable).toBe(true);
    expect(resNotPermitted.estimateReason).toBe('fl_unavailable');
    expect(resNotPermitted.labelKind).toBe('add_your_price');
    expect(resNotPermitted.priceCents).toBeNull();

    // (b) fl-resident with not_offered set
    const notOfferedSet: TicketPriceSetMeta = {
      discountGroup: 'fl-resident',
      numDays: 3,
      asOf: null,
      horizonDate: null,
      lastError: 'not_offered',
    };
    const resNotOffered = resolveTicketPrice(
      reqFl,
      { sets: [notOfferedSet], rows: [] },
      today,
      DEFAULT_LABEL_CFG,
      true,
    );
    expect(resNotOffered.flUnavailable).toBe(true);
    expect(resNotOffered.estimateReason).toBe('fl_unavailable');
    expect(resNotOffered.priceCents).toBeNull();

    // (c) fl-resident with pairPermitted = true and no set
    const resPermittedNoSet = resolveTicketPrice(reqFl, { sets: [], rows: [] }, today, DEFAULT_LABEL_CFG, true);
    expect(resPermittedNoSet.flUnavailable).toBe(false);
    expect(resPermittedNoSet.estimateReason).toBe('none');
    expect(resPermittedNoSet.priceCents).toBeNull();
    expect(resPermittedNoSet.labelKind).toBe('add_your_price');

    // (d) fl-resident with pairPermitted = true, asOf = null, lastError = 'network'
    const networkSet: TicketPriceSetMeta = {
      discountGroup: 'fl-resident',
      numDays: 3,
      asOf: null,
      horizonDate: null,
      lastError: 'network',
    };
    const resNetwork = resolveTicketPrice(
      reqFl,
      { sets: [networkSet], rows: [] },
      today,
      DEFAULT_LABEL_CFG,
      true,
    );
    expect(resNetwork.flUnavailable).toBe(false);
    expect(resNetwork.estimateReason).toBe('none');
    expect(resNetwork.priceCents).toBeNull();

    // (e) std-gst request with no set returns flUnavailable: false
    const reqStd: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-11-01',
    };
    const resStdNoSet = resolveTicketPrice(reqStd, { sets: [], rows: [] }, today, DEFAULT_LABEL_CFG, true);
    expect(resStdNoSet.flUnavailable).toBe(false);
    expect(resStdNoSet.estimateReason).toBe('none');
    expect(resStdNoSet.priceCents).toBeNull();
  });

  it('step 2 & 3: 1-day base with specific park returns that park with parkAssumed: false', () => {
    const parks = ['mk', 'ep', 'hs', 'ak'] as const;
    const rows: TicketPriceRow[] = parks.map((p, idx) => ({
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      park: p,
      startDate: '2026-11-01',
      priceCents: 15000 + idx * 500,
      taxCents: 1000 + idx * 30,
    }));

    const book: TicketBook = { sets: [baseSet], rows };

    for (const p of parks) {
      const req: TicketPriceRef = {
        kind: 'ticket',
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        startDate: '2026-11-01',
        park: p,
      };
      const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
      const expectedRow = rows.find((r) => r.park === p)!;
      expect(res.priceCents).toBe(expectedRow.priceCents);
      expect(res.taxCents).toBe(expectedRow.taxCents);
      expect(res.parkAssumed).toBe(false);
      expect(res.labelKind).toBe('current');
      expect(res.estimateReason).toBe('none');
      expect(res.resolvedStartDate).toBe('2026-11-01');
    }
  });

  it('step 2 & 3: 1-day base without park returns maximum price with parkAssumed: true and estimate label', () => {
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'ak',
        startDate: '2026-11-01',
        priceCents: 14000,
        taxCents: 910,
      },
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: '2026-11-01',
        priceCents: 18000,
        taxCents: 1170,
      },
    ];

    const book: TicketBook = { sets: [baseSet], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-11-01',
      // park unset
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.priceCents).toBe(18000);
    expect(res.taxCents).toBe(1170);
    expect(res.parkAssumed).toBe(true);
    expect(res.labelKind).toBe('estimate');
    expect(res.estimateReason).toBe('park_unset');
  });

  it('step 3: multi-day exact row returns current label and parkAssumed false', () => {
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-05',
        priceCents: 52000,
        taxCents: 3380,
      },
    ];

    const book: TicketBook = { sets: [multiSet], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-11-05',
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.priceCents).toBe(52000);
    expect(res.parkAssumed).toBe(false);
    expect(res.labelKind).toBe('current');
    expect(res.estimateReason).toBe('none');
  });

  it('step 4 (round 4 L2): beyond-horizon target rule resolves to 364-day earlier weekday, not holiday peak', () => {
    // Requested date: 2028-06-03 (Saturday)
    // 364 days earlier: 2027-06-05 (Saturday)
    // Horizon is 2027-12-31
    // Peak week rows on 2027-12-25 (Saturday): 22900
    // Typical row on 2027-06-05 (Saturday): 19000
    const set: TicketPriceSetMeta = {
      discountGroup: 'std-gst',
      numDays: 4,
      asOf,
      horizonDate: '2027-12-31',
      lastError: null,
    };
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2027-06-05', // Saturday, target
        priceCents: 19000,
        taxCents: 1235,
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2027-12-25', // Saturday, holiday peak
        priceCents: 22900,
        taxCents: 1488,
      },
    ];

    const book: TicketBook = { sets: [set], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2028-06-03',
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.priceCents).toBe(19000);
    expect(res.resolvedStartDate).toBe('2027-06-05');
    expect(res.estimateReason).toBe('beyond_horizon');
    expect(res.labelKind).toBe('estimate');
  });

  it('step 4: when startDate - 364 days is before today or beyond horizon, latest same-weekday cached date is used', () => {
    // today is 2026-10-25
    // requested: 2027-02-06 (Saturday) > horizonDate 2027-01-31
    // target: 2027-02-06 - 364 days = 2026-02-07 < today!
    // So target < today. Must fall back to latest candidate.
    const set: TicketPriceSetMeta = {
      discountGroup: 'std-gst',
      numDays: 4,
      asOf,
      horizonDate: '2027-01-31',
      lastError: null,
    };
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-07', // Saturday
        priceCents: 45000,
        taxCents: 2925,
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2027-01-23', // Saturday (latest)
        priceCents: 48000,
        taxCents: 3120,
      },
    ];

    const book: TicketBook = { sets: [set], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2027-02-06',
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.priceCents).toBe(48000);
    expect(res.resolvedStartDate).toBe('2027-01-23');
    expect(res.estimateReason).toBe('beyond_horizon');
  });

  it('step 4 & 7 (review F22): 1-day base without park beyond horizon reports estimateReason: park_unset', () => {
    const set: TicketPriceSetMeta = {
      discountGroup: 'std-gst',
      numDays: 1,
      asOf,
      horizonDate: '2027-01-31',
      lastError: null,
    };
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: '2026-11-07',
        priceCents: 18000,
        taxCents: 1170,
      },
    ];
    const book: TicketBook = { sets: [set], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2027-02-06', // Beyond horizon
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.parkAssumed).toBe(true);
    expect(res.estimateReason).toBe('park_unset');
  });

  it('step 5: within-horizon miss chooses candidate date with same weekday, ties to earlier date', () => {
    // Requested: 2026-11-15 (Sunday)
    // Candidates: 2026-11-08 (diff 7 days) and 2026-11-22 (diff 7 days)
    // Tie should pick 2026-11-08 (earlier)
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-08',
        priceCents: 41000,
        taxCents: 2665,
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-22',
        priceCents: 43000,
        taxCents: 2795,
      },
    ];

    const book: TicketBook = { sets: [multiSet], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-11-15',
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.resolvedStartDate).toBe('2026-11-08');
    expect(res.priceCents).toBe(41000);
    expect(res.estimateReason).toBe('no_exact_date');
    expect(res.labelKind).toBe('estimate');
  });

  it('book holding only non-exact dates of the key returns nearest same-weekday date and never add_your_price (review F11)', () => {
    // Set has horizon 2027-10-25. No exact row on 2026-12-02 (Wednesday).
    // Cached row on 2026-11-04 (Wednesday).
    const rows: TicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-04',
        priceCents: 45000,
        taxCents: 2925,
      },
    ];

    const book: TicketBook = { sets: [multiSet], rows };
    const req: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      startDate: '2026-12-02',
    };

    const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, true);
    expect(res.priceCents).toBe(45000);
    expect(res.labelKind).toBe('estimate');
    expect(res.resolvedStartDate).toBe('2026-11-04');
  });

  // Feature: trip-budget, Property 14: Ticket price resolution honors horizon and weekday parity
  it('Property 14: Ticket price resolution honors horizon and weekday parity (fast-check, 100 runs)', () => {
    const dateArb = fc.integer({ min: 0, max: 700 }).map((offset) => addDays(today, offset));
    const parkArb = fc.constantFrom<'any' | 'mk' | 'ep' | 'hs' | 'ak'>('any', 'mk', 'ep', 'hs', 'ak');
    const discountGroupArb = fc.constantFrom<'std-gst' | 'fl-resident'>('std-gst', 'fl-resident');
    const optionCodeArb = fc.constantFrom<'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports'>(
      'base',
      'park_hopper',
      'park_hopper_plus',
      'water_parks_sports',
    );
    const numDaysArb = fc.integer({ min: 1, max: 10 });
    const ageGroupArb = fc.constantFrom<'adult' | 'child'>('adult', 'child');

    fc.assert(
      fc.property(
        dateArb,
        discountGroupArb,
        numDaysArb,
        ageGroupArb,
        optionCodeArb,
        fc.option(parkArb, { nil: undefined }),
        fc.boolean(),
        (startDate, discountGroup, numDays, ageGroup, optionCode, park, pairPermitted) => {
          const req: TicketPriceRef = {
            kind: 'ticket',
            discountGroup,
            numDays,
            ageGroup,
            optionCode,
            startDate,
            park: numDays === 1 && optionCode === 'base' && park !== 'any' ? park : undefined,
          };

          const setHorizon = addDays(today, 365);
          const set: TicketPriceSetMeta = {
            discountGroup,
            numDays,
            asOf,
            horizonDate: setHorizon,
            lastError: null,
          };

          // Generate some rows
          const rows: TicketPriceRow[] = [];
          for (let i = 0; i < 30; i++) {
            const d = addDays(today, i * 7); // weekly on same weekday as today
            rows.push({
              discountGroup,
              numDays,
              ageGroup,
              optionCode,
              park: numDays === 1 && optionCode === 'base' ? 'mk' : 'any',
              startDate: d,
              priceCents: 10000 + i * 100,
              taxCents: 650 + i * 6,
            });
          }

          const book: TicketBook = { sets: [set], rows };
          const res = resolveTicketPrice(req, book, today, DEFAULT_LABEL_CFG, pairPermitted);

          // Invariant 1: If startDate < today, priceCents must be null and labelKind must be add_your_price
          if (startDate < today) {
            expect(res.priceCents).toBeNull();
            expect(res.labelKind).toBe('add_your_price');
            expect(res.estimateReason).toBe('none');
          }

          // Invariant 2: If Florida resident and not permitted, flUnavailable must be true
          if (discountGroup === 'fl-resident' && !pairPermitted) {
            expect(res.flUnavailable).toBe(true);
            expect(res.estimateReason).toBe('fl_unavailable');
            expect(res.priceCents).toBeNull();
          }

          // Invariant 3: If a price is resolved, weekday of resolvedStartDate must equal weekday of startDate
          if (res.priceCents !== null && res.resolvedStartDate !== null) {
            expect(dayOfWeek(res.resolvedStartDate)).toBe(dayOfWeek(startDate));
          }

          // Invariant 4: parkAssumed precedence: if parkAssumed is true, estimateReason must be park_unset
          if (res.priceCents !== null && res.parkAssumed) {
            expect(res.estimateReason).toBe('park_unset');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
