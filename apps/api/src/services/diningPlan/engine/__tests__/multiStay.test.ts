import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bpsOf,
  DINING_CONFIG_DEFAULTS,
  DINING_ORDER_STYLES,
  DINING_PLAN_CODES,
  DINING_PLAN_ENTITLEMENTS_PER_NIGHT,
  diningPlanSettingsSchema,
  type DiningMealLineDTO,
  type DiningPlanCode,
  type DiningPlanResultDTO,
  type DiningPlanSettingsInput,
  type DiningScenarioCode,
  type DiningScenarioResultDTO,
  type EnginePlanStay,
  type StayPlanSetting,
} from '@dwt/shared';

import { addDays, daysBetween } from '../../../ticketPrices/dates.js';
import { computeDiningPlan, singlePlanStay } from '../computeDiningPlan.js';
import { buildStayRuntimes, isPlanEligibleStay } from '../stays.js';
import type { EngineEntry, EngineInput, EnginePerson } from '../types.js';
import { A1, A2, C1, generatedInputArb, ID, LOCATIONS, placeholder, restaurant, SEEDED, SNACK_UNIT, toEngineInput } from './engineFixtures.js';

// --- fixtures ------------------------------------------------------------------------------------------------------

function setting(overrides: Partial<StayPlanSetting> = {}): StayPlanSetting {
  return { status: 'compare', heldPlan: null, channel: 'package', ...overrides };
}

function planStay(key: string, checkIn: string, checkOut: string, overrides: Partial<EnginePlanStay> = {}): EnginePlanStay {
  return { key, label: key, lodgingKind: 'resort', source: 'stay', checkIn, checkOut, partyKeys: null, setting: setting(), ...overrides };
}

function input(overrides: Partial<Omit<EngineInput, 'settings'>> & { settings?: DiningPlanSettingsInput } = {}): EngineInput {
  const { settings, ...rest } = overrides;
  return {
    persons: [A1, A2],
    stay: { checkIn: '2026-12-15', checkOut: '2026-12-28', source: 'trip' },
    entries: [],
    locations: LOCATIONS,
    priceRows: SEEDED,
    config: DINING_CONFIG_DEFAULTS,
    today: '2026-11-09',
    ...rest,
    settings: diningPlanSettingsSchema.parse(settings ?? {}),
  };
}

const byCode = (r: DiningPlanResultDTO) => Object.fromEntries(r.scenarios.map((s) => [s.code, s])) as Record<DiningScenarioCode, DiningScenarioResultDTO>;
const line = (s: DiningScenarioResultDTO, date: string, period: string) => s.meals.find((m) => m.date === date && m.mealPeriod === period)!;

// Contemporary Dec 15 to 20 with the table-service plan held; Pop Century Dec 20 to 26 compared; off-site Dec 26 to 28.
const CONTEMPORARY = planStay('contemporary', '2026-12-15', '2026-12-20', { label: "Disney's Contemporary Resort", setting: setting({ status: 'have_plan', heldPlan: 'table_service' }) });
const POP = planStay('pop', '2026-12-20', '2026-12-26', { label: "Disney's Pop Century Resort" });
const OFFSITE = planStay('offsite', '2026-12-26', '2026-12-28', { label: 'Off-site hotel', lodgingKind: 'offsite' });

function dates(from: string, to: string): string[] {
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
}
const THREE_STAY_ENTRIES: EngineEntry[] = [
  ...dates('2026-12-15', '2026-12-19').map((d) => placeholder(d, 'lunch', 'quick_service')),
  ...dates('2026-12-16', '2026-12-19').map((d) => placeholder(d, 'dinner', 'table_service')),
  placeholder('2026-12-20', 'breakfast', 'quick_service'),
  placeholder('2026-12-20', 'dinner', 'table_service'),
  ...dates('2026-12-21', '2026-12-25').map((d) => placeholder(d, 'lunch', 'quick_service')),
  ...dates('2026-12-21', '2026-12-27').map((d) => placeholder(d, 'dinner', 'table_service')),
];

