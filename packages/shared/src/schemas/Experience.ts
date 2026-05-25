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
  })
  .strict();
