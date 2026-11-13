/**
 * The Dining Plan section of the Admin_Panel (dining-plan-calculator Requirements 2.6, 8.2 to 8.4, 8.8 to 8.10, 18;
 * design.md "Admin_Panel"). Types only, so `services/admin/diningPlanRoutes.ts` depends on this port and not on the
 * implementation (`adminRepo.ts`).
 */

import type { DiningConfig, DiningCreditCostByPeriod, DiningPlanCode, DiningRuleBasis, DiningRuleStatus, DiningServiceType } from '@dwt/shared';

import type { SeedEntryResult, SeedOutcome } from './seed/seedRules.js';

/** One stored Plan_Price_Period (`dining_plan_prices`). Money is integer cents; dates `YYYY-MM-DD`. */
export interface AdminPriceRow {
  readonly id: string;
  readonly planCode: DiningPlanCode;
  readonly displayName: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly adultCents: number;
  readonly childCents: number;
  readonly childPromoCents: number | null;
  readonly promoLabel: string | null;
  readonly sourceNote: string | null;
  readonly verifiedAt: string | null;
}

/** A period to create (`id` null) or replace. */
export type AdminPriceInput = Omit<AdminPriceRow, 'id'> & { readonly id: string | null };

/** A Location_Rule as the operator edits it; `serviceType` null means "derive from the catalog". */
export interface AdminRuleInput {
  readonly serviceType: DiningServiceType | null;
  readonly creditCost: 1 | 2;
  readonly creditCostByPeriod: DiningCreditCostByPeriod | null;
  readonly gratuityIncluded: boolean;
  readonly passDiscountEligible: boolean | null;
  readonly overrideAdultCents: number | null;
  readonly overrideChildCents: number | null;
  readonly ruleStatus: DiningRuleStatus;
  readonly verifiedAt: string | null;
  readonly sourceNote: string | null;
}

/** A write that may fail validation; the messages are shown on the page and nothing is written. */
export type AdminWriteResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

/** Requirement 18.5, over active Restaurant Experiences. */
export interface AdminCoverage {
  readonly activeRestaurants: number;
  readonly byDerivedServiceType: Readonly<Record<DiningServiceType, number>>;
  readonly withRule: number;
  readonly verified: number;
  readonly withMenu: number;
  /** Neither a non-empty cached menu nor a price tier: valued by the default estimate only. */
  readonly withNeitherMenuNorTier: number;
}

export interface AdminDiningPlanState {
  readonly prices: readonly AdminPriceRow[];
  /** The stored keys only; a missing key takes `DINING_CONFIG_DEFAULTS`. */
  readonly storedConfig: Readonly<Record<string, unknown>>;
  /** Stored merged over the defaults, exactly as the calculation reads it. */
  readonly effectiveConfig: DiningConfig;
  readonly coverage: AdminCoverage;
}

/** `needs_review`: no rule (derived) or an `unverified` rule; `seeded_unverified`: an unverified rule the seed wrote. */
export const ADMIN_LOCATION_FILTERS = ['all', 'needs_review', 'has_rule', 'seeded_unverified'] as const;
export type AdminLocationFilter = (typeof ADMIN_LOCATION_FILTERS)[number];

export interface AdminLocationRow {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  readonly priceTier: string | null;
  readonly active: boolean;
  readonly hasMenu: boolean;
  readonly derivedServiceType: DiningServiceType;
  readonly effectiveServiceType: DiningServiceType;
  readonly ruleBasis: DiningRuleBasis;
  readonly creditCost: 1 | 2;
  readonly creditCostByPeriod: DiningCreditCostByPeriod | null;
  readonly gratuityIncluded: boolean;
  readonly sourceNote: string | null;
}

export interface AdminLocationPage {
  readonly rows: readonly AdminLocationRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminLocationDetail {
  readonly location: AdminLocationRow;
  /** The stored rule, or null when the location uses the derived one. */
  readonly rule: AdminRuleInput | null;
}

export type AdminSeedResult =
  | { readonly ok: true; readonly results: readonly SeedEntryResult[]; readonly counts: Readonly<Record<SeedOutcome, number>> }
  | { readonly ok: false; readonly error: string };

export interface AdminDiningPlanPort {
  readState(): Promise<AdminDiningPlanState>;
  listLocations(query: { readonly q: string; readonly filter: AdminLocationFilter; readonly limit: number; readonly offset: number }): Promise<AdminLocationPage>;
  /** Null when the id names no Restaurant Experience. */
  getLocation(experienceId: string): Promise<AdminLocationDetail | null>;
  savePrice(input: AdminPriceInput): Promise<AdminWriteResult>;
  deletePrice(id: string): Promise<boolean>;
  /** The full config; only the keys that differ from the defaults are stored. */
  saveConfig(config: DiningConfig): Promise<void>;
  resetConfig(): Promise<void>;
  saveRule(experienceId: string, input: AdminRuleInput): Promise<AdminWriteResult>;
  deleteRule(experienceId: string): Promise<boolean>;
  applySeed(): Promise<AdminSeedResult>;
}
