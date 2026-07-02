/**
 * Zod schema for `ExperienceDTO`.
 *
 * Field constraints mirror the design's data model:
 *   - `name`        1-200 characters (R1.8)
 *   - `description` 0-1000 characters (R1.8) — empty allowed
 *   - `park`        Park enum (R1.6)
 *   - `category`    ExperienceCategory enum (R1.3-R1.5)
 *   - `id`          UUID v5 of upstream entity id (R1.7)
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.15
 */

import { z } from 'zod';

import {
  experienceCategorySchema,
  parkSchema,
  uuidSchema,
} from './primitives.js';

export const experienceSchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(1).max(200),
    park: parkSchema,
    category: experienceCategorySchema,
    description: z.string().max(1000),
    active: z.boolean(),
    // Optional + nullable: curated out of band from the catalog sync, so a
    // row may have no image yet (null) and pre-field fixtures may omit it.
    imageUrl: z.string().url().max(2048).nullable().optional(),
    // Themed Land within a ThemePark/WaterPark, resolved during Catalog_Sync.
    // Present only when persisted; null/absent otherwise. Capped at 200 chars
    // to mirror the persistence length constraint (R1.7, R3.1, R3.2).
    land: z.string().max(200).nullable().optional(),
  })
  .strict();
