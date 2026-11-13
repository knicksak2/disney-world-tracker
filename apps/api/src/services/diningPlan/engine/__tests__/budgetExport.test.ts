import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bpsOf,
  DINING_CONFIG_DEFAULTS,
  diningPlanSettingsSchema,
  type DiningPerPersonAmounts,
  type DiningPlanResultDTO,
  type DiningScenarioResultDTO,
  type DiningStayOptionCode,
  type EnginePlanStay,
} from '@dwt/shared';

import { buildBudgetExport, toPreTax, type BudgetExportInput, type ExportPartyRef, type ExportStay } from '../budgetExport.js';
import { computeDiningPlan, evaluateForExport } from '../computeDiningPlan.js';
import type { EngineInput } from '../types.js';
import { A1, A2, BABY, C1, generatedInputArb, LOCATIONS, SEEDED, toEngineInput, WORKED_ENTRIES } from './engineFixtures.js';

const MEMBER_A1 = '11111111-1111-4111-8111-1111111111a1';
const MEMBER_A2 = '11111111-1111-4111-8111-1111111111a2';
const GUEST_C1 = '22222222-2222-4222-8222-2222222222c1';

describe('computeDiningPlan includePerPerson', () => {
  const input: EngineInput = {
    persons: [A1, A2, C1, BABY],
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', source: 'trip' },
    settings: diningPlanSettingsSchema.parse({}),
    entries: WORKED_ENTRIES,
    locations: LOCATIONS,
    priceRows: SEEDED,
    config: DINING_CONFIG_DEFAULTS,
    today: '2026-11-09',
  };

  it('returns each Person\'s plan share, pre-tax out-of-pocket food, snacks and tips for the worked example', () => {
    const r = computeDiningPlan(input, { includePerPerson: true });
    const none = r.scenarios.find((s) => s.code === 'none')!;
    const ts = r.scenarios.find((s) => s.code === 'table_service')!;
    // No plan: Alex pays Cinderella 7900 and two Pecos lunches 2 x 1750, tip 1422, and 6 snacks of 650 before tax.
    expect(none.perPerson).toEqual([
      { key: A1.key, planCostByStay: {}, oopFoodCents: 7900 + 2 * 1750, oopSnackMugCents: 6 * 650, tipCents: 1422 },
      { key: A2.key, planCostByStay: {}, oopFoodCents: 7900 + 2 * 1750, oopSnackMugCents: 6 * 650, tipCents: 1422 },
      { key: C1.key, planCostByStay: {}, oopFoodCents: 4700 + 2 * 1240, oopSnackMugCents: 6 * 650, tipCents: 846 },
    ]);
    // Table service: 5 nights at 9987 / 3194, every meal covered (Cinderella's gratuity waived), one snack each.
    expect(ts.perPerson).toEqual([
      { key: A1.key, planCostByStay: { stay: 5 * 9987 }, oopFoodCents: 0, oopSnackMugCents: 650, tipCents: 0 },
      { key: A2.key, planCostByStay: { stay: 5 * 9987 }, oopFoodCents: 0, oopSnackMugCents: 650, tipCents: 0 },
      { key: C1.key, planCostByStay: { stay: 5 * 3194 }, oopFoodCents: 0, oopSnackMugCents: 650, tipCents: 0 },
    ]);
    expect(r.scenarios.find((s) => s.code === 'deluxe')!.perPerson).toHaveLength(3);
  });

  it('is absent by default and does not change any other figure', () => {
    const plain = computeDiningPlan(input);
    const withPeople = computeDiningPlan(input, { includePerPerson: true });
    expect(plain.scenarios.every((s) => s.perPerson === undefined)).toBe(true);
    expect({ ...withPeople, scenarios: withPeople.scenarios.map(({ perPerson: _p, ...s }) => s) }).toEqual(plain);
  });

  it('gives the wanted mugs to the Persons a plan covers first, so the uncovered mug is charged to someone off the plan', () => {
    // Two mugs wanted; only Blair is on the plan-active stay, so Blair's mug is covered and Alex (first in Party
    // order among the rest) pays for the other. Casey wants none.
    const stays = [
      { key: 'a', label: 'a', lodgingKind: 'resort' as const, source: 'stay' as const, checkIn: '2027-03-01', checkOut: '2027-03-03', partyKeys: [A2.key], setting: { status: 'have_plan' as const, heldPlan: 'quick_service' as const, channel: 'package' as const } },
    ];
    const r = computeDiningPlan({ ...input, persons: [A1, A2, C1], entries: [], stay: { checkIn: '2027-03-01', checkOut: '2027-03-03', source: 'trip' }, stays, settings: diningPlanSettingsSchema.parse({ mugsWanted: 2, snacksPerPersonPerDay: 0 }) }, { includePerPerson: true });
    const none = r.scenarios[0]!;
    expect(none.mugOutOfPocketCents).toBe(2299 + bpsOf(2299, 650));
    expect(none.perPerson!.map((p) => [p.key, p.oopSnackMugCents, p.planCostByStay])).toEqual([[A1.key, 2299, {}], [A2.key, 0, { a: 2 * 6278 }], [C1.key, 0, {}]]);
  });
});

