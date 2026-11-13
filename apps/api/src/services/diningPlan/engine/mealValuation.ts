/**
 * Meal valuation (Requirement 7, 12.1, 12.3, 12.5, 12.6, 4.9, 4.10; design.md "Meal valuation").
 *
 * `valueEntry` prices one Dining_Entry for each of its Diners: the Menu_Basis precedence per audience and drink class,
 * the pass discount, the shared appetizers, tax and tip, and the savings of covering that Diner's meal with a credit.
 * Pure and total: every Diner of a meal gets a positive integer food price, whatever shape the cached menus have.
 */

import {
  bpsOf,
  computeMenuEstimatePerPerson,
  DINING_MENU_BASES,
  DINING_ORDER_STYLE_PERCENTILE,
  extractMenuPriceOffers,
  splitCentsEvenly,
  type DiningBeverage,
  type DiningConfig,
  type DiningMealPeriod,
  type DiningMenuBasis,
  type DiningOrderStyle,
  type DiningRuleBasis,
  type DiningServiceType,
  type MenuDTO,
} from '@dwt/shared';

import { creditCostFor, resolveLocationRule } from './locationRules.js';
import { groupCents, menusForPeriod } from './menuSelect.js';
import { pickPercentile } from './percentile.js';
import type { DiningAudience, EngineEntry, EngineLocation, EnginePerson, ResolvedRule } from './types.js';

/** The scenario settings and resolved rates a valuation reads. `taxBps`/`tipBps` are already resolved over config. */
export interface ValuationContext {
  readonly orderStyle: DiningOrderStyle;
  readonly beverage: DiningBeverage;
  readonly alcoholDrinkerKeys: ReadonlySet<string>;
  readonly orderDessert: boolean;
  readonly appetizersPerTable: number;
  readonly taxBps: number;
  readonly tipBps: number;
  /** The Party (not only the Diners) holds an annual pass or DVC membership (Requirement 3.8). */
  readonly partyHasPassHolder: boolean;
  readonly config: DiningConfig;
}

/** One Diner's priced meal. All integer cents. */
export interface DinerValuation {
  readonly key: string;
  readonly audience: DiningAudience;
  readonly basis: DiningMenuBasis;
  /** Before the pass discount. */
  readonly foodCents: number;
  /** After the pass discount; the amount a credit covers. */
  readonly foodNet: number;
  /** This Diner's share of the appetizers after the pass discount; never covered. */
  readonly extraNet: number;
  readonly taxFood: number;
  readonly taxExtra: number;
  /** `bpsOf(foodNet + extraNet, tipBps)` at table service, else 0. */
  readonly tip: number;
  /** `foodNet + taxFood (+ tip when gratuity is included)`: what covering this Diner's meal saves. */
  readonly savingsCents: number;
}

export interface MealValuation {
  readonly kind: 'meal';
  readonly label: string;
  /** `table_service`, `quick_service` or `not_eligible` (priced like quick service). */
  readonly serviceType: Exclude<DiningServiceType, 'snack_only'>;
  /** The credit that can cover it; null for `not_eligible`, which is never covered (Requirement 4.10). */
  readonly creditKind: 'ts' | 'qs' | null;
  /** `creditCostFor(rule, mealPeriod)` (Requirement 8.8). */
  readonly creditCost: 1 | 2;
  readonly twoCredit: boolean;
  readonly gratuityIncluded: boolean;
  /** The highest-precedence basis any Diner of the entry was priced on. */
  readonly basis: DiningMenuBasis;
  readonly ruleBasis: DiningRuleBasis;
  /** True only for a stored `unverified` rule (Requirement 8.6). */
  readonly unverifiedRule: boolean;
  readonly passDiscountApplied: boolean;
  /** Pre-tax, after the pass discount: a non-drinking adult Diner's price (else a drinker's), and a child Diner's. */
  readonly perDinerFoodCents: { readonly adult: number | null; readonly child: number | null };
  /** In Party order. */
  readonly diners: readonly DinerValuation[];
  readonly byKey: ReadonlyMap<string, DinerValuation>;
}

/** A `snack_only` location: one snack per Diner added to snack demand, no meal price (Requirement 4.9). */
export interface SnackValuation {
  readonly kind: 'snack';
  readonly label: string;
  readonly ruleBasis: DiningRuleBasis;
  readonly unverifiedRule: boolean;
  readonly dinerKeys: readonly string[];
}

