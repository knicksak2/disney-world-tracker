import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bpsOf, DINING_CONFIG_DEFAULTS, DINING_ORDER_STYLES, type DiningOrderStyle, type MenuDTO } from '@dwt/shared';

import {
  dinersOf,
  partyHasPassHolder,
  tierLevelOf,
  valueEntry,
  type EntryValuation,
  type MealValuation,
  type ValuationContext,
} from '../mealValuation.js';
import type { EngineEntry, EngineLocation, EnginePerson, LocationRuleRow } from '../types.js';

// --- fixtures ------------------------------------------------------------------------------------------------------

const TS_FACETS = { dining: [{ id: 'table-service-type', name: 'Table Service' }], tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };
const QS_FACETS = { dining: [{ id: 'quick-service-type', name: 'Quick Service' }], quickService: [{ id: 'counter-service', name: 'Counter Service' }] };

const A1: EnginePerson = { key: 'm:a1', label: 'Alex', ageBracket: 'adult', passType: 'none' };
const A2: EnginePerson = { key: 'm:a2', label: 'Blair', ageBracket: 'adult', passType: 'none' };
const C1: EnginePerson = { key: 'g:c1', label: 'Casey', ageBracket: 'child', passType: 'none' };
const BABY: EnginePerson = { key: 'g:b1', label: 'Dana', ageBracket: 'under3', passType: 'none' };

function ctx(overrides: Partial<ValuationContext> = {}): ValuationContext {
  return {
    orderStyle: 'typical',
    beverage: 'soft_drink',
    alcoholDrinkerKeys: new Set(),
    orderDessert: true,
    appetizersPerTable: 0,
    taxBps: 650,
    tipBps: 1800,
    partyHasPassHolder: false,
    config: DINING_CONFIG_DEFAULTS,
    ...overrides,
  };
}

function rule(overrides: Partial<LocationRuleRow> = {}): LocationRuleRow {
  return {
    serviceType: 'table_service',
    creditCost: 1,
    creditCostByPeriod: null,
    gratuityIncluded: false,
    passDiscountEligible: null,
    overrideAdultCents: null,
    overrideChildCents: null,
    ruleStatus: 'unverified',
    verifiedAt: null,
    sourceNote: null,
    ...overrides,
  };
}

function loc(overrides: Partial<EngineLocation> = {}): EngineLocation {
  return {
    experienceId: '11111111-1111-4111-8111-111111111111',
    name: 'Test Restaurant',
    priceTier: null,
    groupedFacets: TS_FACETS,
    menus: null,
    rule: null,
    ...overrides,
  };
}

function entry(overrides: Partial<EngineEntry> = {}): EngineEntry {
  return {
    date: '2027-03-02',
    mealPeriod: 'dinner',
    kind: 'restaurant',
    experienceId: '11111111-1111-4111-8111-111111111111',
    placeholderKind: null,
    excludedKeys: [],
    ...overrides,
  };
}

function items(prices: readonly number[], prefix = 'Item') {
  return prices.map((priceCents, i) => ({ name: `${prefix} ${i + 1}`, price: `$${(priceCents / 100).toFixed(2)}`, priceCents }));
}

/** Ten entrees: nearest-rank picks index 2, 4, 8, 9 at p = 25, 50, 85, 100. */
const ENTREES = [2000, 2200, 2400, 2600, 2800, 3000, 3200, 3400, 3600, 5000];

function tsMenu(menuType: string, opts: { kids?: boolean; alcohol?: boolean; appetizers?: readonly number[] } = {}): MenuDTO {
  return {
    menuType,
    groups: [
      ...(opts.appetizers ? [{ name: 'Appetizers', type: 'Appetizer', items: items(opts.appetizers, 'Starter') }] : []),
      { name: 'Entrées', type: 'Entree', items: [...items(ENTREES, 'Entree'), { name: 'Chef Selection', price: 'Market Price' }] },
      { name: 'Desserts', type: 'Dessert', items: items([900, 1200], 'Dessert') },
      ...(opts.kids === false ? [] : [{ name: "Kids' Entrées", type: 'Kids', items: items([1200, 1400], 'Kids') }]),
      ...(opts.alcohol === false ? [] : [{ name: 'Wine by the Glass', type: 'Alcohol', items: items([1400, 1600], 'Wine') }]),
    ],
  };
}

const QS_MENU: MenuDTO = {
  menuType: 'All Day',
  groups: [
    { name: 'Sandwiches', type: null, items: items([1100, 1300, 1500], 'Sandwich') },
    { name: 'Beer', type: 'Alcohol', items: items([900, 1100], 'Beer') },
  ],
};

function meal(v: EntryValuation): MealValuation {
  if (v.kind !== 'meal') throw new Error(`expected a meal valuation, got ${v.kind}`);
  return v;
}

function diner(v: EntryValuation, key: string) {
  const d = meal(v).byKey.get(key);
  if (d === undefined) throw new Error(`no diner ${key}`);
  return d;
}

