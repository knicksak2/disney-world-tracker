/**
 * Zod schemas for first-run onboarding endpoints
 * (`.kiro/specs/first-run-onboarding`, Requirements 1.3, 1.7, 1.9, 2.1).
 */

import { z } from 'zod';

import {
  ONBOARDING_INTENTS,
  ONBOARDING_PARKS,
  QUICK_COMPLETIONS_MAX,
  QUICK_COMPLETIONS_MIN,
} from '../constants/onboarding.js';
import { ianaTzSchema, uuidSchema } from './primitives.js';

export const onboardingIntentSchema = z.enum(ONBOARDING_INTENTS);
export const onboardingParkSchema = z.enum(ONBOARDING_PARKS);

export const onboardingPatchSchema = z
  .object({
    initialIntent: onboardingIntentSchema.optional(),
    selectedPark: onboardingParkSchema.optional(),
    complete: z.boolean().optional(),
    skip: z.boolean().optional(),
    dismissStarterChecklist: z.boolean().optional(),
    restoreStarterChecklist: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      !(v.dismissStarterChecklist === true && v.restoreStarterChecklist === true),
    {
      message: 'Cannot dismiss and restore starter checklist simultaneously.',
    },
  );

export type OnboardingPatchInput = z.infer<typeof onboardingPatchSchema>;

export const quickCompletionsInputSchema = z
  .object({
    experienceIds: z
      .array(uuidSchema)
      .min(QUICK_COMPLETIONS_MIN)
      .max(QUICK_COMPLETIONS_MAX),
    userTz: ianaTzSchema,
  })
  .strict();

export type QuickCompletionsInput = z.infer<typeof quickCompletionsInputSchema>;