/** A `skip` entry, an entry whose Diners are all excluded (Requirement 4.6), or a restaurant with no location. */
export interface SkipValuation {
  readonly kind: 'skip';
}

export type EntryValuation = MealValuation | SnackValuation | SkipValuation;

export const PLACEHOLDER_LABELS = {
  quick_service: 'Quick-service meal',
  table_service: 'Table-service meal',
} as const;

/** True when the Party holds an annual pass or DVC membership (Requirement 3.8). */
export function partyHasPassHolder(persons: readonly EnginePerson[]): boolean {
  return persons.some((p) => p.passType === 'annual_pass' || p.passType === 'dvc');
}

/** The Diners of an entry: Plan_Eligible_Persons of the Party minus `excludedKeys`, in Party order (Requirement 4.5). */
export function dinersOf(entry: Pick<EngineEntry, 'excludedKeys'>, party: readonly EnginePerson[]): EnginePerson[] {
  const excluded = new Set(entry.excludedKeys);
  return party.filter((p) => p.ageBracket !== 'under3' && !excluded.has(p.key));
}

/** `$`, `$$`, `$ ($14.99 and under per adult)` -> 1, 2, 1; clamped to 1..4; null when there is no leading `$`. */
export function tierLevelOf(priceTier: string | null): '1' | '2' | '3' | '4' | null {
  if (typeof priceTier !== 'string') return null;
  const match = /^\s*(\$+)/.exec(priceTier);
  if (match === null) return null;
  return String(Math.min(4, match[1]!.length)) as '1' | '2' | '3' | '4';
}

type DrinkClass = DiningBeverage | 'alcohol';
interface Priced {
  readonly cents: number;
  readonly basis: DiningMenuBasis;
}

const BASIS_RANK = new Map<DiningMenuBasis, number>(DINING_MENU_BASES.map((b, i) => [b, i]));

const SYNTHETIC_RULE: Omit<ResolvedRule, 'serviceType'> = {
  creditCost: 1,
  creditCostByPeriod: null,
  gratuityIncluded: false,
  passDiscountEligible: null,
  overrideAdultCents: null,
  overrideChildCents: null,
  status: 'derived',
};

/**
 * Prices one entry for each of its Diners. `party` is the Party of the stay the entry falls in; the Diners are derived
 * from it (`dinersOf`). `location` is the entry's catalog Restaurant (ignored for a placeholder).
 */
