// Feature: trip-budget, Property 8: Menu projection stays additive and verbatim
/**
 * Property 8 (design.md):
 * For any RawMenu[] without the new optional fields, projectMenus returns
 * output deep-equal to its pre-change output (no new keys); for any input with them,
 * each new field is present only when valid, price strings are unchanged, and each
 * prices[].cents equals Math.round(withoutTax * 100) of a finite positive USD entry;
 * priceCents is set exactly when there is one such entry.
 *
 * Validates: Requirements 10.5, 10.6
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { menuDtoSchema } from '@dwt/shared';
import { projectMenus } from '../disney/menu.js';

const NUM_RUNS = 100;

/** Arbitrary for legacy clean items without new optional fields. */
const legacyRawItemArb = fc.record({
  name: fc.string(),
  price: fc.string(),
});

const legacyRawGroupArb = fc.record({
  name: fc.string(),
  items: fc.array(legacyRawItemArb, { maxLength: 5 }),
});

const legacyRawMenuArb = fc.record({
  menuType: fc.string(),
  cuisineType: fc.oneof(fc.string(), fc.constant(null)),
  groups: fc.array(legacyRawGroupArb, { maxLength: 4 }),
});

/** Arbitrary for raw price items. */
const rawPriceItemArb = fc.record({
  withoutTax: fc.oneof(fc.double(), fc.constant(undefined), fc.constant(null)),
  type: fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null)),
  currency: fc.oneof(fc.constant('USD'), fc.constant('EUR'), fc.constant('GBP'), fc.string()),
});

/** Arbitrary for enriched items. */
const enrichedRawItemArb = fc.record({
  name: fc.string(),
  price: fc.string(),
  prices: fc.array(rawPriceItemArb, { maxLength: 4 }),
});

const enrichedRawGroupArb = fc.record({
  name: fc.string(),
  type: fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null), fc.constant('')),
  items: fc.array(enrichedRawItemArb, { maxLength: 5 }),
});

const enrichedRawMenuArb = fc.record({
  menuType: fc.string(),
  cuisineType: fc.oneof(fc.string(), fc.constant(null)),
  serviceStyle: fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null), fc.constant('')),
  experience: fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null), fc.constant('')),
  groups: fc.array(enrichedRawGroupArb, { maxLength: 4 }),
});

describe('Property 8: Menu projection stays additive and verbatim', () => {
  it('for any RawMenu[] without new optional fields, output has no new keys and matches legacy shape', () => {
    fc.assert(
      fc.property(fc.array(legacyRawMenuArb, { maxLength: 5 }), (rawMenus) => {
        const projected = projectMenus(rawMenus);
        expect(projected).toHaveLength(rawMenus.length);

        for (let i = 0; i < rawMenus.length; i++) {
          const raw = rawMenus[i]!;
          const menu = projected[i]!;

          // Exactly the legacy keys on MenuDTO
          expect(Object.keys(menu).sort()).toEqual(['cuisineType', 'groups', 'menuType'].sort());
          expect(menu.menuType).toBe(raw.menuType);
          expect(menu.cuisineType).toBe(raw.cuisineType);
          expect(menu.groups).toHaveLength(raw.groups.length);

          for (let j = 0; j < raw.groups.length; j++) {
            const rawGroup = raw.groups[j]!;
            const group = menu.groups[j]!;

            // Exactly the legacy keys on MenuGroupDTO
            expect(Object.keys(group).sort()).toEqual(['items', 'name'].sort());
            expect(group.name).toBe(rawGroup.name);
            expect(group.items).toHaveLength(rawGroup.items.length);

            for (let k = 0; k < rawGroup.items.length; k++) {
              const rawItem = rawGroup.items[k]!;
              const item = group.items[k]!;

              // Exactly the legacy keys on MenuItemDTO
              expect(Object.keys(item).sort()).toEqual(['name', 'price'].sort());
              expect(item.name).toBe(rawItem.name);
              expect(item.price).toBe(rawItem.price);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for enriched inputs, each new field is present only when valid and structured prices compute correctly', () => {
    fc.assert(
      fc.property(fc.array(enrichedRawMenuArb, { maxLength: 4 }), (rawMenus) => {
        const projected = projectMenus(rawMenus);

        for (let i = 0; i < rawMenus.length; i++) {
          const raw = rawMenus[i]!;
          const menu = projected[i]!;

          // serviceStyle present only when valid non-empty string
          if (typeof raw.serviceStyle === 'string' && raw.serviceStyle.trim().length > 0) {
            expect(menu.serviceStyle).toBe(raw.serviceStyle);
          } else {
            expect('serviceStyle' in menu).toBe(false);
          }

          // experience present only when valid non-empty string
          if (typeof raw.experience === 'string' && raw.experience.trim().length > 0) {
            expect(menu.experience).toBe(raw.experience);
          } else {
            expect('experience' in menu).toBe(false);
          }

          for (let j = 0; j < raw.groups.length; j++) {
            const rawGroup = raw.groups[j]!;
            const group = menu.groups[j]!;

            // group type present only when valid non-empty string
            if (typeof rawGroup.type === 'string' && rawGroup.type.trim().length > 0) {
              expect(group.type).toBe(rawGroup.type);
            } else {
              expect('type' in group).toBe(false);
            }

            for (let k = 0; k < rawGroup.items.length; k++) {
              const rawItem = rawGroup.items[k]!;
              const item = group.items[k]!;

              // Price string is unchanged
              expect(item.price).toBe(rawItem.price);

              // Calculate expected valid USD prices with positive integer cents
              const expectedPrices = (rawItem.prices ?? [])
                .filter(
                  (p) =>
                    p.currency === 'USD' &&
                    typeof p.withoutTax === 'number' &&
                    Number.isFinite(p.withoutTax) &&
                    p.withoutTax > 0 &&
                    Number.isSafeInteger(Math.round(p.withoutTax * 100)) &&
                    Math.round(p.withoutTax * 100) > 0,
                )
                .map((p) => ({
                  cents: Math.round(p.withoutTax! * 100),
                  label: typeof p.type === 'string' && p.type.length > 0 ? p.type : null,
                }));

              if (expectedPrices.length > 0) {
                expect(item.prices).toEqual(expectedPrices);
                if (expectedPrices.length === 1) {
                  expect(item.priceCents).toBe(expectedPrices[0]!.cents);
                } else {
                  expect('priceCents' in item).toBe(false);
                }
              } else {
                expect('prices' in item).toBe(false);
                expect('priceCents' in item).toBe(false);
              }
            }
          }

          // Must validate with shared menuDtoSchema
          expect(menuDtoSchema.safeParse(menu).success).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
