import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { MenuDTO, MenuGroupClass } from '@dwt/shared';

import { groupCents, menusForPeriod } from '../menuSelect.js';

function menu(menuType: string, groups: MenuDTO['groups'] = []): MenuDTO {
  return { menuType, cuisineType: 'American', groups };
}

// A table-service dinner menu in the shape the Menu_Service caches.
const DINNER: MenuDTO = menu('Dinner', [
  {
    name: 'Appetizers',
    type: 'Appetizer',
    items: [
      { name: 'Charcuterie', price: '$21.00', priceCents: 2100 },
      { name: 'Soup du Jour', price: null, priceCents: null },
    ],
  },
  {
    name: 'Entrées',
    type: 'Entree',
    items: [
      { name: 'Filet Mignon', price: '$56.00', priceCents: 5600 },
      { name: 'Seared Scallops', price: '$42.00' },
      {
        name: 'Market Fish',
        price: '$38.00 / $46.00',
        prices: [
          { cents: 3800, label: 'Lunch portion' },
          { cents: 4600, label: 'Dinner portion' },
        ],
      },
      { name: 'Chef Selection', price: 'Market Price' },
    ],
  },
  {
    name: "Kids' Entrées",
    type: 'Kids',
    items: [
      { name: 'Grilled Chicken', price: '$14.00', priceCents: 1400 },
      { name: 'Mac & Cheese', price: '$12.00', priceCents: 1200 },
    ],
  },
  {
    name: 'Desserts',
    type: 'Dessert',
    items: [{ name: 'Crème Brûlée', price: '$12.00', priceCents: 1200 }],
  },
  {
    name: 'Non-Alcoholic Beverages',
    type: 'Beverage',
    items: [{ name: 'Fountain Soda', price: '$4.79', priceCents: 479 }],
  },
  {
    name: 'Wine by the Glass',
    type: 'Alcohol',
    items: [
      { name: 'Cabernet', price: '$16.00', priceCents: 1600 },
      { name: 'Prosecco', price: '$14.00', priceCents: 1400 },
    ],
  },
]);

describe('menusForPeriod', () => {
  const breakfast = menu('Breakfast');
  const lunch = menu('Lunch');
  const dinner = menu('Dinner');
  const allDay = menu('All Day');

  it('keeps the menus of the meal period plus all-day menus', () => {
    expect(menusForPeriod([breakfast, lunch, dinner, allDay], 'dinner')).toEqual([dinner, allDay]);
    expect(menusForPeriod([breakfast, lunch, dinner], 'lunch')).toEqual([lunch]);
    expect(menusForPeriod([breakfast, lunch, dinner], 'breakfast')).toEqual([breakfast]);
  });

  it('matches case-insensitively and by containment', () => {
    const characterDinner = menu('CHARACTER DINNER');
    const lunchAndDinner = menu('Lunch and Dinner');
    const allDayHyphen = menu('all-day dining');
    expect(menusForPeriod([characterDinner, lunchAndDinner, breakfast], 'dinner')).toEqual([characterDinner, lunchAndDinner]);
    expect(menusForPeriod([lunchAndDinner, allDayHyphen, breakfast], 'lunch')).toEqual([lunchAndDinner, allDayHyphen]);
  });

  it('falls back to every menu when none matches the meal period', () => {
    const snacks = menu('Snacks');
    const brunch = menu('Brunch');
    expect(menusForPeriod([snacks, brunch], 'dinner')).toEqual([snacks, brunch]);
    expect(menusForPeriod([lunch], 'breakfast')).toEqual([lunch]);
  });

  it('returns [] for no menus or a malformed list', () => {
    expect(menusForPeriod(null, 'dinner')).toEqual([]);
    expect(menusForPeriod([], 'dinner')).toEqual([]);
    expect(menusForPeriod('dinner' as unknown as MenuDTO[], 'dinner')).toEqual([]);
    expect(menusForPeriod([null, menu('Dinner')] as unknown as MenuDTO[], 'dinner')).toEqual([menu('Dinner')]);
  });
});

