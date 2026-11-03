import { describe, expect, it } from 'vitest';
import { menuDtoSchema, menuPriceEntrySchema } from '../index.js';

describe('Menu DTO Schemas (Task 1.2)', () => {
  it('parses existing v1 menu JSON without new fields (backward compatibility)', () => {
    const v1Menu = {
      menuType: 'Dinner',
      cuisineType: 'American',
      groups: [
        {
          name: 'Entrees',
          items: [
            { name: 'Cheeseburger', price: '$18.00' },
            { name: 'Steak', price: '$45.00' },
          ],
        },
      ],
    };

    const parsed = menuDtoSchema.safeParse(v1Menu);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.menuType).toBe('Dinner');
      expect(parsed.data.serviceStyle).toBeUndefined();
      expect(parsed.data.groups[0]?.type).toBeUndefined();
      expect(parsed.data.groups[0]?.items[0]?.priceCents).toBeUndefined();
    }
  });

  it('parses v2 menu JSON with serviceStyle, experience, group type, parsed cents, and prices array', () => {
    const v2Menu = {
      menuType: 'Dinner',
      cuisineType: 'Signature',
      serviceStyle: 'table service',
      experience: 'Fine Dining',
      groups: [
        {
          name: 'Cocktails',
          type: 'Alcohol',
          items: [
            {
              name: 'Signature Martini',
              price: '$18.00',
              priceCents: 1800,
              prices: [{ label: 'Standard', cents: 1800 }],
            },
          ],
        },
        {
          name: 'Desserts',
          type: 'Food',
          items: [
            {
              name: 'Chocolate Cake',
              price: '$12.00 / $16.00',
              priceCents: null,
              prices: [
                { label: 'Slice', cents: 1200 },
                { label: 'Whole', cents: 1600 },
              ],
            },
          ],
        },
      ],
    };

    const parsed = menuDtoSchema.safeParse(v2Menu);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.serviceStyle).toBe('table service');
      expect(parsed.data.experience).toBe('Fine Dining');
      expect(parsed.data.groups[0]?.type).toBe('Alcohol');
      expect(parsed.data.groups[0]?.items[0]?.priceCents).toBe(1800);
      expect(parsed.data.groups[1]?.items[0]?.prices).toHaveLength(2);
    }
  });

  it('validates menuPriceEntrySchema strictly', () => {
    expect(
      menuPriceEntrySchema.safeParse({
        label: 'Adult',
        cents: 6500,
      }).success
    ).toBe(true);

    expect(
      menuPriceEntrySchema.safeParse({
        label: null,
        cents: 4000,
      }).success
    ).toBe(true);

    // Reject unknown keys strictly
    expect(
      menuPriceEntrySchema.safeParse({
        label: null,
        cents: 4000,
        unknownKey: 'invalid',
      }).success
    ).toBe(false);

    // Reject non-positive cents
    expect(
      menuPriceEntrySchema.safeParse({
        label: null,
        cents: 0,
      }).success
    ).toBe(false);
  });
});

