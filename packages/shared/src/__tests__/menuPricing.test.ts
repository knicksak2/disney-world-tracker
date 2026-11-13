import { describe, expect, it } from 'vitest';
import {
  computeMenuEstimatePerPerson,
  extractMenuPriceOffers,
  extractTierPriceSuggestions,
  formatCentsAsDollarString,
  isAlcoholGroupType,
  menuPriceRefSchema,
  normalizeMenuName,
  normalizeTierName,
  parseDollarAmounts,
  parseMenuPriceString,
} from '../index.js';

describe('menuPricing (Task 1.3)', () => {
  describe('parseDollarAmounts and parseMenuPriceString', () => {
    it('parses multiple USD amounts in order ("$12 / $18")', () => {
      expect(parseDollarAmounts('$12 / $18')).toEqual([1200, 1800]);
      expect(parseMenuPriceString('$12 / $18')).toEqual([1200, 1800]);
    });

    it('parses a single USD amount ("$20")', () => {
      expect(parseDollarAmounts('$20')).toEqual([2000]);
      expect(parseMenuPriceString('$20')).toEqual([2000]);
    });

    it('parses "$49 per adult, plus tax and gratuity"', () => {
      expect(parseDollarAmounts('$49 per adult, plus tax and gratuity')).toEqual([4900]);
      expect(parseMenuPriceString('$49 per adult, plus tax and gratuity')).toEqual([4900]);
    });

    it('parses "$42 per child (Ages 3-9), plus tax and gratuity"', () => {
      expect(parseDollarAmounts('$42 per child (Ages 3-9), plus tax and gratuity')).toEqual([4200]);
      expect(parseMenuPriceString('$42 per child (Ages 3-9), plus tax and gratuity')).toEqual([4200]);
    });

    it('parses "Adult: $65.00"', () => {
      expect(parseDollarAmounts('Adult: $65.00')).toEqual([6500]);
      expect(parseMenuPriceString('Adult: $65.00')).toEqual([6500]);
    });

    it('parses "Splitsville ... Prix Fixe Menu ($45 per person)"', () => {
      expect(parseDollarAmounts('Splitsville ... Prix Fixe Menu ($45 per person)')).toEqual([4500]);
      expect(parseMenuPriceString('Splitsville ... Prix Fixe Menu ($45 per person)')).toEqual([4500]);
    });

    it('parses an item with no price as empty array', () => {
      expect(parseDollarAmounts('Chef Special Selection')).toEqual([]);
      expect(parseMenuPriceString('Chef Special Selection')).toEqual([]);
      expect(parseMenuPriceString(null)).toEqual([]);
      expect(parseMenuPriceString(undefined)).toEqual([]);
    });

    it('parses a EUR or foreign currency price as empty array (Property 5)', () => {
      expect(parseDollarAmounts('15 €')).toEqual([]);
      expect(parseDollarAmounts('€15.00')).toEqual([]);
      expect(parseDollarAmounts('15 EUR')).toEqual([]);
      expect(parseMenuPriceString('15 €')).toEqual([]);
      expect(parseMenuPriceString('€15.00')).toEqual([]);
      expect(parseMenuPriceString('15 EUR')).toEqual([]);
    });
  });

  describe('extractMenuPriceOffers and extractTierPriceSuggestions', () => {
    it('matches legacy mobile extractTierPriceSuggestions fixtures verbatim', () => {
      const buffetMenu = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Buffet Pricing',
              items: [
                { name: '$65 per adult', price: '$65.00' },
                { name: '$40 per child', price: '$40.00' },
              ],
            },
          ],
        },
      ];
      expect(extractTierPriceSuggestions(buffetMenu)).toEqual([
        { name: 'Adult', priceCents: 6500 },
        { name: 'Child', priceCents: 4000 },
      ]);

      const fixedMenu = [
        {
          menuType: 'Lunch',
          groups: [
            {
              name: 'Prix Fixe Menu',
              items: [
                { name: 'Adult: $55.00', price: '$55.00' },
                { name: 'Child: $35.00', price: '$35.00' },
              ],
            },
          ],
        },
      ];
      expect(extractTierPriceSuggestions(fixedMenu)).toEqual([
        { name: 'Adult', priceCents: 5500 },
        { name: 'Child', priceCents: 3500 },
      ]);

      const aLaCarteMenu = [
        {
          menuType: 'All Day',
          groups: [
            {
              name: 'Entrees',
              items: [
                { name: 'Cheeseburger', price: '$14.99' },
                { name: 'Chicken Tenders', price: '$12.49' },
              ],
            },
          ],
        },
      ];
      expect(extractTierPriceSuggestions(aLaCarteMenu)).toEqual([]);
    });

    it('extracts fixed_menu offer from group header with ($45 per person)', () => {
      const menus = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Splitsville Luxury Lanes Prix Fixe Menu ($45 per person)',
              items: [{ name: 'Starter + Entree + Dessert' }],
            },
          ],
        },
      ];

      const offers = extractMenuPriceOffers(menus);
      expect(offers).toHaveLength(1);
      expect(offers[0]).toEqual({
        kind: 'fixed_menu',
        label: 'Splitsville Luxury Lanes Prix Fixe Menu ($45 per person)',
        audience: 'person',
        priceCents: 4500,
        menuType: 'Dinner',
        sourceText: 'Splitsville Luxury Lanes Prix Fixe Menu ($45 per person)',
      });
    });

    it('extracts banner_item offer from Breakfast Buffet Pricing with item Buffet Breakfast $45', () => {
      const menus = [
        {
          menuType: 'Breakfast',
          groups: [
            {
              name: 'Breakfast Buffet Pricing',
              items: [{ name: 'Buffet Breakfast', price: '$45' }],
            },
          ],
        },
      ];

      const offers = extractMenuPriceOffers(menus);
      expect(offers).toHaveLength(1);
      expect(offers[0]).toEqual({
        kind: 'banner_item',
        label: 'Buffet Breakfast',
        audience: null,
        priceCents: 4500,
        menuType: 'Breakfast',
        sourceText: 'Buffet Breakfast $45',
      });
    });

    it('extracts person audience for per person pattern', () => {
      const menus = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Dinner Packages',
              items: [{ name: '$50 per person', price: '$50.00' }],
            },
          ],
        },
      ];
      const offers = extractMenuPriceOffers(menus);
      expect(offers).toHaveLength(1);
      expect(offers[0]?.audience).toBe('person');
      expect(offers[0]?.label).toBe('Person');
      expect(offers[0]?.priceCents).toBe(5000);
    });

    it('extracts distinct pricing for multiple meals (e.g. Breakfast vs Dinner) without collision', () => {
      const ohanaMenus = [
        {
          menuType: 'Breakfast',
          groups: [
            {
              name: "'Ohana Breakfast Pricing",
              items: [
                { name: '$58 per adult, plus tax and gratuity' },
                { name: '$36 per child (Guests ages 3-9), plus tax and gratuity' },
              ],
            },
          ],
        },
        {
          menuType: 'Dinner',
          groups: [
            {
              name: "'Ohana Dinner Pricing",
              items: [
                { name: '$69 per adult, plus tax and gratuity' },
                { name: '$46 per child (Guests ages 3-9), plus tax and gratuity' },
              ],
            },
          ],
        },
      ];

      const offers = extractMenuPriceOffers(ohanaMenus);
      expect(offers).toHaveLength(4);
      expect(offers).toEqual([
        {
          kind: 'per_person_tier',
          label: 'Adult',
          audience: 'adult',
          priceCents: 5800,
          menuType: 'Breakfast',
          sourceText: '$58 per adult, plus tax and gratuity',
        },
        {
          kind: 'per_person_tier',
          label: 'Child',
          audience: 'child',
          priceCents: 3600,
          menuType: 'Breakfast',
          sourceText: '$36 per child (Guests ages 3-9), plus tax and gratuity',
        },
        {
          kind: 'per_person_tier',
          label: 'Adult',
          audience: 'adult',
          priceCents: 6900,
          menuType: 'Dinner',
          sourceText: '$69 per adult, plus tax and gratuity',
        },
        {
          kind: 'per_person_tier',
          label: 'Child',
          audience: 'child',
          priceCents: 4600,
          menuType: 'Dinner',
          sourceText: '$46 per child (Guests ages 3-9), plus tax and gratuity',
        },
      ]);

      const suggestions = extractTierPriceSuggestions(ohanaMenus);
      expect(suggestions).toEqual([
        { name: 'Breakfast Adult', priceCents: 5800 },
        { name: 'Breakfast Child', priceCents: 3600 },
        { name: 'Dinner Adult', priceCents: 6900 },
        { name: 'Dinner Child', priceCents: 4600 },
      ]);
    });
  });

  describe('formatCentsAsDollarString and isAlcoholGroupType', () => {
    it('formats cents as dollar string with zero padding', () => {
      expect(formatCentsAsDollarString(4995)).toBe('$49.95');
      expect(formatCentsAsDollarString(100)).toBe('$1.00');
      expect(formatCentsAsDollarString(5)).toBe('$0.05');
      expect(formatCentsAsDollarString(0)).toBe('$0.00');
    });

    it('identifies alcohol group types', () => {
      expect(isAlcoholGroupType('Alcoholic Beverages')).toBe(true);
      expect(isAlcoholGroupType('Cocktails & Alcohol')).toBe(true);
      expect(isAlcoholGroupType('Food')).toBe(false);
      expect(isAlcoholGroupType(null)).toBe(false);
      expect(isAlcoholGroupType(undefined)).toBe(false);
    });
  });

  describe('normalizeMenuName (round 4 L9)', () => {
    it('trims whitespace', () => {
      expect(normalizeMenuName('   Cheeseburger   ')).toBe('Cheeseburger');
    });

    it('truncates a 120-character title to its first 100 characters', () => {
      const longTitle = 'A'.repeat(120);
      const normalized = normalizeMenuName(longTitle);
      expect(normalized).toHaveLength(100);
      expect(normalized).toBe('A'.repeat(100));
    });

    it('is idempotent and never returns more than 100 characters', () => {
      const longTitle = '   ' + 'B'.repeat(150) + '   ';
      const step1 = normalizeMenuName(longTitle);
      const step2 = normalizeMenuName(step1);
      expect(step1).toBe(step2);
      expect(step1.length).toBeLessThanOrEqual(100);
    });
  });

  describe('normalizeTierName (round 5 L8)', () => {
    it('cuts a 60-character group-banner label to its first 40 characters after trimming', () => {
      const banner = 'Breakfast Buffet Pricing - Adult and Child Combined Rates';
      expect(banner.length).toBeGreaterThan(40);
      const normalized = normalizeTierName(banner);
      expect(normalized).toHaveLength(40);
      expect(normalized).toBe(banner.slice(0, 40));
    });

    it('is idempotent and accepted by menuPriceRefSchema', () => {
      const banner = 'Breakfast Buffet Pricing - Adult and Child Combined Rates';
      const normalized = normalizeTierName(banner);
      expect(normalizeTierName(normalized)).toBe(normalized);

      // Accepted by menuPriceRefSchema
      const validRef = menuPriceRefSchema.safeParse({
        kind: 'menu',
        tier: { name: normalized, priceCents: 4500 },
      });
      expect(validRef.success).toBe(true);

      // Raw 60-character label rejected by menuPriceRefSchema (EXPENSE_TIER_NAME_MAX = 40)
      const invalidRef = menuPriceRefSchema.safeParse({
        kind: 'menu',
        tier: { name: banner, priceCents: 4500 },
      });
      expect(invalidRef.success).toBe(false);
    });
  });

  describe('computeMenuEstimatePerPerson (Requirement 9.11, Property 50a)', () => {
    it('returns null for empty or unpriced menus', () => {
      expect(computeMenuEstimatePerPerson(null)).toBeNull();
      expect(computeMenuEstimatePerPerson([])).toBeNull();
      expect(
        computeMenuEstimatePerPerson([
          {
            menuType: 'Dinner',
            groups: [{ name: 'Entrees', items: [{ name: 'Market Fish' }] }],
          },
        ])
      ).toBeNull();
    });

    it('prefers Entrees over appetizers, desserts, and alcoholic drinks when >= 2 entrees exist', () => {
      const menus = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Appetizers',
              items: [{ name: 'Soup', price: '$9.00', priceCents: 900 }],
            },
            {
              name: 'Entrees',
              type: 'Entrees',
              items: [
                { name: 'Steak', price: '$38.00', priceCents: 3800 },
                { name: 'Salmon', price: '$32.00', priceCents: 3200 },
                { name: 'Pasta', price: '$26.00', priceCents: 2600 },
              ],
            },
            {
              name: 'Specialty Cocktails',
              type: 'Alcoholic Beverage',
              items: [{ name: 'Margarita', price: '$18.00', priceCents: 1800 }],
            },
          ],
        },
      ];
      const est = computeMenuEstimatePerPerson(menus);
      expect(est).toEqual({
        perPersonCents: 3200, // (3800 + 3200 + 2600) / 3
        basis: 'entrees',
        sampleCount: 3,
      });
    });

    it('falls back to non-alcoholic items when fewer than 2 entree items exist', () => {
      const menus = [
        {
          menuType: 'Snack',
          groups: [
            {
              name: 'Snacks & Treats',
              items: [
                { name: 'Churro', price: '$6.75' },
                { name: 'Pretzel', price: '$8.25' },
              ],
            },
            {
              name: 'Alcoholic Beverages',
              type: 'Alcoholic Beverage',
              items: [{ name: 'Draft Beer', price: '$12.00' }],
            },
          ],
        },
      ];
      const est = computeMenuEstimatePerPerson(menus);
      expect(est).toEqual({
        perPersonCents: 750, // (675 + 825) / 2
        basis: 'items',
        sampleCount: 2,
      });
    });
  });
});

