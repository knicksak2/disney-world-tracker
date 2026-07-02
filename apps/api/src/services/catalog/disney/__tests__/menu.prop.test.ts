// Feature: disney-facilities-catalog-source, Property 15: Menu persistence round-trips the full menu structure
/**
 * Property-based tests for `projectMenus` (design.md → "7. Menu retrieval and
 * projection").
 *
 * Validates: Requirements 8.2, 8.3, 8.5
 *
 * Property 15 (design): *For any* set of menus returned by the Menu_Service,
 * projecting, persisting, and reading them back yields the same per-menu type
 * and cuisine type and, per group, the same group name, item names, and item
 * price strings that the App receives through the menu DTO; and when no menus
 * are returned, no menu is persisted.
 *
 * `projectMenus` is the pure core of that pipeline: it converts the raw
 * Menu_Service payload into the `MenuDTO[]` that is persisted verbatim to the
 * `experience_menus` JSONB column (design → schema) and served back to the App
 * through `getMenusFor` (R8.5). Because persistence is a verbatim JSONB
 * round-trip, projecting a "clean" raw payload (one whose fields are already
 * strings) must reproduce that payload's type, cuisine type, group names, item
 * names, and price strings exactly — the DTO the App receives carries the same
 * structure the Menu_Service returned (R8.2). Empty input yields an empty
 * projection, so no menu is persisted (R8.3).
 *
 * The generator produces "clean" raw menus (every string field present and
 * already a string) so that the projection is expected to be a structural
 * identity. This lets the test assert exact round-trip equality of the full
 * menu structure rather than re-deriving the projection's defaulting rules.
 * A separate totality property drives fully-arbitrary (possibly malformed)
 * payloads to assert `projectMenus` never throws and always yields a
 * well-formed DTO.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { MenuDTO } from '@dwt/shared';

import { projectMenus, type RawMenu } from '../menu.js';

const NUM_RUNS = 100;

/**
 * A "clean" raw menu whose every string field is present and already a string.
 * Projecting such a payload is a structural identity, which is what lets the
 * round-trip property assert exact equality of the full menu structure.
 *
 * `cuisineType` is optional in the raw payload; when omitted the projection
 * normalizes it to `null`, so the generator either supplies a string or omits
 * the field, and the oracle accounts for the `null` default below.
 */
const cleanRawItemArb: fc.Arbitrary<{ name: string; price: string }> = fc.record({
  name: fc.string(),
  price: fc.string(),
});

const cleanRawGroupArb: fc.Arbitrary<{ name: string; items: { name: string; price: string }[] }> =
  fc.record({
    name: fc.string(),
    items: fc.array(cleanRawItemArb, { maxLength: 6 }),
  });

const cleanRawMenuArb: fc.Arbitrary<RawMenu> = fc
  .record({
    menuType: fc.string(),
    cuisineType: fc.string(),
    groups: fc.array(cleanRawGroupArb, { maxLength: 5 }),
    includeCuisine: fc.boolean(),
  })
  .map(({ menuType, cuisineType, groups, includeCuisine }) =>
    includeCuisine ? { menuType, cuisineType, groups } : { menuType, groups },
  );

/**
 * Build the expected DTO from a clean raw menu, mirroring the only
 * normalization the projection applies to clean input: an absent `cuisineType`
 * becomes `null`. All other fields carry through verbatim.
 */
function expectedFromClean(raw: RawMenu): MenuDTO {
  return {
    menuType: raw.menuType as string,
    cuisineType: raw.cuisineType ?? null,
    groups: (raw.groups ?? []).map((group) => ({
      name: (group as { name: string }).name,
      items: ((group as { items: { name: string; price: string }[] }).items ?? []).map((item) => ({
        name: item.name,
        price: item.price,
      })),
    })),
  };
}

