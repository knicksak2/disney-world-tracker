/**
 * The engine entry point (design.md "Engine modules" and "Multi-Stay Extension"; Requirements 4.6, 4.7, 13.3 to
 * 13.8, 15.1 to 15.5, 16.9, 25).
 *
 * Pure: plain values in, a `DiningPlanResultDTO` out, no I/O, no clock and no randomness, so the Trip route and the
 * stateless route share one code path and every figure is reproducible. Every input runs through the Plan_Stay model;
 * without `input.stays` the engine builds the one stay of the single-stay design and leaves the multi-stay fields out,
 * which gives exactly the single-stay result (Property 31).
 */

import {
  DINING_MENU_BASES,
  DINING_ORDER_STYLES,
  DINING_PLAN_CODES,
  type DiningMenuBasis,
  type DiningPlanCode,
  type DiningPlanResultDTO,
  type DiningPlanStayResultDTO,
  type DiningScenarioCode,
  type DiningScenarioResultDTO,
  type DiningStayOptionCode,
  type EnginePlanStay,
} from '@dwt/shared';

import { daysBetween } from '../../ticketPrices/dates.js';
import type { ExportStay } from './budgetExport.js';
import { evenThresholdOf, verdictOf } from './compare.js';
import {
  assignmentKey,
  baselineOf,
  combinationRecord,
  compareRanked,
  enumerateAssignments,
  sameAssignment,
  uniformOf,
  type Assignment,
} from './combinations.js';
import type { ValuationContext } from './mealValuation.js';
import type { PlanCostResult } from './planPrice.js';
import {
  buildScenarioEntries,
  DINING_SCENARIO_FALLBACK_NAMES,
  emptyScenario,
  evaluateCombination,
  valuationContextOf,
  type BuiltEntries,
  type CombinationContext,
  type CombinationResult,
  type ScenarioEntry,
} from './scenario.js';
import { daysInclusive } from './stay.js';
import { buildStayRuntimes, type PlanStayRuntime, type StayRuntimeResult } from './stays.js';
import type { EngineInput, EnginePriceRow } from './types.js';

export interface ComputeOptions {
  /** Set by the sensitivity passes so they do not recurse (Requirement 15.1). */
  readonly skipSensitivity?: boolean;
  /**
   * Each available scenario also carries `perPerson`, computed in the same pass (Requirement 26.14). For the Budget
   * export only; the routes do not send it to the client.
   */
  readonly includePerPerson?: boolean;
}

/** The single stay of the earlier design, as a Plan_Stay (Multi-Stay Extension: "When `stays` is omitted"). */
export function singlePlanStay(input: Pick<EngineInput, 'stay' | 'settings'>): EnginePlanStay {
  const { stayType } = input.settings;
  return {
    key: 'stay',
    label: 'Stay',
    lodgingKind: stayType === 'not_disney_resort' ? 'offsite' : 'resort',
    source: 'stay',
    checkIn: input.stay.checkIn,
    checkOut: input.stay.checkOut,
    partyKeys: null,
    setting: { status: 'compare', heldPlan: null, channel: stayType === 'dvc_or_passholder_resort' ? 'dvc_or_passholder' : 'package' },
  };
}

/** Counts each in-stay, non-skip entry once (Requirements 7.9, 15.2; Property 13). */
function dataQualityOf(entries: readonly ScenarioEntry[], unverifiedPrices: number, outsideStayEntries: number): DiningPlanResultDTO['dataQuality'] {
  const byBasis = Object.fromEntries(DINING_MENU_BASES.map((b) => [b, 0])) as Record<DiningMenuBasis, number>;
  let estimatedEntries = 0;
  let unverifiedRules = 0;
  let derivedRules = 0;
  for (const { entry, valuation } of entries) {
    // A snack-only entry is priced at the configured snack price: counted under `default_estimate` so the basis
    // counts add up to the entries, but not as an "estimated" meal (the daily snacks use the same price and never are).
    const basis: DiningMenuBasis = valuation.kind === 'meal' ? valuation.basis : 'default_estimate';
    byBasis[basis] += 1;
    if (valuation.kind === 'meal' && (basis === 'tier_estimate' || basis === 'default_estimate')) estimatedEntries += 1;
    if (valuation.ruleBasis === 'unverified') unverifiedRules += 1;
    // A placeholder has no location, so no rule to derive (Requirement 8.6 counts locations without a stored rule).
    if (valuation.ruleBasis === 'derived' && entry.kind === 'restaurant') derivedRules += 1;
  }
  return { byBasis, estimatedEntries, unverifiedRules, derivedRules, unverifiedPrices, outsideStayEntries };
}

