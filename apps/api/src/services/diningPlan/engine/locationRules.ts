/**
 * Location_Rule derivation and resolution (Requirements 8.1, 8.2, 8.5, 8.6; Property 15 derivation half).
 *
 * A location with no stored rule derives its Service_Type from the catalog's `grouped_facets` and gets Credit_Cost 1,
 * no included gratuity and status `derived`. A stored row's non-null fields override the derived values; a NULL
 * `serviceType` means "derive".
 */

import type { DiningCreditCostByPeriod, DiningMealPeriod, DiningServiceType } from '@dwt/shared';

import type { EngineLocation, LocationRuleRow, ResolvedRule } from './types.js';

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** The catalog's facet id that files a bar or lounge under `tableService` (Requirement 8.11). */
export const LOUNGE_FACET_ID = 'lounges';

/**
 * `tableService` facet ids that describe booking or a drinks menu, not a kind of meal. A location whose
 * `tableService` facets are `lounges` plus only these is a lounge; one that also has a meal facet (`casual-dining`,
 * `a-la-carte`, `fine-signature-dining`, ...) is a restaurant with a bar, such as Raglan Road.
 */
const NON_MEAL_TABLE_SERVICE_FACETS = new Set([
  LOUNGE_FACET_ID,
  'reservations-accepted',
  'reservations-strongly-recommended',
  'speciality-food-beverage',
]);

function facetIds(group: unknown): string[] {
  if (!Array.isArray(group)) return [];
  return group
    .map((f) => (f !== null && typeof f === 'object' ? (f as Record<string, unknown>).id : undefined))
    .filter((id): id is string => typeof id === 'string');
}

/**
 * True when the location's table-service facets say it is a lounge and nothing more (Requirement 8.11). Disney's own
 * answers disagree on whether lounges take dining plan credits, so a lounge derives as `not_eligible`, and the
 * operator records a table-service rule for any lounge that does accept the plan.
 */
export function isLoungeOnly(groupedFacets: unknown): boolean {
  if (groupedFacets === null || typeof groupedFacets !== 'object' || Array.isArray(groupedFacets)) return false;
  const ids = facetIds((groupedFacets as Record<string, unknown>).tableService);
  return ids.includes(LOUNGE_FACET_ID) && ids.every((id) => NON_MEAL_TABLE_SERVICE_FACETS.has(id));
}

/**
 * `not_eligible` for a lounge (Requirement 8.11); otherwise `table_service` when `tableService` is a non-empty array,
 * else `quick_service` when `quickService` is a non-empty array, else `not_eligible` (Requirement 8.1). A null,
 * non-object or array `groupedFacets`, or a group value that is not an array, counts as empty. Total: never throws.
 */
export function deriveServiceType(groupedFacets: unknown): DiningServiceType {
  if (groupedFacets === null || typeof groupedFacets !== 'object' || Array.isArray(groupedFacets)) return 'not_eligible';
  if (isLoungeOnly(groupedFacets)) return 'not_eligible';
  const facets = groupedFacets as Record<string, unknown>;
  if (isNonEmptyArray(facets.tableService)) return 'table_service';
  if (isNonEmptyArray(facets.quickService)) return 'quick_service';
  return 'not_eligible';
}

function positiveCentsOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sanitizeCostByPeriod(value: DiningCreditCostByPeriod | null): DiningCreditCostByPeriod | null {
  if (value === null || typeof value !== 'object') return null;
  const out: { breakfast?: 1 | 2; lunch?: 1 | 2; dinner?: 1 | 2 } = {};
  for (const period of ['breakfast', 'lunch', 'dinner'] as const) {
    const cost = value[period];
    if (cost === 1 || cost === 2) out[period] = cost;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Resolves the effective rule of a location (design.md "Meal valuation" step 1). With no row: the derived Service_Type,
 * Credit_Cost 1, no gratuity, status `derived`. With a row: its fields, with a NULL `serviceType` derived.
 *
 * Two-credit costs, a per-period cost map and an included gratuity are table-service only. The database enforces this
 * for stored rows (migration 0075 `chk_dpl_*`); the resolver applies the same rule so no input reaching the engine can
 * produce a Credit_Cost of 2 outside table service (Requirement 8.5, Property 15). Override cents that are not positive
 * integers are ignored (Requirement 8.7).
 */
export function resolveLocationRule(
  rule: LocationRuleRow | null,
  location: Pick<EngineLocation, 'groupedFacets'>,
): ResolvedRule {
  if (rule === null) {
    return {
      serviceType: deriveServiceType(location.groupedFacets),
      creditCost: 1,
      creditCostByPeriod: null,
      gratuityIncluded: false,
      passDiscountEligible: null,
      overrideAdultCents: null,
      overrideChildCents: null,
      status: 'derived',
    };
  }
  const serviceType = rule.serviceType ?? deriveServiceType(location.groupedFacets);
  const tableService = serviceType === 'table_service';
  return {
    serviceType,
    creditCost: tableService && rule.creditCost === 2 ? 2 : 1,
    creditCostByPeriod: tableService ? sanitizeCostByPeriod(rule.creditCostByPeriod) : null,
    gratuityIncluded: tableService && rule.gratuityIncluded === true,
    passDiscountEligible: rule.passDiscountEligible,
    overrideAdultCents: positiveCentsOrNull(rule.overrideAdultCents),
    overrideChildCents: positiveCentsOrNull(rule.overrideChildCents),
    status: rule.ruleStatus,
  };
}

/** The Credit_Cost of a meal at `period`: `creditCostByPeriod[period] ?? creditCost` (Requirement 8.8). */
export function creditCostFor(
  rule: Pick<ResolvedRule, 'creditCost' | 'creditCostByPeriod'>,
  period: DiningMealPeriod,
): 1 | 2 {
  return rule.creditCostByPeriod?.[period] ?? rule.creditCost;
}
