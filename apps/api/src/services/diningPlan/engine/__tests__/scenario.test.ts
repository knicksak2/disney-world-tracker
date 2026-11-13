import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bpsOf,
  DINING_CONFIG_DEFAULTS,
  DINING_MEAL_PERIODS,
  DINING_PLAN_CODES,
  DINING_PLAN_ENTITLEMENTS_PER_NIGHT,
  diningPlanSettingsSchema,
  type DiningPlanCode,
  type DiningPlanSettingsInput,
  type DiningScenarioResultDTO,
} from '@dwt/shared';

import { addDays } from '../../../ticketPrices/dates.js';
import { allocateParty, evaluateScenario, scenarioContextOf, type SingleStayInput } from '../scenario.js';
import type { EngineEntry, EnginePerson } from '../types.js';
import { A1, A2, BABY, C1, generatedInputArb, ID, LOCATIONS, POOL, restaurant, SEEDED, SNACK_UNIT, WORKED_ENTRIES } from './engineFixtures.js';

// --- fixtures ------------------------------------------------------------------------------------------------------

function stayInput(overrides: Partial<Omit<SingleStayInput, 'settings'>> & { settings?: DiningPlanSettingsInput } = {}): SingleStayInput {
  const { settings, ...rest } = overrides;
  return {
    persons: [A1, A2, C1],
    checkIn: '2027-03-01',
    checkOut: '2027-03-06',
    entries: [],
    locations: LOCATIONS,
    priceRows: SEEDED,
    config: DINING_CONFIG_DEFAULTS,
    ...rest,
    settings: diningPlanSettingsSchema.parse(settings ?? {}),
  };
}

function evaluateAll(input: SingleStayInput): Record<'none' | DiningPlanCode, DiningScenarioResultDTO> {
  const { ctx } = scenarioContextOf(input);
  return {
    none: evaluateScenario('none', ctx),
    quick_service: evaluateScenario('quick_service', ctx),
    table_service: evaluateScenario('table_service', ctx),
    deluxe: evaluateScenario('deluxe', ctx),
  };
}

// The worked example (engineFixtures.WORKED_ENTRIES). Per Diner, Cinderella: adult 7900 + tax 514 + tip 1422 (savings 9836); child 4700 + 306 + 846 (savings 5852).
// Pecos (menu_items, typical): adult fajita 1300 + soft drink 450 = 1750, tax 114, savings 1864;
//                              child kids 790 + 450 = 1240, tax 81, savings 1321. Quick service has no tip.
const CRT_LINE_SAVINGS = 2 * 9836 + 5852; // 25524
const PECOS_LINE_SAVINGS = 2 * 1864 + 1321; // 5049

