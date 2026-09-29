/**
 * Zod schemas for Experience List contracts (Feature: experience-lists).
 *
 * Direct structural port of `FoodList.ts`'s schema patterns — same name
 * length validation (1-100 chars, trimmed), visibility enum, and role enum.
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.5, 3.1, 4.1, 4.3, 7.1
 */

import { z } from 'zod';
import {
  experienceCategorySchema,
  foodListNameSchema,
  isoTimestampSchema,
  parkSchema,
  uuidSchema,
} from './primitives.js';

/** Experience_List name: trimmed, 1-100 characters — identical rule to `foodListNameSchema`. */
export const experienceListNameSchema = foodListNameSchema;

export const experienceListVisibilitySchema = z.enum(['private', 'public']);
export const experienceListRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const experienceListShareRoleSchema = z.enum(['viewer', 'editor']);

export const createExperienceListInputSchema = z
  .object({
    name: experienceListNameSchema,
    visibility: experienceListVisibilitySchema.optional(),
  })
  .strict();

export const updateExperienceListInputSchema = z
  .object({
    name: experienceListNameSchema.optional(),
    visibility: experienceListVisibilitySchema.optional(),
    /** Setting `true` pins the list (server stamps `pinned_at = now()`); `false` unpins it (`pinned_at = NULL`). */
    pinned: z.boolean().optional(),
  })
  .strict();

export const addExperienceListItemInputSchema = z
  .object({
    experienceId: uuidSchema,
  })
  .strict();

export const reorderExperienceListItemsInputSchema = z
  .object({
    experienceIds: z.array(uuidSchema),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export const shareExperienceListInputSchema = z
  .object({
    recipientId: uuidSchema,
    role: experienceListShareRoleSchema,
  })
  .strict();

export const experienceListItemSchema = z
  .object({
    experienceId: uuidSchema,
    name: z.string().min(1),
    park: parkSchema.nullable(),
    category: experienceCategorySchema,
    position: z.number().int().min(0),
    addedByUserId: uuidSchema.nullable(),
    addedByDisplayName: z.string().nullable(),
  })
  .strict();

export const experienceListSchema = z
  .object({
    id: uuidSchema,
    ownerId: uuidSchema,
    ownerDisplayName: z.string().min(1),
    name: experienceListNameSchema,
    visibility: experienceListVisibilitySchema,
    likeCount: z.number().int().min(0),
    itemCount: z.number().int().min(0),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    pinnedAt: isoTimestampSchema.nullable(),
  })
  .strict();

export const experienceListDetailSchema = experienceListSchema
  .extend({
    liked: z.boolean(),
    saved: z.boolean(),
    version: z.number().int().min(0),
    myRole: experienceListRoleSchema,
    items: z.array(experienceListItemSchema),
  })
  .strict();

export const experienceListShareSchema = z
  .object({
    recipientId: uuidSchema,
    recipientDisplayName: z.string().min(1),
    role: experienceListShareRoleSchema,
    sharedAt: isoTimestampSchema,
  })
  .strict();

export const savedExperienceListItemSchema = z.discriminatedUnion('available', [
  experienceListSchema.extend({ available: z.literal(true) }),
  z.object({ available: z.literal(false), experienceListId: uuidSchema }),
]);

export const experienceListCollectionSchema = z
  .object({
    owned: z.array(experienceListSchema),
    saved: z.array(savedExperienceListItemSchema),
  })
  .strict();

export const experienceListDiscoveryPageSchema = z
  .object({
    items: z.array(experienceListSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
