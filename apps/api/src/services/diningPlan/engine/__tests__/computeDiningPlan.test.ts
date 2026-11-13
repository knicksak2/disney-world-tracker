import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DINING_CONFIG_DEFAULTS,
  DINING_MENU_BASES,
  DINING_ORDER_STYLES,
  diningPlanSettingsSchema,
  type DiningPlanResultDTO,
  type DiningPlanSettingsInput,
} from '@dwt/shared';

import { computeDiningPlan } from '../computeDiningPlan.js';
import type { EngineEntry, EngineInput } from '../types.js';
import {
  A1,
  A2,
  BABY,
  C1,
  generatedInputArb,
  ID,
  LOCATIONS,
  placeholder,
  restaurant,
  SEEDED,
  SNACK_UNIT,
  toEngineInput,
  WORKED_ENTRIES,
} from './engineFixtures.js';

function engineInput(overrides: Partial<Omit<EngineInput, 'settings'>> & { settings?: DiningPlanSettingsInput } = {}): EngineInput {
  const { settings, ...rest } = overrides;
  return {
    persons: [A1, A2, C1],
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', source: 'trip' },
    entries: WORKED_ENTRIES,
    locations: LOCATIONS,
    priceRows: SEEDED,
    config: DINING_CONFIG_DEFAULTS,
    today: '2026-11-09',
    ...rest,
    settings: diningPlanSettingsSchema.parse(settings ?? {}),
  };
}

/** The result without its per-meal lines (pinned line by line in scenario.test.ts), plus a one-row summary per line. */
function summarize(r: DiningPlanResultDTO) {
  return {
    ...r,
    scenarios: r.scenarios.map(({ meals, bestCreditUses, ...rest }) => ({
      ...rest,
      meals: meals.map((m) => `${m.date} ${m.mealPeriod} ${m.label}: ${m.coverage} saves ${m.savingsCents} pays ${m.outOfPocketCents}${m.reason ? ` (${m.reason})` : ''}`),
      bestCreditUses: bestCreditUses.length,
    })),
  };
}

