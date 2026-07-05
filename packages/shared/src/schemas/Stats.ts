/**
 * Zod schema for `StatsDTO`.
 *
 * Each breakdown carries `completed`, `total`, and `percent`. The bounds
 * (`percent` in `[0, 100]`, integer counts) are checked, but the rounding to
 * one decimal place and the `min(100.0, …)` cap (R3.1-R3.3, R3.8) are
 * enforced by `computePercent` in Stats_Service rather than here so the
 * schema can validate values produced by either the server or a test fixture.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8
 */

import { z } from 'zod';

import { EXPERIENCE_CATEGORIES, PARKS } from '../enums.js';
import type { ExperienceCategory, Park } from '../enums.js';

import { completionPercentSchema } from './primitives.js';

const breakdownSchema = z
  .object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
    percent: completionPercentSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    // Defensive: a zero denominator must report `0.0` percent and `0` count
    // (R3.6, R3.7).
    if (value.total === 0 && (value.completed !== 0 || value.percent !== 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'breakdown with total=0 must have completed=0 and percent=0',
      });
    }
    // Defensive: completed cannot exceed total.
    if (value.completed > value.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'completed must be <= total',
      });
    }
  });

/**
 * A Coverage_Statistic cell (`CompletionCell`). Extends the breakdown shape
 * with a `remaining` count and a `completeBadge` flag. As with
 * `breakdownSchema`, the rounding of `percent` is enforced at computation
 * time; this schema checks the structural invariants:
 * - `completed <= total`,
 * - `remaining === total - completed`,
 * - `completeBadge === (total > 0 && completed === total)`,
 * - `total === 0` implies `completed === 0`, `percent === 0`, `remaining === 0`,
 *   and `completeBadge === false`.
 *
 * Validates: Requirements 1.11, 1.12, 2.3, 2.4, 2.5, 10.2
 */
export const completionCellSchema = z
  .object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
    percent: completionPercentSchema,
    remaining: z.number().int().min(0),
    completeBadge: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.completed > value.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'completed must be <= total',
      });
    }
    if (value.remaining !== value.total - value.completed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'remaining must equal total - completed',
      });
    }
    const expectedBadge = value.total > 0 && value.completed === value.total;
    if (value.completeBadge !== expectedBadge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'completeBadge must be true iff total > 0 and completed === total',
      });
    }
    if (
      value.total === 0 &&
      (value.completed !== 0 || value.percent !== 0 || value.remaining !== 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'cell with total=0 must have completed=0, percent=0, and remaining=0',
      });
    }
  });

const perParkShape = Object.fromEntries(
  PARKS.map((park) => [park, breakdownSchema] as const),
) as { [K in Park]: typeof breakdownSchema };

const perCategoryShape = Object.fromEntries(
  EXPERIENCE_CATEGORIES.map((category) => [category, breakdownSchema] as const),
) as { [K in ExperienceCategory]: typeof breakdownSchema };

export const statsSchema = z
  .object({
    overall: breakdownSchema,
    perPark: z.object(perParkShape).strict(),
    perCategory: z.object(perCategoryShape).strict(),
  })
  .strict();