function distinctJoined(values: readonly (string | null)[]): string | null {
  const out: string[] = [];
  for (const v of values) if (v !== null && !out.includes(v)) out.push(v);
  return out.length > 0 ? out.join(' / ') : null;
}

/** The first unavailable reason of a stay with no plan to offer, in the order of `DINING_PLAN_CODES`. */
function stayUnavailableReason(stay: PlanStayRuntime): DiningPlanStayResultDTO['unavailableReason'] {
  if (!stay.planEligible) return 'not_disney_resort';
  if (stay.heldPlan !== null || DINING_PLAN_CODES.some((p) => stay.planCosts[p].available)) return null;
  return stay.planCosts[DINING_PLAN_CODES[0]].unavailableReason;
}

export function computeDiningPlan(input: EngineInput, options: ComputeOptions = {}): DiningPlanResultDTO {
  return computeInternal(input, options.skipSensitivity === true, options.includePerPerson === true).result;
}

/** Everything a Combination is evaluated against: built once per input, shared by the result and the export. */
interface Prepared {
  readonly ctx: CombinationContext;
  readonly runtime: StayRuntimeResult;
  readonly valuationCtx: ValuationContext;
  readonly built: BuiltEntries;
  readonly multi: boolean;
}

function prepare(input: EngineInput, includePerPerson: boolean): Prepared {
  const { settings, config, persons } = input;
  const multi = input.stays !== undefined;
  const valuationCtx = valuationContextOf(persons, settings, config);
  const runtime = buildStayRuntimes({
    stays: input.stays ?? [singlePlanStay(input)],
    persons,
    priceRows: input.priceRows,
    settings,
    config,
    taxBps: valuationCtx.taxBps,
  });
  const built = buildScenarioEntries(input.entries, input.locations, persons, runtime.span, valuationCtx);
  const ctx: CombinationContext = {
    persons,
    entries: built.entries,
    stays: runtime.stays,
    stayOfDate: runtime.stayOfDate,
    snacksPerPersonPerDay: settings.snacksPerPersonPerDay,
    mugsWanted: settings.mugsWanted,
    taxBps: valuationCtx.taxBps,
    config,
    tagStays: multi,
    includePerPerson,
  };
  return { ctx, runtime, valuationCtx, built, multi };
}

/** Why a requested Combination cannot be exported (Requirement 26.3). */
export interface ExportCombinationProblem {
  /**
   * `unknown_stay`: the key names no Plan_Stay; `missing_stay`: a Plan_Stay has no option; `held_plan`: the stay is
   * set to a plan already booked and the option differs; `no_plan`: the stay is set to no plan (or is a `compare` stay
   * past the limit, which is treated as no plan); `unavailable`: the plan cannot be bought for the stay.
   */
  readonly reason: 'unknown_stay' | 'missing_stay' | 'held_plan' | 'no_plan' | 'unavailable';
  readonly stayKey: string;
}

export interface ExportEvaluation {
  /** The Combination as exported, by Plan_Stay key. */
  readonly combination: Readonly<Record<string, DiningStayOptionCode>>;
  /** The evaluated Combination, with `perPerson`. */
  readonly scenario: DiningScenarioResultDTO;
  /** In date order, as `buildBudgetExport` takes them. */
  readonly stays: readonly ExportStay[];
  readonly calculatorTaxBps: number;
  readonly planPricesIncludeTax: boolean;
}

