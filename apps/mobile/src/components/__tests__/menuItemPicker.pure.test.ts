// Feature: trip-budget, Property 27: Picker selections become valid Expense and Budget payloads
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.10

import {
  expenseItemInputSchema,
  menuPriceRefSchema,
  type MenuDTO,
  type MenuPriceOffer,
} from '@dwt/shared';

import {
  buildPickerRows,
  isAlcoholicGroupType,
  isInformationalDisclaimer,
  isPricingAnnouncement,
  selectionSubtotalCents,
  selectionToBudgetPriceRef,
  selectionToExpenseItems,
} from '../menuItemPicker.pure';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('menuItemPicker.pure (Task 17.3, Property 27)', () => {
  describe('isAlcoholicGroupType (Requirement 9.5)', () => {
    it('returns true for case-insensitive "Alcoholic Beverage"', () => {
      expect(isAlcoholicGroupType('Alcoholic Beverage')).toBe(true);
      expect(isAlcoholicGroupType('alcoholic beverage')).toBe(true);
      expect(isAlcoholicGroupType('ALCOHOLIC BEVERAGE')).toBe(true);
      expect(isAlcoholicGroupType('  alcoholic beverage  ')).toBe(true);
    });

    it('returns false for other types or null', () => {
      expect(isAlcoholicGroupType('Beverage')).toBe(false);
      expect(isAlcoholicGroupType('Entrees')).toBe(false);
      expect(isAlcoholicGroupType(null)).toBe(false);
      expect(isAlcoholicGroupType(undefined)).toBe(false);
    });
  });

  describe('buildPickerRows (Requirement 9.1, 9.4, 9.5)', () => {
    it('builds sections and parses price variants or flags priceless items', () => {
      const menus: MenuDTO[] = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Appetizers',
              type: 'Food',
              items: [
                {
                  name: 'Soup of the Day',
                  price: '$12 / $18',
                },
                {
                  name: 'Caesar Salad',
                  priceCents: 1400,
                },
                {
                  name: 'Chef Secret Tasting',
                  price: null,
                },
              ],
            },
            {
              name: 'Cocktails',
              type: 'Alcoholic Beverage',
              items: [
                {
                  name: 'Lapu Lapu',
                  priceCents: 1950,
                  prices: [{ cents: 1950, label: 'Standard' }],
                },
              ],
            },
          ],
        },
      ];

      const sections = buildPickerRows(menus);
      expect(sections).toHaveLength(2);

      // Appetizers section
      expect(sections[0]!.menuType).toBe('Dinner');
      expect(sections[0]!.groupName).toBe('Appetizers');
      expect(sections[0]!.items).toHaveLength(3);

      // Soup has 2 variants from "$12 / $18"
      const soup = sections[0]!.items[0]!;
      expect(soup.name).toBe('Soup of the Day');
      expect(soup.variants).toEqual([
        { cents: 1200, label: null },
        { cents: 1800, label: null },
      ]);
      expect(soup.isPriceless).toBe(false);
      expect(soup.isAlcohol).toBe(false);

      // Salad has single price
      const salad = sections[0]!.items[1]!;
      expect(salad.name).toBe('Caesar Salad');
      expect(salad.defaultPriceCents).toBe(1400);
      expect(salad.isPriceless).toBe(false);

      // Chef tasting is priceless
      const tasting = sections[0]!.items[2]!;
      expect(tasting.isPriceless).toBe(true);
      expect(tasting.variants).toHaveLength(0);

      // Cocktails section has isAlcohol: true
      expect(sections[1]!.groupName).toBe('Cocktails');
      expect(sections[1]!.items[0]!.isAlcohol).toBe(true);
      expect(sections[1]!.items[0]!.defaultPriceCents).toBe(1950);
    });

    it('identifies pricing announcements and disclaimers', () => {
      expect(isPricingAnnouncement('$58 per adult, plus tax and gratuity', 'Breakfast')).toBe(true);
      expect(isPricingAnnouncement('Any Item', "'Ohana Breakfast Pricing")).toBe(true);
      expect(isPricingAnnouncement('Caesar Salad', 'Appetizers')).toBe(false);

      expect(isInformationalDisclaimer('Guests must speak to a Cast Member about their allergy-friendly request')).toBe(true);
      expect(isInformationalDisclaimer('Ask a cast member for daily specials')).toBe(true);
      expect(isInformationalDisclaimer('Fresh Fruit')).toBe(false);
    });

    it('filters out pricing announcements and disclaimers, and tags unpriced feast items', () => {
      const ohanaMenus: MenuDTO[] = [
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
            {
              name: "All-You-Care-To-Enjoy 'Ohana Breakfast",
              items: [
                { name: 'Freshly Made Pineapple-Coconut Breakfast Bread' },
                { name: 'Fresh Fruit' },
                { name: "'Ohana Breakfast Skillet" },
                { name: 'Guests must speak to a Cast Member about their allergy-friendly request' },
              ],
            },
            {
              name: 'Specialty Beverages',
              type: 'Beverage',
              items: [
                { name: 'Stitch Smoothie', priceCents: 700 },
              ],
            },
          ],
        },
      ];

      const sections = buildPickerRows(ohanaMenus);

      // Pricing group was stripped because all items were pricing announcements
      expect(sections.some((s) => s.groupName === "'Ohana Breakfast Pricing")).toBe(false);

      // Feast section items: disclaimer removed, food items marked isFeastItem: true
      const feastSec = sections.find((s) => s.groupName === "All-You-Care-To-Enjoy 'Ohana Breakfast");
      expect(feastSec).toBeDefined();
      expect(feastSec!.items).toHaveLength(3); // 3 items (disclaimer omitted)
      expect(feastSec!.items.map((i) => i.name)).toEqual([
        'Freshly Made Pineapple-Coconut Breakfast Bread',
        'Fresh Fruit',
        "'Ohana Breakfast Skillet",
      ]);
      expect(feastSec!.items.every((i) => i.isFeastItem)).toBe(true);

      // Specialty beverages are priced and not feast items
      const drinkSec = sections.find((s) => s.groupName === 'Specialty Beverages');
      expect(drinkSec).toBeDefined();
      expect(drinkSec!.items[0]!.isFeastItem).toBe(false);
      expect(drinkSec!.items[0]!.defaultPriceCents).toBe(700);
    });
  });

  describe('selectionSubtotalCents', () => {
    it('sums items priceCents * quantity', () => {
      const subtotal = selectionSubtotalCents({
        items: [
          { name: 'Burger', priceCents: 1500, quantity: 2, isAlcohol: false },
          { name: 'Fries', priceCents: 500, quantity: 1, isAlcohol: false },
        ],
      });
      expect(subtotal).toBe(3500);
    });

    it('returns tier priceCents * quantity', () => {
      const subtotal = selectionSubtotalCents({
        tier: { name: 'Adult Buffet', priceCents: 4900, quantity: 2 },
      });
      expect(subtotal).toBe(9800);
    });

    it('returns 0 for empty selection', () => {
      expect(selectionSubtotalCents({})).toBe(0);
      expect(selectionSubtotalCents({ items: [] })).toBe(0);
    });
  });

  describe('selectionToExpenseItems (Property 27)', () => {
    it('repeats items by quantity and matches expenseItemInputSchema', () => {
      const selection = {
        items: [
          { name: 'Cheeseburger', priceCents: 1650, quantity: 2, isAlcohol: false },
          { name: 'Craft IPA', priceCents: 1100, quantity: 1, isAlcohol: true },
        ],
      };

      const rows = selectionToExpenseItems(selection, [VALID_UUID]);
      expect(rows).toHaveLength(3);

      expect(rows[0]).toEqual({
        name: 'Cheeseburger',
        priceCents: 1650,
        assigneeIds: [VALID_UUID],
        isAlcohol: false,
      });
      expect(rows[1]).toEqual({
        name: 'Cheeseburger',
        priceCents: 1650,
        assigneeIds: [VALID_UUID],
        isAlcohol: false,
      });
      expect(rows[2]).toEqual({
        name: 'Craft IPA',
        priceCents: 1100,
        assigneeIds: [VALID_UUID],
        isAlcohol: true,
      });

      // All rows validate against expenseItemInputSchema
      for (const row of rows) {
        const parsed = expenseItemInputSchema.safeParse(row);
        expect(parsed.success).toBe(true);
      }

      // Sum equals selectionSubtotalCents
      const totalExpenseCents = rows.reduce((s, r) => s + r.priceCents, 0);
      expect(totalExpenseCents).toBe(selectionSubtotalCents(selection));
    });

    it('truncates long item names to 100 characters', () => {
      const longName = 'A'.repeat(120);
      const rows = selectionToExpenseItems(
        {
          items: [{ name: longName, priceCents: 1000, quantity: 1, isAlcohol: false }],
        },
        [VALID_UUID]
      );
      expect(rows[0]!.name).toHaveLength(100);
      expect(expenseItemInputSchema.safeParse(rows[0]).success).toBe(true);
    });

    it('handles prix fixe offer and normalizes tier name to 40 characters (round 5 L8)', () => {
      const banner60 = 'Breakfast Buffet Pricing at Tusker House Restaurant for Adults';
      expect(banner60.length).toBeGreaterThan(40);

      const offer: MenuPriceOffer = {
        kind: 'fixed_menu',
        label: banner60,
        audience: 'adult',
        priceCents: 4900,
        menuType: 'Breakfast',
        sourceText: banner60,
      };

      const rows = selectionToExpenseItems({ tier: offer }, [VALID_UUID]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name.length).toBeLessThanOrEqual(40);
      expect(rows[0]!.priceCents).toBe(4900);
      expect(expenseItemInputSchema.safeParse(rows[0]).success).toBe(true);
    });
  });

  describe('selectionToBudgetPriceRef (Requirements 9.2, 9.3, 9.10)', () => {
    it('builds MenuPriceRef for itemized selection and validates against schema', () => {
      const ref = selectionToBudgetPriceRef({
        items: [
          { name: 'Mickey Waffle', priceCents: 1250, priceLabel: 'Regular', quantity: 2 },
          { name: 'Mimosa', priceCents: 1500, quantity: 1, isAlcohol: true },
        ],
      });

      expect(ref.kind).toBe('menu');
      expect(ref.items).toHaveLength(2);
      expect(ref.items![0]).toEqual({
        name: 'Mickey Waffle',
        priceCents: 1250,
        priceLabel: 'Regular',
        quantity: 2,
      });
      expect(ref.items![1]).toEqual({
        name: 'Mimosa',
        priceCents: 1500,
        priceLabel: null,
        quantity: 1,
        isAlcohol: true,
      });

      const parsed = menuPriceRefSchema.safeParse(ref);
      expect(parsed.success).toBe(true);
    });

    it('builds MenuPriceRef for 60-character tier offer with normalized 40-character tier.name (round 5 L8)', () => {
      const banner60 = 'Breakfast Buffet Pricing at Tusker House Restaurant for Adults';
      const offer: MenuPriceOffer = {
        kind: 'fixed_menu',
        label: banner60,
        audience: 'adult',
        priceCents: 4900,
        menuType: 'Breakfast',
        sourceText: banner60,
      };

      const ref = selectionToBudgetPriceRef({ tier: offer });
      expect(ref.kind).toBe('menu');
      expect(ref.tier).toBeDefined();
      expect(ref.tier!.name.length).toBeLessThanOrEqual(40);
      expect(ref.tier!.priceCents).toBe(4900);

      const parsed = menuPriceRefSchema.safeParse(ref);
      expect(parsed.success).toBe(true);
    });

    it('builds MenuPriceRef for combined tier and regular items projecting all as items', () => {
      const ref = selectionToBudgetPriceRef({
        tier: { name: 'Adult Dinner Buffet', priceCents: 6900, quantity: 2 },
        items: [
          { name: 'Lapu Lapu', priceCents: 2400, quantity: 1, isAlcohol: true },
        ],
      });

      expect(ref.kind).toBe('menu');
      expect(ref.tier).toBeUndefined();
      expect(ref.items).toHaveLength(2);
      expect(ref.items![0]).toEqual({
        name: 'Adult Dinner Buffet',
        priceCents: 6900,
        priceLabel: null,
        quantity: 2,
      });
      expect(ref.items![1]).toEqual({
        name: 'Lapu Lapu',
        priceCents: 2400,
        priceLabel: null,
        quantity: 1,
        isAlcohol: true,
      });

      const parsed = menuPriceRefSchema.safeParse(ref);
      expect(parsed.success).toBe(true);
    });

    it('builds MenuPriceRef for multiple tiers with regular items', () => {
      const ref = selectionToBudgetPriceRef({
        tiers: [
          { name: 'Adult', priceCents: 6900, quantity: 2 },
          { name: 'Child', priceCents: 4600, quantity: 1 },
        ],
        items: [
          { name: 'Lapu Lapu', priceCents: 2400, quantity: 1, isAlcohol: true },
        ],
      });

      expect(ref.kind).toBe('menu');
      expect(ref.items).toHaveLength(3);
      expect(ref.items![0]!.name).toBe('Adult');
      expect(ref.items![0]!.quantity).toBe(2);
      expect(ref.items![1]!.name).toBe('Child');
      expect(ref.items![1]!.quantity).toBe(1);
      expect(ref.items![2]!.name).toBe('Lapu Lapu');

      const parsed = menuPriceRefSchema.safeParse(ref);
      expect(parsed.success).toBe(true);
    });
  });
});

