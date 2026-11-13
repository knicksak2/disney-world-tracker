/**
 * `classifyMenuGroup` and `menuGroupItemCents` (dining-plan-calculator task 1.2).
 *
 * Validates: Requirements 7.2, 7.4, 24.4
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyMenuGroup, menuGroupItemCents, type MenuGroupClass, type MenuItemDTO } from '../index.js';

describe('classifyMenuGroup', () => {
  it.each<[string | null, string | null, MenuGroupClass]>([
    ["Kids' Menu", null, 'kids'],
    ['Children', 'Entree', 'kids'],
    ['Desserts', null, 'dessert'],
    ['Sweet Treats', null, 'dessert'],
    ['Appetizers', null, 'appetizer'],
    ['Starters', null, 'appetizer'],
    ['Small Plates', null, 'appetizer'],
    ['Shareables', null, 'appetizer'],
    ['Beer & Wine', 'Alcohol', 'alcohol'],
    ['Specialty Cocktails', null, 'alcohol'],
    ['Spirits', null, 'alcohol'],
    ['Beverages', null, 'beverage'],
    ['Non-Alcoholic Drinks', null, 'beverage'],
    ['Coffee & Tea', null, 'beverage'],
    ['Main Courses', null, 'entree'],
    ['Entrées', null, 'entree'],
    ['Sandwiches & Burgers', null, 'entree'],
    ['Steaks', null, 'entree'],
    ['Sides', null, 'other'],
    ['Soups & Salads', null, 'other'],
    ['', null, 'other'],
    [null, null, 'other'],
  ])('%s (type %s) is %s', (name, type, expected) => {
    expect(classifyMenuGroup({ name, type })).toBe(expected);
  });

  it('reads the type as well as the name', () => {
    expect(classifyMenuGroup({ name: 'House Specials', type: 'Alcohol' })).toBe('alcohol');
    expect(classifyMenuGroup({ name: 'Featured', type: 'Dessert' })).toBe('dessert');
  });

  it('applies the precedence alcohol, kids, dessert, appetizer, beverage, entree', () => {
    expect(classifyMenuGroup({ name: 'Kids Desserts' })).toBe('kids');
    expect(classifyMenuGroup({ name: 'Dessert Wines' })).toBe('alcohol');
    expect(classifyMenuGroup({ name: 'Dessert Starters' })).toBe('dessert');
    expect(classifyMenuGroup({ name: 'Appetizer Platter' })).toBe('appetizer');
    expect(classifyMenuGroup({ name: 'Drinks and Burgers' })).toBe('beverage');
  });

  it('does not treat alcohol-free drinks as alcohol', () => {
    expect(classifyMenuGroup({ name: 'Mocktails' })).toBe('beverage');
    expect(classifyMenuGroup({ name: 'Zero-Proof Drinks' })).toBe('beverage');
    expect(classifyMenuGroup({ name: 'Specialty', type: 'Non-Alcoholic Beverage' })).toBe('beverage');
    expect(classifyMenuGroup({ name: 'Wine & Non-Alcoholic Drinks' })).toBe('alcohol'); // a real alcohol word remains
  });

  it('does not mistake a steak group for tea (word match)', () => {
    expect(classifyMenuGroup({ name: 'Steakhouse Classics' })).toBe('entree');
    expect(classifyMenuGroup({ name: 'Afternoon Teas' })).toBe('beverage');
  });
});

describe('menuGroupItemCents', () => {
  const item = (over: Partial<MenuItemDTO>): MenuItemDTO => ({ name: 'Item', ...over }) as MenuItemDTO;

  it('uses priceCents first', () => {
    expect(menuGroupItemCents(item({ priceCents: 2899, price: '$10.00' }))).toBe(2899);
  });

  it('uses the rounded mean of the variant prices next', () => {
    expect(
      menuGroupItemCents(
        item({
          prices: [
            { cents: 1000, label: 'Small' },
            { cents: 1501, label: 'Large' },
          ],
        }),
      ),
    ).toBe(1251);
  });

  it('parses the price string last', () => {
    expect(menuGroupItemCents(item({ price: '$24.50' }))).toBe(2450);
  });

  it('returns null for an unpriced item and for a zero price', () => {
    expect(menuGroupItemCents(item({}))).toBeNull();
    expect(menuGroupItemCents(item({ priceCents: 0 }))).toBeNull();
    expect(menuGroupItemCents(item({ price: '$0.00' }))).toBeNull();
  });
});

describe('properties', () => {
  const CLASSES: MenuGroupClass[] = ['entree', 'kids', 'dessert', 'appetizer', 'beverage', 'alcohol', 'other'];

  it('classifyMenuGroup is total over arbitrary strings', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), fc.option(fc.string(), { nil: null }), (name, type) => {
        expect(CLASSES).toContain(classifyMenuGroup({ name, type }));
      }),
      { numRuns: 200 },
    );
  });

  it('menuGroupItemCents returns null or a positive safe integer', () => {
    fc.assert(
      fc.property(
        fc.record({
          priceCents: fc.option(fc.oneof(fc.integer(), fc.double()), { nil: undefined }),
          price: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
          prices: fc.option(fc.array(fc.record({ cents: fc.oneof(fc.integer(), fc.double()), label: fc.constant(null) }), { maxLength: 4 }), {
            nil: undefined,
          }),
        }),
        (fields) => {
          const out = menuGroupItemCents({ name: 'x', ...fields } as unknown as MenuItemDTO);
          if (out !== null) {
            expect(Number.isSafeInteger(out)).toBe(true);
            expect(out).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
