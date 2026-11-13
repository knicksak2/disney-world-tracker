/**
 * Engine-internal input shapes shared by the pure engine modules (dining-plan-calculator design.md
 * "Engine modules" and "Engine input"). Types only.
 *
 * `LocationRuleRow` is the camelCased `dining_plan_location_rules` row (migration 0075) as the repo hands it to the
 * engine; `ResolvedRule` is what `resolveLocationRule` returns once derivation has filled the gaps.
 */

import type {
  AgeBracket,
  DiningConfig,
  DiningCreditCostByPeriod,
  DiningEntryKind,
  DiningMealPeriod,
  DiningPlaceholderKind,
  DiningPlanCode,
  DiningPlanSettings,
  DiningRuleBasis,
  DiningRuleStatus,
  DiningServiceType,
  EnginePlanStay,
  MenuDTO,
  TravelerPassType,
} from '@dwt/shared';

/** One stored Location_Rule (Requirement 8.2). A NULL `serviceType` means "derive" from the catalog facets. */
export interface LocationRuleRow {
  readonly serviceType: DiningServiceType | null;
  readonly creditCost: 1 | 2;
  readonly creditCostByPeriod: DiningCreditCostByPeriod | null;
  readonly gratuityIncluded: boolean;
  /** NULL means "the default" (eligible); only an explicit `false` turns the pass discount off. */
  readonly passDiscountEligible: boolean | null;
  readonly overrideAdultCents: number | null;
  readonly overrideChildCents: number | null;
  readonly ruleStatus: DiningRuleStatus;
  readonly verifiedAt: string | null;
  readonly sourceNote: string | null;
}

/** A catalog Restaurant as the engine sees it. */
export interface EngineLocation {
  readonly experienceId: string;
  readonly name: string;
  readonly priceTier: string | null;
  /** `experiences.grouped_facets`; read defensively (it is upstream JSON). */
  readonly groupedFacets: unknown;
  readonly menus: readonly MenuDTO[] | null;
  readonly rule: LocationRuleRow | null;
}

/** A Location_Rule after derivation (design.md "Meal valuation" step 1). */
export interface ResolvedRule {
  readonly serviceType: DiningServiceType;
  readonly creditCost: 1 | 2;
  readonly creditCostByPeriod: DiningCreditCostByPeriod | null;
  readonly gratuityIncluded: boolean;
  readonly passDiscountEligible: boolean | null;
  readonly overrideAdultCents: number | null;
  readonly overrideChildCents: number | null;
  /** `verified` / `unverified` for a stored row, `derived` when there is none (Requirement 8.6). */
  readonly status: DiningRuleBasis;
}

/** Which price list a Diner reads (Requirement 7.1). */
export type DiningAudience = 'adult' | 'child';

/** One Person of the Party (design.md "Engine input"). */
export interface EnginePerson {
  readonly key: string;
  readonly label: string;
  readonly ageBracket: AgeBracket;
  readonly passType: TravelerPassType;
}

/** One Plan_Price_Period (`dining_plan_prices`, design.md "Engine input"). Dates are inclusive `YYYY-MM-DD`. */
export interface EnginePriceRow {
  readonly planCode: DiningPlanCode;
  readonly displayName: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly adultCents: number;
  readonly childCents: number;
  readonly childPromoCents: number | null;
  readonly promoLabel: string | null;
  readonly verifiedAt: string | null;
}

/** Everything `computeDiningPlan` reads (design.md "Engine input"). No clock: `today` is passed in. */
export interface EngineInput {
  readonly persons: readonly EnginePerson[];
  readonly stay: { readonly checkIn: string; readonly checkOut: string; readonly source: 'trip' | 'custom' };
  readonly settings: DiningPlanSettings;
  readonly entries: readonly EngineEntry[];
  readonly locations: ReadonlyMap<string, EngineLocation>;
  readonly priceRows: readonly EnginePriceRow[];
  readonly config: DiningConfig;
  /** WDW_Today, echoed as `computedForDate`. */
  readonly today: string;
  /**
   * The Plan_Stays (Multi-Stay Extension). When omitted the engine uses one stay spanning `stay` with
   * `settings.stayType`, and the result has no multi-stay fields.
   */
  readonly stays?: readonly EnginePlanStay[];
}

/** One stored Dining_Entry (design.md "Engine input"). */
export interface EngineEntry {
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly kind: DiningEntryKind;
  readonly experienceId: string | null;
  readonly placeholderKind: DiningPlaceholderKind | null;
  readonly excludedKeys: readonly string[];
}