// --- tests ---------------------------------------------------------------------------------------------------------

describe('valueEntry: admin_override', () => {
  it('prices from the stored overrides, with tax, tip and included gratuity in the savings (Cinderella shape)', () => {
    const location = loc({
      name: "Cinderella's Royal Table",
      menus: [tsMenu('Dinner')],
      rule: rule({ creditCost: 2, gratuityIncluded: true, overrideAdultCents: 7900, overrideChildCents: 4700, ruleStatus: 'verified', verifiedAt: '2026-11-09' }),
    });
    const v = meal(valueEntry(entry(), location, [A1, C1], ctx()));
    expect(v).toMatchObject({
      label: "Cinderella's Royal Table",
      serviceType: 'table_service',
      creditKind: 'ts',
      creditCost: 2,
      twoCredit: true,
      gratuityIncluded: true,
      basis: 'admin_override',
      ruleBasis: 'verified',
      unverifiedRule: false,
      passDiscountApplied: false,
      perDinerFoodCents: { adult: 7900, child: 4700 },
    });
    // tax: bpsOf(7900, 650) = 514; tip: bpsOf(7900, 1800) = 1422; savings 7900 + 514 + 1422.
    expect(diner(v, A1.key)).toEqual({
      key: A1.key, audience: 'adult', basis: 'admin_override', foodCents: 7900, foodNet: 7900, extraNet: 0,
      taxFood: 514, taxExtra: 0, tip: 1422, savingsCents: 9836,
    });
    // tax: bpsOf(4700, 650) = 306; tip: bpsOf(4700, 1800) = 846; savings 4700 + 306 + 846.
    expect(diner(v, C1.key)).toMatchObject({ foodNet: 4700, taxFood: 306, tip: 846, savingsCents: 5852 });
  });

  it('applies an override only to its audience: a missing child override falls through for the child', () => {
    const location = loc({ menus: [tsMenu('Dinner')], rule: rule({ overrideAdultCents: 7900 }) });
    const v = valueEntry(entry(), location, [A1, C1], ctx());
    expect(diner(v, A1.key)).toMatchObject({ basis: 'admin_override', foodCents: 7900 });
    // Kids group, typical: 1200 + dessert 900 + soft drink 450.
    expect(diner(v, C1.key)).toMatchObject({ basis: 'menu_items', foodCents: 2550 });
    expect(meal(v).basis).toBe('admin_override');
  });

  it('flags a stored unverified rule', () => {
    const v = meal(valueEntry(entry(), loc({ rule: rule({ overrideAdultCents: 5000 }) }), [A1], ctx()));
    expect(v.ruleBasis).toBe('unverified');
    expect(v.unverifiedRule).toBe(true);
  });
});

describe('valueEntry: menu_offer', () => {
  const buffet: MenuDTO = {
    menuType: 'Dinner',
    groups: [
      {
        name: 'Buffet',
        items: [
          { name: 'Adult Buffet', price: '$65.00 per adult' },
          { name: 'Child Buffet', price: '$40.00 per child' },
        ],
      },
    ],
  };

  it('takes the adult and child prices from a "$65 per adult / $40 per child" menu', () => {
    const v = valueEntry(entry(), loc({ menus: [buffet] }), [A1, C1], ctx());
    // Derived rule: no gratuity, so savings = food + tax. bpsOf(6500, 650) = 423; bpsOf(4000, 650) = 260.
    expect(diner(v, A1.key)).toMatchObject({ basis: 'menu_offer', foodCents: 6500, taxFood: 423, tip: 1170, savingsCents: 6923 });
    expect(diner(v, C1.key)).toMatchObject({ basis: 'menu_offer', foodCents: 4000, taxFood: 260, tip: 720, savingsCents: 4260 });
    expect(meal(v).ruleBasis).toBe('derived');
    expect(meal(v).unverifiedRule).toBe(false);
  });

  it('uses the adult offer times childFallbackBps when there is no child offer', () => {
    const adultOnly: MenuDTO = { menuType: 'Dinner', groups: [{ name: 'Buffet', items: [{ name: 'Adult Buffet', price: '$65.00 per adult' }] }] };
    const v = valueEntry(entry(), loc({ menus: [adultOnly] }), [A1, C1], ctx());
    expect(diner(v, C1.key)).toMatchObject({ basis: 'menu_offer', foodCents: 3900 }); // bpsOf(6500, 6000)
  });

  it('uses a per-person offer for adults, and its child fallback', () => {
    const prixFixe: MenuDTO = { menuType: 'Dinner', groups: [{ name: 'Prix Fixe', items: [{ name: 'Three-Course Dinner', price: '$50.00 per person' }] }] };
    const v = valueEntry(entry(), loc({ menus: [prixFixe] }), [A1, C1], ctx());
    expect(diner(v, A1.key)).toMatchObject({ basis: 'menu_offer', foodCents: 5000 });
    expect(diner(v, C1.key)).toMatchObject({ basis: 'menu_offer', foodCents: 3000 }); // bpsOf(5000, 6000)
  });

  it('takes the order-style percentile of several adult offers', () => {
    const tiers: MenuDTO = {
      menuType: 'Dinner',
      groups: [{ name: 'Pricing', items: [{ name: 'Adult', price: 'Adult: $48.00' }, { name: 'Guest', price: '$62.00 per guest' }] }],
    };
    expect(diner(valueEntry(entry(), loc({ menus: [tiers] }), [A1], ctx({ orderStyle: 'budget' })), A1.key).foodCents).toBe(4800);
    expect(diner(valueEntry(entry(), loc({ menus: [tiers] }), [A1], ctx({ orderStyle: 'max_value' })), A1.key).foodCents).toBe(6200);
  });

  it('ignores an offer on a menu of another meal period', () => {
    const lunchBuffet: MenuDTO = { ...buffet, menuType: 'Lunch' };
    const v = valueEntry(entry({ mealPeriod: 'dinner' }), loc({ menus: [lunchBuffet, tsMenu('Dinner')] }), [A1], ctx());
    expect(diner(v, A1.key).basis).toBe('menu_items');
  });
});