describe('computeDiningPlan: the three-stay worked example', () => {
  // Per adult: a quick-service placeholder is 1800 + 117 tax (saves 1917); a table-service one is 4500 + 293 tax + 810
  // tip (out of pocket 5603, saves 4793, and a covered one still pays the 810 tip). One snack a day at 692 with tax.
  // Snack days: Dec 15 to 19 -> Contemporary (5), Dec 20 to 25 -> Pop (6), Dec 26 to 28 -> off-site (3).
  const r = computeDiningPlan(input({ entries: THREE_STAY_ENTRIES, stays: [OFFSITE, POP, CONTEMPORARY], settings: { mugsWanted: 2 } }));
  const s = byCode(r);

  it('Baseline (Pop with no plan): the held plan covers 5 lunches and 5 dinners each, including the Dec 20 dinner', () => {
    // Out of pocket per adult: Dec 20 breakfast, 5 lunches, 7 dinners (Dec 21 to 27): food 42300, tax 2753; every
    // table-service dinner pays the tip (12 x 810); snacks 9 x 692 uncovered; both mugs covered by the held plan.
    expect(s.none).toMatchObject({
      displayName: 'No additional plan', planCostCents: 2 * 9859 * 5, foodOutOfPocketCents: 84_600, taxCents: 5_506, tipCents: 19_440,
      snackOutOfPocketCents: 2 * 9 * SNACK_UNIT, mugOutOfPocketCents: 0, totalCents: 220_592, combination: { contemporary: 'table_service', pop: 'none', offsite: 'none' },
      credits: { ts: { issued: 10, used: 10, unused: 0 }, qs: { issued: 10, used: 10, unused: 0 }, snack: { issued: 10, used: 10, unused: 0 }, snacksPerDayToUseAll: 1, mugsCovered: 2 },
    });
    expect(line(s.none, '2026-12-20', 'dinner')).toMatchObject({ stayKey: 'pop', coveredByStayKey: 'contemporary', coverage: 'all' });
    expect(line(s.none, '2026-12-20', 'breakfast')).toMatchObject({ stayKey: 'pop', coveredByStayKey: null, coverage: 'none', reason: 'better_use_elsewhere' });
  });

  it('Pop on the table-service plan: the outgoing dinner credit covers the Dec 20 dinner and the incoming one the breakfast', () => {
    // Only the Dec 27 dinner (off-site) is out of pocket; Pop also covers its own check-out day's dinner (Dec 26).
    expect(s.table_service).toMatchObject({
      displayName: 'Disney Dining Plan', planCostCents: 98_590 + 2 * 9859 * 6, foodOutOfPocketCents: 9_000, taxCents: 586, tipCents: 19_440,
      snackOutOfPocketCents: 2 * 3 * SNACK_UNIT, totalCents: 250_076, netSavingsCents: 220_592 - 250_076,
      combination: { contemporary: 'table_service', pop: 'table_service', offsite: 'none' },
      credits: { ts: { issued: 22, used: 22 }, qs: { issued: 22, used: 22 }, snack: { issued: 22, used: 22 } },
    });
    expect(line(s.table_service, '2026-12-20', 'dinner')).toMatchObject({ stayKey: 'pop', coveredByStayKey: 'contemporary' });
    expect(line(s.table_service, '2026-12-20', 'breakfast')).toMatchObject({ stayKey: 'pop', coveredByStayKey: 'pop' });
    expect(line(s.table_service, '2026-12-26', 'dinner')).toMatchObject({ stayKey: 'offsite', coveredByStayKey: 'pop', coverage: 'all' });
    expect(line(s.table_service, '2026-12-27', 'dinner')).toMatchObject({ stayKey: 'offsite', coveredByStayKey: null, coverage: 'none', reason: 'no_matching_credits' });
  });

  it('Pop on the quick-service plan: the breakfast goes to Pop, Pop\'s dinners are out of pocket', () => {
    expect(s.quick_service).toMatchObject({ planCostCents: 98_590 + 2 * 6047 * 6, foodOutOfPocketCents: 63_000, taxCents: 4_102, tipCents: 19_440, totalCents: 261_848 });
    expect(line(s.quick_service, '2026-12-20', 'breakfast')).toMatchObject({ coveredByStayKey: 'pop' });
    expect(line(s.quick_service, '2026-12-21', 'dinner')).toMatchObject({ coverage: 'none', reason: 'no_matching_credits' });
  });

  it('recommends no additional plan, with Pop on table service as the best alternative', () => {
    expect(r).toMatchObject({
      verdict: 'plan_costs_more', recommended: 'none', bestPlan: 'table_service', evenThresholdCents: bpsOf(220_592, 200), breakEvenGapCents: 29_484,
      recommendedCombination: { contemporary: 'table_service', pop: 'none', offsite: 'none' },
      alternatives: [
        { combination: { contemporary: 'table_service', pop: 'table_service', offsite: 'none' }, totalCents: 250_076, netSavingsCents: -29_484 },
        { combination: { contemporary: 'table_service', pop: 'quick_service', offsite: 'none' }, totalCents: 261_848, netSavingsCents: -41_256 },
      ],
      stay: { checkIn: '2026-12-15', checkOut: '2026-12-28', nights: 13, days: 14 },
      warnings: [],
    });
    expect(s.deluxe).toMatchObject({ available: false, unavailableReason: 'no_price_for_dates' });
    expect(r.scenarios.map((x) => x.code)).toEqual(['none', ...DINING_PLAN_CODES]);
  });

  it('reports each stay, with the held plan\'s contribution against dropping it', () => {
    // With no plan anywhere the total is 200918 (every meal, 14 snacks each and both mugs out of pocket), so the held
    // plan raises this trip's total by 19674: dropping it would save money.
    expect(r.stays).toEqual([
      {
        key: 'contemporary', label: "Disney's Contemporary Resort", lodgingKind: 'resort', source: 'stay', checkIn: '2026-12-15', checkOut: '2026-12-20',
        nights: 5, partyCount: 2, status: 'have_plan', heldPlan: 'table_service', channel: 'package', available: true, unavailableReason: null,
        recommendedPlan: 'table_service', planCostCents: 98_590,
        credits: { ts: { issued: 10, used: 10, unused: 0 }, qs: { issued: 10, used: 10, unused: 0 }, snack: { issued: 10, used: 10, unused: 0 }, snacksPerDayToUseAll: 1, mugsCovered: 2 },
        contributionCents: 200_918 - 220_592,
      },
      {
        key: 'pop', label: "Disney's Pop Century Resort", lodgingKind: 'resort', source: 'stay', checkIn: '2026-12-20', checkOut: '2026-12-26',
        nights: 6, partyCount: 2, status: 'compare', heldPlan: null, channel: 'package', available: true, unavailableReason: null,
        recommendedPlan: 'none', planCostCents: 0, credits: null, contributionCents: 0,
      },
      {
        key: 'offsite', label: 'Off-site hotel', lodgingKind: 'offsite', source: 'stay', checkIn: '2026-12-26', checkOut: '2026-12-28',
        nights: 2, partyCount: 2, status: 'compare', heldPlan: null, channel: 'package', available: false, unavailableReason: 'not_disney_resort',
        recommendedPlan: 'none', planCostCents: 0, credits: null, contributionCents: 0,
      },
    ]);
  });
});

