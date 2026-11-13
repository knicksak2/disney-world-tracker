/**
 * Menu selection for the `menu_items` basis (Requirements 7.2, 7.3, 7.4).
 *
 * `menusForPeriod` keeps the menus of a Meal_Period; `groupCents` returns the ascending priced items of one group class.
 * Both read the cached upstream menu JSON defensively: a malformed menu, group or item is skipped, never thrown on.
 */

import {
  classifyMenuGroup,
  menuGroupItemCents,
  type DiningMealPeriod,
  type MenuDTO,
  type MenuGroupClass,
  type MenuItemDTO,
} from '@dwt/shared';

import type { DiningAudience } from './types.js';

const ALL_DAY_REGEX = /all[\s-]?day/i;

function menuList(menus: readonly MenuDTO[] | null | undefined): MenuDTO[] {
  if (!Array.isArray(menus)) return [];
  return menus.filter((m): m is MenuDTO => m !== null && typeof m === 'object');
}

/**
 * Menus whose `menuType` contains the Meal_Period (case-insensitive) or "all day"; all menus when none match
 * (Requirement 7.3).
 */
export function menusForPeriod(menus: readonly MenuDTO[] | null | undefined, period: DiningMealPeriod): MenuDTO[] {
  const all = menuList(menus);
  const matching = all.filter((m) => {
    const type = typeof m.menuType === 'string' ? m.menuType.toLowerCase() : '';
    return type.includes(period) || ALL_DAY_REGEX.test(type);
  });
  return matching.length > 0 ? matching : all;
}

/**
 * The group class an audience reads for `cls`. Entrees are audience-specific: a child reads the `kids` groups only and
 * an adult reads the `entree` groups and never `kids` (Requirement 7.4). Desserts, appetizers and drinks are shared.
 */
function classFor(cls: MenuGroupClass, audience: DiningAudience): MenuGroupClass | null {
  if (cls === 'entree' || cls === 'kids') return audience === 'child' ? 'kids' : cls === 'entree' ? 'entree' : null;
  return cls;
}

/**
 * The priced items of every group of class `cls` (as read by `audience`), as an ascending list of positive integer
 * cents. An item's cents come from `menuGroupItemCents` (its `priceCents`, else the mean of its variants, else its
 * parsed price string); unpriced items are left out.
 */
export function groupCents(
  menus: readonly MenuDTO[] | null | undefined,
  cls: MenuGroupClass,
  audience: DiningAudience,
): number[] {
  const wanted = classFor(cls, audience);
  if (wanted === null) return [];
  const cents: number[] = [];
  for (const menu of menuList(menus)) {
    if (!Array.isArray(menu.groups)) continue;
    for (const group of menu.groups) {
      if (group === null || typeof group !== 'object' || !Array.isArray(group.items)) continue;
      if (classifyMenuGroup(group) !== wanted) continue;
      for (const item of group.items) {
        if (item === null || typeof item !== 'object') continue;
        const c = itemCents(item);
        if (c !== null && Number.isSafeInteger(c) && c > 0) cents.push(c);
      }
    }
  }
  return cents.sort((a, b) => a - b);
}

/**
 * `menuGroupItemCents` reads `item.prices` as an array of `{ cents }`; a cached item whose `prices` is a string, or
 * holds a null entry, makes it throw. Such an item counts as unpriced.
 */
function itemCents(item: MenuItemDTO): number | null {
  try {
    return menuGroupItemCents(item);
  } catch {
    return null;
  }
}
