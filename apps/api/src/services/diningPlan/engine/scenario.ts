/**
 * One scenario's totals, credit summary and per-meal lines (design.md "Scenario totals" and "Multi-Stay Extension";
 * Requirements 9, 10.2, 10.6, 11, 12, 13.1, 13.3, 14.1 to 14.4, 25.4 to 25.8, 25.11, 25.12).
 *
 * Valuation does not depend on the scenario (tax, tip and the pass discount apply in every scenario), so the caller
 * values each entry once (`buildScenarioEntries`) and every scenario reads the same valuations. A scenario is a
 * Combination: a plan (or none) per Plan_Stay. Each Plan_Eligible_Person's meals are covered from their own credits on
 * the stays they are on (`allocateAcrossStays`, which is `allocateCredits` for one stay), and the rest is paid out of
 * pocket. The single-stay `evaluateScenario` is the one-stay case of `evaluateCombination`.
 */

import {
  bpsOf,
  DINING_MEAL_PERIODS,
  DINING_PLAN_CODES,
  DINING_PLAN_ENTITLEMENTS_PER_NIGHT,
  type DiningConfig,
  type DiningCoverage,
  type DiningCreditSummaryDTO,
  type DiningMealLineDTO,
  type DiningPerPersonAmounts,
  type DiningPlanCode,
  type DiningPlanSettings,
  type DiningScenarioCode,
  type DiningScenarioResultDTO,
  type DiningUncoveredReason,
  type DiningUnavailableReason,
} from '@dwt/shared';

import { allocateAcrossStays, type ActiveStay } from './allocateAcrossStays.js';
import { allocateCredits, type AllocationItem } from './allocateCredits.js';
import {
  partyHasPassHolder,
  valueEntry,
  type MealValuation,
  type SnackValuation,
  type ValuationContext,
} from './mealValuation.js';
import { planCost, type PlanCostResult } from './planPrice.js';
import { daysInclusive, isInStay, nightsOf, type StayDates } from './stay.js';
import { stayPlanCents, type PlanStayRuntime } from './stays.js';
import type { EngineEntry, EngineLocation, EnginePerson, EnginePriceRow } from './types.js';

/** Names for a scenario whose plan has no price period to take a `display_name` from. */
export const DINING_SCENARIO_FALLBACK_NAMES: Readonly<Record<DiningScenarioCode, string>> = {
  none: 'No Dining Plan',
  quick_service: 'Quick-Service Dining Plan',
  table_service: 'Table-Service Dining Plan',
  deluxe: 'Deluxe Table-Service Dining Plan',
  mix: 'A plan per hotel',
};

/** One valued, in-stay entry that is not a skip. `order` is its position by (date, meal period). */
export interface ScenarioEntry {
  readonly id: string;
  readonly order: number;
  readonly entry: EngineEntry;
  readonly valuation: MealValuation | SnackValuation;
}

export interface ScenarioContext {
  /** The Party; only `adult` and `child` Persons are Plan_Eligible_Persons and Diners. */
  readonly persons: readonly EnginePerson[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  /** Days from check-in to check-out inclusive (snack demand, Requirement 11.1). */
  readonly days: number;
  readonly entries: readonly ScenarioEntry[];
  readonly planCosts: Readonly<Record<DiningPlanCode, PlanCostResult>>;
  readonly snacksPerPersonPerDay: number;
  readonly mugsWanted: number;
  readonly taxBps: number;
  readonly config: DiningConfig;
}

const PERIOD_RANK = new Map(DINING_MEAL_PERIODS.map((p, i) => [p, i]));

export function compareEntries(a: Pick<EngineEntry, 'date' | 'mealPeriod'>, b: Pick<EngineEntry, 'date' | 'mealPeriod'>): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return PERIOD_RANK.get(a.mealPeriod)! - PERIOD_RANK.get(b.mealPeriod)!;
}

export interface BuiltEntries {
  /** In (date, meal period) order; skips and entries with no Diners are left out (Requirement 4.6). */
  readonly entries: ScenarioEntry[];
  /** Entries outside `[checkIn, checkOut]`: kept in storage, left out of every total (Requirement 4.7). */
  readonly outsideStay: EngineEntry[];
}