describe('computeDiningPlan: the worked example (golden)', () => {
  it('matches the hand-verified result', () => {
    // Hand-verified once from the per-Diner figures in scenario.test.ts:
    //   none   = food 29980 + tax 1952 + tip 3690 + 18 snacks x 692 (12456)        = 48078
    //   qs     = plan (2 x 6278 + 2582) x 5 = 75690 + Cinderella 25524 + 3 x 692    = 103290
    //   ts     = plan (2 x 9987 + 3194) x 5 = 115840 + 3 x 692                      = 117916
    //   deluxe = plan (2 x 16301 + 4685) x 5 = 186435 + 3 x 692                     = 188511
    // Best plan quick_service at -55212; the threshold is the $20 floor (2% of 48078 is 962): plan_costs_more.
    // Sensitivity only moves Pecos (menu_items): budget lunch 4623, splurge and max 5581 against typical 5049, so
    // No_Plan is 47226 / 48078 / 49142 / 49142 and quick_service stays best at -56064 / -55212 / -54148 / -54148.
    const golden = {
      computedForDate: '2026-11-09',
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', nights: 5, days: 6, source: 'trip' },
      eligibleCount: 3,
      scenarios: [
        {
          code: 'none', displayName: 'No Dining Plan', available: true, unavailableReason: null, planCostCents: 0, promoLabel: null,
          foodOutOfPocketCents: 29_980, taxCents: 1_952, tipCents: 3_690, snackOutOfPocketCents: 12_456, mugOutOfPocketCents: 0,
          totalCents: 48_078, netSavingsCents: 0, credits: null, priceVerifiedAt: null, bestCreditUses: 0,
          meals: [
            "2027-03-02 dinner Cinderella's Royal Table: none saves 0 pays 25524",
            '2027-03-03 lunch Pecos Bill Tall Tale Inn and Cafe: none saves 0 pays 5049',
            '2027-03-04 lunch Pecos Bill Tall Tale Inn and Cafe: none saves 0 pays 5049',
          ],
        },
        {
          code: 'quick_service', displayName: 'Quick-Service Dining Plan', available: true, unavailableReason: null, planCostCents: 75_690, promoLabel: null,
          foodOutOfPocketCents: 20_500, taxCents: 1_334, tipCents: 3_690, snackOutOfPocketCents: 3 * SNACK_UNIT, mugOutOfPocketCents: 0,
          totalCents: 103_290, netSavingsCents: -55_212, priceVerifiedAt: null, bestCreditUses: 2,
          credits: { ts: { issued: 0, used: 0, unused: 0 }, qs: { issued: 30, used: 6, unused: 24 }, snack: { issued: 15, used: 15, unused: 0 }, snacksPerDayToUseAll: 1, mugsCovered: 0 },
          meals: [
            "2027-03-02 dinner Cinderella's Royal Table: none saves 0 pays 25524 (no_matching_credits)",
            '2027-03-03 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
            '2027-03-04 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
          ],
        },
        {
          code: 'table_service', displayName: 'Table-Service Dining Plan', available: true, unavailableReason: null, planCostCents: 115_840, promoLabel: null,
          foodOutOfPocketCents: 0, taxCents: 0, tipCents: 0, snackOutOfPocketCents: 3 * SNACK_UNIT, mugOutOfPocketCents: 0,
          totalCents: 117_916, netSavingsCents: -69_838, priceVerifiedAt: null, bestCreditUses: 3,
          credits: { ts: { issued: 15, used: 6, unused: 9 }, qs: { issued: 15, used: 6, unused: 9 }, snack: { issued: 15, used: 15, unused: 0 }, snacksPerDayToUseAll: 1, mugsCovered: 0 },
          meals: [
            "2027-03-02 dinner Cinderella's Royal Table: all saves 25524 pays 0",
            '2027-03-03 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
            '2027-03-04 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
          ],
        },
        {
          code: 'deluxe', displayName: 'Deluxe Table-Service Dining Plan', available: true, unavailableReason: null, planCostCents: 186_435, promoLabel: null,
          foodOutOfPocketCents: 0, taxCents: 0, tipCents: 0, snackOutOfPocketCents: 3 * SNACK_UNIT, mugOutOfPocketCents: 0,
          totalCents: 188_511, netSavingsCents: -140_433, priceVerifiedAt: null, bestCreditUses: 3,
          credits: { ts: { issued: 30, used: 6, unused: 24 }, qs: { issued: 15, used: 6, unused: 9 }, snack: { issued: 15, used: 15, unused: 0 }, snacksPerDayToUseAll: 1, mugsCovered: 0 },
          meals: [
            "2027-03-02 dinner Cinderella's Royal Table: all saves 25524 pays 0",
            '2027-03-03 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
            '2027-03-04 lunch Pecos Bill Tall Tale Inn and Cafe: all saves 5049 pays 0',
          ],
        },
      ],
      recommended: 'none',
      verdict: 'plan_costs_more',
      bestPlan: 'quick_service',
      evenThresholdCents: 2_000,
      breakEvenGapCents: 55_212,
      sensitivity: [
        { orderStyle: 'budget', bestPlan: 'quick_service', recommended: 'none', netSavingsCents: -56_064 },
        { orderStyle: 'typical', bestPlan: 'quick_service', recommended: 'none', netSavingsCents: -55_212 },
        { orderStyle: 'splurge', bestPlan: 'quick_service', recommended: 'none', netSavingsCents: -54_148 },
        { orderStyle: 'max_value', bestPlan: 'quick_service', recommended: 'none', netSavingsCents: -54_148 },
      ],
      dataQuality: {
        byBasis: { admin_override: 1, menu_offer: 0, menu_items: 2, menu_estimate: 0, tier_estimate: 0, default_estimate: 0 },
        estimatedEntries: 0,
        unverifiedRules: 0,
        derivedRules: 2, // Pecos twice: no stored rule
        unverifiedPrices: 3, // the 2027 quick-service, table-service and deluxe periods
        outsideStayEntries: 0,
      },
      assumptions: { taxBps: 650, taxIsDefault: true, tipBps: 1800, tipIsDefault: true, planPricesIncludeTax: true, passDiscountBps: null, pricesAsOf: null },
      warnings: [],
    };
    expect(summarize(computeDiningPlan(engineInput()))).toEqual(golden);
  });
});

