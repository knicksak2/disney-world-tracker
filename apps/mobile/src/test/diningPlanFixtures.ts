/**
 * Server-shaped Dining Plan fixtures for the mobile tests. Every figure is what the API returns; the screens must show
 * them unchanged, so the No-plan fixture deliberately uses a total that does not equal the sum of its terms.
 */

import type {
  DiningMealLineDTO,
  DiningPlanDTO,
  DiningPlanResultDTO,
  DiningPlanSettings,
  DiningPlanStayResultDTO,
  DiningScenarioResultDTO,
} from '@dwt/shared';

export const TRIP_ID = '20000000-0000-4000-8000-000000000001';
export const LIBERTY = '00000000-0000-4000-8000-000000000004';
export const PECOS = '00000000-0000-4000-8000-000000000002';
export const ALEX_KEY = 'm:30000000-0000-4000-8000-0000000000a1';
export const BLAIR_KEY = 'm:30000000-0000-4000-8000-0000000000b2';
export const KIT_KEY = 'g:40000000-0000-4000-8000-0000000000d4';

export const SETTINGS: DiningPlanSettings = {
  stay: null,
  stayType: 'disney_resort_package',
  orderStyle: 'typical',
  beverage: 'soft_drink',
  alcoholDrinkerKeys: [],
  orderDessert: true,
  appetizersPerTable: 0,
  snacksPerPersonPerDay: 1,
  mugsWanted: 0,
  kidsEatFree: true,
  tipBps: null,
  taxBps: null,
  stayPlans: {},
};

export function line(overrides: Partial<DiningMealLineDTO> = {}): DiningMealLineDTO {
  return {
    date: '2027-03-02',
    mealPeriod: 'dinner',
    kind: 'restaurant',
    experienceId: LIBERTY,
    label: 'Liberty Tree Tavern',
    serviceType: 'table_service',
    creditCost: 1,
    gratuityIncluded: false,
    twoCredit: false,
    basis: 'menu_items',
    ruleBasis: 'derived',
    unverifiedRule: false,
    dinerCount: 2,
    perDinerFoodCents: { adult: 4_500, child: null },
    coverage: 'all',
    creditsUsedPerDiner: 1,
    coveredDinerCount: 2,
    savingsCents: 11_300,
    outOfPocketCents: 0,
    action: 'use_plan',
    reason: null,
    ...overrides,
  };
}

export function scenario(overrides: Partial<DiningScenarioResultDTO> = {}): DiningScenarioResultDTO {
  return {
    code: 'none',
    displayName: 'No Dining Plan',
    available: true,
    unavailableReason: null,
    planCostCents: 0,
    promoLabel: null,
    foodOutOfPocketCents: 25_000,
    taxCents: 1_625,
    tipCents: 4_500,
    snackOutOfPocketCents: 3_460,
    mugOutOfPocketCents: 0,
    // Deliberately not the sum of the terms: the screen must show the server's total.
    totalCents: 99_999,
    netSavingsCents: 0,
    credits: null,
    meals: [line({ action: 'pay_out_of_pocket', coverage: 'none', creditsUsedPerDiner: 0, coveredDinerCount: 0, savingsCents: 0, outOfPocketCents: 11_300 })],
    bestCreditUses: [],
    priceVerifiedAt: null,
    ...overrides,
  };
}

export const TS_CREDITS = {
  ts: { issued: 10, used: 4, unused: 6 },
  qs: { issued: 10, used: 2, unused: 8 },
  snack: { issued: 10, used: 10, unused: 0 },
  snacksPerDayToUseAll: 1,
  mugsCovered: 0,
};

