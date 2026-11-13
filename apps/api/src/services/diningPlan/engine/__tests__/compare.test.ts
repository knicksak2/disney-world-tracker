import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bpsOf, DINING_PLAN_CODES, type DiningPlanCode, type DiningScenarioResultDTO } from '@dwt/shared';

import { compareScenarios, evenThresholdOf } from '../compare.js';

function scenario(code: 'none' | DiningPlanCode, totalCents: number, available = true): DiningScenarioResultDTO {
  return {
    code, displayName: code, available, unavailableReason: available ? null : 'no_price_for_dates', planCostCents: 0, promoLabel: null,
    foodOutOfPocketCents: totalCents, taxCents: 0, tipCents: 0, snackOutOfPocketCents: 0, mugOutOfPocketCents: 0,
    totalCents, netSavingsCents: 0, credits: null, meals: [], bestCreditUses: [], priceVerifiedAt: null,
  };
}

function compare(noPlan: number, qs: number | null, ts: number | null, deluxe: number | null) {
  const plan = (code: DiningPlanCode, total: number | null) => scenario(code, total ?? 0, total !== null);
  return compareScenarios(scenario('none', noPlan), [plan('quick_service', qs), plan('table_service', ts), plan('deluxe', deluxe)]);
}

describe('evenThresholdOf', () => {
  it('is the $20 floor for small totals and 2% above $1,000', () => {
    expect(evenThresholdOf(50_000)).toBe(2_000); // 2% would be 1000
    expect(evenThresholdOf(100_000)).toBe(2_000); // exactly 2000 either way
    expect(evenThresholdOf(200_000)).toBe(4_000);
    expect(evenThresholdOf(123_456)).toBe(bpsOf(123_456, 200)); // 2469
  });
});

describe('compareScenarios', () => {
  it('sets each available plan\'s net savings and leaves unavailable plans and No_Plan at 0', () => {
    const r = compare(100_000, 110_000, 95_000, null);
    expect(r.scenarios.map((s) => [s.code, s.netSavingsCents])).toEqual([
      ['none', 0], ['quick_service', -10_000], ['table_service', 5_000], ['deluxe', 0],
    ]);
  });

  it('saves only above the threshold: at it is about_even, one cent above saves', () => {
    expect(compare(100_000, null, 98_000, null)).toMatchObject({ verdict: 'about_even', recommended: 'none', bestPlan: 'table_service', evenThresholdCents: 2_000 });
    expect(compare(100_000, null, 97_999, null)).toMatchObject({ verdict: 'plan_saves', recommended: 'table_service', bestPlan: 'table_service', breakEvenGapCents: 0 });
  });

  it('costs more only beyond the threshold: at minus the threshold it is about_even', () => {
    expect(compare(100_000, null, 102_000, null)).toMatchObject({ verdict: 'about_even', recommended: 'none', breakEvenGapCents: 2_000 });
    expect(compare(100_000, null, 102_001, null)).toMatchObject({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 2_001 });
  });

  it('uses 2% of the No_Plan total once it exceeds the floor', () => {
    // Threshold 4000: a plan saving 3000 is about even, one saving 4001 saves.
    expect(compare(200_000, null, 197_000, null).verdict).toBe('about_even');
    expect(compare(200_000, null, 195_999, null).verdict).toBe('plan_saves');
  });

  it('picks the plan with the greatest net savings, ties toward the simpler plan', () => {
    expect(compare(150_000, 120_000, 110_000, 130_000)).toMatchObject({ bestPlan: 'table_service', recommended: 'table_service', bestNetSavingsCents: 40_000 });
    expect(compare(150_000, 110_000, 110_000, 110_000)).toMatchObject({ bestPlan: 'quick_service', recommended: 'quick_service' });
    expect(compare(150_000, 130_000, 110_000, 110_000)).toMatchObject({ bestPlan: 'table_service' });
  });

  it('is plan_unavailable with no best plan when no plan is available', () => {
    expect(compare(80_000, null, null, null)).toMatchObject({
      verdict: 'plan_unavailable', recommended: 'none', bestPlan: null, bestNetSavingsCents: 0, breakEvenGapCents: 0, evenThresholdCents: 2_000,
    });
  });

  // Feature: dining-plan-calculator, Property 16: Recommendation and verdict are consistent
  // Validates: Requirements 13.4, 13.5, 13.6, 13.7
  it('Property 16: verdict, recommendation and break-even gap follow the threshold rules', () => {
    const totalArb = fc.option(fc.integer({ min: 0, max: 400_000 }), { nil: null });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400_000 }), totalArb, totalArb, totalArb, (noPlan, qs, ts, deluxe) => {
        const r = compare(noPlan, qs, ts, deluxe);
        const totals: [DiningPlanCode, number | null][] = [['quick_service', qs], ['table_service', ts], ['deluxe', deluxe]];
        const available = totals.filter((t): t is [DiningPlanCode, number] => t[1] !== null);
        const threshold = Math.max(2_000, bpsOf(noPlan, 200));
        expect(r.evenThresholdCents).toBe(threshold);
        if (available.length === 0) {
          expect(r).toMatchObject({ verdict: 'plan_unavailable', recommended: 'none', bestPlan: null, breakEvenGapCents: 0 });
          return;
        }
        // Lowest total, ties in the order quick_service, table_service, deluxe.
        const lowest = Math.min(...available.map((t) => t[1]));
        const best = available.find((t) => t[1] === lowest)!;
        const net = noPlan - best[1];
        expect(r.bestPlan).toBe(best[0]);
        expect(r.bestNetSavingsCents).toBe(net);
        const verdict = net > threshold ? 'plan_saves' : Math.abs(net) <= threshold ? 'about_even' : 'plan_costs_more';
        expect(r.verdict).toBe(verdict);
        // A plan is recommended only when it saves; then it is also the option with the lowest total.
        expect(r.recommended).toBe(verdict === 'plan_saves' ? best[0] : 'none');
        if (verdict === 'plan_saves') expect(lowest).toBeLessThan(noPlan);
        expect(r.breakEvenGapCents).toBe(Math.max(0, best[1] - noPlan));
        expect(r.scenarios.map((s) => s.code)).toEqual(['none', ...DINING_PLAN_CODES]);
      }),
      { numRuns: 300 },
    );
  });
});