/**
 * Values every in-stay entry once. A restaurant entry whose Experience is not in `locations` is left out (the service
 * reports it as `unknown_experience`).
 */
export function buildScenarioEntries(
  entries: readonly EngineEntry[],
  locations: ReadonlyMap<string, EngineLocation>,
  persons: readonly EnginePerson[],
  stay: StayDates,
  valuationCtx: ValuationContext,
): BuiltEntries {
  const sorted = [...entries].sort(compareEntries);
  const outsideStay: EngineEntry[] = [];
  const built: ScenarioEntry[] = [];
  for (const entry of sorted) {
    if (!isInStay(entry.date, stay)) {
      outsideStay.push(entry);
      continue;
    }
    const location = entry.experienceId === null ? null : (locations.get(entry.experienceId) ?? null);
    const valuation = valueEntry(entry, location, persons, valuationCtx);
    if (valuation.kind === 'skip') continue;
    built.push({ id: `${entry.date}:${entry.mealPeriod}`, order: built.length, entry, valuation });
  }
  return { entries: built, outsideStay };
}

/** Resolves the valuation settings: rates over config, drinker keys limited to the Party's adults (Req 4.5, 6.4). */
export function valuationContextOf(persons: readonly EnginePerson[], settings: DiningPlanSettings, config: DiningConfig): ValuationContext {
  const adultKeys = new Set(persons.filter((p) => p.ageBracket === 'adult').map((p) => p.key));
  return {
    orderStyle: settings.orderStyle,
    beverage: settings.beverage,
    alcoholDrinkerKeys: new Set(settings.alcoholDrinkerKeys.filter((k) => adultKeys.has(k))),
    orderDessert: settings.orderDessert,
    appetizersPerTable: settings.appetizersPerTable,
    taxBps: settings.taxBps ?? config.taxBps,
    tipBps: settings.tipBps ?? config.tipBps,
    partyHasPassHolder: partyHasPassHolder(persons),
    config,
  };
}

