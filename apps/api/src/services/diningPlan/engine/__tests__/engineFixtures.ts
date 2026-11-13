/**
 * Shared test fixtures for the dining plan engine: the seeded price rows, a small catalog of locations in the shapes
 * the repo hands the engine, the worked-example Party and entries, and a generator of whole single-stay inputs.
 * Test-only; not a test file itself.
 */

import fc from 'fast-check';

import {
  DINING_CONFIG_DEFAULTS,
  DINING_MEAL_PERIODS,
  DINING_ORDER_STYLES,
  diningPlanSettingsSchema,
  type MenuDTO,
} from '@dwt/shared';

import { addDays } from '../../../ticketPrices/dates.js';
import type { SingleStayInput } from '../scenario.js';
import type { EngineEntry, EngineInput, EngineLocation, EnginePerson, EnginePriceRow, LocationRuleRow } from '../types.js';

/** The five rows `0075_dining_plan.sql` seeds, as the repo maps them. */
export const SEEDED: readonly EnginePriceRow[] = [
  { planCode: 'quick_service', displayName: 'Disney Quick-Service Dining Plan', validFrom: '2026-01-01', validTo: '2026-12-31', adultCents: 6047, childCents: 2616, childPromoCents: 0, promoLabel: 'Kids Eat Free 2026', verifiedAt: null },
  { planCode: 'table_service', displayName: 'Disney Dining Plan', validFrom: '2026-01-01', validTo: '2026-12-31', adultCents: 9859, childCents: 3194, childPromoCents: 0, promoLabel: 'Kids Eat Free 2026', verifiedAt: null },
  { planCode: 'quick_service', displayName: 'Quick-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 6278, childCents: 2582, childPromoCents: null, promoLabel: null, verifiedAt: null },
  { planCode: 'table_service', displayName: 'Table-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 9987, childCents: 3194, childPromoCents: null, promoLabel: null, verifiedAt: null },
  { planCode: 'deluxe', displayName: 'Deluxe Table-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 16301, childCents: 4685, childPromoCents: null, promoLabel: null, verifiedAt: null },
];

export const TS_FACETS = { dining: [{ id: 'table-service-type', name: 'Table Service' }], tableService: [{ id: 'character-dining', name: 'Character Dining' }] };
export const QS_FACETS = { dining: [{ id: 'quick-service-type', name: 'Quick Service' }], quickService: [{ id: 'counter-service', name: 'Counter Service' }] };

export const ID = {
  crt: '00000000-0000-4000-8000-000000000001',
  pecos: '00000000-0000-4000-8000-000000000002',
  akershus: '00000000-0000-4000-8000-000000000003',
  liberty: '00000000-0000-4000-8000-000000000004',
  lounge: '00000000-0000-4000-8000-000000000005',
  dole: '00000000-0000-4000-8000-000000000006',
  tiered: '00000000-0000-4000-8000-000000000007',
  hoopDeeDoo: '00000000-0000-4000-8000-000000000008',
};

export function rule(overrides: Partial<LocationRuleRow>): LocationRuleRow {
  return {
    serviceType: 'table_service', creditCost: 1, creditCostByPeriod: null, gratuityIncluded: false, passDiscountEligible: null,
    overrideAdultCents: null, overrideChildCents: null, ruleStatus: 'unverified', verifiedAt: null, sourceNote: null, ...overrides,
  };
}

export function priced(prices: readonly number[], prefix: string) {
  return prices.map((priceCents, i) => ({ name: `${prefix} ${i + 1}`, price: `$${(priceCents / 100).toFixed(2)}`, priceCents }));
}

export const PECOS_MENU: MenuDTO = {
  menuType: 'Lunch and Dinner',
  groups: [
    { name: 'Entrées', type: 'Entree', items: priced([1100, 1300, 1500], 'Fajita') },
    { name: 'Kids Meals', type: 'Kids', items: priced([790, 890], 'Kids') },
  ],
};
export const LIBERTY_MENU: MenuDTO = {
  menuType: 'Dinner',
  groups: [
    { name: 'Appetizers', type: 'Appetizer', items: priced([1400, 1600], 'Starter') },
    { name: 'Entrées', type: 'Entree', items: priced([2900, 3300, 3800], 'Entree') },
    { name: 'Desserts', type: 'Dessert', items: priced([1100], 'Dessert') },
  ],
};

export const LOCATIONS: ReadonlyMap<string, EngineLocation> = new Map<string, EngineLocation>([
  [ID.crt, { experienceId: ID.crt, name: "Cinderella's Royal Table", priceTier: '$$$$', groupedFacets: TS_FACETS, menus: null,
    rule: rule({ creditCost: 2, gratuityIncluded: true, overrideAdultCents: 7900, overrideChildCents: 4700, ruleStatus: 'verified', verifiedAt: '2026-11-09' }) }],
  [ID.pecos, { experienceId: ID.pecos, name: 'Pecos Bill Tall Tale Inn and Cafe', priceTier: '$', groupedFacets: QS_FACETS, menus: [PECOS_MENU], rule: null }],
  [ID.akershus, { experienceId: ID.akershus, name: 'Akershus Royal Banquet Hall', priceTier: '$$$', groupedFacets: TS_FACETS, menus: null,
    rule: rule({ creditCostByPeriod: { lunch: 2, dinner: 2 }, overrideAdultCents: 6500, overrideChildCents: 3900 }) }],
  [ID.liberty, { experienceId: ID.liberty, name: 'Liberty Tree Tavern', priceTier: '$$', groupedFacets: TS_FACETS, menus: [LIBERTY_MENU], rule: null }],
  // The catalog files lounges under `tableService` with the `lounges` facet (Nomad Lounge as synced, 2026-11).
  [ID.lounge, { experienceId: ID.lounge, name: 'Nomad Lounge', priceTier: '$$', groupedFacets: { dining: [{ id: 'walkupWaitList', name: 'Walk-Up Waitlist' }, { id: 'barslounges-type', name: 'Bars/Lounges' }], tableService: [{ id: 'lounges', name: 'Bar-Lounge' }] }, menus: null, rule: null }],
  [ID.dole, { experienceId: ID.dole, name: 'Aloha Isle', priceTier: '$', groupedFacets: QS_FACETS, menus: null, rule: rule({ serviceType: 'snack_only' }) }],
  [ID.tiered, { experienceId: ID.tiered, name: 'Tiered Grill', priceTier: '$$$', groupedFacets: TS_FACETS, menus: null, rule: null }],
  // One credit with included gratuity (the Hoop-Dee-Doo shape), adult override only.
  [ID.hoopDeeDoo, { experienceId: ID.hoopDeeDoo, name: 'Hoop-Dee-Doo Musical Revue', priceTier: '$$$', groupedFacets: TS_FACETS, menus: null,
    rule: rule({ gratuityIncluded: true, overrideAdultCents: 8000 }) }],
]);

export const A1: EnginePerson = { key: 'm:a1', label: 'Alex', ageBracket: 'adult', passType: 'none' };
export const A2: EnginePerson = { key: 'm:a2', label: 'Blair', ageBracket: 'adult', passType: 'none' };
export const C1: EnginePerson = { key: 'g:c1', label: 'Casey', ageBracket: 'child', passType: 'none' };
export const BABY: EnginePerson = { key: 'g:b1', label: 'Dana', ageBracket: 'under3', passType: 'none' };

export function restaurant(date: string, mealPeriod: EngineEntry['mealPeriod'], experienceId: string, excludedKeys: string[] = []): EngineEntry {
  return { date, mealPeriod, kind: 'restaurant', experienceId, placeholderKind: null, excludedKeys };
}

export function placeholder(date: string, mealPeriod: EngineEntry['mealPeriod'], placeholderKind: 'quick_service' | 'table_service'): EngineEntry {
  return { date, mealPeriod, kind: 'placeholder', experienceId: null, placeholderKind, excludedKeys: [] };
}

/** One snack bought out of pocket at 650 bps: 650 + bpsOf(650, 650) = 650 + 42. */
export const SNACK_UNIT = 692;

/**
 * The worked example: 2 adults and 1 child, 2027-03-01 to 2027-03-06 (5 nights, 6 days); a Cinderella's Royal Table
 * dinner (two credits, gratuity included, overrides $79 / $47), two quick-service lunches at Pecos Bill, one skip.
 */
export const WORKED_ENTRIES: readonly EngineEntry[] = [
  restaurant('2027-03-02', 'dinner', ID.crt),
  restaurant('2027-03-03', 'lunch', ID.pecos),
  restaurant('2027-03-04', 'lunch', ID.pecos),
  { date: '2027-03-05', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] },
];

export const POOL = [ID.crt, ID.pecos, ID.akershus, ID.liberty, ID.lounge, ID.dole, ID.tiered, ID.hoopDeeDoo];

/** The single-stay input as `computeDiningPlan` takes it. */
export function toEngineInput(input: SingleStayInput, today = '2026-11-09'): EngineInput {
  return {
    persons: input.persons,
    stay: { checkIn: input.checkIn, checkOut: input.checkOut, source: 'trip' },
    settings: input.settings,
    entries: input.entries,
    locations: input.locations,
    priceRows: input.priceRows,
    config: input.config,
    today,
  };
}

/**
 * Whole single-stay inputs: 1 to 6 persons of every bracket, 0 to 7 nights from 2026-12-20 onward (so stays cross the
 * 2026/2027 price boundary), every location kind, placeholders, skips, exclusions (including a key not in the Party),
 * the first three slots before check-in, and random settings.
 */
export const generatedInputArb = (opts: { passHolders?: boolean; appetizers?: boolean } = {}): fc.Arbitrary<SingleStayInput> =>
  fc
    .record({
      persons: fc.array(
        fc.record({ bracket: fc.constantFrom('adult' as const, 'adult' as const, 'child' as const, 'under3' as const), pass: fc.constantFrom('none' as const, 'none' as const, 'annual_pass' as const) }),
        { minLength: 1, maxLength: 6 },
      ),
      startOffset: fc.integer({ min: 0, max: 380 }),
      nights: fc.integer({ min: 0, max: 7 }),
      slots: fc.array(fc.record({ choice: fc.integer({ min: 0, max: POOL.length + 3 }), excludeMask: fc.integer({ min: 0, max: 63 }), strangerExcluded: fc.boolean() }), { maxLength: 30 }),
      orderStyle: fc.constantFrom(...DINING_ORDER_STYLES),
      beverage: fc.constantFrom('water' as const, 'soft_drink' as const, 'specialty' as const),
      drinkerMask: fc.integer({ min: 0, max: 63 }),
      orderDessert: fc.boolean(),
      appetizersPerTable: fc.integer({ min: 0, max: 2 }),
      snacksPerPersonPerDay: fc.integer({ min: 0, max: 3 }),
      mugs: fc.integer({ min: 0, max: 6 }),
      kidsEatFree: fc.boolean(),
      stayType: fc.constantFrom('disney_resort_package' as const, 'disney_resort_package' as const, 'dvc_or_passholder_resort' as const),
      taxBps: fc.option(fc.integer({ min: 0, max: 1500 }), { nil: null }),
      tipBps: fc.option(fc.integer({ min: 0, max: 3000 }), { nil: null }),
    })
    .map((g) => {
      const persons: EnginePerson[] = g.persons.map((p, i) => ({
        key: `m:p${i}`, label: `P${i}`, ageBracket: p.bracket, passType: opts.passHolders === false ? 'none' : p.pass,
      }));
      const checkIn = addDays('2026-12-20', g.startOffset);
      const checkOut = addDays(checkIn, g.nights);
      const entries: EngineEntry[] = [];
      // Slot i is (checkIn - 1 + floor(i / 3), period i % 3): the first three fall outside the stay.
      g.slots.slice(0, (g.nights + 2) * 3).forEach((s, i) => {
        const date = addDays(checkIn, Math.floor(i / 3) - 1);
        const mealPeriod = DINING_MEAL_PERIODS[i % 3]!;
        const excludedKeys = persons.filter((_, j) => (s.excludeMask & (1 << j)) !== 0).map((p) => p.key);
        if (s.strangerExcluded) excludedKeys.push('m:stranger');
        if (s.choice < POOL.length) entries.push({ date, mealPeriod, kind: 'restaurant', experienceId: POOL[s.choice]!, placeholderKind: null, excludedKeys });
        else if (s.choice === POOL.length) entries.push({ date, mealPeriod, kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys });
        else if (s.choice === POOL.length + 1) entries.push({ date, mealPeriod, kind: 'placeholder', experienceId: null, placeholderKind: 'quick_service', excludedKeys });
        else if (s.choice === POOL.length + 2) entries.push({ date, mealPeriod, kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] });
      });
      const eligible = persons.filter((p) => p.ageBracket !== 'under3').length;
      const settings = diningPlanSettingsSchema.parse({
        orderStyle: g.orderStyle, beverage: g.beverage,
        alcoholDrinkerKeys: persons.filter((p, j) => p.ageBracket === 'adult' && (g.drinkerMask & (1 << j)) !== 0).map((p) => p.key),
        orderDessert: g.orderDessert, appetizersPerTable: opts.appetizers === false ? 0 : g.appetizersPerTable,
        snacksPerPersonPerDay: g.snacksPerPersonPerDay, mugsWanted: Math.min(g.mugs, eligible), kidsEatFree: g.kidsEatFree,
        stayType: g.stayType, taxBps: g.taxBps, tipBps: g.tipBps,
      });
      return { persons, checkIn, checkOut, entries, locations: LOCATIONS, priceRows: SEEDED, settings, config: DINING_CONFIG_DEFAULTS };
    });