describe('groupCents', () => {
  it('lists adult entrees ascending, with a variant item at its mean and a parsed price string, skipping unpriced', () => {
    // Market Fish = mean(3800, 4600) = 4200; Seared Scallops parsed from "$42.00"; "Market Price" is unpriced.
    expect(groupCents([DINNER], 'entree', 'adult')).toEqual([4200, 4200, 5600]);
  });

  it('reads only the kids groups for a child entree, and never the kids groups for an adult', () => {
    expect(groupCents([DINNER], 'entree', 'child')).toEqual([1200, 1400]);
    expect(groupCents([DINNER], 'kids', 'child')).toEqual([1200, 1400]);
    expect(groupCents([DINNER], 'kids', 'adult')).toEqual([]);
    expect(groupCents([DINNER], 'entree', 'adult')).not.toContain(1400);
  });

  it('returns [] for a child when the menu has no kids group', () => {
    const adultOnly = menu('Dinner', DINNER.groups.filter((g) => g.type !== 'Kids'));
    expect(groupCents([adultOnly], 'entree', 'child')).toEqual([]);
  });

  it('shares desserts, appetizers and drinks across audiences', () => {
    expect(groupCents([DINNER], 'dessert', 'adult')).toEqual([1200]);
    expect(groupCents([DINNER], 'dessert', 'child')).toEqual([1200]);
    expect(groupCents([DINNER], 'appetizer', 'adult')).toEqual([2100]);
    expect(groupCents([DINNER], 'beverage', 'adult')).toEqual([479]);
  });

  it('keeps alcohol groups out of entrees and lists them on their own', () => {
    expect(groupCents([DINNER], 'alcohol', 'adult')).toEqual([1400, 1600]);
    expect(groupCents([DINNER], 'entree', 'adult')).not.toContain(1600);
    const cocktailsAsMains = menu('Dinner', [
      { name: 'Signature Cocktails', type: 'Main', items: [{ name: 'Old Fashioned', priceCents: 1800 }] },
    ]);
    expect(groupCents([cocktailsAsMains], 'entree', 'adult')).toEqual([]);
    expect(groupCents([cocktailsAsMains], 'alcohol', 'adult')).toEqual([1800]);
  });

  it('merges groups of one class across several menus', () => {
    const lunch = menu('Lunch', [{ name: 'Entrées', type: 'Entree', items: [{ name: 'Burger', priceCents: 2300 }] }]);
    expect(groupCents([DINNER, lunch], 'entree', 'adult')).toEqual([2300, 4200, 4200, 5600]);
  });

  it('skips malformed menus, groups and items without throwing', () => {
    const malformed = [
      null,
      { menuType: 'Dinner' },
      { menuType: 'Dinner', groups: 'none' },
      { menuType: 'Dinner', groups: [null, { name: 'Entrées' }, { name: 'Entrées', items: 'x' }] },
      { menuType: 'Dinner', groups: [{ name: 'Entrées', type: 'Entree', items: [null, { name: 'Free', priceCents: 0 }, { name: 'Steak', priceCents: 4000 }] }] },
      // `prices` that is a string, or holds a null entry, makes the shared helper throw; the item counts as unpriced.
      { menuType: 'Dinner', groups: [{ name: 'Entrées', type: 'Entree', items: [{ name: 'Odd', prices: 'two' }, { name: 'Odder', prices: [null] }] }] },
    ] as unknown as MenuDTO[];
    expect(groupCents(malformed, 'entree', 'adult')).toEqual([4000]);
    expect(groupCents(null, 'entree', 'adult')).toEqual([]);
  });

  // Feature: dining-plan-calculator, Property 14: Valuation is total and positive (menu selection half)
  // Validates: Requirements 7.2, 7.3, 7.8
  it('Property 14: for any menu shape, groupCents returns ascending positive integers and never throws', () => {
    const itemArb = fc.record(
      {
        name: fc.string(),
        price: fc.oneof(fc.constant(null), fc.constantFrom('$12.99', '$0.00', 'Market Price', '$8 / $10'), fc.string()),
        priceCents: fc.oneof(fc.constant(null), fc.integer({ min: -500, max: 20_000 }), fc.double()),
        prices: fc.oneof(
          fc.array(fc.record({ cents: fc.integer({ min: -100, max: 9_000 }), label: fc.constant(null) }), { maxLength: 3 }),
          fc.constantFrom('$12.00', [null], [{ cents: '1200' }]),
          fc.anything(),
        ),
      },
      { requiredKeys: ['name'] },
    );
    const groupArb = fc.oneof(
      fc.record({
        name: fc.constantFrom('Entrées', 'Kids Menu', 'Desserts', 'Beer', 'Beverages', 'Sides', 'Starters'),
        type: fc.option(fc.constantFrom('Entree', 'Kids', 'Dessert', 'Alcohol'), { nil: null }),
        items: fc.array(itemArb, { maxLength: 5 }),
      }),
      fc.anything(),
    );
    const menusArb = fc.oneof(
      fc.array(fc.record({ menuType: fc.constantFrom('Dinner', 'Lunch', 'All Day', 'Snacks'), groups: fc.array(groupArb, { maxLength: 5 }) })),
      fc.anything(),
    );
    const clsArb = fc.constantFrom<MenuGroupClass>('entree', 'kids', 'dessert', 'appetizer', 'beverage', 'alcohol', 'other');
    fc.assert(
      fc.property(menusArb, clsArb, fc.constantFrom('adult' as const, 'child' as const), (menus, cls, audience) => {
        const list = groupCents(menus as MenuDTO[], cls, audience);
        for (let i = 0; i < list.length; i += 1) {
          expect(Number.isSafeInteger(list[i])).toBe(true);
          expect(list[i]).toBeGreaterThan(0);
          if (i > 0) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1]!);
        }
        expect(Array.isArray(menusForPeriod(menus as MenuDTO[], 'dinner'))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
