/**
 * Unit tests for Food List schemas and error catalog.
 *
 * Covers valid and invalid cases for:
 *   - `foodListNameSchema`
 *   - `createFoodListInputSchema`
 *   - `updateFoodListInputSchema`
 *   - `addFoodListItemInputSchema`
 *   - `reorderFoodListItemsInputSchema`
 *   - `shareFoodListInputSchema`
 *   - `foodListItemSchema`
 *   - `foodListSchema`
 *   - `foodListDetailSchema`
 *   - `foodListShareSchema`
 *   - `foodListCollectionSchema`
 *   - `foodListDiscoveryPageSchema`
 *   - Food list error codes and status mappings
 *
 * Validates: Requirements 1-11
 */

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeToHttpStatus } from '../../errors.js';
import { foodListNameSchema } from '../primitives.js';
import {
  addFoodListItemInputSchema,
  createFoodListInputSchema,
  foodListCollectionSchema,
  foodListDetailSchema,
  foodListDiscoveryPageSchema,
  foodListItemSchema,
  foodListRoleSchema,
  foodListSchema,
  foodListShareRoleSchema,
  foodListShareSchema,
  foodListVisibilitySchema,
  reorderFoodListItemsInputSchema,
  shareFoodListInputSchema,
  updateFoodListInputSchema,
} from '../FoodList.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

describe('foodListNameSchema', () => {
  it('accepts valid 1-100 character names and trims whitespace', () => {
    expect(foodListNameSchema.parse('  Snacks Around EPCOT  ')).toBe('Snacks Around EPCOT');
    expect(foodListNameSchema.parse('A')).toBe('A');
    expect(foodListNameSchema.parse('A'.repeat(100))).toBe('A'.repeat(100));
  });

  it('rejects empty, whitespace-only, or oversized names', () => {
    expect(() => foodListNameSchema.parse('')).toThrow();
    expect(() => foodListNameSchema.parse('   ')).toThrow();
    expect(() => foodListNameSchema.parse('A'.repeat(101))).toThrow();
  });
});

describe('foodList enum schemas', () => {
  it('parses valid visibility values', () => {
    expect(foodListVisibilitySchema.parse('private')).toBe('private');
    expect(foodListVisibilitySchema.parse('public')).toBe('public');
    expect(() => foodListVisibilitySchema.parse('hidden')).toThrow();
  });

  it('parses valid role values', () => {
    expect(foodListRoleSchema.parse('owner')).toBe('owner');
    expect(foodListRoleSchema.parse('editor')).toBe('editor');
    expect(foodListRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => foodListRoleSchema.parse('admin')).toThrow();
  });

  it('parses valid share role values', () => {
    expect(foodListShareRoleSchema.parse('editor')).toBe('editor');
    expect(foodListShareRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => foodListShareRoleSchema.parse('owner')).toThrow();
  });
});