/** The single-stay inputs of design.md "Engine input" that scenarios read. */
export interface SingleStayInput {
  readonly persons: readonly EnginePerson[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly entries: readonly EngineEntry[];
  readonly locations: ReadonlyMap<string, EngineLocation>;
  readonly priceRows: readonly EnginePriceRow[];
  readonly settings: DiningPlanSettings;
  readonly config: DiningConfig;
}

export interface SingleStayContext {
  readonly ctx: ScenarioContext;
  readonly valuationCtx: ValuationContext;
  readonly outsideStay: readonly EngineEntry[];
}

/** Values every in-stay entry once and prices each plan for the single stay of `settings.stayType`. */
export function scenarioContextOf(input: SingleStayInput): SingleStayContext {
  const { settings, config, persons } = input;
  const valuationCtx = valuationContextOf(persons, settings, config);
  const stay = { checkIn: input.checkIn, checkOut: input.checkOut };
  const built = buildScenarioEntries(input.entries, input.locations, persons, stay, valuationCtx);
  const planCosts = {} as Record<DiningPlanCode, PlanCostResult>;
  for (const plan of DINING_PLAN_CODES) {
    planCosts[plan] = planCost({
      plan,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      persons,
      priceRows: input.priceRows,
      disneyResort: settings.stayType !== 'not_disney_resort',
      promoEligible: settings.kidsEatFree && settings.stayType === 'disney_resort_package',
      planPricesIncludeTax: config.planPricesIncludeTax,
      taxBps: valuationCtx.taxBps,
    });
  }
  const ctx: ScenarioContext = {
    persons,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights: nightsOf(input.checkIn, input.checkOut).length,
    days: daysInclusive(input.checkIn, input.checkOut),
    entries: built.entries,
    planCosts,
    snacksPerPersonPerDay: settings.snacksPerPersonPerDay,
    mugsWanted: settings.mugsWanted,
    taxBps: valuationCtx.taxBps,
    config,
  };
  return { ctx, valuationCtx, outsideStay: built.outsideStay };
}

function coverageOf(covered: number, diners: number): DiningCoverage {
  if (covered === 0) return 'none';
  return covered === diners ? 'all' : 'partial';
}

function actionOf(coverage: DiningCoverage): DiningMealLineDTO['action'] {
  if (coverage === 'all') return 'use_plan';
  return coverage === 'partial' ? 'partly_covered' : 'pay_out_of_pocket';
}

/** An unavailable scenario: zeros, its reason, and a fallback name when no period supplied one. */
export function emptyScenario(code: DiningScenarioCode, reason: DiningUnavailableReason | null, displayName: string | null): DiningScenarioResultDTO {
  return {
    code,
    displayName: displayName ?? DINING_SCENARIO_FALLBACK_NAMES[code],
    available: false,
    unavailableReason: reason,
    planCostCents: 0,
    promoLabel: null,
    foodOutOfPocketCents: 0,
    taxCents: 0,
    tipCents: 0,
    snackOutOfPocketCents: 0,
    mugOutOfPocketCents: 0,
    totalCents: 0,
    netSavingsCents: 0,
    credits: null,
    meals: [],
    bestCreditUses: [],
    priceVerifiedAt: null,
  };
}

/** Per-Person meal credit capacity of `code` over `nights` (Requirement 9.1); zero for `none`. */
export function capacityOf(code: 'none' | DiningPlanCode, nights: number): { ts: number; qs: number; snack: number } {
  if (code === 'none') return { ts: 0, qs: 0, snack: 0 };
  const ent = DINING_PLAN_ENTITLEMENTS_PER_NIGHT[code];
  return { ts: nights * ent.ts, qs: nights * ent.qs, snack: nights * ent.snack };
}

/** The allocation items of one Person: the meals they dine at that a credit can cover, with their own savings. */
export function personItems(entries: readonly ScenarioEntry[], personKey: string): AllocationItem[] {
  const items: AllocationItem[] = [];
  for (const e of entries) {
    if (e.valuation.kind !== 'meal' || e.valuation.creditKind === null) continue;
    const diner = e.valuation.byKey.get(personKey);
    if (diner === undefined) continue;
    const kind = e.valuation.creditKind;
    items.push({ id: e.id, kind, weight: kind === 'ts' ? e.valuation.creditCost : 1, savingsCents: diner.savingsCents, order: e.order });
  }
  return items;
}

/**
 * Each Plan_Eligible_Person's covered entry ids under `code` for a single stay, allocated from that Person's own
 * credits only (Requirements 9.2, 10.1). Empty sets for `none`. A reference for tests of `evaluateScenario`.
 */
export function allocateParty(code: 'none' | DiningPlanCode, ctx: Pick<ScenarioContext, 'persons' | 'nights' | 'entries'>): Map<string, Set<string>> {
  const cap = capacityOf(code, ctx.nights);
  const coveredBy = new Map<string, Set<string>>();
  for (const person of ctx.persons) {
    if (person.ageBracket === 'under3') continue;
    coveredBy.set(person.key, code === 'none' ? new Set() : allocateCredits(personItems(ctx.entries, person.key), cap));
  }
  return coveredBy;
}

/** An out-of-pocket amount plus its tax (`bpsOf`, half up). */
function withTax(cents: number, taxBps: number): number {
  return cents + bpsOf(cents, taxBps);
}

/** What `evaluateCombination` reads. Stays are in date order; `stayOfDate` attributes each span date to one stay. */
export interface CombinationContext {
  readonly persons: readonly EnginePerson[];
  readonly entries: readonly ScenarioEntry[];
  readonly stays: readonly PlanStayRuntime[];
  readonly stayOfDate: (date: string) => number;
  readonly snacksPerPersonPerDay: number;
  readonly mugsWanted: number;
  readonly taxBps: number;
  readonly config: DiningConfig;
  /** Multi-stay results tag each line with `stayKey` and `coveredByStayKey` (Requirement 25.11). */
  readonly tagStays: boolean;
  /** Also return each Person's amounts, for the Budget export only (Requirement 26.14). */
  readonly includePerPerson?: boolean;
}

export interface CombinationResult {
  readonly scenario: DiningScenarioResultDTO;
  /** Per stay, in `stays` order: the plan cost charged and the credit summary (null without a plan). */
  readonly perStay: readonly { readonly planCostCents: number; readonly credits: DiningCreditSummaryDTO | null }[];
}

function emptyCredits(): { ts: { issued: number; used: number }; qs: { issued: number; used: number }; snack: { issued: number; used: number } } {
  return { ts: { issued: 0, used: 0 }, qs: { issued: 0, used: 0 }, snack: { issued: 0, used: 0 } };
}

function summary(c: ReturnType<typeof emptyCredits>, snacksPerDayToUseAll: number, mugsCovered: number): DiningCreditSummaryDTO {
  const count = (x: { issued: number; used: number }) => ({ issued: x.issued, used: x.used, unused: x.issued - x.used });
  return { ts: count(c.ts), qs: count(c.qs), snack: count(c.snack), snacksPerDayToUseAll, mugsCovered };
}

/**
 * Evaluates one Combination: `assign[i]` is the plan of `stays[i]`, or null for none. `netSavingsCents` is left at 0;
 * it needs the Baseline total and is set by the comparison.
 */
export function evaluateCombination(
  assign: readonly (DiningPlanCode | null)[],
  ctx: CombinationContext,
  meta: { readonly code: DiningScenarioCode; readonly displayName: string },
): CombinationResult {
  const { stays } = ctx;
  const anyPlan = assign.some((p) => p !== null);
  const caps = stays.map((s, i) => capacityOf(assign[i] ?? 'none', s.nights));
  const eligible = ctx.persons.filter((p) => p.ageBracket !== 'under3');
  const onStay = (personKey: string, i: number) => assign[i] !== null && stays[i]!.personKeys.has(personKey);
  const { snackCents, mugCents } = ctx.config;
  // Each snack and each mug is its own purchase, so each carries its own tax (Requirement 12.1, "per line"). Taxing a
  // Person's uncovered snacks as one total rounds unevenly (6 -> 7 snacks adds 42 cents of tax at 650 bps, 1 -> 2 adds
  // 43), which would let one more snack lower a plan's net savings by a cent (Property 7).
  const snackUnit = withTax(snackCents, ctx.taxBps);
  const mugUnit = withTax(mugCents, ctx.taxBps);
  const credits = stays.map(() => emptyCredits());

  // Meals: each Person's own credits, on the plan-active stays they are on (Requirements 9.2, 25.6 to 25.8). Persons
  // with the same items on the same stays share one allocation (design.md step 5).
  const coveredBy = new Map<string, Map<string, number>>();
  const memo = new Map<string, Map<string, string | null>>();
  const dateById = new Map(ctx.entries.map((e) => [e.id, e.entry.date]));
  for (const person of eligible) {
    const active = stays.map((_, i) => i).filter((i) => onStay(person.key, i));
    for (const i of active) {
      credits[i]!.ts.issued += caps[i]!.ts;
      credits[i]!.qs.issued += caps[i]!.qs;
      credits[i]!.snack.issued += caps[i]!.snack;
    }
    const covered = new Map<string, number>();
    coveredBy.set(person.key, covered);
    if (active.length === 0) continue;
    const items = personItems(ctx.entries, person.key);
    const key = `${active.join(',')}|${items.map((it) => `${it.id}:${it.kind}:${it.weight}:${it.savingsCents}`).join(';')}`;
    let allocation = memo.get(key);
    if (allocation === undefined) {
      const dated = items.map((it) => ({ ...it, date: dateById.get(it.id)! }));
      const activeStays: ActiveStay[] = active.map((i) => ({ key: String(i), checkIn: stays[i]!.checkIn, checkOut: stays[i]!.checkOut, capacity: caps[i]! }));
      allocation = allocateAcrossStays(dated, activeStays);
      memo.set(key, allocation);
    }
    for (const item of items) {
      const stayIndex = allocation.get(item.id);
      if (stayIndex === null || stayIndex === undefined) continue;
      const i = Number(stayIndex);
      covered.set(item.id, i);
      if (item.kind === 'ts') credits[i]!.ts.used += item.weight;
      else credits[i]!.qs.used += item.weight;
    }
  }

  // Snacks, per Person per stay, over the dates attributed to that stay (Requirements 11.1, 11.2, 25.12): a Person's
  // snack-only entries are covered first, in order, then the daily snacks.
  const attributedDays = stays.map((s) => s.attributedDays);
  const snackCoveredBy = new Map<string, Set<string>>();
  const uncoveredSnacksOf = new Map<string, number>();
  let snackOop = 0;
  for (const person of eligible) {
    const coveredIds = new Set<string>();
    snackCoveredBy.set(person.key, coveredIds);
    const own = ctx.entries.filter((e) => e.valuation.kind === 'snack' && e.valuation.dinerKeys.includes(person.key));
    let uncovered = 0;
    stays.forEach((_, i) => {
      const ownHere = own.filter((e) => ctx.stayOfDate(e.entry.date) === i);
      const demand = ctx.snacksPerPersonPerDay * attributedDays[i]! + ownHere.length;
      const covered = onStay(person.key, i) ? Math.min(demand, caps[i]!.snack) : 0;
      credits[i]!.snack.used += covered;
      for (const e of ownHere.slice(0, covered)) coveredIds.add(e.id);
      uncovered += demand - covered;
    });
    uncoveredSnacksOf.set(person.key, uncovered);
    snackOop += uncovered * snackUnit;
  }

  // Mugs, once per Person, covered for each Plan_Eligible_Person on at least one plan-active stay (Req 11.4, 25.12).
  const isHolder = (p: EnginePerson) => stays.some((_, i) => onStay(p.key, i));
  const mugHolders = eligible.filter(isHolder).length;
  const mugsCovered = anyPlan ? Math.min(ctx.mugsWanted, mugHolders) : 0;
  const mugOop = Math.max(0, ctx.mugsWanted - mugsCovered) * mugUnit;

  let foodOop = 0;
  let taxOop = 0;
  let tipTotal = 0;
  const foodOf = new Map<string, number>();
  const tipOf = new Map<string, number>();
  const meals: DiningMealLineDTO[] = [];
  const personByKey = new Map(ctx.persons.map((p) => [p.key, p]));
  for (const e of ctx.entries) {
    const { entry, valuation: v } = e;
    const stayIndex = ctx.stayOfDate(entry.date);
    const stayKey = stayIndex >= 0 ? stays[stayIndex]!.key : null;
    if (v.kind === 'snack') {
      const coveredDiners = v.dinerKeys.filter((k) => snackCoveredBy.get(k)?.has(e.id) === true).length;
      const coverage = coverageOf(coveredDiners, v.dinerKeys.length);
      meals.push({
        date: entry.date,
        mealPeriod: entry.mealPeriod,
        kind: entry.kind,
        experienceId: entry.experienceId,
        label: v.label,
        serviceType: 'snack_only',
        creditCost: 1,
        gratuityIncluded: false,
        twoCredit: false,
        basis: 'default_estimate',
        ruleBasis: v.ruleBasis,
        unverifiedRule: v.unverifiedRule,
        dinerCount: v.dinerKeys.length,
        perDinerFoodCents: {
          adult: v.dinerKeys.some((k) => personByKey.get(k)?.ageBracket === 'adult') ? snackCents : null,
          child: v.dinerKeys.some((k) => personByKey.get(k)?.ageBracket === 'child') ? snackCents : null,
        },
        coverage,
        creditsUsedPerDiner: coveredDiners > 0 ? 1 : 0,
        coveredDinerCount: coveredDiners,
        savingsCents: coveredDiners * snackUnit,
        outOfPocketCents: (v.dinerKeys.length - coveredDiners) * snackUnit,
        action: actionOf(coverage),
        reason: coverage === 'none' && anyPlan ? 'better_use_elsewhere' : null,
        ...(ctx.tagStays ? { stayKey, coveredByStayKey: coveredDiners > 0 ? stayKey : null } : {}),
      });
      continue;
    }

    let coveredDiners = 0;
    let savings = 0;
    let lineOop = 0;
    let coveringStay: number | null = null;
    for (const d of v.diners) {
      const coveringIndex = coveredBy.get(d.key)?.get(e.id);
      const covered = coveringIndex !== undefined;
      const tip = covered && v.gratuityIncluded ? 0 : d.tip;
      const food = (covered ? 0 : d.foodNet) + d.extraNet;
      const tax = (covered ? 0 : d.taxFood) + d.taxExtra;
      foodOop += food;
      taxOop += tax;
      tipTotal += tip;
      lineOop += food + tax + tip;
      foodOf.set(d.key, (foodOf.get(d.key) ?? 0) + food);
      tipOf.set(d.key, (tipOf.get(d.key) ?? 0) + tip);
      if (covered) {
        coveredDiners += 1;
        savings += d.savingsCents;
        coveringStay ??= coveringIndex;
      }
    }
    const coverage = coverageOf(coveredDiners, v.diners.length);
    let reason: DiningUncoveredReason | null = null;
    if (coverage === 'none' && anyPlan) {
      if (v.creditKind === null) reason = 'not_eligible';
      else {
        const kind = v.creditKind;
        // Some plan on a stay containing this date issues this kind of credit.
        const matching = stays.some((s, i) => {
          const plan = assign[i];
          if (plan === null || plan === undefined || entry.date < s.checkIn || entry.date > s.checkOut) return false;
          return DINING_PLAN_ENTITLEMENTS_PER_NIGHT[plan][kind] > 0;
        });
        reason = matching ? 'better_use_elsewhere' : 'no_matching_credits';
      }
    }
    meals.push({
      date: entry.date,
      mealPeriod: entry.mealPeriod,
      kind: entry.kind,
      experienceId: entry.experienceId,
      label: v.label,
      serviceType: v.serviceType,
      creditCost: v.creditCost,
      gratuityIncluded: v.gratuityIncluded,
      twoCredit: v.twoCredit,
      basis: v.basis,
      ruleBasis: v.ruleBasis,
      unverifiedRule: v.unverifiedRule,
      dinerCount: v.diners.length,
      perDinerFoodCents: v.perDinerFoodCents,
      coverage,
      creditsUsedPerDiner: coveredDiners > 0 ? (v.creditKind === 'ts' ? v.creditCost : 1) : 0,
      coveredDinerCount: coveredDiners,
      savingsCents: savings,
      outOfPocketCents: lineOop,
      action: actionOf(coverage),
      reason,
      ...(ctx.tagStays ? { stayKey, coveredByStayKey: coveringStay === null ? null : stays[coveringStay]!.key } : {}),
    });
  }

  const perStayCost = stays.map((s, i) => (assign[i] ? stayPlanCents(s, assign[i]!) : 0));
  const planCostCents = perStayCost.reduce((a, b) => a + b, 0);
  const totalCents = planCostCents + foodOop + taxOop + tipTotal + snackOop + mugOop;
  const bestCreditUses = !anyPlan
    ? []
    : meals
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.serviceType !== 'snack_only' && m.savingsCents > 0)
        .sort((a, b) => b.m.savingsCents - a.m.savingsCents || a.i - b.i)
        .map(({ m }) => ({ date: m.date, mealPeriod: m.mealPeriod, label: m.label, savingsCents: m.savingsCents }));

