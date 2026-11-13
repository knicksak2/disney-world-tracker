/**
 * Comparison and verdict (Requirements 13.3 to 13.7; design.md "Comparison and verdict"; Property 16).
 */

import {
  bpsOf,
  DINING_EVEN_BPS,
  DINING_EVEN_FLOOR_CENTS,
  DINING_PLAN_CODES,
  type DiningPlanCode,
  type DiningScenarioCode,
  type DiningScenarioResultDTO,
  type DiningVerdict,
} from '@dwt/shared';

export interface Comparison {
  /** The input scenarios with `netSavingsCents` set: `noPlan.totalCents - totalCents` for an available plan, else 0. */
  readonly scenarios: DiningScenarioResultDTO[];
  readonly recommended: DiningScenarioCode;
  readonly verdict: DiningVerdict;
  readonly bestPlan: DiningPlanCode | null;
  readonly bestNetSavingsCents: number;
  readonly evenThresholdCents: number;
  readonly breakEvenGapCents: number;
}

const PLAN_RANK = new Map<string, number>(DINING_PLAN_CODES.map((c, i) => [c, i]));

/** `max(DINING_EVEN_FLOOR_CENTS, bpsOf(noPlanTotal, DINING_EVEN_BPS))` (Requirement 13.5). */
export function evenThresholdOf(noPlanTotalCents: number): number {
  return Math.max(DINING_EVEN_FLOOR_CENTS, bpsOf(noPlanTotalCents, DINING_EVEN_BPS));
}

/** Requirement 13.5: `bestNet` is the best option's net savings against No_Plan (the Baseline), null when none exists. */
export function verdictOf(bestNet: number | null, evenThresholdCents: number): DiningVerdict {
  if (bestNet === null) return 'plan_unavailable';
  if (bestNet > evenThresholdCents) return 'plan_saves';
  return Math.abs(bestNet) <= evenThresholdCents ? 'about_even' : 'plan_costs_more';
}

/**
 * The single-stay comparison: `best` is the available plan with the greatest net savings, ties to the simpler plan (quick service, table service,
 * deluxe). A plan is recommended only when it saves more than the Even_Threshold; otherwise No_Plan is (Requirement
 * 13.6), even when a plan is a few dollars cheaper, because that difference is inside the estimate's error.
 */
export function compareScenarios(noPlan: DiningScenarioResultDTO, plans: readonly DiningScenarioResultDTO[]): Comparison {
  const withNet = plans.map((s) => ({ ...s, netSavingsCents: s.available ? noPlan.totalCents - s.totalCents : 0 }));
  const available = withNet.filter((s) => s.available);
  let best: DiningScenarioResultDTO | null = null;
  for (const s of available) {
    if (
      best === null ||
      s.netSavingsCents > best.netSavingsCents ||
      (s.netSavingsCents === best.netSavingsCents && (PLAN_RANK.get(s.code) ?? 99) < (PLAN_RANK.get(best.code) ?? 99))
    ) {
      best = s;
    }
  }
  const evenThresholdCents = evenThresholdOf(noPlan.totalCents);
  const verdict = verdictOf(best === null ? null : best.netSavingsCents, evenThresholdCents);

  return {
    scenarios: [{ ...noPlan, netSavingsCents: 0 }, ...withNet],
    recommended: verdict === 'plan_saves' && best !== null ? best.code : 'none',
    verdict,
    bestPlan: best === null ? null : (best.code as DiningPlanCode),
    bestNetSavingsCents: best?.netSavingsCents ?? 0,
    evenThresholdCents,
    breakEvenGapCents: best === null ? 0 : Math.max(0, best.totalCents - noPlan.totalCents),
  };
}