export function valueEntry(
  entry: EngineEntry,
  location: EngineLocation | null,
  party: readonly EnginePerson[],
  ctx: ValuationContext,
): EntryValuation {
  if (entry.kind === 'skip') return { kind: 'skip' };
  const diners = dinersOf(entry, party);
  if (diners.length === 0) return { kind: 'skip' };

  let rule: ResolvedRule;
  let label: string;
  let menus: readonly MenuDTO[] | null;
  let priceTier: string | null;
  if (entry.kind === 'placeholder') {
    const placeholderKind = entry.placeholderKind ?? 'quick_service';
    rule = { ...SYNTHETIC_RULE, serviceType: placeholderKind };
    label = PLACEHOLDER_LABELS[placeholderKind];
    menus = null;
    priceTier = null;
  } else {
    if (location === null) return { kind: 'skip' };
    rule = resolveLocationRule(location.rule, location);
    label = location.name;
    menus = location.menus;
    priceTier = location.priceTier;
  }

  const ruleBasis = rule.status;
  const unverifiedRule = ruleBasis === 'unverified';
  if (rule.serviceType === 'snack_only') {
    return { kind: 'snack', label, ruleBasis, unverifiedRule, dinerKeys: diners.map((d) => d.key) };
  }
  const serviceType = rule.serviceType;
  const tableService = serviceType === 'table_service';
  const pricer = new AudiencePricer(rule, menus, priceTier, entry.mealPeriod, tableService, ctx);

  const passDiscountApplied =
    ctx.partyHasPassHolder && rule.passDiscountEligible !== false && serviceType !== 'not_eligible';
  const discounted = (cents: number): number =>
    passDiscountApplied ? cents - bpsOf(cents, ctx.config.passDiningDiscountBps) : cents;

  const extraShares = tableService && ctx.appetizersPerTable > 0
    ? splitCentsEvenly(ctx.appetizersPerTable * pricer.appetizerCents(), diners.length)
    : diners.map(() => 0);

  const valued: DinerValuation[] = diners.map((diner, i) => {
    const audience: DiningAudience = diner.ageBracket === 'child' ? 'child' : 'adult';
    const drink: DrinkClass = audience === 'adult' && ctx.alcoholDrinkerKeys.has(diner.key) ? 'alcohol' : ctx.beverage;
    const priced = audience === 'adult' ? pricer.adult(drink) : pricer.child();
    const foodCents = priced.cents;
    const foodNet = Math.max(1, discounted(foodCents));
    const extraNet = discounted(extraShares[i]!);
    const taxFood = bpsOf(foodNet, ctx.taxBps);
    const taxExtra = bpsOf(extraNet, ctx.taxBps);
    const tip = tableService ? bpsOf(foodNet + extraNet, ctx.tipBps) : 0;
    const savingsCents = foodNet + taxFood + (rule.gratuityIncluded ? tip : 0);
    return { key: diner.key, audience, basis: priced.basis, foodCents, foodNet, extraNet, taxFood, taxExtra, tip, savingsCents };
  });

  const creditCost = creditCostFor(rule, entry.mealPeriod);
  const basis = valued.reduce<DiningMenuBasis>(
    (best, d) => (BASIS_RANK.get(d.basis)! < BASIS_RANK.get(best)! ? d.basis : best),
    valued[0]!.basis,
  );
  const adults = valued.filter((d) => d.audience === 'adult');
  const soberAdult = adults.find((d) => !ctx.alcoholDrinkerKeys.has(d.key)) ?? adults[0];
  const child = valued.find((d) => d.audience === 'child');

  return {
    kind: 'meal',
    label,
    serviceType,
    creditKind: serviceType === 'table_service' ? 'ts' : serviceType === 'quick_service' ? 'qs' : null,
    creditCost,
    twoCredit: creditCost === 2,
    gratuityIncluded: rule.gratuityIncluded,
    basis,
    ruleBasis,
    unverifiedRule,
    passDiscountApplied,
    perDinerFoodCents: { adult: soberAdult?.foodNet ?? null, child: child?.foodNet ?? null },
    diners: valued,
    byKey: new Map(valued.map((d) => [d.key, d])),
  };
}

/**
 * The basis precedence of design.md "Meal valuation" step 2 for one entry, memoized per audience and drink class.
 * Every figure is at least 1 cent.
 */
class AudiencePricer {
  private readonly periodMenus: MenuDTO[];
  private readonly percentile: number;
  private readonly memo = new Map<string, Priced>();

  constructor(
    private readonly rule: ResolvedRule,
    private readonly menus: readonly MenuDTO[] | null,
    private readonly priceTier: string | null,
    private readonly period: DiningMealPeriod,
    private readonly tableService: boolean,
    private readonly ctx: ValuationContext,
  ) {
    this.periodMenus = menusForPeriod(menus, period);
    this.percentile = DINING_ORDER_STYLE_PERCENTILE[ctx.orderStyle];
  }

  adult(drink: DrinkClass): Priced {
    return this.memoized(`adult:${drink}`, () => {
      if (this.rule.overrideAdultCents !== null) return { cents: this.rule.overrideAdultCents, basis: 'admin_override' };
      const offer = this.offerCents(['adult', 'person']);
      if (offer !== null) return { cents: offer, basis: 'menu_offer' };
      const items = this.menuItemsCents(groupCents(this.periodMenus, 'entree', 'adult'), drink);
      if (items !== null) return { cents: items, basis: 'menu_items' };
      return this.estimate();
    });
  }

  /** A child: its own figure where the basis has one, else the adult figure times `childFallbackBps` (Req 7.4, 8.7). */
  child(): Priced {
    return this.memoized('child', () => {
      if (this.rule.overrideChildCents !== null) return { cents: this.rule.overrideChildCents, basis: 'admin_override' };
      const childOffer = this.offerCents(['child']);
      if (childOffer !== null) return { cents: childOffer, basis: 'menu_offer' };
      const adultOffer = this.offerCents(['adult', 'person']);
      if (adultOffer !== null) return { cents: this.childFallback(adultOffer), basis: 'menu_offer' };
      const kids = this.menuItemsCents(groupCents(this.periodMenus, 'entree', 'child'), this.ctx.beverage);
      if (kids !== null) return { cents: kids, basis: 'menu_items' };
      const adultItems = this.menuItemsCents(groupCents(this.periodMenus, 'entree', 'adult'), this.ctx.beverage);
      if (adultItems !== null) return { cents: this.childFallback(adultItems), basis: 'menu_items' };
      const adult = this.estimate();
      return { cents: this.childFallback(adult.cents), basis: adult.basis };
    });
  }