describe('valueEntry: menu_items', () => {
  const dinner = loc({ menus: [tsMenu('Dinner')] });

  it.each<[DiningOrderStyle, number]>([
    ['budget', 2400 + 900 + 450],
    ['typical', 2800 + 900 + 450],
    ['splurge', 3600 + 1200 + 450],
    ['max_value', 5000 + 1200 + 450],
  ])('prices a table-service adult at the %s percentile: entree + dessert + soft drink = %i', (orderStyle, expected) => {
    expect(diner(valueEntry(entry(), dinner, [A1], ctx({ orderStyle })), A1.key)).toMatchObject({ basis: 'menu_items', foodCents: expected });
  });

  it('prices a child from the kids group, and from bpsOf(adult, 6000) without one', () => {
    expect(diner(valueEntry(entry(), dinner, [A1, C1], ctx()), C1.key)).toMatchObject({ basis: 'menu_items', foodCents: 1200 + 900 + 450 });
    const noKids = loc({ menus: [tsMenu('Dinner', { kids: false })] });
    // Adult typical 4150 -> bpsOf(4150, 6000) = 2490.
    expect(diner(valueEntry(entry(), noKids, [A1, C1], ctx()), C1.key)).toMatchObject({ basis: 'menu_items', foodCents: 2490 });
  });

  it('drops the dessert when orderDessert is off', () => {
    expect(diner(valueEntry(entry(), dinner, [A1], ctx({ orderDessert: false })), A1.key).foodCents).toBe(2800 + 450);
  });

  it('falls back to dessertCents when the menu has no priced dessert', () => {
    const menu = tsMenu('Dinner');
    const noDessert: MenuDTO = { ...menu, groups: menu.groups.filter((g) => g.type !== 'Dessert') };
    expect(diner(valueEntry(entry(), loc({ menus: [noDessert] }), [A1], ctx()), A1.key).foodCents).toBe(2800 + 1000 + 450);
  });

  it.each([
    ['water', 0],
    ['soft_drink', 450],
    ['specialty', 750],
  ] as const)('prices the %s beverage at %i', (beverage, drink) => {
    expect(diner(valueEntry(entry(), dinner, [A1], ctx({ beverage })), A1.key).foodCents).toBe(2800 + 900 + drink);
  });

  describe('alcohol drinkers (Property 37)', () => {
    const drinkers = new Set([A1.key]);

    it('prices the alcohol group median at a table-service dinner, and alcoholBeverageCents without one', () => {
      // Wine [1400, 1600]: nearest-rank median is 1400.
      expect(diner(valueEntry(entry(), dinner, [A1, A2], ctx({ alcoholDrinkerKeys: drinkers })), A1.key).foodCents).toBe(2800 + 900 + 1400);
      expect(diner(valueEntry(entry(), dinner, [A1, A2], ctx({ alcoholDrinkerKeys: drinkers })), A2.key).foodCents).toBe(2800 + 900 + 450);
      const dry = loc({ menus: [tsMenu('Dinner', { alcohol: false })] });
      expect(diner(valueEntry(entry(), dry, [A1], ctx({ alcoholDrinkerKeys: drinkers })), A1.key).foodCents).toBe(2800 + 900 + 1300);
    });

    it('prices alcohol at a table-service breakfast', () => {
      const breakfast = loc({ menus: [tsMenu('Breakfast')] });
      expect(diner(valueEntry(entry({ mealPeriod: 'breakfast' }), breakfast, [A1], ctx({ alcoholDrinkerKeys: drinkers })), A1.key).foodCents).toBe(
        2800 + 900 + 1400,
      );
    });

    it('prices alcohol at a quick-service lunch: entree + beer median, no dessert, no tip', () => {
      const qs = loc({ groupedFacets: QS_FACETS, menus: [QS_MENU] });
      const v = valueEntry(entry({ mealPeriod: 'lunch' }), qs, [A1, A2], ctx({ alcoholDrinkerKeys: drinkers }));
      expect(diner(v, A1.key)).toMatchObject({ foodCents: 1300 + 900, tip: 0 });
      expect(diner(v, A2.key)).toMatchObject({ foodCents: 1300 + 450, tip: 0 });
      expect(meal(v).creditKind).toBe('qs');
    });

    it('prices a drinker like a non-drinker at a quick-service breakfast', () => {
      const qs = loc({ groupedFacets: QS_FACETS, menus: [QS_MENU] });
      const v = valueEntry(entry({ mealPeriod: 'breakfast' }), qs, [A1, A2], ctx({ alcoholDrinkerKeys: drinkers }));
      expect(diner(v, A1.key).foodCents).toBe(1300 + 450);
      expect(diner(v, A1.key).foodCents).toBe(diner(v, A2.key).foodCents);
    });

    it('never treats a child key in alcoholDrinkerKeys as a drinker', () => {
      const v = valueEntry(entry(), dinner, [A1, C1], ctx({ alcoholDrinkerKeys: new Set([C1.key]) }));
      expect(diner(v, C1.key).foodCents).toBe(1200 + 900 + 450);
    });

    it('reports the non-drinking adult price on the line', () => {
      const v = meal(valueEntry(entry(), dinner, [A1, A2], ctx({ alcoholDrinkerKeys: drinkers })));
      expect(v.perDinerFoodCents.adult).toBe(2800 + 900 + 450);
    });
  });
});