describe('computeDiningPlan: stay settings', () => {
  const dinner = (d: string) => restaurant(d, 'dinner', ID.liberty);

  it('charges a held plan with no price period as 0, warns, and still uses its credits', () => {
    const held = planStay('a', '2026-12-15', '2026-12-17', { setting: setting({ status: 'have_plan', heldPlan: 'deluxe' }) });
    const r = computeDiningPlan(input({ persons: [A1], entries: [dinner('2026-12-16')], stays: [held] }));
    expect(r.warnings).toContainEqual({ code: 'held_plan_price_unknown', stayKey: 'a' });
    expect(byCode(r).none).toMatchObject({ planCostCents: 0, foodOutOfPocketCents: 0 });
    expect(r.stays![0]).toMatchObject({ recommendedPlan: 'deluxe', planCostCents: 0, available: true });
  });

  it('pays every meal of a no_plan or off-site stay out of pocket', () => {
    const entries = [dinner('2026-12-16'), dinner('2026-12-19')];
    const r = computeDiningPlan(input({ persons: [A1], entries, stays: [planStay('a', '2026-12-15', '2026-12-18', { setting: setting({ status: 'no_plan' }) }), planStay('b', '2026-12-18', '2026-12-20', { lodgingKind: 'offsite' })] }));
    expect(r.verdict).toBe('plan_unavailable');
    expect(r.scenarios.map((x) => x.code)).toEqual(['none', ...DINING_PLAN_CODES]);
    expect(r.scenarios.slice(1).every((x) => !x.available && x.unavailableReason === 'not_disney_resort')).toBe(true);
    expect(byCode(r).none.meals.every((m) => m.coverage === 'none' && m.reason === null)).toBe(true);
  });

  it('makes a partner hotel unavailable with not_disney_resort and treats recorded-later segments as Disney Resorts', () => {
    const r = computeDiningPlan(input({ persons: [A1], stays: [
      planStay('partner', '2026-12-15', '2026-12-17', { lodgingKind: 'partner_hotel' }),
      planStay('implicit:2026-12-17', '2026-12-17', '2026-12-19', { lodgingKind: 'offsite', source: 'implicit_gap' }),
    ] }));
    expect(r.stays!.map((x) => [x.key, x.available, x.unavailableReason])).toEqual([['partner', false, 'not_disney_resort'], ['implicit:2026-12-17', true, null]]);
    expect(isPlanEligibleStay({ lodgingKind: 'offsite', source: 'implicit_no_lodging' })).toBe(true);
    expect(isPlanEligibleStay({ lodgingKind: 'partner_hotel', source: 'legacy_resorts' })).toBe(true);
    expect(isPlanEligibleStay({ lodgingKind: 'offsite', source: 'stay' })).toBe(false);
  });

  it('treats a fourth compare stay as no_plan with too_many_compare_stays', () => {
    const stays = ['12-15', '12-17', '12-19', '12-21'].map((d, i) => planStay(`s${i}`, `2026-${d}`, addDays(`2026-${d}`, 2)));
    const r = computeDiningPlan(input({ persons: [A1], stays }));
    expect(r.warnings).toEqual([{ code: 'no_entries' }, { code: 'too_many_compare_stays', stayKey: 's3' }]);
    expect(r.stays!.map((x) => x.status)).toEqual(['compare', 'compare', 'compare', 'no_plan']);
  });

  it('issues credits and charges only the Party members named on a stay; others pay their meals there', () => {
    // Casey is only on the second stay. On the first, Alex's dinner is covered and Casey's is paid.
    const stays = [planStay('a', '2026-12-15', '2026-12-17', { partyKeys: [A1.key, 'm:nobody'] }), planStay('b', '2026-12-17', '2026-12-19')];
    const r = computeDiningPlan(input({ persons: [A1, C1], entries: [dinner('2026-12-15'), dinner('2026-12-18')], stays, settings: { stayPlans: {} } }));
    const ts = byCode(r).table_service;
    expect(ts.planCostCents).toBe(2 * 9859 + 2 * (9859 + 0)); // a: Alex only; b: Alex and Casey (Kids Eat Free 2026)
    expect(line(ts, '2026-12-15', 'dinner')).toMatchObject({ coverage: 'partial', coveredDinerCount: 1, coveredByStayKey: 'a' });
    expect(line(ts, '2026-12-18', 'dinner')).toMatchObject({ coverage: 'all', coveredDinerCount: 2 });
    expect(r.stays!.map((x) => x.partyCount)).toEqual([1, 2]);
  });

  it('reports the stay covering the first covered Diner when a hand-off meal is split between stays', () => {
    // Alex is on both stays, Blair only on the second. Each stay has one table-service credit per person; the Dec 17
    // dinner is Alex's only meal, so Alex covers it from the outgoing stay and Blair from the incoming one.
    const stays = [planStay('a', '2026-12-16', '2026-12-17', { partyKeys: [A1.key] }), planStay('b', '2026-12-17', '2026-12-18')];
    const ts = byCode(computeDiningPlan(input({ persons: [A1, A2], entries: [dinner('2026-12-17')], stays }))).table_service;
    expect(line(ts, '2026-12-17', 'dinner')).toMatchObject({ coverage: 'all', coveredDinerCount: 2, stayKey: 'b', coveredByStayKey: 'a' });
  });

  it('applies Kids Eat Free only to a package stay', () => {
    const stays = [planStay('pkg', '2026-12-15', '2026-12-16'), planStay('dvc', '2026-12-16', '2026-12-17', { setting: setting({ channel: 'dvc_or_passholder' }) })];
    const ts = byCode(computeDiningPlan(input({ persons: [A1, C1], stays }))).table_service;
    expect(ts).toMatchObject({ planCostCents: 9859 + 0 + 9859 + 3194, promoLabel: 'Kids Eat Free 2026' });
  });

  it('counts snacks per stay over the dates attributed to it, and one mug per Person', () => {
    // Stay a: Dec 15, 16 (2 days, 2 nights of credits); stay b: Dec 17, 18, 19 (3 days, 2 nights); one snack a day.
    const stays = [planStay('a', '2026-12-15', '2026-12-17', { setting: setting({ status: 'have_plan', heldPlan: 'quick_service' }) }), planStay('b', '2026-12-17', '2026-12-19', { setting: setting({ status: 'have_plan', heldPlan: 'quick_service' }) })];
    const r = computeDiningPlan(input({ persons: [A1], stays, settings: { mugsWanted: 1 } }));
    expect(r.stays!.map((x) => x.credits!.snack)).toEqual([{ issued: 2, used: 2, unused: 0 }, { issued: 2, used: 2, unused: 0 }]);
    expect(byCode(r).none).toMatchObject({ snackOutOfPocketCents: SNACK_UNIT, mugOutOfPocketCents: 0 });
    expect(byCode(r).none.credits!.mugsCovered).toBe(1);
    const runtime = buildStayRuntimes({ stays, persons: [A1], priceRows: SEEDED, settings: { kidsEatFree: true }, config: DINING_CONFIG_DEFAULTS, taxBps: 650 });
    expect(dates('2026-12-15', '2026-12-19').map(runtime.stayOfDate)).toEqual([0, 0, 1, 1, 1]);
  });

  it('recommends a mix when the plan pays at one hotel and not at the other', () => {
    // Stay a (Mar 1 to 2): a Hoop-Dee-Doo dinner (9960 with tax and tip, gratuity included) and a quick-service lunch
    // (1917) plus one snack (692) beat the 9987 plan by 2582. Stay b (Mar 2 to 4): only quick-service lunches.
    const entries = [restaurant('2027-03-01', 'dinner', ID.hoopDeeDoo), placeholder('2027-03-01', 'lunch', 'quick_service'), placeholder('2027-03-02', 'lunch', 'quick_service'), placeholder('2027-03-03', 'lunch', 'quick_service')];
    const r = computeDiningPlan(input({ persons: [A1], entries, stays: [planStay('a', '2027-03-01', '2027-03-02'), planStay('b', '2027-03-02', '2027-03-04')] }));
    const s = byCode(r);
    // Baseline: 9960 + 3 x 1917 + 4 snacks x 692 = 18479. Mix: 9987 + 2 lunches 3834 + 3 snacks (Mar 2 to 4) = 15897.
    expect(s.none!.totalCents).toBe(18_479);
    expect(s.mix).toMatchObject({ code: 'mix', displayName: 'A plan per hotel', totalCents: 15_897, netSavingsCents: 2_582, combination: { a: 'table_service', b: 'none' } });
    expect(s.table_service).toMatchObject({ totalCents: 30_653, combination: { a: 'table_service', b: 'table_service' } });
    expect(r).toMatchObject({ verdict: 'plan_saves', recommended: 'mix', bestPlan: null, recommendedCombination: { a: 'table_service', b: 'none' } });
    expect(r.scenarios.at(-1)!.code).toBe('mix');
    expect(r.stays!.map((x) => [x.key, x.recommendedPlan, x.contributionCents])).toEqual([['a', 'table_service', 2_582], ['b', 'none', 0]]);
  });
});