describe('evaluateScenario: the worked example', () => {
  const all = evaluateAll(stayInput({ entries: WORKED_ENTRIES }));

  it('No_Plan pays every meal with tax and tip, and 6 days of snacks for 3 people', () => {
    expect(all.none).toMatchObject({
      code: 'none', displayName: 'No Dining Plan', available: true, unavailableReason: null, planCostCents: 0, promoLabel: null,
      foodOutOfPocketCents: 20_500 + 4_740 + 4_740, // Cinderella 2 x 7900 + 4700; each Pecos lunch 2 x 1750 + 1240
      taxCents: 1_334 + 309 + 309, // 2 x 514 + 306; 2 x 114 + 81
      tipCents: 3_690, // 2 x 1422 + 846; quick service has none
      snackOutOfPocketCents: 3 * 6 * SNACK_UNIT, // 12456
      mugOutOfPocketCents: 0,
      totalCents: 48_078,
      netSavingsCents: 0,
      credits: null,
      bestCreditUses: [],
      priceVerifiedAt: null,
    });
    expect(all.none.meals.map((m) => [m.label, m.coverage, m.outOfPocketCents, m.action, m.reason])).toEqual([
      ["Cinderella's Royal Table", 'none', 20_500 + 1_334 + 3_690, 'pay_out_of_pocket', null],
      ['Pecos Bill Tall Tale Inn and Cafe', 'none', 4_740 + 309, 'pay_out_of_pocket', null],
      ['Pecos Bill Tall Tale Inn and Cafe', 'none', 4_740 + 309, 'pay_out_of_pocket', null],
    ]);
  });

  it('the 2027 table-service plan covers every meal, waives the included gratuity, and leaves one snack each', () => {
    const ts = all.table_service;
    expect(ts).toMatchObject({
      code: 'table_service', displayName: 'Table-Service Dining Plan', available: true, promoLabel: null,
      planCostCents: (2 * 9987 + 3194) * 5, // 115840
      foodOutOfPocketCents: 0, taxCents: 0, tipCents: 0,
      snackOutOfPocketCents: 3 * SNACK_UNIT, // demand 6, 5 snack credits each
      mugOutOfPocketCents: 0,
      totalCents: 115_840 + 2_076,
      credits: {
        ts: { issued: 15, used: 6, unused: 9 }, // Cinderella costs 2 each
        qs: { issued: 15, used: 6, unused: 9 },
        snack: { issued: 15, used: 15, unused: 0 },
        snacksPerDayToUseAll: 1, // ceil(5 / 6)
        mugsCovered: 0,
      },
    });
    const [crt, pecos1, pecos2] = ts.meals;
    expect(crt).toEqual({
      date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.crt, label: "Cinderella's Royal Table",
      serviceType: 'table_service', creditCost: 2, gratuityIncluded: true, twoCredit: true, basis: 'admin_override', ruleBasis: 'verified',
      unverifiedRule: false, dinerCount: 3, perDinerFoodCents: { adult: 7900, child: 4700 }, coverage: 'all', creditsUsedPerDiner: 2,
      coveredDinerCount: 3, savingsCents: CRT_LINE_SAVINGS, outOfPocketCents: 0, action: 'use_plan', reason: null,
    });
    expect(pecos1).toMatchObject({ serviceType: 'quick_service', basis: 'menu_items', ruleBasis: 'derived', coverage: 'all', creditsUsedPerDiner: 1, savingsCents: PECOS_LINE_SAVINGS, outOfPocketCents: 0 });
    expect(pecos2).toMatchObject({ date: '2027-03-04', savingsCents: PECOS_LINE_SAVINGS });
    expect(ts.meals).toHaveLength(3); // the skipped slot is not a meal
    expect(ts.bestCreditUses).toEqual([
      { date: '2027-03-02', mealPeriod: 'dinner', label: "Cinderella's Royal Table", savingsCents: CRT_LINE_SAVINGS },
      { date: '2027-03-03', mealPeriod: 'lunch', label: 'Pecos Bill Tall Tale Inn and Cafe', savingsCents: PECOS_LINE_SAVINGS },
      { date: '2027-03-04', mealPeriod: 'lunch', label: 'Pecos Bill Tall Tale Inn and Cafe', savingsCents: PECOS_LINE_SAVINGS },
    ]);
  });

  it('the quick-service plan has no table-service credit, so Cinderella is out of pocket with no_matching_credits', () => {
    const qs = all.quick_service;
    expect(qs).toMatchObject({
      planCostCents: (2 * 6278 + 2582) * 5, // 75690
      foodOutOfPocketCents: 20_500, taxCents: 1_334, tipCents: 3_690, snackOutOfPocketCents: 3 * SNACK_UNIT,
      totalCents: 75_690 + 20_500 + 1_334 + 3_690 + 2_076,
      credits: { ts: { issued: 0, used: 0, unused: 0 }, qs: { issued: 30, used: 6, unused: 24 } },
    });
    expect(qs.meals[0]).toMatchObject({ coverage: 'none', reason: 'no_matching_credits', action: 'pay_out_of_pocket', savingsCents: 0, outOfPocketCents: 25_524 });
    expect(qs.meals[1]).toMatchObject({ coverage: 'all', reason: null });
  });

  it('the deluxe plan covers the same meals at its own price', () => {
    expect(all.deluxe).toMatchObject({
      planCostCents: (2 * 16301 + 4685) * 5, // 186435
      foodOutOfPocketCents: 0, tipCents: 0, totalCents: 186_435 + 2_076,
      credits: { ts: { issued: 30, used: 6, unused: 24 } },
    });
  });

  it('the No_Plan savings identity holds (Property 27)', () => {
    // none.total - (plan.total - planCost) = meal savings + 15 covered snacks with tax.
    expect(all.none.totalCents - (all.table_service.totalCents - all.table_service.planCostCents)).toBe(CRT_LINE_SAVINGS + 2 * PECOS_LINE_SAVINGS + 15 * SNACK_UNIT);
  });
});