describe('createFoodListInputSchema', () => {
  it('accepts valid name with visibility and isChecklist omitted', () => {
    const res = createFoodListInputSchema.safeParse({ name: 'Best Desserts' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.visibility).toBeUndefined();
      expect(res.data.isChecklist).toBeUndefined();
    }
  });

  it('accepts valid name with visibility private and public', () => {
    const priv = createFoodListInputSchema.safeParse({
      name: 'Best Desserts',
      visibility: 'private',
    });
    expect(priv.success).toBe(true);

    const pub = createFoodListInputSchema.safeParse({
      name: 'Best Desserts',
      visibility: 'public',
    });
    expect(pub.success).toBe(true);
  });

  it('accepts isChecklist true and false', () => {
    const checklist = createFoodListInputSchema.safeParse({
      name: 'Best Desserts',
      isChecklist: true,
    });
    expect(checklist.success).toBe(true);

    const nonChecklist = createFoodListInputSchema.safeParse({
      name: 'Best Desserts',
      isChecklist: false,
    });
    expect(nonChecklist.success).toBe(true);
  });

  it('rejects non-boolean isChecklist', () => {
    expect(
      createFoodListInputSchema.safeParse({
        name: 'Best Desserts',
        isChecklist: 'true',
      }).success,
    ).toBe(false);
    expect(
      createFoodListInputSchema.safeParse({
        name: 'Best Desserts',
        isChecklist: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid visibility value', () => {
    const res = createFoodListInputSchema.safeParse({
      name: 'Best Desserts',
      visibility: 'unlisted',
    });
    expect(res.success).toBe(false);
  });

  it('rejects empty name and extra fields', () => {
    expect(createFoodListInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createFoodListInputSchema.safeParse({ name: 'Valid', extra: true }).success).toBe(false);
  });
});

describe('updateFoodListInputSchema', () => {
  it('accepts optional name, visibility, and isChecklist', () => {
    expect(updateFoodListInputSchema.safeParse({}).success).toBe(true);
    expect(updateFoodListInputSchema.safeParse({ name: 'New Name' }).success).toBe(true);
    expect(updateFoodListInputSchema.safeParse({ visibility: 'public' }).success).toBe(true);
    expect(updateFoodListInputSchema.safeParse({ isChecklist: true }).success).toBe(true);
    expect(updateFoodListInputSchema.safeParse({ isChecklist: false }).success).toBe(true);
    expect(
      updateFoodListInputSchema.safeParse({
        name: 'New Name',
        visibility: 'private',
        isChecklist: true,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid visibility and non-boolean isChecklist', () => {
    expect(updateFoodListInputSchema.safeParse({ visibility: 'unlisted' }).success).toBe(false);
    expect(updateFoodListInputSchema.safeParse({ isChecklist: 'yes' }).success).toBe(false);
  });
});

describe('addFoodListItemInputSchema and reorderFoodListItemsInputSchema', () => {
  it('validates addFoodListItemInputSchema', () => {
    expect(addFoodListItemInputSchema.safeParse({ foodItemId: UUID_A }).success).toBe(true);
    expect(addFoodListItemInputSchema.safeParse({ foodItemId: 'not-uuid' }).success).toBe(false);
  });

  it('validates reorderFoodListItemsInputSchema', () => {
    expect(
      reorderFoodListItemsInputSchema.safeParse({
        foodItemIds: [UUID_A, UUID_B],
        expectedVersion: 3,
      }).success,
    ).toBe(true);

    expect(
      reorderFoodListItemsInputSchema.safeParse({
        foodItemIds: [UUID_A],
        expectedVersion: -1,
      }).success,
    ).toBe(false);
  });
});

describe('shareFoodListInputSchema and foodListShareSchema', () => {
  it('validates shareFoodListInputSchema with viewer and editor roles', () => {
    expect(
      shareFoodListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'viewer',
      }).success,
    ).toBe(true);

    expect(
      shareFoodListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'editor',
      }).success,
    ).toBe(true);

    expect(
      shareFoodListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('validates foodListShareSchema', () => {
    expect(
      foodListShareSchema.safeParse({
        recipientId: UUID_A,
        recipientDisplayName: 'Alex',
        role: 'editor',
        sharedAt: '2026-06-15T12:00:00Z',
      }).success,
    ).toBe(true);
  });
});

describe('foodListItemSchema and foodListDetailSchema', () => {
  const sampleItem = {
    foodItemId: UUID_A,
    name: 'Dole Whip',
    experienceId: UUID_B,
    experienceName: 'Aloha Isle',
    locationId: null,
    locationName: null,
    price: '$5.99',
    position: 0,
    addedByUserId: UUID_C,
    addedByDisplayName: 'Jordan',
  };

  const sampleList = {
    id: UUID_A,
    ownerId: UUID_B,
    ownerDisplayName: 'Jordan',
    name: 'Must Eats',
    visibility: 'public' as const,
    isChecklist: false,
    likeCount: 5,
    itemCount: 1,
    createdAt: '2026-06-15T12:00:00Z',
    updatedAt: '2026-06-15T12:00:00Z',
  };

  it('validates foodListItemSchema with and without gotten', () => {
    expect(foodListItemSchema.safeParse(sampleItem).success).toBe(true);
    expect(foodListItemSchema.safeParse({ ...sampleItem, gotten: true }).success).toBe(true);
    expect(foodListItemSchema.safeParse({ ...sampleItem, gotten: false }).success).toBe(true);
    expect(foodListItemSchema.safeParse({ ...sampleItem, gotten: 'yes' }).success).toBe(false);
  });

  // Feature: food-lists, Requirement 13.19 — rating field on a checklist item
  it('validates foodListItemSchema rating: absent, null, and a valid 1-10 value all accepted; out-of-range rejected', () => {
    expect(foodListItemSchema.safeParse(sampleItem).success).toBe(true);
    expect(
      foodListItemSchema.safeParse({ ...sampleItem, gotten: true, rating: null }).success,
    ).toBe(true);
    expect(
      foodListItemSchema.safeParse({ ...sampleItem, gotten: true, rating: 9 }).success,
    ).toBe(true);
    expect(
      foodListItemSchema.safeParse({ ...sampleItem, gotten: true, rating: 0 }).success,
    ).toBe(false);
    expect(
      foodListItemSchema.safeParse({ ...sampleItem, gotten: true, rating: 11 }).success,
    ).toBe(false);
    expect(
      foodListItemSchema.safeParse({ ...sampleItem, gotten: true, rating: 5.5 }).success,
    ).toBe(false);
  });

  it('validates foodListSchema', () => {
    expect(foodListSchema.safeParse(sampleList).success).toBe(true);
    expect(foodListSchema.safeParse({ ...sampleList, isChecklist: true }).success).toBe(true);
  });

  it('validates foodListDetailSchema with and without gottenCount', () => {
    const detail = {
      ...sampleList,
      liked: true,
      saved: false,
      version: 2,
      myRole: 'owner' as const,
      items: [sampleItem],
    };
    expect(foodListDetailSchema.safeParse(detail).success).toBe(true);

    const checklistDetail = {
      ...sampleList,
      isChecklist: true,
      liked: true,
      saved: false,
      version: 2,
      myRole: 'owner' as const,
      items: [{ ...sampleItem, gotten: true }],
      gottenCount: 1,
    };
    expect(foodListDetailSchema.safeParse(checklistDetail).success).toBe(true);
  });

  it('rejects invalid role in detail', () => {
    const detail = {
      ...sampleList,
      liked: true,
      saved: false,
      version: 2,
      myRole: 'admin',
      items: [sampleItem],
    };
    expect(foodListDetailSchema.safeParse(detail).success).toBe(false);
  });
});

describe('foodListCollectionSchema and foodListDiscoveryPageSchema', () => {
  const sampleList = {
    id: UUID_A,
    ownerId: UUID_B,
    ownerDisplayName: 'Jordan',
    name: 'Must Eats',
    visibility: 'public' as const,
    isChecklist: false,
    likeCount: 5,
    itemCount: 1,
    createdAt: '2026-06-15T12:00:00Z',
    updatedAt: '2026-06-15T12:00:00Z',
  };

  it('validates collection with available and unavailable saved items', () => {
    const res = foodListCollectionSchema.safeParse({
      owned: [sampleList],
      saved: [
        { ...sampleList, available: true },
        { available: false, foodListId: UUID_D },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('validates discovery page with items and cursor', () => {
    expect(
      foodListDiscoveryPageSchema.safeParse({
        items: [sampleList],
        nextCursor: 'base64cursor==',
      }).success,
    ).toBe(true);

    expect(
      foodListDiscoveryPageSchema.safeParse({
        items: [],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });
});

describe('food-lists error catalog codes', () => {
  it('contains all required error codes mapped to expected HTTP statuses', () => {
    const expected = [
      { code: 'food_list_not_found', status: 404 },
      { code: 'food_list_edit_forbidden', status: 403 },
      { code: 'food_list_item_duplicate', status: 409 },
      { code: 'food_list_reorder_mismatch', status: 400 },
      { code: 'food_list_stale_write', status: 409 },
      { code: 'food_list_share_not_friend', status: 403 },
      { code: 'food_list_save_self', status: 400 },
    ] as const;

    for (const { code, status } of expected) {
      expect(ERROR_CODES).toContain(code);
      expect(errorCodeToHttpStatus[code]).toBe(status);
    }
  });
});