  const activeIdx = stays.map((_, i) => i).filter((i) => assign[i] !== null);
  const perDay = (i: number) => (attributedDays[i]! > 0 ? Math.ceil(caps[i]!.snack / attributedDays[i]!) : 0);
  const firstActive = activeIdx[0];
  const perStay = stays.map((_, i) =>
    assign[i] === null
      ? { planCostCents: 0, credits: null }
      : { planCostCents: perStayCost[i]!, credits: summary(credits[i]!, perDay(i), i === firstActive ? mugsCovered : 0) },
  );
  const total = emptyCredits();
  for (const i of activeIdx) {
    for (const k of ['ts', 'qs', 'snack'] as const) {
      total[k].issued += credits[i]![k].issued;
      total[k].used += credits[i]![k].used;
    }
  }

  const promoLabels: string[] = [];
  const verified: (string | null)[] = [];
  for (const i of activeIdx) {
    const cost = stays[i]!.planCosts[assign[i]!];
    if (cost.promoLabel !== null && !promoLabels.includes(cost.promoLabel)) promoLabels.push(cost.promoLabel);
    if (cost.available) verified.push(cost.verifiedAt);
    else verified.push(null);
  }
  const priceVerifiedAt =
    verified.length === 0 || verified.some((v) => v === null) ? null : (verified as string[]).reduce((a, b) => (b > a ? b : a));

