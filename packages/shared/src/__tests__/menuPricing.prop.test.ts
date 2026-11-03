import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  extractMenuPriceOffers,
  extractTierPriceSuggestions,
  formatCentsAsDollarString,
  normalizeMenuName,
  normalizeTierName,
  parseDollarAmounts,
  parseMenuPriceString,
} from '../index.js';
import type { MenuDTO } from '../index.js';

const NUM_RUNS = 100;

describe('menuPricing Properties', () => {
  // Feature: trip-budget, Property 5: The price parser never returns an unusable amount
  it('// Feature: trip-budget, Property 5: The price parser never returns an unusable amount', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (input) => {
        const dollarAmounts = parseDollarAmounts(input);
        for (const cents of dollarAmounts) {
          expect(Number.isInteger(cents)).toBe(true);
          expect(Number.isFinite(cents)).toBe(true);
          expect(cents).toBeGreaterThan(0);
        }

        const menuPriceAmounts = parseMenuPriceString(input);
        for (const cents of menuPriceAmounts) {
          expect(Number.isInteger(cents)).toBe(true);
          expect(Number.isFinite(cents)).toBe(true);
          expect(cents).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: trip-budget, Property 6: Cents round-trip through the dollar string
  it('// Feature: trip-budget, Property 6: Cents round-trip through the dollar string', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (c1, c2) => {
          // Single value round trip
          const s1 = formatCentsAsDollarString(c1);
          expect(parseDollarAmounts(s1)).toEqual([c1]);

          // Pair join round trip
          const s2 = formatCentsAsDollarString(c2);
          const joined = `${s1} / ${s2}`;
          expect(parseDollarAmounts(joined)).toEqual([c1, c2]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: trip-budget, Property 7: The promoted tier extractor is behavior-compatible
  it('// Feature: trip-budget, Property 7: The promoted tier extractor is behavior-compatible', () => {
    const audienceArb = fc.constantFrom('adult', 'child', 'guest', 'senior');
    const priceCentsArb = fc.integer({ min: 100, max: 20000 });

    const menuArb = fc.record({
      menuType: fc.constant('Dinner'),
      groups: fc.array(
        fc.record({
          name: fc.constantFrom('Buffet Pricing', 'Prix Fixe Menu', 'Entrees'),
          items: fc.array(
            fc.oneof(
              fc.record({
                name: fc.tuple(priceCentsArb, audienceArb).map(([c, a]) => `$${c / 100} per ${a}`),
                price: fc.constant('$50.00'),
              }),
              fc.record({
                name: fc.tuple(audienceArb, priceCentsArb).map(([a, c]) => `${a}: $${c / 100}`),
                price: fc.constant('$50.00'),
              }),
              fc.record({
                name: fc.constant('Regular Item'),
                price: fc.constant('$15.00'),
              })
            ),
            { minLength: 1, maxLength: 5 }
          ),
        }),
        { minLength: 1, maxLength: 3 }
      ),
    }) as fc.Arbitrary<MenuDTO>;

    fc.assert(
      fc.property(fc.array(menuArb, { minLength: 0, maxLength: 2 }), (menus) => {
        const suggestions = extractTierPriceSuggestions(menus);
        const offers = extractMenuPriceOffers(menus);

        // Every tier suggestion maps directly to a per_person_tier offer
        const tierOffers = offers.filter((o) => o.kind === 'per_person_tier');
        expect(suggestions).toHaveLength(tierOffers.length);

        for (let i = 0; i < suggestions.length; i++) {
          expect(suggestions[i]?.name).toBe(tierOffers[i]?.label);
          expect(suggestions[i]?.priceCents).toBe(tierOffers[i]?.priceCents);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('normalizers are idempotent and length-bounded', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        const normMenu = normalizeMenuName(s);
        expect(normMenu.length).toBeLessThanOrEqual(100);
        expect(normalizeMenuName(normMenu)).toBe(normMenu);

        const normTier = normalizeTierName(s);
        expect(normTier.length).toBeLessThanOrEqual(40);
        expect(normalizeTierName(normTier)).toBe(normTier);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