describe('toPreTax', () => {
  it('converts a tax-inclusive amount to the Budget\'s pre-tax figure, half up', () => {
    expect(toPreTax(10_650, 650)).toBe(10_000);
    expect(toPreTax(3_194, 650)).toBe(2_999); // 2999.06
    expect(toPreTax(1_065, 650)).toBe(1_000);
    expect(toPreTax(5, 0)).toBe(5);
    expect(toPreTax(0, 650)).toBe(0);
    expect(toPreTax(3, 2500)).toBe(2); // 2.4 -> 2
    expect(toPreTax(5, 2500)).toBe(4); // 4.0
    expect(toPreTax(9, 2500)).toBe(7); // 7.2 -> 7
    expect(toPreTax(4, 6000)).toBe(3); // exactly 2.5 -> 3 (half up)
  });
});

const PARTY = new Map<string, ExportPartyRef>([[A1.key, { memberId: MEMBER_A1 }], [A2.key, { memberId: MEMBER_A2 }], [C1.key, { guestId: GUEST_C1 }]]);

const TWO_STAYS: ExportStay[] = [
  { key: 'contemporary', label: "Disney's Contemporary Resort", checkIn: '2026-12-15', hasPlan: true, held: true, displayName: 'Disney Dining Plan' },
  { key: 'pop', label: "Disney's Pop Century Resort", checkIn: '2026-12-20', hasPlan: true, held: false, displayName: 'Disney Dining Plan' },
  { key: 'offsite', label: 'Off-site hotel', checkIn: '2026-12-26', hasPlan: false, held: false, displayName: 'Disney Dining Plan' },
];

function exportInput(overrides: Partial<BudgetExportInput> = {}): BudgetExportInput {
  return {
    include: ['plan', 'out_of_pocket', 'tips'],
    perPerson: [
      { key: A1.key, planCostByStay: { contemporary: 10_650, pop: 21_300 }, oopFoodCents: 4_500, oopSnackMugCents: 650, tipCents: 810 },
      { key: C1.key, planCostByStay: { contemporary: 0, pop: 3_194 }, oopFoodCents: 0, oopSnackMugCents: 0, tipCents: 0 },
      { key: 'g:not-active', planCostByStay: { pop: 9_000 }, oopFoodCents: 1_000, oopSnackMugCents: 0, tipCents: 100 },
    ],
    stays: TWO_STAYS,
    party: PARTY,
    budgetTaxBps: 650,
    calculatorTaxBps: 650,
    otherCategoryTaxBps: 0,
    planPricesIncludeTax: true,
    existing: [],
    ...overrides,
  };
}