  /** The appetizer price: the median priced appetizer of the period's menus, else `appetizerCents` (Requirement 7.6). */
  appetizerCents(): number {
    return pickPercentile(groupCents(this.periodMenus, 'appetizer', 'adult'), 50) ?? this.ctx.config.appetizerCents;
  }

  private memoized(key: string, compute: () => Priced): Priced {
    let priced = this.memo.get(key);
    if (priced === undefined) {
      const raw = compute();
      priced = { cents: Math.max(1, raw.cents), basis: raw.basis };
      this.memo.set(key, priced);
    }
    return priced;
  }

  private childFallback(adultCents: number): number {
    return Math.max(1, bpsOf(adultCents, this.ctx.config.childFallbackBps));
  }

  /** Bases d, e, f: one all-in figure for the location. */
  private estimate(): Priced {
    const estimate = safeEstimate(this.menus);
    if (estimate !== null && Number.isSafeInteger(estimate.perPersonCents) && estimate.perPersonCents > 0) {
      return { cents: estimate.perPersonCents, basis: 'menu_estimate' };
    }
    const tierLevel = tierLevelOf(this.priceTier);
    const tiers = this.ctx.config.tierEstimates[this.tableService ? 'table_service' : 'quick_service'];
    if (tierLevel !== null) return { cents: tiers[tierLevel], basis: 'tier_estimate' };
    const cents = this.tableService ? this.ctx.config.placeholderTsCents : this.ctx.config.placeholderQsCents;
    return { cents, basis: 'default_estimate' };
  }

  private offerCents(audiences: readonly ('adult' | 'child' | 'person')[]): number | null {
    const prices = safeOffers(this.periodMenus)
      .filter((o) => o.audience !== null && audiences.includes(o.audience))
      .map((o) => o.priceCents)
      .filter((c) => Number.isSafeInteger(c) && c > 0)
      .sort((a, b) => a - b);
    return pickPercentile(prices, this.percentile);
  }

  /** Basis c: entree, plus dessert at table service when ordered, plus the beverage; null without a priced entree. */
  private menuItemsCents(entrees: readonly number[], drink: DrinkClass): number | null {
    const entree = pickPercentile(entrees, this.percentile);
    if (entree === null) return null;
    const dessert = this.tableService && this.ctx.orderDessert
      ? (pickPercentile(groupCents(this.periodMenus, 'dessert', 'adult'), this.percentile) ?? this.ctx.config.dessertCents)
      : 0;
    return entree + dessert + this.beverageCents(drink);
  }

  /**
   * The beverage of the `menu_items` basis (Requirement 7.5). An alcohol drinker's drink is priced at every
   * table-service meal and at quick-service lunch and dinner; at a quick-service breakfast it is the scenario beverage.
   */
  private beverageCents(drink: DrinkClass): number {
    if (drink === 'alcohol' && (this.tableService || this.period !== 'breakfast')) {
      return pickPercentile(groupCents(this.periodMenus, 'alcohol', 'adult'), 50) ?? this.ctx.config.alcoholBeverageCents;
    }
    const beverage = drink === 'alcohol' ? this.ctx.beverage : drink;
    if (beverage === 'water') return 0;
    return beverage === 'soft_drink' ? this.ctx.config.softDrinkCents : this.ctx.config.specialtyBeverageCents;
  }
}

/*
 * `extractMenuPriceOffers` and `computeMenuEstimatePerPerson` assume well-formed menus (a `groups` that is a number,
 * or a group `name` that is not a string, throws inside them). The cached upstream JSON is not validated to that
 * depth, so a throw here means "this basis has no data" and valuation falls through to the next basis (Property 14).
 */
function safeOffers(menus: readonly MenuDTO[]): ReturnType<typeof extractMenuPriceOffers> {
  try {
    return extractMenuPriceOffers(menus);
  } catch {
    return [];
  }
}

function safeEstimate(menus: readonly MenuDTO[] | null): ReturnType<typeof computeMenuEstimatePerPerson> {
  try {
    return computeMenuEstimatePerPerson(menus);
  } catch {
    return null;
  }
}
