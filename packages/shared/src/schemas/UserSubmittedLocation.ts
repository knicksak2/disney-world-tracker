/**
 * Zod schemas for User_Submitted_Location contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 6.1, 6.2
 */

import { z } from 'zod';
import { foodItemNameSchema, parkSchema, uuidSchema } from './primitives.js';

export const createUserSubmittedLocationInputSchema = z
  .object({
    name: foodItemNameSchema,
    park: parkSchema,
  })
  .strict();

export const userSubmittedLocationSchema = z
  .object({
    id: uuidSchema,
    name: foodItemNameSchema,
    park: parkSchema,
  })
  .strict();

export const locationSuggestionSchema = z
  .object({
    id: uuidSchema,
    name: foodItemNameSchema,
    park: parkSchema,
    similarity: z.number().min(0).max(1),
  })
  .strict();

export type CreateUserSubmittedLocationInput = z.infer<
  typeof createUserSubmittedLocationInputSchema
>;

