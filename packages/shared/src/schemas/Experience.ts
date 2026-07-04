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
 * Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.15, 9.2, 9.3, 9.4
 */

import { z } from 'zod';

import {
  experienceCategorySchema,
  parkSchema,
  uuidSchema,
} from './primitives.js';

/** A single facet value: upstream id plus human-readable name (R9). */
const facetValueSchema = z.object({ id: z.string(), name: z.string() }).strict();

/** Grouped facets keyed by facet group, each holding a list of facet values (R9). */
const groupedFacetsSchema = z.record(z.string(), z.array(facetValueSchema));

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
    // WDW Resort_Area (geographic zone) for a Resort-area Experience, resolved
    // during Catalog_Sync. Present only when persisted; null/absent otherwise.
    // Capped at 200 chars to mirror the persistence length constraint.
    resortArea: z.string().max(200).nullable().optional(),
    // Enrichment facet fields, curated during Catalog_Sync. Each is optional so
    // pre-field fixtures may omit it; nullable where a persisted-but-absent
    // value is represented as null (R9.2, R9.3, R9.4).
    heightRequirement: z
      .object({
        id: z.string(),
        name: z.string(),
        minInches: z.number().nullable(),
        minCentimeters: z.number().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    groupedFacets: groupedFacetsSchema.optional(),
    physicalConsiderations: z.array(facetValueSchema).optional(),
    interestFacets: groupedFacetsSchema.optional(),
    whyThis: z
      .object({
        title: z.string().nullable(),
        bullets: z.array(z.string()),
        quotes: z.array(z.string()),
      })
      .strict()
      .nullable()
      .optional(),
    subType: z.string().max(200).nullable().optional(),
  })
  .strict();
