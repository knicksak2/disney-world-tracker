// Feature: restaurant-menu-display — shared MenuDTO fast-check arbitraries.
//
// These generators back the Menu_Screen render property tests (design
// Properties 7, 8, 9). A single arbitrary produces `MenuDTO[]` values whose
// menuType, group names, and item names are always non-empty (so render
// assertions can locate them by text), while the *optional* fields deliberately
// span every edge case the design calls out:
//
//   - `cuisineType`  → absent | null | ''  | non-empty string
//   - item `price`   → absent | null | ''  | non-empty string
//
// This module lives in `__testSupport__` (not `__tests__`) on purpose: Jest's
// default `testMatch` treats every file under a `__tests__` directory as a test
// suite, so a shared support module must sit beside it to be importable without
// being run as an (empty) suite.
//
// The "absent" case is produced by `fc.record(..., { requiredKeys: [...] })`,
// which *omits* the key entirely on some samples rather than setting it to
// `undefined`. This matters under the workspace tsconfig's
// `exactOptionalPropertyTypes`: an explicit `{ cuisineType: undefined }` is not
// assignable to the exact-optional `cuisineType?: string | null` field, so the
// generated value must omit the key instead of carrying `undefined`. This
// mirrors the pattern in `__testSupport__/menuArbitraries.ts`.
//
// Menus, groups, and items may all be empty arrays, so completeness/order
// assertions must tolerate zero-length collections. Names are non-empty and use
// a small unicode-inclusive alphabet so ordering can be asserted by content.

import fc from 'fast-check';

import type { MenuDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Concrete element types (mirror MenuDTO's nested readonly shapes)
// ---------------------------------------------------------------------------

export type MenuItem = MenuDTO['groups'][number]['items'][number];
export type MenuGroup = MenuDTO['groups'][number];

// ---------------------------------------------------------------------------
// Building-block arbitraries
// ---------------------------------------------------------------------------

/**
 * A non-empty label. Includes ASCII, whitespace-bearing, and unicode strings so
 * name rendering is exercised across scripts, while guaranteeing at least one
 * character so `getByText` can always locate the node.
 */
const nonEmptyLabel: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/**
 * The *present* values an optional string field can take: explicit `null`, an
 * empty string, or a non-empty string. The fourth shape the DTO allows — the
 * field being absent entirely — is produced by omitting the key via
 * `requiredKeys` on the enclosing record, not by generating `undefined` here
 * (see the module header on `exactOptionalPropertyTypes`).
 */
const presentOptionalString: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  nonEmptyLabel,
);

const itemArb: fc.Arbitrary<MenuItem> = fc.record(
  {
    name: nonEmptyLabel,
    price: presentOptionalString,
  },
  { requiredKeys: ['name'] },
);

const groupArb: fc.Arbitrary<MenuGroup> = fc.record({
  name: nonEmptyLabel,
  items: fc.array(itemArb, { maxLength: 4 }),
});

export const menuArb: fc.Arbitrary<MenuDTO> = fc.record(
  {
    menuType: nonEmptyLabel,
    cuisineType: presentOptionalString,
    groups: fc.array(groupArb, { maxLength: 4 }),
  },
  { requiredKeys: ['menuType', 'groups'] },
);

/** A list of menus, possibly empty, as carried on the detail response. */
export const menuListArb: fc.Arbitrary<MenuDTO[]> = fc.array(menuArb, {
  maxLength: 4,
});

/** A guaranteed non-empty list of menus, for properties that require ≥ 1 menu. */
export const nonEmptyMenuListArb: fc.Arbitrary<MenuDTO[]> = fc.array(menuArb, {
  minLength: 1,
  maxLength: 4,
});
