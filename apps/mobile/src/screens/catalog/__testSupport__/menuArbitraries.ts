/**
 * Shared `fast-check` arbitraries for the restaurant-menu-display feature's
 * mobile property tests (design.md → Testing Strategy → "Generators").
 *
 * A single `MenuDTO[]` generator produces menus with arbitrary menu types,
 * optional cuisine types (spanning `null`, absent, and non-empty), ordered
 * groups with arbitrary names, and ordered items with names and prices spanning
 * `null`, absent, empty string, and non-empty strings. Concentrating those edge
 * cases in the generators means the summary-derivation (Property 6) and the
 * future Menu_Screen render properties (Properties 7–9) all exercise empty
 * menus/groups, missing cuisine, missing/empty prices, and unicode strings
 * without hand-written example tests.
 *
 * This module lives outside `__tests__` on purpose: Jest's default `testMatch`
 * treats every file under a `__tests__` directory as a test suite, so a shared
 * support module must sit beside it (in `__testSupport__`) to be importable
 * without being run as an (empty) suite.
 */

import fc from 'fast-check';

import type { MenuDTO } from '@dwt/shared';

/** A label string spanning ASCII, whitespace-padded, empty, and unicode. */
const labelArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.string({ minLength: 1, maxLength: 24 }) },
  { weight: 2, arbitrary: fc.constantFrom('Dinner', 'Lunch', 'Breakfast', 'All Day', 'Brunch') },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constantFrom('  Dinner  ', 'Café', '寿司', 'Prix Fixe 🍽️') },
);

/** A cuisine type spanning a real value, explicit `null`, and absent. */
const cuisineTypeArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('Italian', 'American', 'Sushi', 'French') },
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<string | null | undefined>;

/** A price string spanning non-empty, empty, explicit `null`, and absent. */
const priceArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('$', '$12.99', '$3', 'Market Price', '€8,50') },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<string | null | undefined>;

/** A single menu item: a name plus an optional (verbatim) price string. */
const menuItemArb = fc.record(
  {
    name: labelArb,
    price: priceArb,
  },
  { requiredKeys: ['name'] },
) as fc.Arbitrary<MenuDTO['groups'][number]['items'][number]>;

/** A menu group: a name plus an ordered (possibly empty) list of items. */
const menuGroupArb: fc.Arbitrary<MenuDTO['groups'][number]> = fc.record({
  name: labelArb,
  items: fc.array(menuItemArb, { maxLength: 5 }),
});

/**
 * A well-formed `MenuDTO`: a menu type, an optional cuisine type, and an ordered
 * (possibly empty) list of groups.
 */
export const menuDtoArb: fc.Arbitrary<MenuDTO> = fc.record(
  {
    menuType: labelArb,
    cuisineType: cuisineTypeArb,
    groups: fc.array(menuGroupArb, { maxLength: 4 }),
  },
  { requiredKeys: ['menuType', 'groups'] },
) as fc.Arbitrary<MenuDTO>;

/** An ordered list of menus, possibly empty. */
export const menuListArb: fc.Arbitrary<readonly MenuDTO[]> = fc.array(menuDtoArb, {
  maxLength: 6,
});

/** An ordered, guaranteed non-empty list of menus. */
export const nonEmptyMenuListArb: fc.Arbitrary<readonly MenuDTO[]> = fc.array(menuDtoArb, {
  minLength: 1,
  maxLength: 6,
});