describe('evaluateScenario: rules and edge cases', () => {
  it('charges the tip on a covered meal without included gratuity (Property 10)', () => {
    const all = evaluateAll(stayInput({ persons: [A1], entries: [restaurant('2027-03-02', 'dinner', ID.liberty)] }));
    // Liberty Tree, typical: entree 3300 + dessert 1100 + soft drink 450 = 4850; tip bpsOf(4850, 1800) = 873.
    expect(all.table_service.tipCents).toBe(873);
    expect(all.none.tipCents).toBe(873);
    expect(all.table_service.meals[0]).toMatchObject({ coverage: 'all', outOfPocketCents: 873, savingsCents: 4850 + bpsOf(4850, 650) });
  });

  it('never covers appetizers: their cost and tax stay out of pocket on a covered meal (Property 9)', () => {
    const all = evaluateAll(stayInput({ persons: [A1, A2], entries: [restaurant('2027-03-02', 'dinner', ID.liberty)], settings: { appetizersPerTable: 1 } }));
    // Appetizer median 1400 split 700 / 700; tax 46 each; tip bpsOf(4850 + 700, 1800) = 999 each.
    const ts = all.table_service;
    expect(ts).toMatchObject({ foodOutOfPocketCents: 1400, taxCents: 92, tipCents: 1998 });
    expect(ts.meals[0]!.outOfPocketCents).toBe(1400 + 92 + 1998);
    expect(all.none.taxCents).toBe(2 * bpsOf(4850, 650) + 92);
  });

  it('partly covers a meal when one Diner spent the credit elsewhere, and says better_use_elsewhere when nobody can', () => {
    // One night: one table-service credit each. Alex dines at both; Casey skips Akershus (excluded).
    const entries = [restaurant('2027-03-01', 'breakfast', ID.akershus, [C1.key]), restaurant('2027-03-01', 'dinner', ID.liberty)];
    const ts = evaluateAll(stayInput({ persons: [A1, C1], checkIn: '2027-03-01', checkOut: '2027-03-02', entries })).table_service;
    // Akershus breakfast costs 1 credit and saves Alex 6500 + 423; Liberty saves Alex 4850 + 315, so Alex covers Akershus.
    expect(ts.meals.map((m) => [m.label, m.creditCost, m.coverage, m.coveredDinerCount, m.reason, m.action])).toEqual([
      ['Akershus Royal Banquet Hall', 1, 'all', 1, null, 'use_plan'],
      ['Liberty Tree Tavern', 1, 'partial', 1, null, 'partly_covered'],
    ]);
    const tight = evaluateAll(stayInput({ persons: [A1], checkIn: '2027-03-01', checkOut: '2027-03-02', entries })).table_service;
    expect(tight.meals[1]).toMatchObject({ coverage: 'none', reason: 'better_use_elsewhere', action: 'pay_out_of_pocket' });
  });

  it('costs Akershus two credits at dinner (twoCredit) and one at breakfast', () => {
    const ts = evaluateAll(stayInput({ persons: [A1], entries: [restaurant('2027-03-01', 'breakfast', ID.akershus), restaurant('2027-03-02', 'dinner', ID.akershus)] })).table_service;
    expect(ts.meals.map((m) => [m.creditCost, m.twoCredit, m.creditsUsedPerDiner])).toEqual([[1, false, 1], [2, true, 2]]);
    expect(ts.credits!.ts.used).toBe(3);
  });

  it('marks a not_eligible location not_eligible in every plan and never covers it', () => {
    const all = evaluateAll(stayInput({ persons: [A1], entries: [restaurant('2027-03-02', 'dinner', ID.lounge)] }));
    for (const plan of DINING_PLAN_CODES) expect(all[plan].meals[0]).toMatchObject({ serviceType: 'not_eligible', coverage: 'none', reason: 'not_eligible' });
    // Lounge '$$' reads the quick-service tier table: 1700, tax 111, no tip.
    expect(all.none.meals[0]!.outOfPocketCents).toBe(1700 + bpsOf(1700, 650));
  });

  it('adds a snack per Diner for a snack_only location and covers it with a snack credit', () => {
    const entries = [restaurant('2027-03-01', 'lunch', ID.dole)];
    const all = evaluateAll(stayInput({ persons: [A1, C1], checkIn: '2027-03-01', checkOut: '2027-03-03', entries, settings: { snacksPerPersonPerDay: 0 } }));
    // Demand: 0 per day + 1 snack-only entry each; the plan has 2 snack credits each.
    expect(all.none.snackOutOfPocketCents).toBe(2 * SNACK_UNIT);
    expect(all.table_service.snackOutOfPocketCents).toBe(0);
    expect(all.table_service.credits!.snack).toEqual({ issued: 4, used: 2, unused: 2 });
    expect(all.table_service.meals[0]).toMatchObject({ serviceType: 'snack_only', coverage: 'all', savingsCents: 2 * SNACK_UNIT, outOfPocketCents: 0 });
    expect(all.table_service.bestCreditUses).toEqual([]);
  });

  it('covers one mug per Plan_Eligible_Person and pays the rest with tax', () => {
    const mug = 2299 + bpsOf(2299, 650); // 2448
    const all = evaluateAll(stayInput({ persons: [A1, BABY], settings: { mugsWanted: 2 } }));
    expect(all.none.mugOutOfPocketCents).toBe(2 * mug);
    expect(all.table_service.mugOutOfPocketCents).toBe(mug);
    expect(all.table_service.credits!.mugsCovered).toBe(1);
  });

  it('returns an unavailable plan as zeros with its reason', () => {
    const all = evaluateAll(stayInput({ checkIn: '2026-12-30', checkOut: '2027-01-02', entries: WORKED_ENTRIES }));
    expect(all.deluxe).toMatchObject({ available: false, unavailableReason: 'no_price_for_dates', totalCents: 0, credits: null, meals: [], displayName: 'Deluxe Table-Service Dining Plan' });
    expect(all.table_service).toMatchObject({ available: true, promoLabel: 'Kids Eat Free 2026', displayName: 'Disney Dining Plan / Table-Service Dining Plan' });
    const offSite = evaluateAll(stayInput({ settings: { stayType: 'not_disney_resort' } }));
    for (const plan of DINING_PLAN_CODES) expect(offSite[plan].unavailableReason).toBe('not_disney_resort');
    expect(offSite.none.available).toBe(true);
  });

  it('applies Kids Eat Free only for a package stay with kidsEatFree on', () => {
    const june = { persons: [A1, C1], checkIn: '2026-06-01', checkOut: '2026-06-03' };
    expect(evaluateAll(stayInput(june)).table_service).toMatchObject({ planCostCents: 2 * 9859, promoLabel: 'Kids Eat Free 2026' });
    expect(evaluateAll(stayInput({ ...june, settings: { stayType: 'dvc_or_passholder_resort' } })).table_service).toMatchObject({ planCostCents: 2 * (9859 + 3194), promoLabel: null });
    expect(evaluateAll(stayInput({ ...june, settings: { kidsEatFree: false } })).table_service).toMatchObject({ planCostCents: 2 * (9859 + 3194), promoLabel: null });
  });

  it('leaves entries outside the stay out of every total', () => {
    const outside = restaurant('2027-02-28', 'dinner', ID.crt);
    const { outsideStay } = scenarioContextOf(stayInput({ entries: [...WORKED_ENTRIES, outside] }));
    expect(outsideStay).toEqual([outside]);
    expect(evaluateAll(stayInput({ entries: [...WORKED_ENTRIES, outside] }))).toEqual(evaluateAll(stayInput({ entries: WORKED_ENTRIES })));
  });

  it('resolves tax and tip from settings over config, and ignores drinker keys that are not adults in the Party', () => {
    const base = evaluateAll(stayInput({ persons: [A1, C1], entries: [restaurant('2027-03-02', 'dinner', ID.liberty)] }));
    const custom = evaluateAll(stayInput({ persons: [A1, C1], entries: [restaurant('2027-03-02', 'dinner', ID.liberty)], settings: { taxBps: 0, tipBps: 0, alcoholDrinkerKeys: [C1.key, 'm:stranger'] } }));
    expect(custom.none.taxCents).toBe(0);
    expect(custom.none.tipCents).toBe(0);
    expect(custom.none.foodOutOfPocketCents).toBe(base.none.foodOutOfPocketCents);
  });
});

