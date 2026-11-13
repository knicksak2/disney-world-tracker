/**
 * Pure projections for the Admin_Panel Dining Plan section: the coverage metrics of Requirement 18.5 and one location
 * row with its derived and effective rule (Requirement 18.4).
 */

import { DINING_SERVICE_TYPES, type DiningServiceType } from '@dwt/shared';

import type { AdminCoverage, AdminLocationRow } from '../adminPort.js';
import { deriveServiceType, resolveLocationRule } from '../engine/locationRules.js';
import type { LocationRuleRow } from '../engine/types.js';

export interface CatalogLocation {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  readonly priceTier: string | null;
  readonly active: boolean;
  readonly groupedFacets: unknown;
  /** A cached menu that lists at least one menu. */
  readonly hasMenu: boolean;
  readonly rule: LocationRuleRow | null;
}

/** A price tier the engine can value: at least one `$` (design.md External Interfaces). */
export function hasPriceTier(priceTier: string | null): boolean {
  return priceTier !== null && priceTier.includes('$');
}

export function locationRowOf(loc: CatalogLocation): AdminLocationRow {
  const resolved = resolveLocationRule(loc.rule, { groupedFacets: loc.groupedFacets });
  return {
    experienceId: loc.experienceId,
    name: loc.name,
    park: loc.park,
    priceTier: loc.priceTier,
    active: loc.active,
    hasMenu: loc.hasMenu,
    derivedServiceType: deriveServiceType(loc.groupedFacets),
    effectiveServiceType: resolved.serviceType,
    ruleBasis: resolved.status,
    creditCost: resolved.creditCost,
    creditCostByPeriod: resolved.creditCostByPeriod,
    gratuityIncluded: resolved.gratuityIncluded,
    sourceNote: loc.rule?.sourceNote ?? null,
  };
}

/** Requirement 18.5 over the active Restaurant Experiences given. */
export function coverageOf(locations: readonly CatalogLocation[]): AdminCoverage {
  const byDerivedServiceType = Object.fromEntries(DINING_SERVICE_TYPES.map((t) => [t, 0])) as Record<DiningServiceType, number>;
  let withRule = 0;
  let verified = 0;
  let withMenu = 0;
  let withNeitherMenuNorTier = 0;
  for (const loc of locations) {
    byDerivedServiceType[deriveServiceType(loc.groupedFacets)] += 1;
    if (loc.rule !== null) withRule += 1;
    if (loc.rule?.ruleStatus === 'verified') verified += 1;
    if (loc.hasMenu) withMenu += 1;
    if (!loc.hasMenu && !hasPriceTier(loc.priceTier)) withNeitherMenuNorTier += 1;
  }
  return { activeRestaurants: locations.length, byDerivedServiceType, withRule, verified, withMenu, withNeitherMenuNorTier };
}
