/**
 * Zod schemas for Food List contracts (Feature: food-lists).
 *
 * Validates: Requirements 1-11
 */

import { z } from 'zod';
import {
  foodListNameSchema,
  isoTimestampSchema,
  ratingValueSchema,
  uuidSchema,
} from './primitives.js';

export const foodListVisibilitySchema = z.enum(['private', 'public']);
export const foodListRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const foodListShareRoleSchema = z.enum(['viewer', 'editor']);

export const createFoodListInputSchema = z
  .object({
    name: foodListNameSchema,
    visibility: foodListVisibilitySchema.optional(),
    isChecklist: z.boolean().optional(),
  })
  .strict();

export const updateFoodListInputSchema = z
  .object({
    name: foodListNameSchema.optional(),
    visibility: foodListVisibilitySchema.optional(),
    isChecklist: z.boolean().optional(),
    /** Setting `true` pins the list (server stamps `pinned_at = now()`); `false` unpins it (`pinned_at = NULL`). */
    pinned: z.boolean().optional(),
  })
  .strict();

export const addFoodListItemInputSchema = z
  .object({
    foodItemId: uuidSchema,
  })
  .strict();

export const reorderFoodListItemsInputSchema = z
  .object({
    foodItemIds: z.array(uuidSchema),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export const shareFoodListInputSchema = z
  .object({
    recipientId: uuidSchema,
    role: foodListShareRoleSchema,
  })
  .strict();

export const foodListItemSchema = z
  .object({
    foodItemId: uuidSchema,
    name: z.string().min(1),
    experienceId: uuidSchema.nullable(),
    experienceName: z.string().nullable(),
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    price: z.string().nullable(),
    position: z.number().int().min(0),
    addedByUserId: uuidSchema.nullable(),
    addedByDisplayName: z.string().nullable(),
    gotten: z.boolean().optional(),
    rating: ratingValueSchema.nullable().optional(),
    logId: uuidSchema.nullable().optional(),
  })
  .strict();

export const foodListSchema = z
  .object({
    id: uuidSchema,
    ownerId: uuidSchema,
    ownerDisplayName: z.string().min(1),
    name: foodListNameSchema,
    visibility: foodListVisibilitySchema,
    isChecklist: z.boolean(),
    likeCount: z.number().int().min(0),
    itemCount: z.number().int().min(0),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    pinnedAt: isoTimestampSchema.nullable(),
  })
  .strict();

export const foodListDetailSchema = foodListSchema
  .extend({
    liked: z.boolean(),
    saved: z.boolean(),
    version: z.number().int().min(0),
    myRole: foodListRoleSchema,
    items: z.array(foodListItemSchema),
    gottenCount: z.number().int().min(0).optional(),
  })
  .strict();

export const foodListShareSchema = z
  .object({
    recipientId: uuidSchema,
    recipientDisplayName: z.string().min(1),
    role: foodListShareRoleSchema,
    sharedAt: isoTimestampSchema,
  })
  .strict();

export const savedFoodListItemSchema = z.discriminatedUnion('available', [
  foodListSchema.extend({ available: z.literal(true) }),
  z.object({ available: z.literal(false), foodListId: uuidSchema }),
]);

export const foodListCollectionSchema = z
  .object({
    owned: z.array(foodListSchema),
    saved: z.array(savedFoodListItemSchema),
  })
  .strict();

export const foodListDiscoveryPageSchema = z
  .object({
    items: z.array(foodListSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