export function result(overrides: Partial<DiningPlanResultDTO> = {}): DiningPlanResultDTO {
  return {
    computedForDate: '2026-11-09',
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', nights: 5, days: 6, source: 'trip' },
    eligibleCount: 2,
    scenarios: [
      scenario(),
      scenario({ code: 'quick_service', displayName: 'Quick-Service Dining Plan', planCostCents: 62_780, totalCents: 88_000, netSavingsCents: 11_999 }),
      scenario({
        code: 'table_service',
        displayName: 'Table-Service Dining Plan',
        planCostCents: 99_870,
        foodOutOfPocketCents: 0,
        taxCents: 0,
        tipCents: 4_500,
        snackOutOfPocketCents: 0,
        totalCents: 70_000,
        netSavingsCents: 29_999,
        credits: TS_CREDITS,
        meals: [
          line(),
          line({ date: '2027-03-03', mealPeriod: 'lunch', experienceId: PECOS, label: 'Pecos Bill', serviceType: 'quick_service', action: 'partly_covered', coverage: 'partial', coveredDinerCount: 1, reason: 'better_use_elsewhere', outOfPocketCents: 1_900 }),
        ],
      }),
      scenario({ code: 'deluxe', displayName: 'Deluxe Table-Service Dining Plan', available: false, unavailableReason: 'no_price_for_dates', planCostCents: 0, totalCents: 0, meals: [] }),
    ],
    recommended: 'table_service',
    verdict: 'plan_saves',
    bestPlan: 'table_service',
    evenThresholdCents: 2_000,
    breakEvenGapCents: 0,
    sensitivity: [
      { orderStyle: 'budget', bestPlan: 'quick_service', netSavingsCents: 1_200 },
      { orderStyle: 'typical', bestPlan: 'table_service', netSavingsCents: 29_999 },
      { orderStyle: 'splurge', bestPlan: 'table_service', netSavingsCents: 41_000 },
      { orderStyle: 'max_value', bestPlan: 'deluxe', netSavingsCents: 52_000 },
    ],
    dataQuality: {
      byBasis: { admin_override: 0, menu_offer: 0, menu_items: 2, menu_estimate: 0, tier_estimate: 0, default_estimate: 0 },
      estimatedEntries: 0,
      unverifiedRules: 0,
      derivedRules: 0,
      unverifiedPrices: 0,
      outsideStayEntries: 0,
    },
    assumptions: { taxBps: 650, taxIsDefault: true, tipBps: 1_800, tipIsDefault: true, planPricesIncludeTax: true, passDiscountBps: null, pricesAsOf: '2026-11-09' },
    warnings: [],
    ...overrides,
  };
}

export function plan(overrides: Partial<DiningPlanDTO> = {}): DiningPlanDTO {
  return {
    settings: SETTINGS,
    entries: [
      { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: LIBERTY, experienceName: 'Liberty Tree Tavern', placeholderKind: null, plannedItemId: null, excludedKeys: [] },
    ],
    party: [
      { key: ALEX_KEY, label: 'Alex', ageBracket: 'adult', passType: 'none' },
      { key: BLAIR_KEY, label: 'Blair', ageBracket: 'adult', passType: 'none' },
      { key: KIT_KEY, label: 'Kit', ageBracket: 'child', passType: 'none' },
    ],
    stay: { checkIn: '2027-03-01', checkOut: '2027-03-06', nights: 5, days: 6, source: 'trip' },
    suggestions: [],
    suggestionsNeedingMealPeriod: 0,
    result: result(),
    ...overrides,
  };
}

/** One Plan_Stay of a multi-stay result, as the server reports it (defaults applied). */
export function planStay(overrides: Partial<DiningPlanStayResultDTO> = {}): DiningPlanStayResultDTO {
  return {
    key: '60000000-0000-4000-8000-000000000001',
    label: "Disney's Contemporary Resort",
    lodgingKind: 'resort',
    source: 'stay',
    checkIn: '2027-12-15',
    checkOut: '2027-12-20',
    nights: 5,
    partyCount: 3,
    status: 'compare',
    heldPlan: null,
    channel: 'package',
    available: true,
    unavailableReason: null,
    recommendedPlan: 'none',
    planCostCents: 0,
    credits: null,
    contributionCents: 0,
    ...overrides,
  };
}