describe('buildBudgetExport', () => {
  it('builds the plan lines, the out-of-pocket line and the tips line with hand-computed cents', () => {
    const plan = buildBudgetExport(
      exportInput({
        existing: [
          { id: 'line-held', key: 'dining_plan:plan:contemporary', linkedExpenseId: '33333333-3333-4333-8333-333333333333' },
          { id: 'line-gone', key: 'dining_plan:plan:old-stay', linkedExpenseId: null },
          { id: 'line-tips', key: 'dining_plan:tips', linkedExpenseId: null },
          { id: 'line-mine', key: 'planned:abc', linkedExpenseId: null },
        ],
      }),
    );
    expect(plan.edits).toEqual([
      {
        key: 'dining_plan:plan:contemporary', existingId: 'line-held', subtotalCents: 10_000,
        input: {
          category: 'dining', description: "Disney Dining Plan (Disney's Contemporary Resort) (already booked)", plannedDate: '2026-12-15', priceSource: 'user_entered', applyTip: false,
          allocations: [{ memberId: MEMBER_A1, amountCents: 10_000 }], suggestionKey: 'dining_plan:plan:contemporary', linkedExpenseId: '33333333-3333-4333-8333-333333333333',
        },
      },
      {
        key: 'dining_plan:tips', existingId: 'line-tips', subtotalCents: 810,
        input: {
          category: 'other', description: 'Dining tips (estimate)', plannedDate: null, priceSource: 'user_entered', applyTip: false,
          allocations: [{ memberId: MEMBER_A1, amountCents: 810 }], suggestionKey: 'dining_plan:tips', linkedExpenseId: null,
        },
      },
    ]);
    expect(plan.creates).toEqual([
      {
        key: 'dining_plan:plan:pop', existingId: null, subtotalCents: 20_000 + 2_999,
        input: {
          category: 'dining', description: "Disney Dining Plan (Disney's Pop Century Resort)", plannedDate: '2026-12-20', priceSource: 'user_entered', applyTip: false,
          allocations: [{ memberId: MEMBER_A1, amountCents: 20_000 }, { guestId: GUEST_C1, amountCents: 2_999 }], suggestionKey: 'dining_plan:plan:pop', linkedExpenseId: null,
        },
      },
      {
        key: 'dining_plan:oop', existingId: null, subtotalCents: 5_150,
        input: {
          category: 'dining', description: 'Dining out of pocket (estimate)', plannedDate: null, priceSource: 'user_entered', applyTip: false,
          allocations: [{ memberId: MEMBER_A1, amountCents: 5_150 }], suggestionKey: 'dining_plan:oop', linkedExpenseId: null,
        },
      },
    ]);
    // The stale keyed line is deleted; the line without the prefix is never touched.
    expect(plan.deletes).toEqual([{ id: 'line-gone', key: 'dining_plan:plan:old-stay', linkedExpenseId: null }]);
    expect(plan.warnings).toEqual([]);
  });

  it('stores the plan share unchanged when plan prices do not include tax', () => {
    const plan = buildBudgetExport(exportInput({ planPricesIncludeTax: false, include: ['plan'] }));
    expect(plan.creates.map((l) => [l.key, l.input.allocations.map((a) => a.amountCents)])).toEqual([
      ['dining_plan:plan:contemporary', [10_650]],
      ['dining_plan:plan:pop', [21_300, 3_194]],
    ]);
  });

  it('gives a Person with zero in every group no allocation, and an all-zero group no line', () => {
    const plan = buildBudgetExport(exportInput({ perPerson: [{ key: A2.key, planCostByStay: { pop: 0 }, oopFoodCents: 0, oopSnackMugCents: 0, tipCents: 0 }] }));
    expect([...plan.creates, ...plan.edits]).toEqual([]);
  });

  it('produces no plan line for a stay without a plan, and deletes the groups left out of include', () => {
    const plan = buildBudgetExport(
      exportInput({ include: ['plan'], existing: [{ id: 'oop', key: 'dining_plan:oop', linkedExpenseId: null }, { id: 'off', key: 'dining_plan:plan:offsite', linkedExpenseId: null }] }),
    );
    expect(plan.creates.map((l) => l.key)).toEqual(['dining_plan:plan:contemporary', 'dining_plan:plan:pop']);
    expect(plan.deletes.map((l) => l.id)).toEqual(['oop', 'off']);
  });

  it('warns on a tax-rate mismatch, and on a taxed other category only when there is a tips line', () => {
    expect(buildBudgetExport(exportInput({ calculatorTaxBps: 700 })).warnings).toEqual([{ code: 'tax_rate_mismatch', calculatorTaxBps: 700, budgetTaxBps: 650 }]);
    expect(buildBudgetExport(exportInput({ otherCategoryTaxBps: 300 })).warnings).toEqual([{ code: 'other_category_taxed', budgetTaxBps: 300 }]);
    expect(buildBudgetExport(exportInput({ otherCategoryTaxBps: 300, include: ['plan'] })).warnings).toEqual([]);
  });

  it('writes at most 50 allocations per line and clips a long description', () => {
    const many: DiningPerPersonAmounts[] = Array.from({ length: 60 }, (_, i) => ({ key: `m:p${i}`, planCostByStay: {}, oopFoodCents: 100, oopSnackMugCents: 0, tipCents: 0 }));
    const party = new Map<string, ExportPartyRef>(many.map((p, i) => [p.key, { memberId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }]));
    const plan = buildBudgetExport(exportInput({ perPerson: many, party, include: ['out_of_pocket'] }));
    expect(plan.creates[0]!.input.allocations).toHaveLength(50);
    const long = buildBudgetExport(exportInput({ include: ['plan'], stays: [{ ...TWO_STAYS[1]!, label: 'x'.repeat(250) }] }));
    expect(long.creates[0]!.input.description).toHaveLength(200);
  });
});