/** The option of each stay, in stay order, or the first problem with the requested record. */
function assignmentFromRecord(stays: readonly PlanStayRuntime[], record: Readonly<Record<string, DiningStayOptionCode>>): Assignment | ExportCombinationProblem {
  const keys = new Set(stays.map((s) => s.key));
  const unknown = Object.keys(record).find((k) => !keys.has(k));
  if (unknown !== undefined) return { reason: 'unknown_stay', stayKey: unknown };
  const assign: (DiningPlanCode | null)[] = [];
  for (const s of stays) {
    const code = record[s.key];
    if (code === undefined) return { reason: 'missing_stay', stayKey: s.key };
    const option = code === 'none' ? null : code;
    if (!s.options.includes(option)) {
      const reason = s.status === 'have_plan' && s.options[0] !== null ? 'held_plan' : s.status === 'no_plan' ? 'no_plan' : 'unavailable';
      return { reason, stayKey: s.key };
    }
    assign.push(option);
  }
  return assign;
}

/**
 * The Combination to send to the Trip Budget (Requirements 26.1, 26.3, 26.14), evaluated with each Person's amounts.
 * Without `combination` it is the recommended Combination of `computeDiningPlan(input)`. The evaluation reads the
 * same prepared context as the result, so its figures are the displayed figures for that Combination.
 */
export function evaluateForExport(
  input: EngineInput,
  combination?: Readonly<Record<string, DiningStayOptionCode>>,
): { readonly ok: true; readonly evaluation: ExportEvaluation } | { readonly ok: false; readonly problem: ExportCombinationProblem } {
  const { ctx, runtime, valuationCtx } = prepare(input, true);
  const { stays } = runtime;
  let assign: Assignment;
  if (combination === undefined) {
    assign = computeInternal(input, true, false).recommendedAssign;
  } else {
    const parsed = assignmentFromRecord(stays, combination);
    if ('reason' in parsed) return { ok: false, problem: parsed };
    assign = parsed;
  }
  const { scenario } = evaluateCombination(assign, ctx, { code: 'mix', displayName: DINING_SCENARIO_FALLBACK_NAMES.mix });
  const exportStays: ExportStay[] = stays.map((s, i) => {
    const plan = assign[i] ?? null;
    return {
      key: s.key,
      label: s.label,
      checkIn: s.checkIn,
      hasPlan: plan !== null,
      held: plan !== null && plan === s.heldPlan,
      displayName: plan === null ? '' : (s.planCosts[plan].displayName ?? DINING_SCENARIO_FALLBACK_NAMES[plan]),
    };
  });
  return {
    ok: true,
    evaluation: {
      combination: combinationRecord(stays, assign),
      scenario,
      stays: exportStays,
      calculatorTaxBps: valuationCtx.taxBps,
      planPricesIncludeTax: input.config.planPricesIncludeTax,
    },
  };
}