describe('computeDiningPlan: verdicts and reporting', () => {
  const HDD_INPUT = engineInput({
    persons: [A1, A2],
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-03', source: 'custom' },
    entries: [
      placeholder('2027-03-01', 'lunch', 'quick_service'),
      restaurant('2027-03-01', 'dinner', ID.hoopDeeDoo),
      placeholder('2027-03-02', 'lunch', 'quick_service'),
      restaurant('2027-03-02', 'dinner', ID.hoopDeeDoo),
    ],
  });

  it('recommends the table-service plan when it saves more than the threshold (two Hoop-Dee-Doo dinners)', () => {
    // Per adult, No_Plan: 2 x (8000 + 520 tax + 1440 tip) + 2 x (1800 + 117) + 3 snacks x 692 = 25830; two adults 51660.
    // Table service: 2 x 2 x 9987 = 39948, every meal covered and both tips waived, 1 snack each uncovered: 41332.
    const r = computeDiningPlan(HDD_INPUT);
    const byCode = Object.fromEntries(r.scenarios.map((s) => [s.code, s]));
    expect(byCode.none!.totalCents).toBe(51_660);
    expect(byCode.table_service!.totalCents).toBe(41_332);
    expect(byCode.quick_service!.totalCents).toBe(25_112 + 39_840 + 1_384);
    expect(byCode.deluxe!.totalCents).toBe(65_204 + 1_384);
    expect(r).toMatchObject({
      verdict: 'plan_saves', recommended: 'table_service', bestPlan: 'table_service', evenThresholdCents: 2_000, breakEvenGapCents: 0,
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-03', nights: 2, days: 3, source: 'custom' },
    });
    expect(byCode.table_service!.netSavingsCents).toBe(10_328);
    // The placeholders are default estimates; Hoop-Dee-Doo is a stored unverified rule; no derived rules (placeholders have no location).
    expect(r.dataQuality).toMatchObject({ estimatedEntries: 2, unverifiedRules: 2, derivedRules: 0 });
    expect(r.dataQuality.byBasis).toMatchObject({ admin_override: 2, default_estimate: 2 });
  });

  it('returns the plan costs and a no_entries warning when there are no meals', () => {
    const r = computeDiningPlan(engineInput({ entries: [] }));
    expect(r.warnings).toEqual([{ code: 'no_entries' }]);
    expect(r.scenarios.find((s) => s.code === 'table_service')!.planCostCents).toBe(115_840);
    expect(computeDiningPlan(engineInput({ entries: [WORKED_ENTRIES[3]!] })).warnings).toEqual([{ code: 'no_entries' }]);
  });

  it('warns about entries outside the stay, counts them, and leaves every total unchanged', () => {
    const outside = [restaurant('2027-02-28', 'dinner', ID.crt), restaurant('2027-03-07', 'breakfast', ID.akershus)];
    const base = computeDiningPlan(engineInput());
    const r = computeDiningPlan(engineInput({ entries: [...WORKED_ENTRIES, ...outside] }));
    expect(r.warnings).toEqual([
      { code: 'outside_stay', date: '2027-02-28', mealPeriod: 'dinner' },
      { code: 'outside_stay', date: '2027-03-07', mealPeriod: 'breakfast' },
    ]);
    expect(r.dataQuality.outsideStayEntries).toBe(2);
    expect(r.scenarios).toEqual(base.scenarios);
  });

  it('is plan_unavailable off-site, still pricing No_Plan', () => {
    const r = computeDiningPlan(engineInput({ settings: { stayType: 'not_disney_resort' } }));
    expect(r).toMatchObject({ verdict: 'plan_unavailable', recommended: 'none', bestPlan: null, breakEvenGapCents: 0 });
    expect(r.scenarios[0]!.totalCents).toBe(48_078);
    expect(r.dataQuality.unverifiedPrices).toBe(0);
    expect(r.sensitivity.every((s) => s.bestPlan === null && s.netSavingsCents === 0)).toBe(true);
  });

  it('counts a derived rule only for a restaurant without a stored rule, and estimated entries only for tier and default', () => {
    // Tiered Grill: no stored rule, no menus, '$$$' -> tier_estimate on a derived rule.
    const r = computeDiningPlan(engineInput({ entries: [restaurant('2027-03-02', 'dinner', ID.tiered), restaurant('2027-03-03', 'dinner', ID.crt)] }));
    expect(r.dataQuality).toEqual({
      byBasis: { admin_override: 1, menu_offer: 0, menu_items: 0, menu_estimate: 0, tier_estimate: 1, default_estimate: 0 },
      estimatedEntries: 1, unverifiedRules: 0, derivedRules: 1, unverifiedPrices: 3, outsideStayEntries: 0,
    });
  });

  it('counts a snack-only entry under default_estimate but not as an estimated meal', () => {
    const r = computeDiningPlan(engineInput({ entries: [restaurant('2027-03-02', 'lunch', ID.dole)] }));
    expect(r.dataQuality).toMatchObject({ estimatedEntries: 0, unverifiedRules: 1, derivedRules: 0 });
    expect(r.dataQuality.byBasis.default_estimate).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it('reports a result whose only quality count is derivedRules with every other count at zero', () => {
    const verifiedPrices = SEEDED.map((p) => ({ ...p, verifiedAt: '2026-11-09' }));
    const r = computeDiningPlan(engineInput({ entries: [restaurant('2027-03-03', 'lunch', ID.pecos)], priceRows: verifiedPrices }));
    expect(r.dataQuality).toMatchObject({ estimatedEntries: 0, unverifiedRules: 0, unverifiedPrices: 0, derivedRules: 1 });
    expect(r.assumptions.pricesAsOf).toBe('2026-11-09');
  });

  it('reports the pass discount, custom rates and the verified prices date in assumptions', () => {
    const verified = SEEDED.map((p) => ({ ...p, verifiedAt: p.planCode === 'deluxe' ? '2026-11-20' : '2026-11-09' }));
    const r = computeDiningPlan(engineInput({ persons: [{ ...A1, passType: 'dvc' }, A2], priceRows: verified, settings: { taxBps: 700, tipBps: 2000 } }));
    expect(r.assumptions).toEqual({ taxBps: 700, taxIsDefault: false, tipBps: 2000, tipIsDefault: false, planPricesIncludeTax: true, passDiscountBps: 1000, pricesAsOf: '2026-11-20' });
  });

  it('reports no prices-as-of date when any period in use is unverified, and counts only the unverified ones', () => {
    const mixed = SEEDED.map((p) => ({ ...p, verifiedAt: p.planCode === 'deluxe' ? null : '2026-11-09' }));
    const r = computeDiningPlan(engineInput({ priceRows: mixed }));
    expect(r.assumptions.pricesAsOf).toBeNull();
    expect(r.dataQuality.unverifiedPrices).toBe(1);
    expect(r.scenarios.find((s) => s.code === 'table_service')!.priceVerifiedAt).toBe('2026-11-09');
    expect(r.scenarios.find((s) => s.code === 'deluxe')!.priceVerifiedAt).toBeNull();
  });

  it('ignores an entry whose Experience is unknown (the service reports it)', () => {
    const unknown = restaurant('2027-03-05', 'lunch', '00000000-0000-4000-8000-0000000000ff');
    expect(computeDiningPlan(engineInput({ entries: [...WORKED_ENTRIES, unknown] })).scenarios).toEqual(computeDiningPlan(engineInput()).scenarios);
  });
});

describe('engine properties', () => {
  // Feature: dining-plan-calculator, Property 25: The engine is pure and deterministic
  // Validates: Requirements 16.9, 23.4
  it('Property 25: equal results on repeat calls, no input mutation, and Party order does not matter without appetizers', () => {
    fc.assert(
      fc.property(generatedInputArb({ appetizers: false }), (single) => {
        const input = toEngineInput(single);
        const snapshot = JSON.stringify({ ...input, locations: [...input.locations.entries()] });
        const first = computeDiningPlan(input);
        expect(computeDiningPlan(input)).toEqual(first);
        expect(JSON.stringify({ ...input, locations: [...input.locations.entries()] })).toBe(snapshot);
        expect(computeDiningPlan({ ...input, persons: [...input.persons].reverse() })).toEqual(first);
      }),
      { numRuns: 60 },
    );
  });

  // Feature: dining-plan-calculator, Property 26: Sensitivity agrees with the main result
  // Validates: Requirements 15.1
  it('Property 26: one sensitivity row per order style; each equals a full run with that style; the current row equals the main result', () => {
    fc.assert(
      fc.property(generatedInputArb(), (single) => {
        const input = toEngineInput(single);
        const r = computeDiningPlan(input);
        expect(r.sensitivity.map((s) => s.orderStyle)).toEqual([...DINING_ORDER_STYLES]);
        const bestNet = (x: DiningPlanResultDTO) => x.scenarios.find((s) => s.code === x.bestPlan)?.netSavingsCents ?? 0;
        for (const row of r.sensitivity) {
          const other = computeDiningPlan({ ...input, settings: { ...input.settings, orderStyle: row.orderStyle } });
          expect(row).toEqual({
            orderStyle: row.orderStyle,
            bestPlan: other.bestPlan,
            recommended: other.recommended,
            netSavingsCents: bestNet(other),
          });
        }
        const current = r.sensitivity.find((s) => s.orderStyle === input.settings.orderStyle)!;
        expect(current).toEqual({
          orderStyle: input.settings.orderStyle,
          bestPlan: r.bestPlan,
          recommended: r.recommended,
          netSavingsCents: bestNet(r),
        });
      }),
      { numRuns: 40 },
    );
  });

  // Feature: dining-plan-calculator, Property 19: Stay and slot handling (outside-stay half)
  // Feature: dining-plan-calculator, Property 13: Menu basis follows the precedence order (counts half)
  // Validates: Requirements 4.6, 4.7, 7.9, 15.2
  it('Properties 19 and 13: outside-stay entries are warned, counted and inert; basis counts add up to the in-stay entries', () => {
    fc.assert(
      fc.property(generatedInputArb(), (single) => {
        const input = toEngineInput(single);
        const r = computeDiningPlan(input);
        const outside = input.entries.filter((e) => e.date < input.stay.checkIn || e.date > input.stay.checkOut);
        expect(r.dataQuality.outsideStayEntries).toBe(outside.length);
        expect(r.warnings.filter((w) => w.code === 'outside_stay')).toEqual(outside.map((e) => ({ code: 'outside_stay', date: e.date, mealPeriod: e.mealPeriod })));
        const inside: EngineEntry[] = input.entries.filter((e) => !outside.includes(e));
        expect(computeDiningPlan({ ...input, entries: inside }).scenarios).toEqual(r.scenarios);
        const counted = DINING_MENU_BASES.reduce((a, b) => a + r.dataQuality.byBasis[b], 0);
        expect(counted).toBe(r.scenarios[0]!.meals.length);
        expect(r.dataQuality.estimatedEntries).toBeLessThanOrEqual(counted);
        expect(r.warnings.some((w) => w.code === 'no_entries')).toBe(counted === 0);
        // An under-3 Person changes nothing in any scenario.
        expect(computeDiningPlan({ ...input, persons: [...input.persons, BABY] }).scenarios).toEqual(r.scenarios);
      }),
      { numRuns: 60 },
    );
  });
});