  let perPerson: DiningPerPersonAmounts[] | undefined;
  if (ctx.includePerPerson === true) {
    // `mugsWanted` is a count: the mugs go first to the Persons a plan covers, then in Party order, so the covered
    // and uncovered mugs per Person add up to the scenario's (Requirement 11.4).
    const mugOrder = [...eligible.filter(isHolder), ...eligible.filter((p) => !isHolder(p))].slice(0, ctx.mugsWanted);
    const uncoveredMug = new Set(mugOrder.slice(mugsCovered).map((p) => p.key));
    perPerson = eligible.map((p) => {
      const planCostByStay: Record<string, number> = {};
      stays.forEach((s, i) => {
        if (!onStay(p.key, i)) return;
        const cost = s.planCosts[assign[i]!];
        planCostByStay[s.key] = cost.available ? (cost.baseByPerson.get(p.key) ?? 0) : 0;
      });
      return {
        key: p.key,
        planCostByStay,
        oopFoodCents: foodOf.get(p.key) ?? 0,
        oopSnackMugCents: uncoveredSnacksOf.get(p.key)! * snackCents + (uncoveredMug.has(p.key) ? mugCents : 0),
        tipCents: tipOf.get(p.key) ?? 0,
      };
    });
  }

  return {
    scenario: {
      ...(perPerson === undefined ? {} : { perPerson }),
      code: meta.code,
      displayName: meta.displayName,
      available: true,
      unavailableReason: null,
      planCostCents,
      promoLabel: promoLabels.length > 0 ? promoLabels.join(' / ') : null,
      foodOutOfPocketCents: foodOop,
      taxCents: taxOop,
      tipCents: tipTotal,
      snackOutOfPocketCents: snackOop,
      mugOutOfPocketCents: mugOop,
      totalCents,
      netSavingsCents: 0,
      credits: anyPlan ? summary(total, Math.max(0, ...activeIdx.map(perDay)), mugsCovered) : null,
      meals,
      bestCreditUses,
      priceVerifiedAt,
    },
    perStay,
  };
}

