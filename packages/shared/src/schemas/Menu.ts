/**
 * Validation schemas for Menu DTOs.
 *
 * Supports backward-compatible parsing of legacy v1 menu JSON
 * and enriched v2 menu JSON with parsed cents and price variants.
 *
 * Validates: restaurant-menu-display R8.1, R8.2, R8.3
 */

import { z } from 'zod';

export const menuPriceEntrySchema = z.object({
  cents: z.number().int().positive(),
  label: z.string().nullable(),
}).strict();

export const menuDtoSchema = z.object({
  menuType: z.string(),
  cuisineType: z.string().nullable().optional(),
  serviceStyle: z.string().nullable().optional(),
  experience: z.string().nullable().optional(),
  groups: z.array(z.object({
    name: z.string(),
    type: z.string().nullable().optional(),
    items: z.array(z.object({
      name: z.string(),
      price: z.string().nullable().optional(),
      priceCents: z.number().int().positive().nullable().optional(),
      prices: z.array(menuPriceEntrySchema).optional(),
    })),
  })),
});