describe('valueEntry: menu_estimate, tier_estimate, default_estimate', () => {
  it('uses the menu estimate when no group classifies as an entree', () => {
    const bakery: MenuDTO = { menuType: 'Breakfast', groups: [{ name: 'Bakery', items: items([400, 500, 650], 'Pastry') }] };
    const v = valueEntry(entry({ mealPeriod: 'breakfast' }), loc({ groupedFacets: QS_FACETS, menus: [bakery] }), [A1, C1], ctx());
    // mean(400, 500, 650) = 516.67 -> 517; child bpsOf(517, 6000) = 310.
    expect(diner(v, A1.key)).toMatchObject({ basis: 'menu_estimate', foodCents: 517 });
    expect(diner(v, C1.key)).toMatchObject({ basis: 'menu_estimate', foodCents: 310 });
  });

  it('uses the tier estimate for "$$" at table service and for a "$ (...)" string at quick service', () => {
    expect(diner(valueEntry(entry(), loc({ priceTier: '$$' }), [A1], ctx()), A1.key)).toMatchObject({ basis: 'tier_estimate', foodCents: 4200 });
    const qs = loc({ groupedFacets: QS_FACETS, priceTier: '$ ($14.99 and under per adult)' });
    const v = valueEntry(entry({ mealPeriod: 'lunch' }), qs, [A1, C1], ctx());
    expect(diner(v, A1.key)).toMatchObject({ basis: 'tier_estimate', foodCents: 1400 });
    expect(diner(v, C1.key)).toMatchObject({ basis: 'tier_estimate', foodCents: 840 }); // bpsOf(1400, 6000)
  });

  it('clamps the tier level to 4 and ignores a tier without a leading $', () => {
    expect(tierLevelOf('$$$$$')).toBe('4');
    expect(tierLevelOf('  $$$ (over $60)')).toBe('3');
    expect(tierLevelOf('Moderate')).toBeNull();
    expect(tierLevelOf(null)).toBeNull();
    expect(diner(valueEntry(entry(), loc({ priceTier: 'Moderate' }), [A1], ctx()), A1.key)).toMatchObject({ basis: 'default_estimate', foodCents: 4500 });
  });

  it('uses the default estimate for a table-service and a quick-service location with no data', () => {
    expect(diner(valueEntry(entry(), loc(), [A1], ctx()), A1.key)).toMatchObject({ basis: 'default_estimate', foodCents: 4500 });
    expect(diner(valueEntry(entry(), loc({ groupedFacets: QS_FACETS }), [A1], ctx()), A1.key)).toMatchObject({
      basis: 'default_estimate',
      foodCents: 1800,
    });
  });

  it('values a placeholder from the placeholder price with the child fallback', () => {
    const qs = valueEntry(entry({ kind: 'placeholder', experienceId: null, placeholderKind: 'quick_service' }), null, [A1, C1], ctx());
    expect(meal(qs)).toMatchObject({ label: 'Quick-service meal', serviceType: 'quick_service', creditKind: 'qs', basis: 'default_estimate', ruleBasis: 'derived' });
    expect(diner(qs, A1.key)).toMatchObject({ foodCents: 1800, tip: 0 });
    expect(diner(qs, C1.key)).toMatchObject({ foodCents: 1080 }); // bpsOf(1800, 6000)
    const ts = valueEntry(entry({ kind: 'placeholder', experienceId: null, placeholderKind: 'table_service' }), null, [A1], ctx());
    // bpsOf(4500, 650) = 293; bpsOf(4500, 1800) = 810.
    expect(diner(ts, A1.key)).toMatchObject({ foodCents: 4500, taxFood: 293, tip: 810, savingsCents: 4793 });
    expect(meal(ts).creditKind).toBe('ts');
  });
});