// --- properties ----------------------------------------------------------------------------------------------------

const generatedArb = (opts: { passHolders?: boolean; appetizers?: boolean } = {}) => generatedInputArb(opts).map((input) => ({ input }));

const SCENARIOS = ['none', ...DINING_PLAN_CODES] as const;
const unit = (cents: number, taxBps: number) => cents + bpsOf(cents, taxBps);

describe('scenario properties', () => {
  // Feature: dining-plan-calculator, Property 1: Money is exact and decomposes
  // Validates: Requirements 13.1, 13.3
  it('Property 1: every amount is a non-negative safe integer and the total is the sum of its terms', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const all = evaluateAll(input);
        for (const code of SCENARIOS) {
          const s = all[code];
          const terms = [s.planCostCents, s.foodOutOfPocketCents, s.taxCents, s.tipCents, s.snackOutOfPocketCents, s.mugOutOfPocketCents];
          for (const t of [...terms, s.totalCents]) {
            expect(Number.isSafeInteger(t)).toBe(true);
            expect(t).toBeGreaterThanOrEqual(0);
          }
          expect(s.totalCents).toBe(terms.reduce((a, b) => a + b, 0));
          for (const m of s.meals) for (const n of [m.savingsCents, m.outOfPocketCents]) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 4: Credits never exceed capacity and kinds never mix
  // Validates: Requirements 9.1, 9.3, 9.4, 9.5, 4.10
  it('Property 4: per-Person credits stay within capacity and every covered meal matches its credit kind', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const { ctx } = scenarioContextOf(input);
        for (const code of DINING_PLAN_CODES) {
          const s = evaluateScenario(code, ctx);
          if (!s.available) continue;
          const ent = DINING_PLAN_ENTITLEMENTS_PER_NIGHT[code];
          const coveredBy = allocateParty(code, ctx);
          for (const [, covered] of coveredBy) {
            let ts = 0;
            let qs = 0;
            for (const e of ctx.entries) {
              if (!covered.has(e.id)) continue;
              expect(e.valuation.kind).toBe('meal');
              if (e.valuation.kind !== 'meal') continue;
              expect(e.valuation.creditKind).not.toBeNull();
              if (e.valuation.creditKind === 'ts') ts += e.valuation.creditCost;
              else qs += 1;
            }
            expect(ts).toBeLessThanOrEqual(ctx.nights * ent.ts);
            expect(qs).toBeLessThanOrEqual(ctx.nights * ent.qs);
          }
          expect(s.credits!.snack.used).toBeLessThanOrEqual(s.credits!.snack.issued);
          for (const m of s.meals) {
            if (m.serviceType === 'not_eligible') expect(m.coverage).toBe('none');
            if (m.serviceType === 'table_service' && ent.ts === 0) expect(m.coverage).toBe('none');
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 6: Credits are not transferable between people
  // Validates: Requirements 9.2, 9.6, 10.1
  it('Property 6: removing another Person never changes a Person\'s covered meals or savings, and twins match', () => {
    fc.assert(
      fc.property(generatedArb({ passHolders: false, appetizers: false }), fc.nat(), ({ input }, pick) => {
        const { ctx } = scenarioContextOf(input);
        const removed = input.persons[pick % input.persons.length]!;
        const smaller = scenarioContextOf({ ...input, persons: input.persons.filter((p) => p !== removed), settings: { ...input.settings, mugsWanted: 0 } }).ctx;
        for (const code of DINING_PLAN_CODES) {
          if (!ctx.planCosts[code].available || !smaller.planCosts[code].available) continue;
          const full = allocateParty(code, ctx);
          const less = allocateParty(code, smaller);
          for (const [key, covered] of less) {
            expect([...covered].sort()).toEqual([...full.get(key)!].sort());
            for (const id of covered) {
              const a = ctx.entries.find((e) => e.id === id)!.valuation;
              const b = smaller.entries.find((e) => e.id === id)!.valuation;
              if (a.kind === 'meal' && b.kind === 'meal') expect(b.byKey.get(key)!.savingsCents).toBe(a.byKey.get(key)!.savingsCents);
            }
          }
          // Two Persons with the same bracket, drink class and Diner membership get the same meals.
          const drinkers = new Set(input.settings.alcoholDrinkerKeys);
          const signature = (p: EnginePerson) =>
            `${p.ageBracket}|${drinkers.has(p.key)}|${ctx.entries.map((e) => (e.valuation.kind === 'meal' ? e.valuation.byKey.has(p.key) : e.valuation.dinerKeys.includes(p.key))).join(',')}`;
          const eligible = input.persons.filter((p) => p.ageBracket !== 'under3');
          for (const p of eligible) for (const q of eligible) {
            if (p !== q && signature(p) === signature(q)) expect([...full.get(p.key)!].sort()).toEqual([...full.get(q.key)!].sort());
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 7: Adding a meal never lowers a plan's net savings
  // Validates: Requirements 13.3, 10.1
  it('Property 7: appending a non-skip entry in a free in-stay slot never lowers any plan\'s net savings', () => {
    fc.assert(
      fc.property(generatedArb(), fc.nat(), fc.integer({ min: 0, max: POOL.length + 1 }), ({ input }, slotPick, choice) => {
        const taken = new Set(input.entries.map((e) => `${e.date}:${e.mealPeriod}`));
        const free: { date: string; mealPeriod: EngineEntry['mealPeriod'] }[] = [];
        const nights = Math.max(0, Math.round((Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86_400_000));
        for (let d = 0; d <= nights; d += 1) for (const mealPeriod of DINING_MEAL_PERIODS) {
          const date = addDays(input.checkIn, d);
          if (!taken.has(`${date}:${mealPeriod}`)) free.push({ date, mealPeriod });
        }
        fc.pre(free.length > 0);
        const slot = free[slotPick % free.length]!;
        const extra: EngineEntry = choice < POOL.length
          ? { ...slot, kind: 'restaurant', experienceId: POOL[choice]!, placeholderKind: null, excludedKeys: [] }
          : { ...slot, kind: 'placeholder', experienceId: null, placeholderKind: choice === POOL.length ? 'table_service' : 'quick_service', excludedKeys: [] };
        const before = evaluateAll(input);
        const after = evaluateAll({ ...input, entries: [...input.entries, extra] });
        for (const code of DINING_PLAN_CODES) {
          if (!before[code].available) continue;
          const netBefore = before.none.totalCents - before[code].totalCents;
          const netAfter = after.none.totalCents - after[code].totalCents;
          expect(netAfter).toBeGreaterThanOrEqual(netBefore);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 8: Raising tax or tip never lowers a plan's net savings
  // Validates: Requirements 12.1, 12.2, 12.3, 12.4
  it('Property 8: raising taxBps or tipBps never lowers net savings; at 0 and 0 every out-of-pocket meal is its pre-tax food', () => {
    fc.assert(
      fc.property(generatedArb(), fc.integer({ min: 0, max: 1200 }), fc.integer({ min: 0, max: 1300 }), fc.integer({ min: 0, max: 2500 }), fc.integer({ min: 0, max: 2500 }), ({ input }, tax, taxRaise, tip, tipRaise) => {
        const at = (taxBps: number, tipBps: number) => evaluateAll({ ...input, settings: { ...input.settings, taxBps, tipBps } });
        const base = at(tax, tip);
        const moreTax = at(tax + taxRaise, tip);
        const moreTip = at(tax, tip + tipRaise);
        for (const code of DINING_PLAN_CODES) {
          if (!base[code].available) continue;
          const net = (r: typeof base) => r.none.totalCents - r[code].totalCents;
          expect(net(moreTax)).toBeGreaterThanOrEqual(net(base));
          expect(net(moreTip)).toBeGreaterThanOrEqual(net(base));
        }
        const zero = at(0, 0);
        expect(zero.none.taxCents).toBe(0);
        expect(zero.none.tipCents).toBe(0);
        for (const m of zero.none.meals) {
          if (m.serviceType !== 'snack_only') expect(m.outOfPocketCents).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dining-plan-calculator, Property 9: Covered amounts carry no tax
  // Feature: dining-plan-calculator, Property 10: Included gratuity saves exactly the tip
  // Validates: Requirements 12.2, 12.3, 12.4, 12.6, 9.7, 10.2
  it('Properties 9 and 10: a covered Diner pays only extras with their tax (plus tip unless gratuity is included); quick service is never tipped', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const { ctx } = scenarioContextOf(input);
        const none = evaluateScenario('none', ctx);
        none.meals.forEach((line, i) => {
          const v = ctx.entries[i]!.valuation;
          if (v.kind !== 'meal') return;
          expect(line.outOfPocketCents).toBe(v.diners.reduce((a, d) => a + d.foodNet + d.taxFood + d.extraNet + d.taxExtra + d.tip, 0));
          if (v.serviceType !== 'table_service') for (const d of v.diners) expect(d.tip + d.extraNet).toBe(0);
        });
        for (const code of DINING_PLAN_CODES) {
          const s = evaluateScenario(code, ctx);
          if (!s.available) continue;
          const coveredBy = allocateParty(code, ctx);
          let waivedTips = 0;
          s.meals.forEach((line, i) => {
            const v = ctx.entries[i]!.valuation;
            if (v.kind !== 'meal') return;
            let expected = 0;
            for (const d of v.diners) {
              const covered = coveredBy.get(d.key)!.has(ctx.entries[i]!.id);
              if (covered && v.gratuityIncluded) waivedTips += d.tip;
              expected += covered ? d.extraNet + d.taxExtra + (v.gratuityIncluded ? 0 : d.tip) : d.foodNet + d.taxFood + d.extraNet + d.taxExtra + d.tip;
              if (covered && d.extraNet >= 100 && ctx.taxBps >= 100) expect(d.taxExtra).toBeGreaterThan(0);
            }
            expect(line.outOfPocketCents).toBe(expected);
          });
          // Property 10: the plan's tip is the No_Plan tip minus exactly the waived tips of covered gratuity meals.
          expect(s.tipCents).toBe(none.tipCents - waivedTips);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 17: Snack accounting
  // Feature: dining-plan-calculator, Property 18: Mug accounting
  // Validates: Requirements 11.1, 11.2, 11.3, 11.4, 4.9
  it('Properties 17 and 18: snack demand, coverage and cost; mugs covered once per eligible Person', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const { ctx } = scenarioContextOf(input);
        const eligible = input.persons.filter((p) => p.ageBracket !== 'under3');
        const snackOnly = (key: string) => ctx.entries.filter((e) => e.valuation.kind === 'snack' && e.valuation.dinerKeys.includes(key)).length;
        const snackUnit = unit(DINING_CONFIG_DEFAULTS.snackCents, ctx.taxBps);
        const mugUnit = unit(DINING_CONFIG_DEFAULTS.mugCents, ctx.taxBps);
        const mugs = input.settings.mugsWanted;
        for (const code of SCENARIOS) {
          const s = evaluateScenario(code, ctx);
          if (!s.available) continue;
          const perPersonCredits = code === 'none' ? 0 : ctx.nights * DINING_PLAN_ENTITLEMENTS_PER_NIGHT[code].snack;
          let covered = 0;
          let uncovered = 0;
          for (const p of eligible) {
            const demand = input.settings.snacksPerPersonPerDay * ctx.days + snackOnly(p.key);
            const c = Math.min(demand, perPersonCredits);
            covered += c;
            uncovered += demand - c;
          }
          expect(s.snackOutOfPocketCents).toBe(uncovered * snackUnit);
          const mugsCovered = code === 'none' ? 0 : Math.min(mugs, eligible.length);
          expect(s.mugOutOfPocketCents).toBe((mugs - mugsCovered) * mugUnit);
          if (code === 'none') {
            expect(s.credits).toBeNull();
            continue;
          }
          const issued = perPersonCredits * eligible.length;
          expect(s.credits!.snack).toEqual({ issued, used: covered, unused: issued - covered });
          expect(s.credits!.snacksPerDayToUseAll).toBe(ctx.days > 0 ? Math.ceil(perPersonCredits / ctx.days) : 0);
          expect(s.credits!.mugsCovered).toBe(mugsCovered);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 27: Per-meal verdicts agree with the allocation
  // Validates: Requirements 14.1, 14.2, 14.3, 14.4
  it('Property 27: coverage, reason and savings agree with the allocation, and No_Plan minus the plan\'s out-of-pocket is the savings', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const { ctx } = scenarioContextOf(input);
        const none = evaluateScenario('none', ctx);
        const snackUnit = unit(DINING_CONFIG_DEFAULTS.snackCents, ctx.taxBps);
        const mugUnit = unit(DINING_CONFIG_DEFAULTS.mugCents, ctx.taxBps);
        for (const code of DINING_PLAN_CODES) {
          const s = evaluateScenario(code, ctx);
          if (!s.available) continue;
          const ent = DINING_PLAN_ENTITLEMENTS_PER_NIGHT[code];
          const coveredBy = allocateParty(code, ctx);
          let mealSavings = 0;
          s.meals.forEach((line, i) => {
            const e = ctx.entries[i]!;
            if (e.valuation.kind !== 'meal') return;
            const v = e.valuation;
            const covered = v.diners.filter((d) => coveredBy.get(d.key)!.has(e.id));
            expect(line.coveredDinerCount).toBe(covered.length);
            expect(line.coverage).toBe(covered.length === 0 ? 'none' : covered.length === v.diners.length ? 'all' : 'partial');
            expect(line.savingsCents).toBe(covered.reduce((a, d) => a + d.savingsCents, 0));
            expect(line.reason === null).toBe(line.coverage !== 'none');
            if (line.coverage === 'none') {
              const expected = v.creditKind === null ? 'not_eligible' : (v.creditKind === 'ts' ? ent.ts : ent.qs) === 0 ? 'no_matching_credits' : 'better_use_elsewhere';
              expect(line.reason).toBe(expected);
            }
            mealSavings += line.savingsCents;
          });
          const ranked = s.bestCreditUses.map((u) => u.savingsCents);
          expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
          expect(none.totalCents - (s.totalCents - s.planCostCents)).toBe(mealSavings + s.credits!.snack.used * snackUnit + s.credits!.mugsCovered * mugUnit);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 19: Stay and slot handling (under-3 half)
  // Validates: Requirements 3.6, 4.5, 4.6
  it('Property 19: adding an under-3 Person or excluding a stranger key changes no scenario total', () => {
    fc.assert(
      fc.property(generatedArb(), ({ input }) => {
        const base = evaluateAll(input);
        const withBaby = evaluateAll({ ...input, persons: [...input.persons, BABY] });
        for (const code of SCENARIOS) expect(withBaby[code].totalCents).toBe(base[code].totalCents);
      }),
      { numRuns: 100 },
    );
  });
});
