/**
 * Tests for structured menu price extraction and additive projection
 * with a realistic 1900 Park Fare payload shape.
 *
 * Validates: Requirements 9.5, 10.5, 10.6
 */

import { describe, expect, it } from 'vitest';
import { menuDtoSchema } from '@dwt/shared';
import { projectDiningMenuPayload } from '../diningMenuClient.js';
import { projectMenus } from '../menu.js';

// Realistic fixture mirroring the 1900 Park Fare (Character Dining Buffet) payload
const PARK_FARE_1900_PAYLOAD = {
  name: '1900 Park Fare',
  location: "Disney's Grand Floridian Resort & Spa",
  destinationId: 'WDW',
  mealPeriodsList: [
    { name: 'Dinner', label: 'Dinner', isActive: true },
  ],
  mealPeriods: [
    {
      name: 'Dinner',
      label: 'Dinner',
      experience: 'Character Dining',
      serviceStyle: 'Buffet',
      groups: [
        {
          name: 'Buffet Pricing',
          type: 'Buffet',
          items: [
            {
              title: '$59 per adult, plus tax and gratuity',
              prices: [],
              pricesRange: false,
              description: 'Character Dining Buffet Dinner',
            },
            {
              title: '$42 per child (Ages 3-9), plus tax and gratuity',
              prices: [],
              pricesRange: false,
              description: 'Character Dining Buffet Dinner',
            },
          ],
        },
        {
          name: 'Specialty Cocktails',
          type: 'Alcoholic Beverage',
          items: [
            {
              title: 'Grand Floridian Mimosa',
              prices: [
                { withoutTax: 16.5, type: 'Per Serving', currency: 'USD' },
              ],
              pricesRange: false,
              description: 'Champagne with orange juice',
            },
          ],
        },
        {
          name: 'Wine by the Glass or Bottle',
          type: 'Alcoholic Beverage',
          items: [
            {
              title: 'Pinot Grigio',
              prices: [
                { withoutTax: 12, type: 'Glass', currency: 'USD' },
                { withoutTax: 45, type: 'Bottle', currency: 'USD' },
              ],
              pricesRange: false,
              description: '',
            },
            {
              title: 'Imported Reserve (Non-USD Mock)',
              prices: [
                { withoutTax: 25, type: 'Glass', currency: 'EUR' },
              ],
              pricesRange: false,
              description: '',
            },
          ],
        },
      ],
    },
  ],
};

describe('diningMenuClient prices extraction (1900 Park Fare fixture)', () => {
  it('maps mealPeriods, serviceStyle, experience, group types, and item prices into RawMenu[]', () => {
    const rawMenus = projectDiningMenuPayload(PARK_FARE_1900_PAYLOAD);
    expect(rawMenus).toHaveLength(1);

    const dinner = rawMenus[0]!;
    expect(dinner.menuType).toBe('Dinner');
    expect(dinner.serviceStyle).toBe('Buffet');
    expect(dinner.experience).toBe('Character Dining');
    expect(dinner.groups).toHaveLength(3);

    // Group 1: Buffet Pricing
    const buffetGroup = dinner.groups![0]!;
    expect(buffetGroup.name).toBe('Buffet Pricing');
    expect(buffetGroup.type).toBe('Buffet');
    expect(buffetGroup.items).toHaveLength(2);
    expect(buffetGroup.items![0]!.name).toBe('$59 per adult, plus tax and gratuity');
    expect(buffetGroup.items![0]!.price).toBeNull();
    expect(buffetGroup.items![0]!.prices).toBeUndefined();
    expect(buffetGroup.items![0]!.priceCents).toBeUndefined();

    // Group 2: Specialty Cocktails (Alcoholic Beverage)
    const cocktailGroup = dinner.groups![1]!;
    expect(cocktailGroup.name).toBe('Specialty Cocktails');
    expect(cocktailGroup.type).toBe('Alcoholic Beverage');
    expect(cocktailGroup.items).toHaveLength(1);
    const mimosa = cocktailGroup.items![0]!;
    expect(mimosa.name).toBe('Grand Floridian Mimosa');
    expect(mimosa.price).toBe('$16.50');
    expect(mimosa.priceCents).toBe(1650);
    expect(mimosa.prices).toHaveLength(1);
    expect(mimosa.prices![0]!.cents).toBe(1650);
    expect(mimosa.prices![0]!.label).toBe('Per Serving');

    // Group 3: Wine (multi-price and non-USD items)
    const wineGroup = dinner.groups![2]!;
    expect(wineGroup.name).toBe('Wine by the Glass or Bottle');
    expect(wineGroup.type).toBe('Alcoholic Beverage');
    expect(wineGroup.items).toHaveLength(2);

    const pinot = wineGroup.items![0]!;
    expect(pinot.name).toBe('Pinot Grigio');
    expect(pinot.price).toBe('$12 / $45');
    // Multiple prices => priceCents must be undefined
    expect(pinot.priceCents).toBeUndefined();
    expect(pinot.prices).toHaveLength(2);
    expect(pinot.prices![0]!.cents).toBe(1200);
    expect(pinot.prices![0]!.label).toBe('Glass');
    expect(pinot.prices![1]!.cents).toBe(4500);
    expect(pinot.prices![1]!.label).toBe('Bottle');

    // Non-USD item: display price string unchanged, structured fields skipped
    const nonUsd = wineGroup.items![1]!;
    expect(nonUsd.name).toBe('Imported Reserve (Non-USD Mock)');
    expect(nonUsd.price).toBe('€25');
    expect(nonUsd.prices).toBeUndefined();
    expect(nonUsd.priceCents).toBeUndefined();
  });

  it('runs cleanly through projectMenus to produce a valid MenuDTO', () => {
    const rawMenus = projectDiningMenuPayload(PARK_FARE_1900_PAYLOAD);
    const projected = projectMenus(rawMenus);

    expect(projected).toHaveLength(1);
    const menu = projected[0]!;

    expect(menu.menuType).toBe('Dinner');
    expect(menu.cuisineType).toBeNull();
    expect(menu.serviceStyle).toBe('Buffet');
    expect(menu.experience).toBe('Character Dining');

    // Buffet group
    const buffetGroup = menu.groups[0]!;
    expect(buffetGroup.type).toBe('Buffet');
    expect(buffetGroup.items[0]!.price).toBeNull();
    expect(buffetGroup.items[0]!.priceCents).toBeUndefined();
    expect(buffetGroup.items[0]!.prices).toBeUndefined();

    // Cocktail group
    const cocktailGroup = menu.groups[1]!;
    expect(cocktailGroup.type).toBe('Alcoholic Beverage');
    expect(cocktailGroup.items[0]!.priceCents).toBe(1650);
    expect(cocktailGroup.items[0]!.prices).toEqual([
      { cents: 1650, label: 'Per Serving' },
    ]);

    // Wine group
    const wineGroup = menu.groups[2]!;
    expect(wineGroup.type).toBe('Alcoholic Beverage');
    expect(wineGroup.items[0]!.priceCents).toBeUndefined();
    expect(wineGroup.items[0]!.prices).toEqual([
      { cents: 1200, label: 'Glass' },
      { cents: 4500, label: 'Bottle' },
    ]);

    // Validates with menuDtoSchema
    const parseResult = menuDtoSchema.safeParse(menu);
    expect(parseResult.success).toBe(true);
  });
});