describe('valueEntry: pass discount', () => {
  const location = loc({ rule: rule({ overrideAdultCents: 7900 }) });

  it('takes passDiningDiscountBps off the food when the Party has a pass holder', () => {
    const v = valueEntry(entry(), location, [A1], ctx({ partyHasPassHolder: true }));
    // 7900 - bpsOf(7900, 1000) = 7110; tax bpsOf(7110, 650) = 462; tip bpsOf(7110, 1800) = 1280.
    expect(diner(v, A1.key)).toMatchObject({ foodCents: 7900, foodNet: 7110, taxFood: 462, tip: 1280, savingsCents: 7572 });
    expect(meal(v).passDiscountApplied).toBe(true);
    expect(meal(v).perDinerFoodCents.adult).toBe(7110);
  });

  it('applies no discount without a pass holder, or when the rule says passDiscountEligible = false', () => {
    expect(diner(valueEntry(entry(), location, [A1], ctx()), A1.key).foodNet).toBe(7900);
    const ineligible = loc({ rule: rule({ overrideAdultCents: 7900, passDiscountEligible: false }) });
    const v = valueEntry(entry(), ineligible, [A1], ctx({ partyHasPassHolder: true }));
    expect(diner(v, A1.key).foodNet).toBe(7900);
    expect(meal(v).passDiscountApplied).toBe(false);
  });

  it('detects a pass holder from annual_pass or dvc only', () => {
    expect(partyHasPassHolder([A1, { ...A2, passType: 'annual_pass' }])).toBe(true);
    expect(partyHasPassHolder([{ ...A1, passType: 'dvc' }])).toBe(true);
    expect(partyHasPassHolder([{ ...A1, passType: 'other_discount' }, A2])).toBe(false);
  });
});

describe('valueEntry: appetizers', () => {
  // Appetizers [1500, 1700, 2100]: nearest-rank median 1700; 2 per table = 3400 split over 3 Diners = 1134, 1133, 1133.
  const location = loc({ menus: [tsMenu('Dinner', { appetizers: [1500, 1700, 2100] })] });

  it('splits the table total across the Diners with the remainder cent to the first Diner in Party order', () => {
    const v = valueEntry(entry(), location, [A1, A2, C1], ctx({ appetizersPerTable: 2 }));
    expect(meal(v).diners.map((d) => d.extraNet)).toEqual([1134, 1133, 1133]);
    const a1 = diner(v, A1.key);
    // tax on the extra: bpsOf(1134, 650) = 74; the tip covers food and extras: bpsOf(4150 + 1134, 1800) = 951.
    expect(a1).toMatchObject({ foodNet: 4150, taxExtra: 74, tip: 951 });
    // Extras are never part of what a credit saves.
    expect(a1.savingsCents).toBe(4150 + bpsOf(4150, 650));
  });

  it('splits only across the Diners who are eating', () => {
    const v = valueEntry(entry({ excludedKeys: [A1.key] }), location, [A1, A2, C1], ctx({ appetizersPerTable: 2 }));
    expect(meal(v).diners.map((d) => [d.key, d.extraNet])).toEqual([[A2.key, 1700], [C1.key, 1700]]);
  });

  it('uses appetizerCents without an appetizer group, and the pass discount on each share', () => {
    const v = valueEntry(entry(), loc({ menus: [tsMenu('Dinner')] }), [A1], ctx({ appetizersPerTable: 1, partyHasPassHolder: true }));
    expect(diner(v, A1.key).extraNet).toBe(1500 - bpsOf(1500, 1000));
  });

  it('adds no appetizers at a quick-service meal', () => {
    const qs = loc({ groupedFacets: QS_FACETS, menus: [QS_MENU] });
    expect(meal(valueEntry(entry({ mealPeriod: 'lunch' }), qs, [A1, A2], ctx({ appetizersPerTable: 4 }))).diners.every((d) => d.extraNet === 0)).toBe(true);
  });
});

describe('valueEntry: tip and savings', () => {
  it('tips only table service', () => {
    const qs = valueEntry(entry({ mealPeriod: 'lunch' }), loc({ groupedFacets: QS_FACETS, menus: [QS_MENU] }), [A1], ctx());
    expect(diner(qs, A1.key).tip).toBe(0);
    const ts = valueEntry(entry(), loc({ menus: [tsMenu('Dinner')] }), [A1], ctx());
    expect(diner(ts, A1.key).tip).toBe(bpsOf(4150, 1800));
  });

  it('savings are foodNet + taxFood, plus the tip only where gratuity is included', () => {
    const plain = diner(valueEntry(entry(), loc({ rule: rule({ overrideAdultCents: 6000 }) }), [A1], ctx()), A1.key);
    expect(plain.savingsCents).toBe(6000 + 390);
    const gratuity = diner(valueEntry(entry(), loc({ rule: rule({ overrideAdultCents: 6000, gratuityIncluded: true }) }), [A1], ctx()), A1.key);
    expect(gratuity.savingsCents).toBe(6000 + 390 + 1080);
    expect(gratuity.savingsCents - plain.savingsCents).toBe(gratuity.tip);
  });
});

