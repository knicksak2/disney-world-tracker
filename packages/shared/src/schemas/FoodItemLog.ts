/**
 * Zod schemas for Food_Item_Log contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 3.1, 4.1, 4.2
 */

import { z } from 'zod';
import {
  foodItemNameSchema,
  ianaTzSchema,
  isoDateSchema,
  isoTimestampSchema,
  noteBodySchema,
  ratingValueSchema,
  uuidSchema,
} from './primitives.js';

export const createFoodItemLogInputSchema = z
  .object({
    visitedOn: isoDateSchema,
    userTz: ianaTzSchema,
    rating: ratingValueSchema.nullable().optional(),
    note: noteBodySchema.nullable().optional(),
  })
  .strict();

export const foodItemLogSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    foodItemId: uuidSchema,
    visitedOn: isoDateSchema,
    userTz: ianaTzSchema,
    loggedAt: isoTimestampSchema,
    rating: ratingValueSchema.nullable(),
    note: z.string().nullable(),
  })
  .strict();

export const foodItemLogHistorySchema = z
  .object({
    foodItemId: uuidSchema,
    repeatCount: z.number().int().min(0),
    logs: z.array(foodItemLogSchema),
  })
  .strict();

export const foodItemLogWithContextSchema = foodItemLogSchema
  .extend({
    foodItemName: foodItemNameSchema,
    currentlyOnMenu: z.boolean(),
    restaurantName: z.string().nullable(),
    locationName: z.string().nullable(),
  })
  .strict();

export const updateFoodItemLogInputSchema = z
  .object({
    rating: ratingValueSchema.nullable().optional(),
    note: noteBodySchema.nullable().optional(),
  })
  .strict();

export type CreateFoodItemLogInput = z.infer<typeof createFoodItemLogInputSchema>;
export type UpdateFoodItemLogInput = z.infer<typeof updateFoodItemLogInputSchema>;
export type FoodItemLogWithContext = z.infer<typeof foodItemLogWithContextSchema>;