/** The result plus the best Combination's net savings, which a sensitivity row needs even when it is a `mix`. */
function computeInternal(
  input: EngineInput,
  skipSensitivity: boolean,
  includePerPerson: boolean,
): { result: DiningPlanResultDTO; bestNet: number; recommendedAssign: Assignment } {
  const { settings, config, persons } = input;
  const { ctx, runtime, valuationCtx, built, multi } = prepare(input, includePerPerson);
  const { stays, span } = runtime;

  // Evaluate every Combination once (no enumeration beyond the one fixed Combination without a compare stay).
  const evaluated = new Map<string, CombinationResult>();
  const evaluate = (assign: Assignment, code: DiningScenarioCode = 'mix', displayName = DINING_SCENARIO_FALLBACK_NAMES.mix): CombinationResult => {
    const key = assignmentKey(assign);
    let hit = evaluated.get(key);
    if (hit === undefined) {
      hit = evaluateCombination(assign, ctx, { code, displayName });
      evaluated.set(key, hit);
    }
    return { scenario: { ...hit.scenario, code, displayName }, perStay: hit.perStay };
  };
  const hasHeld = stays.some((s) => s.heldPlan !== null);
  const baseline = baselineOf(stays);
  const baselineResult = evaluate(baseline, 'none', hasHeld ? 'No additional plan' : DINING_SCENARIO_FALLBACK_NAMES.none);
  const ranked = enumerateAssignments(stays)
    .map((assign) => ({ assign, totalCents: evaluate(assign).scenario.totalCents }))
    .sort((a, b) => compareRanked(stays, a, b));
  const candidates = ranked.filter((r) => !sameAssignment(r.assign, baseline));
  const best = candidates[0] ?? null;

  // Uniform scenarios, one per plan code, then the mixed Combination when the best one is not uniform.
  const compareStays = stays.filter((s) => s.status === 'compare');
  const uniform = new Map<DiningPlanCode, Assignment>();
  const planScenarios: DiningScenarioResultDTO[] = [];
  for (const plan of DINING_PLAN_CODES) {
    const assign = uniformOf(stays, plan);
    if (assign !== null) {
      uniform.set(plan, assign);
      const names = compareStays.filter((s) => s.options.includes(plan)).map((s) => s.planCosts[plan].displayName);
      planScenarios.push(evaluate(assign, plan, distinctJoined(names) ?? DINING_SCENARIO_FALLBACK_NAMES[plan]).scenario);
    } else if (compareStays.length > 0) {
      const first: PlanCostResult = compareStays[0]!.planCosts[plan];
      planScenarios.push(emptyScenario(plan, first.unavailableReason, first.displayName));
    }
  }
  const codeOf = (assign: Assignment): DiningScenarioCode => {
    if (sameAssignment(assign, baseline)) return 'none';
    for (const [plan, u] of uniform) if (sameAssignment(assign, u)) return plan;
    return 'mix';
  };
  const bestCode = best === null ? null : codeOf(best.assign);
  if (best !== null && bestCode === 'mix') planScenarios.push(evaluate(best.assign).scenario);

  const baselineTotal = baselineResult.scenario.totalCents;
  const net = (s: DiningScenarioResultDTO) => (s.available ? baselineTotal - s.totalCents : 0);
  const scenarios = [{ ...baselineResult.scenario, netSavingsCents: 0 }, ...planScenarios.map((s) => ({ ...s, netSavingsCents: net(s) }))];

  // Verdict against the Baseline (Requirements 13.5 to 13.7, 25.10).
  const evenThresholdCents = evenThresholdOf(baselineTotal);
  const bestNet = best === null ? 0 : baselineTotal - best.totalCents;
  const verdict = verdictOf(best === null ? null : bestNet, evenThresholdCents);
  const recommendedAssign = verdict === 'plan_saves' && best !== null ? best.assign : baseline;
  const recommended: DiningScenarioCode = verdict === 'plan_saves' && bestCode !== null ? bestCode : 'none';
  const bestPlan = bestCode === null || bestCode === 'none' || bestCode === 'mix' ? null : bestCode;

  // Prices as of: the periods each stay could use. Null when none is in use or any is unverified (Requirement 15.5).
  const periodsInUse: EnginePriceRow[] = [];
  for (const s of stays) {
    for (const option of s.options) {
      if (option === null) continue;
      for (const period of s.planCosts[option].periods) if (!periodsInUse.includes(period)) periodsInUse.push(period);
    }
  }
  const unverifiedPrices = periodsInUse.filter((p) => p.verifiedAt === null).length;
  const pricesAsOf =
    periodsInUse.length === 0 || unverifiedPrices > 0 ? null : periodsInUse.map((p) => p.verifiedAt!).reduce((a, b) => (b > a ? b : a));

  const sensitivity = skipSensitivity
    ? []
    : DINING_ORDER_STYLES.map((orderStyle) => {
        if (orderStyle === settings.orderStyle) return { orderStyle, bestPlan, recommended, netSavingsCents: bestNet };
        const other = computeInternal({ ...input, settings: { ...settings, orderStyle } }, true, false);
        return { orderStyle, bestPlan: other.result.bestPlan, recommended: other.result.recommended, netSavingsCents: other.bestNet };
      });

  const warnings: DiningPlanResultDTO['warnings'][number][] = built.outsideStay.map((e) => ({
    code: 'outside_stay' as const,
    date: e.date,
    mealPeriod: e.mealPeriod,
  }));
  if (built.entries.length === 0) warnings.push({ code: 'no_entries' });
  for (const s of stays) if (s.heldPriceUnknown) warnings.push({ code: 'held_plan_price_unknown', stayKey: s.key });
  for (const key of runtime.overflowCompareKeys) warnings.push({ code: 'too_many_compare_stays', stayKey: key });

  const result: DiningPlanResultDTO = {
    computedForDate: input.today,
    stay: {
      checkIn: span.checkIn,
      checkOut: span.checkOut,
      nights: Math.max(0, daysBetween(span.checkIn, span.checkOut)),
      days: daysInclusive(span.checkIn, span.checkOut),
      source: input.stay.source,
    },
    eligibleCount: persons.filter((p) => p.ageBracket !== 'under3').length,
    scenarios: multi ? scenarios.map((s) => withCombination(s, stays, s.code === 'none' ? baseline : s.code === 'mix' ? best?.assign ?? null : uniform.get(s.code as DiningPlanCode) ?? null)) : scenarios,
    recommended,
    verdict,
    bestPlan,
    evenThresholdCents,
    breakEvenGapCents: best === null ? 0 : Math.max(0, best.totalCents - baselineTotal),
    sensitivity,
    dataQuality: dataQualityOf(built.entries, unverifiedPrices, built.outsideStay.length),
    assumptions: {
      taxBps: valuationCtx.taxBps,
      taxIsDefault: settings.taxBps === null,
      tipBps: valuationCtx.tipBps,
      tipIsDefault: settings.tipBps === null,
      planPricesIncludeTax: config.planPricesIncludeTax,
      passDiscountBps: valuationCtx.partyHasPassHolder ? config.passDiningDiscountBps : null,
      pricesAsOf,
    },
    warnings,
  };

  if (multi) {
    const recommendedResult = evaluate(recommendedAssign);
    const recommendedTotal = recommendedResult.scenario.totalCents;
    const stayResults: DiningPlanStayResultDTO[] = stays.map((s, i) => {
      const option = recommendedAssign[i] ?? null;
      const without = option === null ? recommendedTotal : evaluate(recommendedAssign.map((x, j) => (j === i ? null : x))).scenario.totalCents;
      return {
        key: s.key,
        label: s.label,
        lodgingKind: s.lodgingKind,
        source: s.source,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        nights: s.nights,
        partyCount: s.persons.length,
        status: s.status,
        heldPlan: s.heldPlan,
        channel: s.channel,
        available: stayUnavailableReason(s) === null,
        unavailableReason: stayUnavailableReason(s),
        recommendedPlan: option ?? 'none',
        planCostCents: recommendedResult.perStay[i]!.planCostCents,
        credits: recommendedResult.perStay[i]!.credits,
        contributionCents: without - recommendedTotal,
      };
    });
    const recommendedKey = assignmentKey(recommendedAssign);
    Object.assign(result, {
      stays: stayResults,
      recommendedCombination: combinationRecord(stays, recommendedAssign),
      alternatives: ranked
        .filter((r) => assignmentKey(r.assign) !== recommendedKey)
        .slice(0, 5)
        .map((r) => ({ combination: combinationRecord(stays, r.assign), totalCents: r.totalCents, netSavingsCents: baselineTotal - r.totalCents })),
    });
  }

  return { result, bestNet, recommendedAssign };
}

function withCombination(s: DiningScenarioResultDTO, stays: readonly PlanStayRuntime[], assign: Assignment | null): DiningScenarioResultDTO {
  return assign === null ? s : { ...s, combination: combinationRecord(stays, assign) };
}
