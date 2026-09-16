/**
 * Zod schemas for Food_Item contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 1.6, 1.8, 2.1, 2.4, 6.5, 6.6
 */

import { z } from 'zod';
import { foodItemNameSchema, uuidSchema } from './primitives.js';

export const submitFoodItemInputSchema = z
  .object({
    name: foodItemNameSchema,
  })
  .strict();

export const foodItemSchema = z
  .object({
    id: uuidSchema,
    experienceId: uuidSchema.nullable(),
    locationId: uuidSchema.nullable(),
    name: foodItemNameSchema,
    price: z.string().nullable(),
    source: z.enum(['menu_sync', 'user_submitted']),
    currentlyOnMenu: z.boolean(),
  })
  .strict();

export type SubmitFoodItemInput = z.infer<typeof submitFoodItemInputSchema>;