/** The single stay of a `ScenarioContext` as a Plan_Stay with the whole Party on it. */
function singleStayRuntime(ctx: ScenarioContext): PlanStayRuntime {
  return {
    key: 'stay',
    label: 'Stay',
    lodgingKind: 'resort',
    source: 'stay',
    checkIn: ctx.checkIn,
    checkOut: ctx.checkOut,
    nights: ctx.nights,
    persons: ctx.persons,
    personKeys: new Set(ctx.persons.map((p) => p.key)),
    status: 'compare',
    heldPlan: null,
    channel: 'package',
    planEligible: true,
    planCosts: ctx.planCosts,
    options: [null, ...DINING_PLAN_CODES.filter((p) => ctx.planCosts[p].available)],
    heldPriceUnknown: false,
    attributedDays: ctx.days,
  };
}

/**
 * Evaluates No_Plan (`none`) or one plan for a single stay. An unavailable plan returns zeros with its reason.
 * `netSavingsCents` is left at 0; it needs the No_Plan total and is set by the comparison.
 */
export function evaluateScenario(code: 'none' | DiningPlanCode, ctx: ScenarioContext): DiningScenarioResultDTO {
  const plan = code === 'none' ? null : ctx.planCosts[code];
  if (plan !== null && !plan.available) return emptyScenario(code, plan.unavailableReason, plan.displayName);
  const stay = singleStayRuntime(ctx);
  const combination: CombinationContext = {
    persons: ctx.persons,
    entries: ctx.entries,
    stays: [stay],
    stayOfDate: (date) => (date >= ctx.checkIn && date <= ctx.checkOut ? 0 : -1),
    snacksPerPersonPerDay: ctx.snacksPerPersonPerDay,
    mugsWanted: ctx.mugsWanted,
    taxBps: ctx.taxBps,
    config: ctx.config,
    tagStays: false,
  };
  return evaluateCombination([plan === null ? null : code as DiningPlanCode], combination, {
    code,
    displayName: plan?.displayName ?? DINING_SCENARIO_FALLBACK_NAMES[code],
  }).scenario;
}
