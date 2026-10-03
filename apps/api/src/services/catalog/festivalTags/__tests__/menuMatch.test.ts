/**
 * Unit tests for `menuMatchesFestival`.
 *
 * Validates: Requirements 3.8, 3.9
 */

import { describe, expect, it } from 'vitest';
import type { MenuDTO } from '@dwt/shared';

import { festivalMatchingItemNames, menuMatchesFestival } from '../menuMatch.js';

function menu(groupNames: readonly string[]): MenuDTO {
  return {
    menuType: 'Lunch And Dinner',
    cuisineType: null,
    groups: groupNames.map((name) => ({ name, items: [] })),
  };
}

describe('menuMatchesFestival', () => {
  it('matches the "Food & Wine Festival" ampersand/plural variant', () => {
    const menus = [menu(['Food & Wine Festival Food Offerings'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(true);
  });

  it('matches the "Food and Wine Festival" spelled-out/singular variant', () => {
    const menus = [menu(['Food and Wine Festival Beverage Offering'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(true);
  });

  it('matches "Food & Wine Festival Alcoholic Beverage Offerings"', () => {
    const menus = [menu(['Food & Wine Festival Alcoholic Beverage Offerings'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(true);
  });

  it('matches across multiple menus/groups, not just the first', () => {
    const menus = [
      menu(['Entrees', 'Beverages']),
      menu(['Desserts', 'Food & Wine Festival Food Offerings']),
    ];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(true);
  });

  it('does not match a Flower & Garden-keyworded group for food-and-wine (R3.9)', () => {
    const menus = [menu(['Flower & Garden Festival Food Offerings'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(false);
  });

  it('matches the Flower & Garden group when checking flower-and-garden', () => {
    const menus = [menu(['Flower & Garden Festival Food Offerings'])];
    expect(menuMatchesFestival(menus, 'flower-and-garden')).toBe(true);
  });

  it('matches "Festival of the Arts" named groups', () => {
    const menus = [menu(['Festival of the Arts Food Offerings'])];
    expect(menuMatchesFestival(menus, 'festival-of-the-arts')).toBe(true);
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(false);
  });

  it('matches "Festival of the Holidays" named groups', () => {
    const menus = [menu(['Festival of the Holidays Food Offerings'])];
    expect(menuMatchesFestival(menus, 'festival-of-the-holidays')).toBe(true);
    expect(menuMatchesFestival(menus, 'festival-of-the-arts')).toBe(false);
  });

  it('returns false for an empty menus array', () => {
    expect(menuMatchesFestival([], 'food-and-wine')).toBe(false);
  });

  it('returns false for menus with no matching group name', () => {
    const menus = [menu(['Entrees', 'Desserts', 'Beverages'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(false);
  });

  it('returns false for a menu with no groups at all', () => {
    const menus = [menu([])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(false);
  });

  it('is case-insensitive', () => {
    const menus = [menu(['FOOD & WINE FESTIVAL food offerings'])];
    expect(menuMatchesFestival(menus, 'food-and-wine')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// festivalMatchingItemNames (festival-booth-tagging R10.1)
// ---------------------------------------------------------------------------

function menuWithGroups(
  groups: readonly { readonly name: string; readonly items: readonly string[] }[],
): MenuDTO {
  return {
    menuType: 'Lunch And Dinner',
    cuisineType: null,
    groups: groups.map((g) => ({
      name: g.name,
      items: g.items.map((name) => ({ name })),
    })),
  };
}

describe('festivalMatchingItemNames', () => {
  it('returns exactly the item names inside a matching group', () => {
    const menus = [
      menuWithGroups([
        {
          name: 'Food & Wine Festival Food Offerings',
          items: ['Plant-based Falafel Wrap', 'Chermoula Chicken Hummus Bowl'],
        },
        { name: 'Entrees', items: ['Steak Frites'] },
      ]),
    ];
    const names = festivalMatchingItemNames(menus, 'food-and-wine');
    expect(names).toEqual(['Plant-based Falafel Wrap', 'Chermoula Chicken Hummus Bowl']);
  });

  it('collects matching items across multiple matching groups and menus', () => {
    const menus = [
      menuWithGroups([
        { name: 'Food & Wine Festival Food Offerings', items: ['Falafel Wrap'] },
      ]),
      menuWithGroups([
        { name: 'Food & Wine Festival Alcoholic Beverage Offerings', items: ['Fig Cocktail'] },
      ]),
    ];
    const names = festivalMatchingItemNames(menus, 'food-and-wine');
    expect(names).toEqual(['Falafel Wrap', 'Fig Cocktail']);
  });

  it('dedupes by case-insensitive trimmed name', () => {
    const menus = [
      menuWithGroups([
        {
          name: 'Food & Wine Festival Food Offerings',
          items: [' Falafel Wrap ', 'falafel wrap', 'FALAFEL WRAP'],
        },
      ]),
    ];
    const names = festivalMatchingItemNames(menus, 'food-and-wine');
    expect(names).toEqual(['Falafel Wrap']);
  });

  it('returns empty for no matching group', () => {
    const menus = [menuWithGroups([{ name: 'Entrees', items: ['Steak Frites'] }])];
    expect(festivalMatchingItemNames(menus, 'food-and-wine')).toEqual([]);
  });

  it('returns empty for empty menus', () => {
    expect(festivalMatchingItemNames([], 'food-and-wine')).toEqual([]);
  });

  it('does not include items from a different festival\'s matching group', () => {
    const menus = [
      menuWithGroups([
        { name: 'Flower & Garden Festival Food Offerings', items: ['Frushi'] },
      ]),
    ];
    expect(festivalMatchingItemNames(menus, 'food-and-wine')).toEqual([]);
    expect(festivalMatchingItemNames(menus, 'flower-and-garden')).toEqual(['Frushi']);
  });

  it('skips an item whose name is empty after trimming', () => {
    const menus = [
      menuWithGroups([
        { name: 'Food & Wine Festival Food Offerings', items: ['Falafel Wrap', '   '] },
      ]),
    ];
    expect(festivalMatchingItemNames(menus, 'food-and-wine')).toEqual(['Falafel Wrap']);
  });
});
