/**
 * Unit tests for Food Item Logging schemas and error catalog.
 *
 * Covers valid and invalid cases for:
 *   - `foodItemNameSchema`
 *   - `submitFoodItemInputSchema`
 *   - `foodItemSchema`
 *   - `createFoodItemLogInputSchema`
 *   - `foodItemLogSchema`
 *   - `foodItemLogHistorySchema`
 *   - `createUserSubmittedLocationInputSchema`
 *   - `userSubmittedLocationSchema`
 *   - `locationSuggestionSchema`
 *   - New error codes and status mappings
 *
 * Validates: Requirements 1.6, 1.8, 2.1, 2.2, 3.1, 3.3, 4.1, 4.2, 6.1, 6.2, 6.4, 6.5
 */

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeToHttpStatus } from '../../errors.js';
import { foodItemNameSchema } from '../primitives.js';
import {
  foodItemSchema,
  submitFoodItemInputSchema,
} from '../FoodItem.js';
import {
  createFoodItemLogInputSchema,
  foodItemLogHistorySchema,
  foodItemLogSchema,
  foodItemLogWithContextSchema,
} from '../FoodItemLog.js';
import {
  createUserSubmittedLocationInputSchema,
  locationSuggestionSchema,
  userSubmittedLocationSchema,
} from '../UserSubmittedLocation.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

describe('foodItemNameSchema', () => {
  it('accepts valid 1-200 character names and trims whitespace', () => {
    expect(foodItemNameSchema.parse('  Dole Whip  ')).toBe('Dole Whip');
    expect(foodItemNameSchema.parse('A')).toBe('A');
    expect(foodItemNameSchema.parse('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('rejects empty or whitespace-only names', () => {
    expect(() => foodItemNameSchema.parse('')).toThrow();
    expect(() => foodItemNameSchema.parse('   ')).toThrow();
  });

  it('rejects names exceeding 200 characters', () => {
    expect(() => foodItemNameSchema.parse('x'.repeat(201))).toThrow();
  });
});

describe('submitFoodItemInputSchema', () => {
  it('accepts valid name', () => {
    const res = submitFoodItemInputSchema.safeParse({ name: 'Churro' });
    expect(res.success).toBe(true);
  });

  it('rejects empty name or extra fields', () => {
    expect(submitFoodItemInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(submitFoodItemInputSchema.safeParse({ name: 'Churro', extra: 1 }).success).toBe(false);
  });
});

describe('foodItemSchema', () => {
  it('accepts valid experience-scoped food item DTO', () => {
    const res = foodItemSchema.safeParse({
      id: UUID_A,
      experienceId: UUID_B,
      locationId: null,
      name: 'Grey Stuff',
      price: '$5.99',
      source: 'menu_sync',
      currentlyOnMenu: true,
    });
    expect(res.success).toBe(true);
  });

  it('accepts valid location-scoped food item DTO', () => {
    const res = foodItemSchema.safeParse({
      id: UUID_A,
      experienceId: null,
      locationId: UUID_C,
      name: 'Cheeseburger Spring Roll',
      price: null,
      source: 'user_submitted',
      currentlyOnMenu: true,
    });
    expect(res.success).toBe(true);
  });

  it('rejects invalid source or extra fields', () => {
    expect(
      foodItemSchema.safeParse({
        id: UUID_A,
        experienceId: UUID_B,
        locationId: null,
        name: 'Grey Stuff',
        price: null,
        source: 'invalid_source',
        currentlyOnMenu: true,
      }).success,
    ).toBe(false);
  });
});

describe('createFoodItemLogInputSchema', () => {
  it('accepts minimal date and tz input', () => {
    const res = createFoodItemLogInputSchema.safeParse({
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
    });
    expect(res.success).toBe(true);
  });

  it('accepts full rating and note input', () => {
    const res = createFoodItemLogInputSchema.safeParse({
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      rating: 9,
      note: 'Super tasty!',
    });
    expect(res.success).toBe(true);
  });

  it('accepts null rating and note', () => {
    const res = createFoodItemLogInputSchema.safeParse({
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      rating: null,
      note: null,
    });
    expect(res.success).toBe(true);
  });

  it('rejects rating out of 1..10 range', () => {
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
        rating: 0,
      }).success,
    ).toBe(false);
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
        rating: 11,
      }).success,
    ).toBe(false);
  });

  it('rejects note over 2000 characters', () => {
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
        note: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
  });

  it('rejects malformed date or tz', () => {
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: 'not-a-date',
        userTz: 'America/New_York',
      }).success,
    ).toBe(false);
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-06-15',
        userTz: '',
      }).success,
    ).toBe(false);
  });
});

