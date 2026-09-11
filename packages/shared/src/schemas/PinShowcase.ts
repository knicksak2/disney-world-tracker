/**
 * Zod validation schemas for Pin Showcase DTOs and request bodies
 * (Feature: pin-collection, Requirement 24).
 */

import { z } from 'zod';

import { uuidSchema } from './primitives.js';

export const pinShowcasePlacementSchema = z
  .object({
    pinId: z.string().min(1).max(100),
    posX: z.number().min(0.0).max(1.0),
    posY: z.number().min(0.0).max(1.0),
    zIndex: z.number().int(),
  })
  .strict();

export const pinShowcaseSchema = z
  .object({
    ownerId: uuidSchema,
    placements: z.array(pinShowcasePlacementSchema),
    unplaced: z.array(z.string().min(1).max(100)).optional(),
  })
  .strict();

export const placePinRequestSchema = z
  .object({
    posX: z.number().min(0.0).max(1.0),
    posY: z.number().min(0.0).max(1.0),
  })
  .strict();