// --- properties ----------------------------------------------------------------------------------------------------

interface MultiCase {
  readonly input: EngineInput;
}

/** A single-stay input split into 1 to 3 consecutive Plan_Stays with random kinds, statuses, channels and parties. */
const multiArb = (opts: { held?: boolean; appetizers?: boolean } = {}): fc.Arbitrary<MultiCase> =>
  fc
    .tuple(
      generatedInputArb(opts.appetizers === undefined ? {} : { appetizers: opts.appetizers }),
      fc.array(
        fc.record({
          cut: fc.double({ min: 0, max: 1, noNaN: true }),
          kind: fc.constantFrom('resort' as const, 'resort' as const, 'resort' as const, 'partner_hotel' as const, 'offsite' as const),
          source: fc.constantFrom('stay' as const, 'stay' as const, 'stay' as const, 'implicit_gap' as const),
          status: fc.constantFrom('compare' as const, 'compare' as const, 'have_plan' as const, 'no_plan' as const),
          held: fc.constantFrom<DiningPlanCode>(...DINING_PLAN_CODES),
          channel: fc.constantFrom('package' as const, 'dvc_or_passholder' as const),
          partyMask: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    )
    .map(([single, specs]) => {
      const base = toEngineInput(single);
      const total = daysBetween(base.stay.checkIn, base.stay.checkOut);
      const cuts = [...new Set(specs.slice(1).map((s) => Math.round(s.cut * total)))].sort((a, b) => a - b);
      const bounds = [0, ...cuts, total];
      const stays: EnginePlanStay[] = [];
      for (let i = 0; i + 1 < bounds.length; i += 1) {
        const s = specs[i]!;
        const status = s.status === 'have_plan' && opts.held === false ? 'compare' : s.status;
        stays.push({
          key: `stay-${i}`,
          label: `Stay ${i}`,
          lodgingKind: s.kind,
          source: s.source,
          checkIn: addDays(base.stay.checkIn, bounds[i]!),
          checkOut: addDays(base.stay.checkIn, bounds[i + 1]!),
          partyKeys: s.partyMask === null ? null : base.persons.filter((_, j) => (s.partyMask! & (1 << j)) !== 0).map((p) => p.key),
          setting: { status, heldPlan: status === 'have_plan' ? s.held : null, channel: s.channel },
        });
      }
      return { input: { ...base, stays } };
    });

const MULTI_FIELDS = ['stays', 'recommendedCombination', 'alternatives'] as const;
function oldFields(r: DiningPlanResultDTO): unknown {
  const copy: Record<string, unknown> = { ...r };
  for (const f of MULTI_FIELDS) delete copy[f];
  copy.scenarios = r.scenarios.map(({ combination: _c, meals, ...rest }) => ({ ...rest, meals: meals.map(({ stayKey: _s, coveredByStayKey: _k, ...m }) => m) }));
  return copy;
}

interface BruteCombination {
  readonly assign: (DiningPlanCode | null)[];
  readonly plans: number;
  readonly total: number;
}

/**
 * Every Combination, each priced by a separate engine run in which each `compare` stay is fixed (to `have_plan` with
 * the plan, or `no_plan`), so that run enumerates nothing and its Baseline is that Combination.
 */
function bruteForce(inp: EngineInput): BruteCombination[] {
  const runtime = buildStayRuntimes({ stays: inp.stays!, persons: inp.persons, priceRows: inp.priceRows, settings: inp.settings, config: inp.config, taxBps: inp.settings.taxBps ?? inp.config.taxBps });
  const byKey = new Map(inp.stays!.map((s) => [s.key, s]));
  const out: BruteCombination[] = [];
  const walk = (i: number, acc: (DiningPlanCode | null)[]): void => {
    if (i === runtime.stays.length) {
      const fixed = runtime.stays.map((rt, j) => {
        const st = byKey.get(rt.key)!;
        if (rt.status !== 'compare') return rt.status === 'no_plan' ? { ...st, setting: { ...st.setting, status: 'no_plan' as const, heldPlan: null } } : st;
        const p = acc[j]!;
        return { ...st, setting: p === null ? { ...st.setting, status: 'no_plan' as const, heldPlan: null } : { ...st.setting, status: 'have_plan' as const, heldPlan: p } };
      });
      const total = computeDiningPlan({ ...inp, stays: fixed }, { skipSensitivity: true }).scenarios[0]!.totalCents;
      out.push({ assign: [...acc], plans: runtime.stays.filter((rt, j) => rt.status === 'compare' && acc[j] !== null).length, total });
      return;
    }
    const rt = runtime.stays[i]!;
    const choices = rt.status === 'compare' ? [null, ...DINING_PLAN_CODES.filter((p) => rt.planCosts[p].available)] : [rt.options[0]!];
    for (const c of choices) walk(i + 1, [...acc, c]);
  };
  walk(0, []);
  return out;
}

const RANK: Record<string, number> = { none: 0, quick_service: 1, table_service: 2, deluxe: 3 };

describe('multi-stay properties', () => {
  // Feature: dining-plan-calculator, Property 31: One stay reproduces the single-stay result
  // Validates: Requirements 25.1, 25.10, 25.11
  it('Property 31: one Plan_Stay spanning the stay gives the single-stay result on every earlier field', () => {
    fc.assert(
      fc.property(generatedInputArb(), (single) => {
        const base = toEngineInput(single);
        const plain = computeDiningPlan(base);
        const withStay = computeDiningPlan({ ...base, stays: [{ ...singlePlanStay(base), key: 'the-stay' }] });
        expect(oldFields(withStay)).toEqual(plain);
        expect(withStay.stays).toHaveLength(1);
        expect(withStay.stays![0]!.recommendedPlan).toBe(plain.recommended === 'none' ? 'none' : plain.recommended);
        expect(plain.stays).toBeUndefined();
      }),
      { numRuns: 60 },
    );
  });

  // Feature: dining-plan-calculator, Property 32: The recommended Combination is the cheapest
  // Validates: Requirements 25.4, 25.5, 25.9, 25.10
  it('Property 32: the best Combination is the brute-force cheapest; net savings are against the Baseline; held stays never change', () => {
    fc.assert(
      fc.property(multiArb(), ({ input: inp }) => {
        const r = computeDiningPlan(inp, { skipSensitivity: true });
        const all = bruteForce(inp);
        const stays = r.stays!;
        const baseline = all.find((c) => c.plans === 0)!;
        expect(byCode(r).none!.totalCents).toBe(baseline.total);
        const ranked = all
          .filter((c) => c !== baseline)
          .sort((a, b) => a.total - b.total || a.plans - b.plans || a.assign.reduce((d, x, i) => d || RANK[x ?? 'none']! - RANK[b.assign[i] ?? 'none']!, 0));
        if (ranked.length === 0) {
          expect(r.verdict).toBe('plan_unavailable');
          expect(r.recommended).toBe('none');
          return;
        }
        const best = ranked[0]!;
        expect(r.breakEvenGapCents).toBe(Math.max(0, best.total - baseline.total));
        const record = (a: (DiningPlanCode | null)[]) => Object.fromEntries(stays.map((s, i) => [s.key, a[i] ?? 'none']));
        expect(r.recommendedCombination).toEqual(r.verdict === 'plan_saves' ? record(best.assign) : record(baseline.assign));
        if (r.verdict !== 'plan_saves') expect(r.recommended).toBe('none');
        // Alternatives: every other Combination in rank order, at most 5, net against the Baseline.
        const recommendedKey = JSON.stringify(r.recommendedCombination);
        const expectedAlternatives = [baseline, ...ranked]
          .sort((a, b) => a.total - b.total || a.plans - b.plans || a.assign.reduce((d, x, i) => d || RANK[x ?? 'none']! - RANK[b.assign[i] ?? 'none']!, 0))
          .filter((c) => JSON.stringify(record(c.assign)) !== recommendedKey)
          .slice(0, 5)
          .map((c) => ({ combination: record(c.assign), totalCents: c.total, netSavingsCents: baseline.total - c.total }));
        expect(r.alternatives).toEqual(expectedAlternatives);
        for (const alt of r.alternatives!) for (const s of stays) if (s.status !== 'compare') expect(alt.combination[s.key]).toBe(s.status === 'have_plan' && s.unavailableReason === null ? s.heldPlan : 'none');
      }),
      { numRuns: 40 },
    );
  });

  // Feature: dining-plan-calculator, Property 33: A Person receives credits only on stays they are on
  // Validates: Requirements 25.8
  it('Property 33: covered Diners are on a plan-active stay of that date; null partyKeys is everyone; a key naming nobody changes nothing', () => {
    fc.assert(
      fc.property(multiArb(), ({ input: inp }) => {
        const r = computeDiningPlan(inp, { skipSensitivity: true });
        const stays = inp.stays!;
        for (const scen of r.scenarios) {
          if (!scen.available || scen.combination === undefined) continue;
          for (const m of scen.meals) {
            const entry = inp.entries.find((e) => e.date === m.date && e.mealPeriod === m.mealPeriod)!;
            const diners = inp.persons.filter((p) => p.ageBracket !== 'under3' && !entry.excludedKeys.includes(p.key));
            const onActive = diners.filter((p) =>
              stays.some((s) => scen.combination![s.key] !== 'none' && s.checkIn <= m.date && m.date <= s.checkOut && (s.partyKeys === null || s.partyKeys.includes(p.key))),
            );
            expect(m.coveredDinerCount).toBeLessThanOrEqual(onActive.length);
          }
        }
        const everyone = stays.map((s) => ({ ...s, partyKeys: s.partyKeys === null ? inp.persons.map((p) => p.key) : [...s.partyKeys, 'm:not-in-party'] }));
        expect(oldFields(computeDiningPlan({ ...inp, stays: everyone }, { skipSensitivity: true }))).toEqual(oldFields(r));
      }),
      { numRuns: 60 },
    );
  });

  // Feature: dining-plan-calculator, Property 35: Snacks and mugs are accounted per stay and per person
  // Feature: dining-plan-calculator, Property 36: Eligibility follows the stay kind and source
  // Validates: Requirements 25.2, 25.4, 25.5, 25.12
  it('Properties 35 and 36: each span date has one stay; snack and mug coverage per stay; eligibility by kind and source', () => {
    fc.assert(
      fc.property(multiArb(), ({ input: inp }) => {
        const r = computeDiningPlan(inp, { skipSensitivity: true });
        const runtime = buildStayRuntimes({ stays: inp.stays!, persons: inp.persons, priceRows: inp.priceRows, settings: inp.settings, config: inp.config, taxBps: inp.settings.taxBps ?? inp.config.taxBps });
        const spanDates = dates(runtime.span.checkIn, runtime.span.checkOut);
        for (const d of spanDates) expect(runtime.stayOfDate(d)).toBeGreaterThanOrEqual(0);
        expect(runtime.stays.reduce((a, s) => a + s.attributedDays, 0)).toBe(spanDates.length);
        for (const [i, s] of r.stays!.entries()) {
          const rt = runtime.stays[i]!;
          const eligible = rt.persons.filter((p) => p.ageBracket !== 'under3').length;
          if (s.credits !== null) {
            const plan = s.recommendedPlan as DiningPlanCode;
            expect(s.credits.snack.issued).toBe(eligible * rt.nights * DINING_PLAN_ENTITLEMENTS_PER_NIGHT[plan].snack);
            expect(s.credits.snack.used).toBeLessThanOrEqual(s.credits.snack.issued);
            expect(s.credits.ts.used).toBeLessThanOrEqual(s.credits.ts.issued);
            expect(s.credits.qs.used).toBeLessThanOrEqual(s.credits.qs.issued);
          } else {
            expect(s.planCostCents).toBe(0);
          }
          expect(s.unavailableReason === 'not_disney_resort').toBe(!isPlanEligibleStay(inp.stays!.find((x) => x.key === s.key)!));
          if (s.status === 'have_plan' && s.unavailableReason === null) expect(s.recommendedPlan).toBe(s.heldPlan);
        }
        for (const scen of r.scenarios) {
          if (!scen.available || scen.credits === null || scen.combination === undefined) continue;
          const holders = inp.persons.filter(
            (p) => p.ageBracket !== 'under3' && inp.stays!.some((s) => scen.combination![s.key] !== 'none' && (s.partyKeys === null || s.partyKeys.includes(p.key))),
          ).length;
          expect(scen.credits.mugsCovered).toBe(Math.min(inp.settings.mugsWanted, holders));
        }
      }),
      { numRuns: 60 },
    );
  });

  // Feature: dining-plan-calculator, Property 1: Money is exact and decomposes (multi-stay)
  // Feature: dining-plan-calculator, Property 16: Recommendation and verdict are consistent (multi-stay)
  // Feature: dining-plan-calculator, Property 25: The engine is pure and deterministic (multi-stay)
  // Validates: Requirements 13.1, 13.4 to 13.7, 16.9, 25.10
  it('Properties 1, 16 and 25 over multi-stay inputs', () => {
    fc.assert(
      fc.property(multiArb({ appetizers: false }), ({ input: inp }) => {
        const r = computeDiningPlan(inp);
        for (const s of r.scenarios) {
          const terms = [s.planCostCents, s.foodOutOfPocketCents, s.taxCents, s.tipCents, s.snackOutOfPocketCents, s.mugOutOfPocketCents];
          for (const t of terms) expect(Number.isSafeInteger(t) && t >= 0).toBe(true);
          expect(s.totalCents).toBe(terms.reduce((a, b) => a + b, 0));
          if (s.code !== 'none') expect(s.netSavingsCents).toBe(s.available ? r.scenarios[0]!.totalCents - s.totalCents : 0);
        }
        const threshold = Math.max(2000, bpsOf(r.scenarios[0]!.totalCents, 200));
        expect(r.evenThresholdCents).toBe(threshold);
        if (r.verdict === 'plan_saves') {
          expect(r.recommended).not.toBe('none');
          expect(r.scenarios[0]!.totalCents - byCode(r)[r.recommended]!.totalCents).toBeGreaterThan(threshold);
        } else {
          expect(r.recommended).toBe('none');
        }
        expect(computeDiningPlan(inp)).toEqual(r);
        expect(computeDiningPlan({ ...inp, persons: [...inp.persons].reverse() })).toEqual(r);
      }),
      { numRuns: 40 },
    );
  });

  // Feature: dining-plan-calculator, Property 26: Sensitivity agrees with the main result (multi-stay)
  // Validates: Requirements 15.1
  it('Property 26 over multi-stay inputs: each sensitivity row equals a run with that order style', () => {
    fc.assert(
      fc.property(multiArb(), ({ input: inp }) => {
        const r = computeDiningPlan(inp);
        expect(r.sensitivity.map((s) => s.orderStyle)).toEqual([...DINING_ORDER_STYLES]);
        for (const row of r.sensitivity) {
          const other = computeDiningPlan({ ...inp, settings: { ...inp.settings, orderStyle: row.orderStyle } });
          const current = other.sensitivity.find((s) => s.orderStyle === row.orderStyle)!;
          expect(row).toEqual(current);
        }
      }),
      { numRuns: 25 },
    );
  });

  // Feature: dining-plan-calculator, Property 4: Credits never exceed capacity and kinds never mix (multi-stay)
  // Feature: dining-plan-calculator, Property 7: Adding a meal never lowers a plan's net savings (multi-stay, no held plans)
  // Validates: Requirements 9.1, 9.3, 9.5, 13.3, 25.6
  it('Properties 4 and 7 over multi-stay inputs', () => {
    fc.assert(
      fc.property(multiArb({ held: false }), fc.nat(), fc.integer({ min: 0, max: 3 }), ({ input: inp }, slotPick, choice) => {
        const r = computeDiningPlan(inp, { skipSensitivity: true });
        for (const s of r.scenarios) {
          for (const m of s.meals) {
            if (m.serviceType === 'not_eligible') expect(m.coverage).toBe('none');
            if (m.coverage !== 'none' && m.serviceType !== 'snack_only') expect(m.coveredByStayKey).not.toBeNull();
          }
        }
        const taken = new Set(inp.entries.map((e) => `${e.date}:${e.mealPeriod}`));
        const free = dates(inp.stays![0]!.checkIn, inp.stays!.at(-1)!.checkOut).flatMap((date) =>
          (['breakfast', 'lunch', 'dinner'] as const).filter((p) => !taken.has(`${date}:${p}`)).map((mealPeriod) => ({ date, mealPeriod })),
        );
        fc.pre(free.length > 0);
        const slot = free[slotPick % free.length]!;
        const extra: EngineEntry = [
          { ...slot, kind: 'restaurant' as const, experienceId: ID.liberty, placeholderKind: null, excludedKeys: [] },
          { ...slot, kind: 'restaurant' as const, experienceId: ID.crt, placeholderKind: null, excludedKeys: [] },
          placeholder(slot.date, slot.mealPeriod, 'quick_service'),
          placeholder(slot.date, slot.mealPeriod, 'table_service'),
        ][choice]!;
        const after = computeDiningPlan({ ...inp, entries: [...inp.entries, extra] }, { skipSensitivity: true });
        for (const code of DINING_PLAN_CODES) {
          const before = byCode(r)[code];
          if (!before?.available) continue;
          expect(byCode(after)[code]!.netSavingsCents).toBeGreaterThanOrEqual(before.netSavingsCents);
        }
      }),
      { numRuns: 40 },
    );
  });

  // Feature: dining-plan-calculator, Property 6: Credits are not transferable between people (multi-stay)
  // Validates: Requirements 9.2, 25.6
  it('Property 6 over multi-stay inputs: removing one Person changes a line\'s covered Diners by at most that Person', () => {
    fc.assert(
      fc.property(multiArb({ appetizers: false }), fc.nat(), ({ input: inp }, pick) => {
        const removed = inp.persons[pick % inp.persons.length]!;
        const passFree = (ps: readonly EnginePerson[]) => ps.map((p) => ({ ...p, passType: 'none' as const }));
        const full = computeDiningPlan({ ...inp, persons: passFree(inp.persons) }, { skipSensitivity: true });
        const less = computeDiningPlan({ ...inp, persons: passFree(inp.persons.filter((p) => p !== removed)), settings: { ...inp.settings, mugsWanted: 0 } }, { skipSensitivity: true });
        for (const s of less.scenarios) {
          const f = full.scenarios.find((x) => x.code === s.code);
          if (!s.available || !f?.available || JSON.stringify(f.combination) !== JSON.stringify(s.combination)) continue;
          const lines = new Map<string, DiningMealLineDTO>(f.meals.map((m) => [`${m.date}:${m.mealPeriod}`, m]));
          for (const m of s.meals) {
            const fm = lines.get(`${m.date}:${m.mealPeriod}`);
            if (fm === undefined) continue;
            expect(Math.abs(fm.coveredDinerCount - m.coveredDinerCount)).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});