describe('budget export properties', () => {
  const multiInput = generatedInputArb({ appetizers: true }).chain((single) =>
    fc.integer({ min: 0, max: 7 }).map((cut) => {
      const base = toEngineInput(single);
      const total = Math.round((Date.parse(base.stay.checkOut) - Date.parse(base.stay.checkIn)) / 86_400_000);
      const at = Math.min(total, cut);
      const mid = new Date(Date.parse(`${base.stay.checkIn}T00:00:00Z`) + at * 86_400_000).toISOString().slice(0, 10);
      const stays = at > 0 && at < total
        ? [
            { key: 'one', label: 'One', lodgingKind: 'resort' as const, source: 'stay' as const, checkIn: base.stay.checkIn, checkOut: mid, partyKeys: null, setting: { status: 'have_plan' as const, heldPlan: 'quick_service' as const, channel: 'package' as const } },
            { key: 'two', label: 'Two', lodgingKind: 'resort' as const, source: 'stay' as const, checkIn: mid, checkOut: base.stay.checkOut, partyKeys: null, setting: { status: 'compare' as const, heldPlan: null, channel: 'package' as const } },
          ]
        : undefined;
      return stays === undefined ? base : { ...base, stays };
    }),
  );

  function exportOf(r: DiningPlanResultDTO, inp: EngineInput, scenarioIndex: number, taxBps: number, existing: BudgetExportInput['existing'] = []) {
    const s = r.scenarios[scenarioIndex]!;
    const stays: ExportStay[] = (r.stays ?? [{ key: 'stay', label: 'Stay', checkIn: inp.stay.checkIn, status: 'compare', heldPlan: null }]).map((st) => ({
      key: st.key, label: st.label, checkIn: st.checkIn, held: st.status === 'have_plan',
      hasPlan: s.combination === undefined ? s.code !== 'none' : s.combination[st.key] !== 'none',
      displayName: s.displayName,
    }));
    const party = new Map<string, ExportPartyRef>(inp.persons.map((p, i) => [p.key, { memberId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }]));
    return buildBudgetExport({ include: ['plan', 'out_of_pocket', 'tips'], perPerson: s.perPerson!, stays, party, budgetTaxBps: taxBps, calculatorTaxBps: taxBps, otherCategoryTaxBps: 0, planPricesIncludeTax: inp.config.planPricesIncludeTax, existing });
  }

  // Feature: dining-plan-calculator, Property 41: Exported lines sum to the displayed figures
  // Validates: Requirements 26.4, 26.6, 26.8, 26.14
  it('Property 41: per-Person amounts sum to the scenario terms, and the exported lines carry them', () => {
    fc.assert(
      fc.property(multiInput, fc.boolean(), (inp, includeTax) => {
        const withTax = { ...inp, config: { ...inp.config, planPricesIncludeTax: includeTax } };
        const r = computeDiningPlan(withTax, { includePerPerson: true, skipSensitivity: true });
        const taxBps = r.assumptions.taxBps;
        const snackUnit = DINING_CONFIG_DEFAULTS.snackCents + bpsOf(DINING_CONFIG_DEFAULTS.snackCents, taxBps);
        const mugUnit = DINING_CONFIG_DEFAULTS.mugCents + bpsOf(DINING_CONFIG_DEFAULTS.mugCents, taxBps);
        r.scenarios.forEach((s, index) => {
          if (!s.available) return;
          const pp = s.perPerson!;
          const sum = (f: (p: DiningPerPersonAmounts) => number) => pp.reduce((a, p) => a + f(p), 0);
          expect(sum((p) => p.oopFoodCents)).toBe(s.foodOutOfPocketCents);
          expect(sum((p) => p.tipCents)).toBe(s.tipCents);
          const snacks = s.snackOutOfPocketCents / snackUnit;
          const mugs = s.mugOutOfPocketCents / mugUnit;
          expect(Number.isInteger(snacks) && Number.isInteger(mugs)).toBe(true);
          expect(sum((p) => p.oopSnackMugCents)).toBe(snacks * DINING_CONFIG_DEFAULTS.snackCents + mugs * DINING_CONFIG_DEFAULTS.mugCents);
          const planShares = sum((p) => Object.values(p.planCostByStay).reduce((a, b) => a + b, 0));
          if (includeTax) expect(planShares).toBe(s.planCostCents);
          else expect(planShares).toBeLessThanOrEqual(s.planCostCents);

          const plan = exportOf(r, withTax, index, taxBps);
          const lines = [...plan.creates, ...plan.edits];
          const byKey = new Map(lines.map((l) => [l.key, l]));
          expect(byKey.get('dining_plan:oop')?.subtotalCents ?? 0).toBe(sum((p) => p.oopFoodCents + p.oopSnackMugCents));
          expect(byKey.get('dining_plan:tips')?.subtotalCents ?? 0).toBe(s.tipCents);
          for (const line of lines) {
            expect(line.input.allocations.length).toBeGreaterThan(0);
            for (const a of line.input.allocations) expect(a.amountCents).toBeGreaterThan(0);
            if (!line.key.startsWith('dining_plan:plan:')) continue;
            const stayKey = line.key.slice('dining_plan:plan:'.length);
            const shares = pp.map((p) => p.planCostByStay[stayKey] ?? 0).filter((x) => x > 0);
            if (!includeTax) {
              expect(line.subtotalCents).toBe(shares.reduce((a, b) => a + b, 0));
              continue;
            }
            // The Budget adds tax at read time; its total lands within a cent per allocation of the plan cost.
            const budgetTotal = line.subtotalCents + bpsOf(line.subtotalCents, taxBps);
            expect(Math.abs(budgetTotal - shares.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(line.input.allocations.length);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dining-plan-calculator, Property 42: Export is idempotent and touches only its own lines (pure half)
  // Validates: Requirements 26.7
  it('Property 42: exporting again edits the same keys in place, keeps linked expenses, deletes stale keys and never touches other lines', () => {
    fc.assert(
      fc.property(multiInput, fc.array(fc.constantFrom('planned:x', 'dining_plan:plan:gone', 'dining_plan:oopx', 'ticket:1', 'dining_planX'), { maxLength: 4 }), (inp, extraKeys) => {
        const r = computeDiningPlan(inp, { includePerPerson: true, skipSensitivity: true });
        const index = r.scenarios.findIndex((s) => s.available && s.code !== 'none');
        fc.pre(index >= 0);
        const first = exportOf(r, inp, index, r.assumptions.taxBps);
        expect(first.edits).toEqual([]);
        const unrelated = [...new Set(extraKeys)].map((key, i) => ({ id: `other-${i}`, key, linkedExpenseId: null }));
        const existing = [
          ...first.creates.map((l, i) => ({ id: `id-${i}`, key: l.key, linkedExpenseId: i === 0 ? '44444444-4444-4444-8444-444444444444' : null })),
          ...unrelated,
        ];
        const second = exportOf(r, inp, index, r.assumptions.taxBps, existing);
        expect(second.creates).toEqual([]);
        expect(second.edits.map((l) => [l.key, l.existingId])).toEqual(first.creates.map((l, i) => [l.key, `id-${i}`]));
        second.edits.forEach((l, i) => {
          expect(l.input.allocations).toEqual(first.creates[i]!.input.allocations);
          expect(l.input.linkedExpenseId).toBe(i === 0 ? '44444444-4444-4444-8444-444444444444' : null);
        });
        // Only prefixed keys that this export no longer produces are deleted; nothing else is ever touched.
        expect(second.deletes.map((l) => l.key).sort()).toEqual(unrelated.filter((l) => l.key.startsWith('dining_plan:')).map((l) => l.key).sort());
        for (const l of [...second.edits, ...second.deletes]) expect(l.key.startsWith('dining_plan:')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dining-plan-calculator, Property 41: Exported lines sum to the displayed figures (the exported Combination)
  // Validates: Requirements 26.1, 26.14
  it('Property 41: evaluateForExport gives every Combination the figures the result shows for it, and defaults to the recommended one', () => {
    const terms = (s: DiningScenarioResultDTO) => [s.planCostCents, s.foodOutOfPocketCents, s.taxCents, s.tipCents, s.snackOutOfPocketCents, s.mugOutOfPocketCents, s.totalCents];
    fc.assert(
      fc.property(multiInput, (inp) => {
        const r = computeDiningPlan(inp, { skipSensitivity: true });
        const stayKeys = r.stays?.map((s) => s.key) ?? ['stay'];
        for (const s of r.scenarios) {
          if (!s.available) continue;
          const combination = s.combination ?? Object.fromEntries(stayKeys.map((k) => [k, s.code === 'none' ? 'none' : s.code]));
          const out = evaluateForExport(inp, combination as Record<string, DiningStayOptionCode>);
          if (!out.ok) throw new Error(`rejected ${JSON.stringify(out.problem)}`);
          expect(terms(out.evaluation.scenario)).toEqual(terms(s));
          expect(out.evaluation.scenario.perPerson!.reduce((a, p) => a + p.tipCents, 0)).toBe(s.tipCents);
        }
        for (const alt of r.alternatives ?? []) {
          const out = evaluateForExport(inp, alt.combination);
          expect(out.ok ? out.evaluation.scenario.totalCents : null).toBe(alt.totalCents);
        }
        const byDefault = evaluateForExport(inp);
        if (!byDefault.ok) throw new Error('the default Combination was rejected');
        expect(byDefault.evaluation.scenario.totalCents).toBe(r.scenarios.find((s) => s.code === r.recommended)!.totalCents);
        if (r.recommendedCombination !== undefined) expect(byDefault.evaluation.combination).toEqual(r.recommendedCombination);
      }),
      { numRuns: 100 },
    );
  });
});

describe('evaluateForExport (Requirements 26.1, 26.3, 26.4)', () => {
  const stay = (key: string, label: string, lodgingKind: 'resort' | 'offsite', checkIn: string, checkOut: string, setting: EnginePlanStay['setting']): EnginePlanStay => ({
    key, label, lodgingKind, source: 'stay', checkIn, checkOut, partyKeys: null, setting,
  });
  const input: EngineInput = {
    persons: [A1, A2],
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', source: 'trip' },
    settings: diningPlanSettingsSchema.parse({}),
    entries: WORKED_ENTRIES,
    locations: LOCATIONS,
    priceRows: SEEDED,
    config: DINING_CONFIG_DEFAULTS,
    today: '2026-11-09',
    stays: [
      stay('held', "Disney's Contemporary Resort", 'resort', '2027-03-01', '2027-03-03', { status: 'have_plan', heldPlan: 'table_service', channel: 'package' }),
      stay('cmp', "Disney's Pop Century Resort", 'resort', '2027-03-03', '2027-03-04', { status: 'compare', heldPlan: null, channel: 'package' }),
      stay('nop', "Disney's Art of Animation Resort", 'resort', '2027-03-04', '2027-03-05', { status: 'no_plan', heldPlan: null, channel: 'package' }),
      stay('off', 'Aunt May', 'offsite', '2027-03-05', '2027-03-06', { status: 'compare', heldPlan: null, channel: 'package' }),
    ],
  };
  const valid: Record<string, DiningStayOptionCode> = { held: 'table_service', cmp: 'quick_service', nop: 'none', off: 'none' };

  it('describes each stay for the export, with the plan shares of the requested Combination', () => {
    const out = evaluateForExport(input, valid);
    if (!out.ok) throw new Error('rejected');
    expect(out.evaluation.combination).toEqual(valid);
    expect(out.evaluation.stays).toEqual([
      { key: 'held', label: "Disney's Contemporary Resort", checkIn: '2027-03-01', hasPlan: true, held: true, displayName: 'Table-Service Dining Plan' },
      { key: 'cmp', label: "Disney's Pop Century Resort", checkIn: '2027-03-03', hasPlan: true, held: false, displayName: 'Quick-Service Dining Plan' },
      { key: 'nop', label: "Disney's Art of Animation Resort", checkIn: '2027-03-04', hasPlan: false, held: false, displayName: '' },
      { key: 'off', label: 'Aunt May', checkIn: '2027-03-05', hasPlan: false, held: false, displayName: '' },
    ]);
    // 2027 adult prices: two nights of the held Table-Service plan at $99.87, one Quick-Service night at $62.78.
    expect(out.evaluation.scenario.perPerson!.map((p) => [p.key, p.planCostByStay])).toEqual([
      [A1.key, { held: 19_974, cmp: 6_278 }],
      [A2.key, { held: 19_974, cmp: 6_278 }],
    ]);
    expect(out.evaluation.calculatorTaxBps).toBe(650);
    expect(out.evaluation.planPricesIncludeTax).toBe(true);
  });

  it.each<[string, Record<string, DiningStayOptionCode>, { reason: string; stayKey: string }]>([
    ['a key that names no stay', { ...valid, gone: 'none' }, { reason: 'unknown_stay', stayKey: 'gone' }],
    ['a stay left out', { held: 'table_service', cmp: 'none', nop: 'none' }, { reason: 'missing_stay', stayKey: 'off' }],
    ['another plan on a stay whose plan is booked', { ...valid, held: 'deluxe' }, { reason: 'held_plan', stayKey: 'held' }],
    ['no plan on a stay whose plan is booked', { ...valid, held: 'none' }, { reason: 'held_plan', stayKey: 'held' }],
    ['a plan on a stay set to no plan', { ...valid, nop: 'quick_service' }, { reason: 'no_plan', stayKey: 'nop' }],
    ['a plan on an off-site stay', { ...valid, off: 'quick_service' }, { reason: 'unavailable', stayKey: 'off' }],
  ])('rejects %s', (_name, combination, problem) => {
    expect(evaluateForExport(input, combination)).toEqual({ ok: false, problem });
  });
});