describe('projectMenus — Property 15: menu structure round-trips', () => {
  it('preserves menu type, cuisine type, group names, item names, and price strings verbatim (R8.2, R8.5)', () => {
    fc.assert(
      fc.property(fc.array(cleanRawMenuArb, { maxLength: 6 }), (rawMenus) => {
        const projected = projectMenus(rawMenus);
        const expected = rawMenus.map(expectedFromClean);
        expect(projected).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries price strings through verbatim, including whitespace and non-numeric text (R8.2)', () => {
    fc.assert(
      fc.property(cleanRawMenuArb, (rawMenu) => {
        const projected = projectMenus([rawMenu])[0];
        expect(projected).toBeDefined();
        if (projected === undefined) return;
        const rawGroups = rawMenu.groups ?? [];
        projected.groups.forEach((group, gi) => {
          const rawGroup = rawGroups[gi] as { items: { price: string }[] };
          group.items.forEach((item, ii) => {
            const rawItem = rawGroup.items[ii];
            expect(rawItem).toBeDefined();
            // The exact upstream price string is preserved with no trim/reformat.
            expect(item.price).toBe(rawItem?.price);
          });
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('empty input yields an empty projection, so no menu is persisted (R8.3)', () => {
    expect(projectMenus([])).toEqual([]);
  });
});

describe('projectMenus — totality over arbitrary/malformed payloads', () => {
  /**
   * Arbitrary that may inject `null`/`undefined` entries and non-string field
   * values to exercise the projection's defensive defaulting. It intentionally
   * models the untyped JSON boundary, so values are cast at the call site.
   */
  const messyValueArb = fc.oneof(
    fc.string(),
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.boolean(),
  );

  const messyItemArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.record({ name: messyValueArb, price: messyValueArb }, { requiredKeys: [] }),
  );

  const messyGroupArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.record(
      { name: messyValueArb, items: fc.oneof(fc.constant(null), fc.array(messyItemArb, { maxLength: 5 })) },
      { requiredKeys: [] },
    ),
  );

  const messyMenuArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.record(
      {
        menuType: messyValueArb,
        cuisineType: messyValueArb,
        groups: fc.oneof(fc.constant(null), fc.array(messyGroupArb, { maxLength: 5 })),
      },
      { requiredKeys: [] },
    ),
  );

  it('never throws and always yields a well-formed DTO for any payload', () => {
    fc.assert(
      fc.property(fc.array(messyMenuArb, { maxLength: 6 }), (rawMenus) => {
        // Cast models the undocumented, untyped Menu_Service JSON boundary.
        const projected = projectMenus(rawMenus as readonly RawMenu[]);

        for (const menu of projected) {
          expect(typeof menu.menuType).toBe('string');
          expect(menu.cuisineType === null || typeof menu.cuisineType === 'string').toBe(true);
          expect(Array.isArray(menu.groups)).toBe(true);
          for (const group of menu.groups) {
            expect(typeof group.name).toBe('string');
            expect(Array.isArray(group.items)).toBe(true);
            for (const item of group.items) {
              expect(typeof item.name).toBe('string');
              expect(item.price === null || typeof item.price === 'string').toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('projectMenus — fixed regression examples', () => {
  it('projects a full menu preserving all fields verbatim (R8.2)', () => {
    const raw: RawMenu[] = [
      {
        menuType: 'Dinner',
        cuisineType: 'American',
        groups: [
          {
            name: 'Appetizers',
            items: [
              { name: 'Soup', price: '$8.00' },
              { name: 'Salad', price: 'Market Price' },
            ],
          },
        ],
      },
    ];
    expect(projectMenus(raw)).toEqual([
      {
        menuType: 'Dinner',
        cuisineType: 'American',
        groups: [
          {
            name: 'Appetizers',
            items: [
              { name: 'Soup', price: '$8.00' },
              { name: 'Salad', price: 'Market Price' },
            ],
          },
        ],
      },
    ]);
  });

  it('defaults an absent cuisine type to null while preserving the rest (R8.2)', () => {
    const raw: RawMenu[] = [{ menuType: 'All Day', groups: [] }];
    expect(projectMenus(raw)).toEqual([{ menuType: 'All Day', cuisineType: null, groups: [] }]);
  });
});
