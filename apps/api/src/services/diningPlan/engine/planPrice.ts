/**
 * Plan price per night and per stay (Requirements 1.5, 2.4, 2.5, 2.7, 3.4, 3.5, 3.6, 13.2; Property 2).
 *
 * Each night is priced from the Plan_Price_Period of the plan that contains it, so a stay crossing two periods uses
 * each night's own price and name. The plan is unavailable, never guessed, when any night has no period.
 */

import { bpsOf, DINING_PLAN_MAX_NIGHTS, type DiningPlanCode, type DiningUnavailableReason } from '@dwt/shared';

import { nightsOf } from './stay.js';
import type { EnginePerson, EnginePriceRow } from './types.js';

/**
 * The period of `plan` whose inclusive `[validFrom, validTo]` contains `date`, or null. The Admin_Panel rejects
 * overlapping periods (Requirement 2.6); if two ever overlap, the one that starts later wins, deterministically.
 */
export function nightPrice(rows: readonly EnginePriceRow[], plan: DiningPlanCode, date: string): EnginePriceRow | null {
  let found: EnginePriceRow | null = null;
  for (const row of rows) {
    if (row.planCode !== plan || date < row.validFrom || date > row.validTo) continue;
    if (found === null || row.validFrom > found.validFrom) found = row;
  }
  return found;
}

export interface PlanCostInput {
  readonly plan: DiningPlanCode;
  readonly checkIn: string;
  readonly checkOut: string;
  /** The persons the plan is bought for; an `under3` Person adds nothing (Requirement 3.6). */
  readonly persons: readonly EnginePerson[];
  readonly priceRows: readonly EnginePriceRow[];
  /** False for a stay the plan cannot be bought at (`not_disney_resort`, Requirement 1.5). */
  readonly disneyResort: boolean;
  /** `kidsEatFree` and a package booking (Stay_Type `disney_resort_package`, or a `package` channel). */
  readonly promoEligible: boolean;
  readonly planPricesIncludeTax: boolean;
  readonly taxBps: number;
}

export interface PlanCostResult {
  readonly available: boolean;
  readonly unavailableReason: DiningUnavailableReason | null;
  /** 0 when unavailable. */
  readonly cents: number;
  /** The distinct `display_name`s of the periods used, in night order, joined with " / "; null when unavailable. */
  readonly displayName: string | null;
  /** The distinct promotion labels actually applied to a child night, joined with " / "; null when none applied. */
  readonly promoLabel: string | null;
  /** The latest `verified_at` of the periods used, or null when any of them has none. */
  readonly verifiedAt: string | null;
  readonly nights: number;
  /** The distinct periods the nights were priced from, in night order; empty when unavailable. */
  readonly periods: readonly EnginePriceRow[];
  /**
   * Each Plan_Eligible_Person's share of the plan price, before the tax the engine adds when plan prices exclude it
   * (so the shares sum to `cents` when `planPricesIncludeTax`). Under-3s are absent. Empty when unavailable.
   */
  readonly baseByPerson: ReadonlyMap<string, number>;
}

function unavailable(reason: DiningUnavailableReason, nights: number): PlanCostResult {
  return { available: false, unavailableReason: reason, cents: 0, displayName: null, promoLabel: null, verifiedAt: null, nights, periods: [], baseByPerson: new Map() };
}

/**
 * The cost of `plan` for every Plan_Eligible_Person for every night (Requirement 3.6), with the Kids Eat Free price
 * where the period has one and the booking qualifies (Requirement 13.2), and tax added when plan prices exclude it
 * (Requirement 2.7). Unavailable reasons are checked in the order of `DINING_UNAVAILABLE_REASONS`.
 */
export function planCost(input: PlanCostInput): PlanCostResult {
  const nights = nightsOf(input.checkIn, input.checkOut);
  if (!input.disneyResort) return unavailable('not_disney_resort', nights.length);
  if (nights.length === 0) return unavailable('no_nights', 0);
  if (nights.length > DINING_PLAN_MAX_NIGHTS) return unavailable('stay_too_long', nights.length);
  const adults = input.persons.filter((p) => p.ageBracket === 'adult').length;
  const children = input.persons.filter((p) => p.ageBracket === 'child').length;
  if (adults + children === 0) return unavailable('no_eligible_guests', nights.length);

  const periods: EnginePriceRow[] = [];
  const promoLabels: string[] = [];
  let adultCents = 0;
  let childCents = 0;
  for (const night of nights) {
    const row = nightPrice(input.priceRows, input.plan, night);
    if (row === null) return unavailable('no_price_for_dates', nights.length);
    if (!periods.includes(row)) periods.push(row);
    const promo = input.promoEligible && row.childPromoCents !== null;
    adultCents += row.adultCents;
    childCents += promo ? row.childPromoCents! : row.childCents;
    if (promo && children > 0 && row.promoLabel !== null && !promoLabels.includes(row.promoLabel)) promoLabels.push(row.promoLabel);
  }
  const baseByPerson = new Map<string, number>();
  for (const p of input.persons) {
    if (p.ageBracket === 'adult') baseByPerson.set(p.key, adultCents);
    else if (p.ageBracket === 'child') baseByPerson.set(p.key, childCents);
  }
  let cents = adults * adultCents + children * childCents;
  if (!input.planPricesIncludeTax) cents += bpsOf(cents, input.taxBps);

  const names: string[] = [];
  for (const p of periods) if (!names.includes(p.displayName)) names.push(p.displayName);
  const verified = periods.map((p) => p.verifiedAt);
  const verifiedAt = verified.some((v) => v === null) ? null : (verified as string[]).reduce((a, b) => (b > a ? b : a));

  return {
    available: true,
    unavailableReason: null,
    cents,
    displayName: names.join(' / '),
    promoLabel: promoLabels.length > 0 ? promoLabels.join(' / ') : null,
    verifiedAt,
    nights: nights.length,
    periods,
    baseByPerson,
  };
}