describe('valueEntry: service types, Diners and skips', () => {
  it('returns a snack for a snack_only location, listing the Diners', () => {
    const v = valueEntry(entry(), loc({ name: 'Dole Whip Stand', rule: rule({ serviceType: 'snack_only' }) }), [A1, BABY, C1], ctx());
    expect(v).toEqual({ kind: 'snack', label: 'Dole Whip Stand', ruleBasis: 'unverified', unverifiedRule: true, dinerKeys: [A1.key, C1.key] });
  });

  it('prices a not_eligible location like quick service and makes it non-coverable', () => {
    const lounge = loc({ groupedFacets: { dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }], tableService: [{ id: 'lounges', name: 'Bar-Lounge' }] }, menus: [tsMenu('Dinner')] });
    const v = meal(valueEntry(entry(), lounge, [A1], ctx({ partyHasPassHolder: true })));
    expect(v).toMatchObject({ serviceType: 'not_eligible', creditKind: null, ruleBasis: 'derived', passDiscountApplied: false });
    // Entree + drink only (no dessert, no tip), no pass discount.
    expect(diner(v, A1.key)).toMatchObject({ foodCents: 2800 + 450, foodNet: 3250, tip: 0, extraNet: 0 });
    // Without menus it reads the quick-service tier table: '$$' is 1700, not the table-service 4200.
    const tiered = loc({ groupedFacets: {}, priceTier: '$$' });
    expect(diner(valueEntry(entry(), tiered, [A1], ctx()), A1.key)).toMatchObject({ basis: 'tier_estimate', foodCents: 1700 });
  });

  it('is skip for a skip entry, an all-excluded entry, an under-3-only Party, or a restaurant with no location', () => {
    expect(valueEntry(entry({ kind: 'skip', experienceId: null }), null, [A1], ctx())).toEqual({ kind: 'skip' });
    expect(valueEntry(entry({ excludedKeys: [A1.key, C1.key] }), loc(), [A1, C1], ctx())).toEqual({ kind: 'skip' });
    expect(valueEntry(entry(), loc(), [BABY], ctx())).toEqual({ kind: 'skip' });
    expect(valueEntry(entry(), null, [A1], ctx())).toEqual({ kind: 'skip' });
  });

  it('never makes an under-3 a Diner and ignores excluded keys that are not in the Party', () => {
    expect(dinersOf({ excludedKeys: ['m:stranger', C1.key] }, [A1, BABY, C1, A2]).map((p) => p.key)).toEqual([A1.key, A2.key]);
  });

  // Feature: dining-plan-calculator, Property 39: Credit cost follows the meal period (valuation half)
  // Validates: Requirements 8.8
  it('Property 39: an Akershus-shaped rule gives 1 credit at breakfast and 2 (twoCredit) at lunch and dinner', () => {
    const akershus = loc({ name: 'Akershus Royal Banquet Hall', rule: rule({ creditCostByPeriod: { lunch: 2, dinner: 2 }, overrideAdultCents: 6000 }) });
    for (const [period, cost] of [['breakfast', 1], ['lunch', 2], ['dinner', 2]] as const) {
      const v = meal(valueEntry(entry({ mealPeriod: period }), akershus, [A1], ctx()));
      expect(v.creditCost).toBe(cost);
      expect(v.twoCredit).toBe(cost === 2);
    }
  });
});

// --- properties ----------------------------------------------------------------------------------------------------

const centsArb = fc.integer({ min: 100, max: 15_000 });
const pricedGroupArb = (names: readonly string[]) =>
  fc.record({
    name: fc.constantFrom(...names),
    type: fc.constant(null),
    items: fc.array(fc.record({ name: fc.constant('Item'), priceCents: centsArb }), { minLength: 1, maxLength: 6 }),
  });

