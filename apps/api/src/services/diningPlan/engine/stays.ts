/**
 * Plan_Stays at evaluation time (Requirement 25.1 to 25.5, 25.8, 25.9, 25.12, 25.13; design.md "Multi-Stay Extension"
 * steps 1 and 6; Properties 33, 35 and 36).
 *
 * Each stay knows the Party members on it, its effective status (a `compare` stay beyond the third, in date order, is
 * treated as `no_plan`), whether a plan can be bought at it, each plan's cost there, and its options in a Combination.
 * Every calendar date of the span is attributed to exactly one stay for snacks.
 */

import {
  DINING_PLAN_CODES,
  DINING_PLAN_COMPARE_STAYS_MAX,
  type DiningPlanCode,
  type DiningPlanSettings,
  type DiningConfig,
  type DiningStayChannel,
  type DiningStayPlanStatus,
  type EffectiveStaySource,
  type EnginePlanStay,
  type StayType,
} from '@dwt/shared';

import { addDays, daysBetween } from '../../ticketPrices/dates.js';
import { planCost, type PlanCostResult } from './planPrice.js';
import { nightsOf } from './stay.js';
import type { EnginePerson, EnginePriceRow } from './types.js';

export interface PlanStayRuntime {
  readonly key: string;
  readonly label: string;
  readonly lodgingKind: StayType;
  readonly source: EffectiveStaySource;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  /** Party members on the stay (`partyKeys` null means the whole Party; unknown keys are ignored), in Party order. */
  readonly persons: readonly EnginePerson[];
  readonly personKeys: ReadonlySet<string>;
  /** After the compare-stay limit; the stored setting may say `compare`. */
  readonly status: DiningStayPlanStatus;
  readonly heldPlan: DiningPlanCode | null;
  readonly channel: DiningStayChannel;
  /** A plan can be bought here (Requirement 25.2). */
  readonly planEligible: boolean;
  readonly planCosts: Readonly<Record<DiningPlanCode, PlanCostResult>>;
  /** The stay's choices in a Combination: null is no plan. A held plan is the only choice. */
  readonly options: readonly (DiningPlanCode | null)[];
  /** The held plan has a night with no price period: its cost counts as 0 (Requirement 25.4). */
  readonly heldPriceUnknown: boolean;
  /** Dates attributed to this stay for snacks (Requirement 25.12). */
  readonly attributedDays: number;
}

/** Requirement 25.2: a Disney Resort, the legacy first resort, or lodging not yet recorded (assumed a package). */
export function isPlanEligibleStay(stay: Pick<EnginePlanStay, 'lodgingKind' | 'source'>): boolean {
  return stay.lodgingKind === 'resort' || stay.source !== 'stay';
}

/** What a stay costs with `plan` in a Combination: its price, or 0 when no period prices it (a held plan). */
export function stayPlanCents(stay: PlanStayRuntime, plan: DiningPlanCode): number {
  const cost = stay.planCosts[plan];
  return cost.available ? cost.cents : 0;
}

export interface StayRuntimeResult {
  /** In date order. */
  readonly stays: PlanStayRuntime[];
  /** The index in `stays` of the stay a date is attributed to; -1 outside the span. */
  readonly stayOfDate: (date: string) => number;
  readonly span: { readonly checkIn: string; readonly checkOut: string };
  /** Keys of `compare` stays treated as `no_plan` because more than `DINING_PLAN_COMPARE_STAYS_MAX` compare. */
  readonly overflowCompareKeys: readonly string[];
}

/**
 * Builds the evaluation-time stays. `settings.kidsEatFree` applies only to a `package` stay (Requirement 25.13);
 * `taxBps` is the resolved rate, used when plan prices exclude tax.
 */
export function buildStayRuntimes(input: {
  readonly stays: readonly EnginePlanStay[];
  readonly persons: readonly EnginePerson[];
  readonly priceRows: readonly EnginePriceRow[];
  readonly settings: Pick<DiningPlanSettings, 'kidsEatFree'>;
  readonly config: Pick<DiningConfig, 'planPricesIncludeTax'>;
  readonly taxBps: number;
}): StayRuntimeResult {
  const sorted = [...input.stays].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.key < b.key ? -1 : 1));
  if (sorted.length === 0) throw new RangeError('at least one Plan_Stay is required');
  const span = {
    checkIn: sorted[0]!.checkIn,
    checkOut: sorted.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), sorted[0]!.checkOut),
  };

  // Date attribution: the stay with that night; a date with no night (a gap, or the final check-out) goes to the
  // latest stay that has already started.
  const index = new Map<string, number>();
  const attributed = sorted.map(() => 0);
  const spanDays = daysBetween(span.checkIn, span.checkOut) + 1;
  for (let d = 0; d < spanDays; d += 1) {
    const date = addDays(span.checkIn, d);
    let owner = sorted.findIndex((s) => s.checkIn <= date && date < s.checkOut);
    if (owner < 0) {
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        if (sorted[i]!.checkIn <= date) {
          owner = i;
          break;
        }
      }
    }
    index.set(date, owner);
    attributed[owner]! += 1;
  }

  let compareSeen = 0;
  const overflowCompareKeys: string[] = [];
  const stays = sorted.map((s, i): PlanStayRuntime => {
    const keys = s.partyKeys === null ? null : new Set(s.partyKeys);
    const persons = keys === null ? [...input.persons] : input.persons.filter((p) => keys.has(p.key));
    const planEligible = isPlanEligibleStay(s);
    let status = s.setting.status;
    if (status === 'compare') {
      compareSeen += 1;
      if (compareSeen > DINING_PLAN_COMPARE_STAYS_MAX) {
        status = 'no_plan';
        overflowCompareKeys.push(s.key);
      }
    }
    const planCosts = {} as Record<DiningPlanCode, PlanCostResult>;
    for (const plan of DINING_PLAN_CODES) {
      planCosts[plan] = planCost({
        plan,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        persons,
        priceRows: input.priceRows,
        disneyResort: planEligible,
        promoEligible: input.settings.kidsEatFree && s.setting.channel === 'package',
        planPricesIncludeTax: input.config.planPricesIncludeTax,
        taxBps: input.taxBps,
      });
    }
    const heldPlan = status === 'have_plan' ? s.setting.heldPlan : null;
    let options: (DiningPlanCode | null)[];
    if (status === 'compare') options = [null, ...DINING_PLAN_CODES.filter((p) => planCosts[p].available)];
    else if (heldPlan !== null && planEligible) options = [heldPlan];
    else options = [null];
    return {
      key: s.key,
      label: s.label,
      lodgingKind: s.lodgingKind,
      source: s.source,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      nights: nightsOf(s.checkIn, s.checkOut).length,
      persons,
      personKeys: new Set(persons.map((p) => p.key)),
      status,
      heldPlan,
      channel: s.setting.channel,
      planEligible,
      planCosts,
      options,
      heldPriceUnknown: heldPlan !== null && planEligible && planCosts[heldPlan].unavailableReason === 'no_price_for_dates',
      attributedDays: attributed[i]!,
    };
  });

  return { stays, stayOfDate: (date) => index.get(date) ?? -1, span, overflowCompareKeys };
}