describe('foodItemLogSchema and foodItemLogHistorySchema', () => {
  it('validates foodItemLogSchema', () => {
    const res = foodItemLogSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      foodItemId: UUID_C,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00Z',
      rating: 8,
      note: null,
    });
    expect(res.success).toBe(true);
  });

  it('validates foodItemLogHistorySchema with logs array and repeatCount', () => {
    const res = foodItemLogHistorySchema.safeParse({
      foodItemId: UUID_C,
      repeatCount: 1,
      logs: [
        {
          id: UUID_A,
          userId: UUID_B,
          foodItemId: UUID_C,
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
          loggedAt: '2026-06-15T12:00:00Z',
          rating: 8,
          note: null,
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects negative repeatCount', () => {
    expect(
      foodItemLogHistorySchema.safeParse({
        foodItemId: UUID_C,
        repeatCount: -1,
        logs: [],
      }).success,
    ).toBe(false);
  });
});

describe('foodItemLogWithContextSchema', () => {
  it('validates a valid food log with restaurant context', () => {
    const res = foodItemLogWithContextSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      foodItemId: UUID_C,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00Z',
      rating: 9,
      note: 'Superb',
      foodItemName: 'Grey Stuff',
      currentlyOnMenu: true,
      restaurantName: 'Be Our Guest',
      locationName: null,
    });
    expect(res.success).toBe(true);
  });

  it('validates a valid food log with location context and null rating', () => {
    const res = foodItemLogWithContextSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      foodItemId: UUID_C,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00Z',
      rating: null,
      note: null,
      foodItemName: 'Cheeseburger Spring Roll',
      currentlyOnMenu: false,
      restaurantName: null,
      locationName: 'Spring Roll Cart',
    });
    expect(res.success).toBe(true);
  });

  it('rejects empty or whitespace-only foodItemName', () => {
    const res = foodItemLogWithContextSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      foodItemId: UUID_C,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00Z',
      rating: null,
      note: null,
      foodItemName: '   ',
      currentlyOnMenu: true,
      restaurantName: 'Be Our Guest',
      locationName: null,
    });
    expect(res.success).toBe(false);
  });

  it('rejects non-boolean currentlyOnMenu or extra fields', () => {
    expect(
      foodItemLogWithContextSchema.safeParse({
        id: UUID_A,
        userId: UUID_B,
        foodItemId: UUID_C,
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
        loggedAt: '2026-06-15T12:00:00Z',
        rating: null,
        note: null,
        foodItemName: 'Grey Stuff',
        currentlyOnMenu: 'yes',
        restaurantName: 'Be Our Guest',
        locationName: null,
      }).success,
    ).toBe(false);

    expect(
      foodItemLogWithContextSchema.safeParse({
        id: UUID_A,
        userId: UUID_B,
        foodItemId: UUID_C,
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
        loggedAt: '2026-06-15T12:00:00Z',
        rating: null,
        note: null,
        foodItemName: 'Grey Stuff',
        currentlyOnMenu: true,
        restaurantName: 'Be Our Guest',
        locationName: null,
        extraProperty: true,
      }).success,
    ).toBe(false);
  });
});

describe('createUserSubmittedLocationInputSchema and locationSuggestionSchema', () => {
  it('accepts valid location creation input', () => {
    const res = createUserSubmittedLocationInputSchema.safeParse({
      name: 'Spring Roll Cart',
      park: 'Magic Kingdom',
    });
    expect(res.success).toBe(true);
  });

  it('rejects invalid park', () => {
    expect(
      createUserSubmittedLocationInputSchema.safeParse({
        name: 'Spring Roll Cart',
        park: 'Universal Studios',
      }).success,
    ).toBe(false);
  });

  it('validates userSubmittedLocationSchema', () => {
    const res = userSubmittedLocationSchema.safeParse({
      id: UUID_A,
      name: 'Spring Roll Cart',
      park: 'Magic Kingdom',
    });
    expect(res.success).toBe(true);
  });

  it('validates locationSuggestionSchema with similarity score in [0, 1]', () => {
    expect(
      locationSuggestionSchema.safeParse({
        id: UUID_A,
        name: 'Spring Roll Cart',
        similarity: 0.85,
      }).success,
    ).toBe(true);

    expect(
      locationSuggestionSchema.safeParse({
        id: UUID_A,
        name: 'Spring Roll Cart',
        similarity: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe('food-item-logging error catalog codes', () => {
  it('contains all required error codes mapped to expected HTTP statuses', () => {
    const expected = [
      { code: 'food_item_not_found', status: 404 },
      { code: 'food_item_duplicate', status: 409 },
      { code: 'food_log_not_found', status: 404 },
      { code: 'food_log_future_date', status: 400 },
      { code: 'location_duplicate', status: 409 },
    ] as const;

    for (const { code, status } of expected) {
      expect(ERROR_CODES).toContain(code);
      expect(errorCodeToHttpStatus[code]).toBe(status);
    }
  });
});