describe('valuation properties', () => {
  // Feature: dining-plan-calculator, Property 11: A bolder order style never lowers cost
  // Validates: Requirements 7.2, 6.1
  it('Property 11: per-Diner food on menu_items is non-decreasing over budget, typical, splurge, max_value; max_value is the maximum entree', () => {
    fc.assert(
      fc.property(
        fc.array(centsArb, { minLength: 1, maxLength: 12 }),
        fc.array(centsArb, { maxLength: 5 }),
        fc.constantFrom('table_service' as const, 'quick_service' as const),
        fc.boolean(),
        (entrees, desserts, serviceType, orderDessert) => {
          const menu: MenuDTO = {
            menuType: 'Dinner',
            groups: [
              { name: 'Entrées', type: 'Entree', items: items(entrees) },
              { name: 'Desserts', type: 'Dessert', items: items(desserts) },
            ],
          };
          const location = loc({ menus: [menu], groupedFacets: serviceType === 'table_service' ? TS_FACETS : QS_FACETS });
          const prices = DINING_ORDER_STYLES.map((orderStyle) => diner(valueEntry(entry(), location, [A1], ctx({ orderStyle, orderDessert })), A1.key));
          for (const p of prices) expect(p.basis).toBe('menu_items');
          for (let i = 1; i < prices.length; i += 1) expect(prices[i]!.foodCents).toBeGreaterThanOrEqual(prices[i - 1]!.foodCents);
          const dessert = serviceType === 'table_service' && orderDessert ? (desserts.length > 0 ? Math.max(...desserts) : 1000) : 0;
          expect(prices[3]!.foodCents).toBe(Math.max(...entrees) + dessert + 450);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: dining-plan-calculator, Property 13: Menu basis follows the precedence order
  // Validates: Requirements 7.1, 7.9
  it('Property 13: the basis is the first applicable; removing its data moves to the next applicable one', () => {
    type Data = { override: boolean; offer: boolean; entrees: boolean; other: boolean; tier: boolean };
    const build = (d: Data): EngineLocation => {
      const groups: MenuDTO['groups'][number][] = [];
      if (d.offer) groups.push({ name: 'Buffet', items: [{ name: 'Adult Buffet', price: '$55.00 per adult' }] });
      if (d.entrees) groups.push({ name: 'Entrées', type: 'Entree', items: items([2500, 3100]) });
      if (d.other) groups.push({ name: 'Bakery', items: items([450, 600]) });
      return loc({
        menus: groups.length > 0 ? [{ menuType: 'Dinner', groups }] : null,
        priceTier: d.tier ? '$$$' : null,
        rule: d.override ? rule({ overrideAdultCents: 8800 }) : null,
      });
    };
    const expected = (d: Data) =>
      d.override ? 'admin_override' : d.offer ? 'menu_offer' : d.entrees ? 'menu_items' : d.other ? 'menu_estimate' : d.tier ? 'tier_estimate' : 'default_estimate';
    const keyOf: Record<string, keyof Data | null> = {
      admin_override: 'override', menu_offer: 'offer', menu_items: 'entrees', menu_estimate: 'other', tier_estimate: 'tier', default_estimate: null,
    };
    fc.assert(
      fc.property(fc.record({ override: fc.boolean(), offer: fc.boolean(), entrees: fc.boolean(), other: fc.boolean(), tier: fc.boolean() }), (data) => {
        const v = meal(valueEntry(entry(), build(data), [A1], ctx()));
        expect(v.basis).toBe(expected(data));
        const key = keyOf[v.basis];
        if (key !== null && key !== undefined) {
          const removed = { ...data, [key]: false };
          expect(meal(valueEntry(entry(), build(removed), [A1], ctx())).basis).toBe(expected(removed));
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: dining-plan-calculator, Property 14: Valuation is total and positive
  // Validates: Requirements 7.4, 7.7, 7.8
  it('Property 14: any menus, rules, tiers and settings give every Diner a positive integer price without throwing', () => {
    const itemArb = fc.oneof(
      fc.record(
        {
          name: fc.oneof(fc.string(), fc.constantFrom('Adult Buffet', 'Child Buffet')),
          price: fc.oneof(fc.constant(null), fc.constantFrom('$0.00', 'Market Price', '$65.00 per adult', '$40 per child', '$8 / $10'), fc.string()),
          priceCents: fc.oneof(fc.constant(null), fc.integer({ min: -100, max: 9_000 })),
        },
        { requiredKeys: [] },
      ),
      fc.anything(),
    );
    const groupArb = fc.oneof(
      fc.record({ name: fc.constantFrom('Entrées', "Kids' Menu", 'Desserts', 'Beer', 'Appetizers', 'Buffet Pricing', ''), type: fc.option(fc.string(), { nil: null }), items: fc.array(itemArb, { maxLength: 5 }) }),
      fc.anything(),
    );
    const menusArb = fc.oneof(
      fc.constant(null),
      fc.array(fc.oneof(fc.record({ menuType: fc.constantFrom('Breakfast', 'Lunch', 'Dinner', 'All Day', ''), groups: fc.array(groupArb, { maxLength: 6 }) }), fc.anything()), { maxLength: 3 }),
    );
    const ruleArb = fc.option(
      fc.record({
        serviceType: fc.constantFrom(null, 'table_service' as const, 'quick_service' as const, 'not_eligible' as const),
        overrideAdultCents: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
        overrideChildCents: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
        passDiscountEligible: fc.constantFrom(null, true, false),
      }),
      { nil: null },
    );
    fc.assert(
      fc.property(
        menusArb,
        ruleArb,
        fc.oneof(fc.constant(null), fc.constantFrom('$', '$$', '$$$$$$', '$ (under $15)', 'Moderate')),
        fc.constantFrom('breakfast' as const, 'lunch' as const, 'dinner' as const),
        fc.record({
          orderStyle: fc.constantFrom(...DINING_ORDER_STYLES),
          beverage: fc.constantFrom('water' as const, 'soft_drink' as const, 'specialty' as const),
          orderDessert: fc.boolean(),
          appetizersPerTable: fc.integer({ min: 0, max: 4 }),
          partyHasPassHolder: fc.boolean(),
          drinker: fc.boolean(),
        }),
        (menus, r, priceTier, mealPeriod, s) => {
          const location = loc({ menus: menus as MenuDTO[] | null, priceTier, groupedFacets: TS_FACETS, rule: r === null ? null : rule(r) });
          const settings = ctx({ ...s, alcoholDrinkerKeys: new Set(s.drinker ? [A1.key] : []) });
          const v = valueEntry(entry({ mealPeriod }), location, [A1, A2, C1, BABY], settings);
          expect(v.kind).toBe('meal');
          const m = meal(v);
          expect(m.diners.map((d) => d.key)).toEqual([A1.key, A2.key, C1.key]);
          for (const d of m.diners) {
            for (const n of [d.foodCents, d.foodNet, d.savingsCents]) {
              expect(Number.isSafeInteger(n)).toBe(true);
              expect(n).toBeGreaterThan(0);
            }
            for (const n of [d.extraNet, d.taxFood, d.taxExtra, d.tip]) {
              expect(Number.isSafeInteger(n)).toBe(true);
              expect(n).toBeGreaterThanOrEqual(0);
            }
          }
          const ph = valueEntry(entry({ kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', mealPeriod }), null, [A1, C1], settings);
          for (const d of meal(ph).diners) expect(d.foodNet).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: dining-plan-calculator, Property 14: Valuation is total and positive (child fallback)
  // Validates: Requirements 7.4
  it('Property 14: a child with no children\'s menu or child offer pays bpsOf(adult, childFallbackBps)', () => {
    fc.assert(
      fc.property(
        fc.array(pricedGroupArb(['Entrées', 'Burgers', 'Desserts', 'Bakery', 'Beer', 'Appetizers']), { maxLength: 4 }),
        fc.boolean(),
        fc.oneof(fc.constant(null), fc.constantFrom('$', '$$$')),
        fc.integer({ min: 1000, max: 10_000 }),
        (groups, offer, priceTier, childFallbackBps) => {
          const allGroups = offer ? [...groups, { name: 'Buffet', type: null, items: [{ name: 'Adult Buffet', price: '$52.00 per adult', priceCents: null }] }] : groups;
          const location = loc({ menus: allGroups.length > 0 ? [{ menuType: 'Dinner', groups: allGroups }] : null, priceTier });
          const v = valueEntry(entry(), location, [A1, C1], ctx({ config: { ...DINING_CONFIG_DEFAULTS, childFallbackBps } }));
          const adult = diner(v, A1.key);
          expect(diner(v, C1.key).foodCents).toBe(Math.max(1, bpsOf(adult.foodCents, childFallbackBps)));
          expect(diner(v, C1.key).basis).toBe(adult.basis);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: dining-plan-calculator, Property 37: Alcohol is not priced at a quick-service breakfast
  // Validates: Requirements 7.5
  it('Property 37: a drinker equals a non-drinker at quick-service breakfast, and pays entree + dessert + alcohol elsewhere', () => {
    fc.assert(
      fc.property(
        fc.array(centsArb, { minLength: 1, maxLength: 6 }),
        fc.array(centsArb, { maxLength: 4 }),
        fc.constantFrom('table_service' as const, 'quick_service' as const),
        fc.constantFrom('breakfast' as const, 'lunch' as const, 'dinner' as const),
        fc.constantFrom('water' as const, 'soft_drink' as const, 'specialty' as const),
        (entrees, alcohol, serviceType, mealPeriod, beverage) => {
          const menu: MenuDTO = {
            menuType: 'All Day',
            groups: [
              { name: 'Entrées', type: 'Entree', items: items(entrees) },
              ...(alcohol.length > 0 ? [{ name: 'Cocktails', type: 'Alcohol', items: items(alcohol) }] : []),
            ],
          };
          const location = loc({ menus: [menu], groupedFacets: serviceType === 'table_service' ? TS_FACETS : QS_FACETS });
          const v = valueEntry(entry({ mealPeriod }), location, [A1, A2], ctx({ beverage, orderDessert: false, alcoholDrinkerKeys: new Set([A1.key]) }));
          const drinker = diner(v, A1.key).foodCents;
          const sober = diner(v, A2.key).foodCents;
          if (serviceType === 'quick_service' && mealPeriod === 'breakfast') {
            expect(drinker).toBe(sober);
          } else {
            const sorted = [...alcohol].sort((a, b) => a - b);
            const alcoholPrice = sorted.length > 0 ? sorted[Math.ceil(sorted.length / 2) - 1]! : 1300;
            const beverageCents = { water: 0, soft_drink: 450, specialty: 750 }[beverage];
            expect(drinker).toBe(sober - beverageCents + alcoholPrice);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
