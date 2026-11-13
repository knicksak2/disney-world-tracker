import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bpsOf, DINING_PLAN_CODES, type DiningPlanCode } from '@dwt/shared';

import { addDays } from '../../../ticketPrices/dates.js';
import { nightPrice, planCost, type PlanCostInput } from '../planPrice.js';
import { nightsOf } from '../stay.js';
import type { EnginePerson, EnginePriceRow } from '../types.js';

/** The five rows `0075_dining_plan.sql` seeds, as the repo maps them. */
const SEEDED: readonly EnginePriceRow[] = [
  { planCode: 'quick_service', displayName: 'Disney Quick-Service Dining Plan', validFrom: '2026-01-01', validTo: '2026-12-31', adultCents: 6047, childCents: 2616, childPromoCents: 0, promoLabel: 'Kids Eat Free 2026', verifiedAt: null },
  { planCode: 'table_service', displayName: 'Disney Dining Plan', validFrom: '2026-01-01', validTo: '2026-12-31', adultCents: 9859, childCents: 3194, childPromoCents: 0, promoLabel: 'Kids Eat Free 2026', verifiedAt: null },
  { planCode: 'quick_service', displayName: 'Quick-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 6278, childCents: 2582, childPromoCents: null, promoLabel: null, verifiedAt: null },
  { planCode: 'table_service', displayName: 'Table-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 9987, childCents: 3194, childPromoCents: null, promoLabel: null, verifiedAt: null },
  { planCode: 'deluxe', displayName: 'Deluxe Table-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 16301, childCents: 4685, childPromoCents: null, promoLabel: null, verifiedAt: null },
];

const A1: EnginePerson = { key: 'm:a1', label: 'Alex', ageBracket: 'adult', passType: 'none' };
const A2: EnginePerson = { key: 'm:a2', label: 'Blair', ageBracket: 'adult', passType: 'none' };
const C1: EnginePerson = { key: 'g:c1', label: 'Casey', ageBracket: 'child', passType: 'none' };
const BABY: EnginePerson = { key: 'g:b1', label: 'Dana', ageBracket: 'under3', passType: 'none' };

function input(overrides: Partial<PlanCostInput>): PlanCostInput {
  return {
    plan: 'table_service',
    checkIn: '2027-03-01',
    checkOut: '2027-03-06',
    persons: [A1, A2, C1],
    priceRows: SEEDED,
    disneyResort: true,
    promoEligible: true,
    planPricesIncludeTax: true,
    taxBps: 650,
    ...overrides,
  };
}

describe('nightPrice', () => {
  it('finds the period containing the date, inclusive at both ends', () => {
    expect(nightPrice(SEEDED, 'table_service', '2026-01-01')?.displayName).toBe('Disney Dining Plan');
    expect(nightPrice(SEEDED, 'table_service', '2026-12-31')?.displayName).toBe('Disney Dining Plan');
    expect(nightPrice(SEEDED, 'table_service', '2027-01-01')?.displayName).toBe('Table-Service Dining Plan');
  });

  it('is null outside every period and for a plan with no period then', () => {
    expect(nightPrice(SEEDED, 'table_service', '2028-01-01')).toBeNull();
    expect(nightPrice(SEEDED, 'deluxe', '2026-06-01')).toBeNull();
  });

  it('prefers the later-starting period if two ever overlap', () => {
    const overlap: EnginePriceRow = { ...SEEDED[1]!, displayName: 'Mid-year', validFrom: '2026-07-01', validTo: '2026-12-31' };
    expect(nightPrice([SEEDED[1]!, overlap], 'table_service', '2026-08-01')?.displayName).toBe('Mid-year');
    expect(nightPrice([overlap, SEEDED[1]!], 'table_service', '2026-08-01')?.displayName).toBe('Mid-year');
  });
});

describe('planCost', () => {
  it('2 adults and 1 child, 5 nights of the 2026 table-service plan, with and without Kids Eat Free', () => {
    const on = planCost(input({ checkIn: '2026-06-01', checkOut: '2026-06-06' }));
    // (2 x 9859 + 0) x 5
    expect(on).toEqual({
      available: true, unavailableReason: null, cents: 98_590, displayName: 'Disney Dining Plan', promoLabel: 'Kids Eat Free 2026', verifiedAt: null, nights: 5,
      periods: [SEEDED[1]],
      baseByPerson: new Map([[A1.key, 5 * 9859], [A2.key, 5 * 9859], [C1.key, 0]]),
    });
    const off = planCost(input({ checkIn: '2026-06-01', checkOut: '2026-06-06', promoEligible: false }));
    // (2 x 9859 + 3194) x 5
    expect(off).toMatchObject({ cents: 114_560, promoLabel: null });
  });

  it('a one-night 2027 quick-service plan for one adult, and a seven-night 2027 deluxe plan for 2 adults and a child', () => {
    expect(planCost(input({ plan: 'quick_service', checkIn: '2027-02-10', checkOut: '2027-02-11', persons: [A1] }))).toMatchObject({
      cents: 6278, displayName: 'Quick-Service Dining Plan', nights: 1,
    });
    // (2 x 16301 + 4685) x 7: the 2027 periods have no promotion, so promoEligible changes nothing.
    expect(planCost(input({ plan: 'deluxe', checkIn: '2027-05-01', checkOut: '2027-05-08' }))).toMatchObject({
      cents: 261_009, promoLabel: null, nights: 7,
    });
  });

  it('prices a stay crossing 2026-12-31 night by night, with each period\'s own name', () => {
    const r = planCost(input({ checkIn: '2026-12-30', checkOut: '2027-01-02', persons: [A1, C1] }));
    // 2026-12-30, 2026-12-31: 9859 + 0 each; 2027-01-01: 9987 + 3194.
    expect(r).toMatchObject({
      available: true,
      cents: 2 * 9859 + 9987 + 3194,
      displayName: 'Disney Dining Plan / Table-Service Dining Plan',
      promoLabel: 'Kids Eat Free 2026',
      nights: 3,
      periods: [SEEDED[1], SEEDED[3]],
    });
  });

  it('is no_price_for_dates when any night has no period, and never guesses', () => {
    expect(planCost(input({ plan: 'deluxe', checkIn: '2026-12-30', checkOut: '2027-01-02' }))).toMatchObject({
      available: false, unavailableReason: 'no_price_for_dates', cents: 0, displayName: null, periods: [],
    });
    const gap = SEEDED.filter((r) => r.planCode === 'table_service').map((r) => (r.validFrom === '2027-01-01' ? { ...r, validFrom: '2027-01-03' } : r));
    expect(planCost(input({ checkIn: '2026-12-31', checkOut: '2027-01-04', priceRows: gap })).unavailableReason).toBe('no_price_for_dates');
    expect(planCost(input({ checkIn: '2027-12-30', checkOut: '2028-01-02' })).unavailableReason).toBe('no_price_for_dates');
  });

  it('allows 30 nights and makes 31 nights stay_too_long', () => {
    expect(planCost(input({ checkIn: '2027-03-01', checkOut: '2027-03-31', persons: [A1] }))).toMatchObject({ available: true, cents: 30 * 9987, nights: 30 });
    expect(planCost(input({ checkIn: '2027-03-01', checkOut: '2027-04-01', persons: [A1] }))).toMatchObject({ available: false, unavailableReason: 'stay_too_long', nights: 31 });
  });

  it('is no_nights for a zero-night stay', () => {
    expect(planCost(input({ checkIn: '2027-03-01', checkOut: '2027-03-01' }))).toMatchObject({ available: false, unavailableReason: 'no_nights', nights: 0 });
  });

  it('is no_eligible_guests when the Party is only under-3s, and an under-3 adds nothing', () => {
    expect(planCost(input({ persons: [BABY] })).unavailableReason).toBe('no_eligible_guests');
    expect(planCost(input({ persons: [] })).unavailableReason).toBe('no_eligible_guests');
    expect(planCost(input({ persons: [A1, BABY] })).cents).toBe(planCost(input({ persons: [A1] })).cents);
  });

  it('ignores the promotion when the booking does not qualify (a DVC or passholder stay)', () => {
    const r = planCost(input({ checkIn: '2026-06-01', checkOut: '2026-06-03', persons: [A1, C1], promoEligible: false }));
    expect(r).toMatchObject({ cents: 2 * (9859 + 3194), promoLabel: null });
  });

  it('names no promotion when there is no child to apply it to', () => {
    expect(planCost(input({ checkIn: '2026-06-01', checkOut: '2026-06-03', persons: [A1] })).promoLabel).toBeNull();
  });

  it('is not_disney_resort ahead of every other reason', () => {
    expect(planCost(input({ disneyResort: false, checkOut: '2027-03-01', persons: [] })).unavailableReason).toBe('not_disney_resort');
  });

  it('adds tax when plan prices do not include it, leaving the per-Person price shares pre-tax', () => {
    const r = planCost(input({ checkIn: '2027-03-01', checkOut: '2027-03-02', persons: [A1], planPricesIncludeTax: false }));
    expect(r.cents).toBe(9987 + bpsOf(9987, 650)); // 9987 + 649
    expect(r.cents).toBe(10_636);
    expect([...r.baseByPerson]).toEqual([[A1.key, 9987]]);
  });

  it('shares the cost per Person by bracket across the nights, without under-3s', () => {
    const r = planCost(input({ checkIn: '2026-12-31', checkOut: '2027-01-02', persons: [A1, C1, BABY], promoEligible: false }));
    expect([...r.baseByPerson]).toEqual([[A1.key, 9859 + 9987], [C1.key, 3194 + 3194]]);
    expect(r.cents).toBe(9859 + 9987 + 3194 + 3194);
  });

  it('reports the latest verified_at of the periods used, or null when any is unverified', () => {
    const verified = SEEDED.map((r) => ({ ...r, verifiedAt: r.validFrom.startsWith('2026') ? '2026-11-09' : '2026-11-20' }));
    expect(planCost(input({ checkIn: '2026-12-30', checkOut: '2027-01-02', priceRows: verified })).verifiedAt).toBe('2026-11-20');
    expect(planCost(input({ checkIn: '2026-06-01', checkOut: '2026-06-03', priceRows: verified })).verifiedAt).toBe('2026-11-09');
    const mixed = verified.map((r) => (r.validFrom === '2027-01-01' ? { ...r, verifiedAt: null } : r));
    expect(planCost(input({ checkIn: '2026-12-30', checkOut: '2027-01-02', priceRows: mixed })).verifiedAt).toBeNull();
  });
});

describe('plan price properties', () => {
  const personArb = fc.record({
    key: fc.uuid().map((u) => `m:${u}`),
    label: fc.constant('P'),
    ageBracket: fc.constantFrom('adult' as const, 'child' as const, 'under3' as const),
    passType: fc.constant('none' as const),
  });
  // Contiguous, non-overlapping periods per plan from 2026-01-01, with random gaps and promotions.
  const periodsArb = fc
    .array(
      fc.record({
        length: fc.integer({ min: 1, max: 20 }),
        gapAfter: fc.integer({ min: 0, max: 2 }),
        adultCents: fc.integer({ min: 100, max: 20_000 }),
        childCents: fc.integer({ min: 100, max: 8_000 }),
        promo: fc.option(fc.integer({ min: 0, max: 2_000 }), { nil: null }),
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((specs) => {
      const rows: EnginePriceRow[] = [];
      let start = '2026-01-01';
      specs.forEach((s, i) => {
        const end = addDays(start, s.length - 1);
        rows.push({
          planCode: 'table_service', displayName: `Period ${i}`, validFrom: start, validTo: end, adultCents: s.adultCents, childCents: s.childCents,
          childPromoCents: s.promo, promoLabel: s.promo === null ? null : `Promo ${i}`, verifiedAt: null,
        });
        start = addDays(end, 1 + s.gapAfter);
      });
      return rows;
    });

  // Feature: dining-plan-calculator, Property 2: Plan cost is the sum of per-night prices
  // Validates: Requirements 2.4, 2.5, 2.7, 3.4, 3.5, 3.6, 13.2, 1.5
  it('Property 2: cost is the per-night, per-person sum, or the plan is unavailable with the stated reason', () => {
    fc.assert(
      fc.property(
        periodsArb,
        fc.array(personArb, { maxLength: 6 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 35 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<DiningPlanCode>(...DINING_PLAN_CODES),
        (rows, persons, offset, length, promoEligible, includeTax, disneyResort, plan) => {
          const checkIn = addDays('2026-01-01', offset);
          const checkOut = addDays(checkIn, length);
          // The generated periods are all table_service, so any other plan has no price for any night.
          const r = planCost({ plan, checkIn, checkOut, persons, priceRows: rows, disneyResort, promoEligible, planPricesIncludeTax: includeTax, taxBps: 650 });
          const eligible = persons.filter((p) => p.ageBracket !== 'under3');
          const nights = nightsOf(checkIn, checkOut);
          const covering = (d: string) => rows.find((row) => row.planCode === plan && row.validFrom <= d && d <= row.validTo) ?? null;

          let expectedReason: string | null = null;
          if (!disneyResort) expectedReason = 'not_disney_resort';
          else if (nights.length === 0) expectedReason = 'no_nights';
          else if (nights.length > 30) expectedReason = 'stay_too_long';
          else if (eligible.length === 0) expectedReason = 'no_eligible_guests';
          else if (nights.some((d) => covering(d) === null)) expectedReason = 'no_price_for_dates';

          expect(r.unavailableReason).toBe(expectedReason);
          expect(r.available).toBe(expectedReason === null);
          if (expectedReason !== null) {
            expect(r.cents).toBe(0);
            return;
          }
          let sum = 0;
          for (const d of nights) {
            const row = covering(d)!;
            for (const p of eligible) {
              sum += p.ageBracket === 'adult' ? row.adultCents : promoEligible && row.childPromoCents !== null ? row.childPromoCents : row.childCents;
            }
          }
          expect(r.cents).toBe(includeTax ? sum : sum + bpsOf(sum, 650));
          expect([...r.baseByPerson.values()].reduce((a, b) => a + b, 0)).toBe(sum);
          expect([...r.baseByPerson.keys()].sort()).toEqual([...new Set(eligible.map((p) => p.key))].sort());
          expect(Number.isSafeInteger(r.cents)).toBe(true);
          // Adding an under-3 Person never changes the cost.
          const withBaby = planCost({ plan, checkIn, checkOut, persons: [...persons, BABY], priceRows: rows, disneyResort, promoEligible, planPricesIncludeTax: includeTax, taxBps: 650 });
          expect(withBaby.cents).toBe(r.cents);
        },
      ),
      { numRuns: 300 },
    );
  });
});
