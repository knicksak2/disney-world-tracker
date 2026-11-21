import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_INTENTS,
  ONBOARDING_PARKS,
  QUICK_COMPLETIONS_MAX,
  onboardingPatchSchema,
  quickCompletionsInputSchema,
} from '../index.js';

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';

describe('First-run onboarding shared contracts (Task 1.5)', () => {
  describe('onboardingPatchSchema', () => {
    it('accepts empty patch and valid combinations of fields', () => {
      expect(onboardingPatchSchema.safeParse({}).success).toBe(true);
      for (const initialIntent of ONBOARDING_INTENTS) {
        expect(onboardingPatchSchema.safeParse({ initialIntent }).success).toBe(true);
      }
      for (const selectedPark of ONBOARDING_PARKS) {
        expect(onboardingPatchSchema.safeParse({ selectedPark }).success).toBe(true);
      }
      expect(
        onboardingPatchSchema.safeParse({
          initialIntent: 'in_park',
          selectedPark: 'EPCOT',
          complete: true,
        }).success,
      ).toBe(true);
      expect(onboardingPatchSchema.safeParse({ skip: true }).success).toBe(true);
      expect(
        onboardingPatchSchema.safeParse({ dismissStarterChecklist: true }).success,
      ).toBe(true);
      expect(
        onboardingPatchSchema.safeParse({ restoreStarterChecklist: true }).success,
      ).toBe(true);
      expect(
        onboardingPatchSchema.safeParse({
          dismissStarterChecklist: true,
          restoreStarterChecklist: false,
        }).success,
      ).toBe(true);
    });

    it('rejects unknown keys due to .strict()', () => {
      expect(
        onboardingPatchSchema.safeParse({ complete: true, extra: 'nope' }).success,
      ).toBe(false);
    });

    it('rejects invalid initialIntent or selectedPark', () => {
      expect(
        onboardingPatchSchema.safeParse({ initialIntent: 'invalid' }).success,
      ).toBe(false);
      expect(
        onboardingPatchSchema.safeParse({ selectedPark: 'Disney Springs' }).success,
      ).toBe(false);
    });

    it('rejects dismissing and restoring starter checklist simultaneously', () => {
      const res = onboardingPatchSchema.safeParse({
        dismissStarterChecklist: true,
        restoreStarterChecklist: true,
      });
      expect(res.success).toBe(false);
    });
  });

  describe('quickCompletionsInputSchema', () => {
    it('accepts 1 to 20 valid UUIDs with a valid IANA time zone shape', () => {
      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: [UUID_1, UUID_2],
          userTz: 'America/New_York',
        }).success,
      ).toBe(true);

      const twenty = Array.from({ length: QUICK_COMPLETIONS_MAX }, (_, i) =>
        `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      );
      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: twenty,
          userTz: 'UTC',
        }).success,
      ).toBe(true);
    });

    it('rejects 0 items, >20 items, non-UUIDs, invalid userTz, and unknown keys', () => {
      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: [],
          userTz: 'America/New_York',
        }).success,
      ).toBe(false);

      const twentyOne = Array.from({ length: QUICK_COMPLETIONS_MAX + 1 }, (_, i) =>
        `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      );
      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: twentyOne,
          userTz: 'America/New_York',
        }).success,
      ).toBe(false);

      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: ['not-a-uuid'],
          userTz: 'America/New_York',
        }).success,
      ).toBe(false);

      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: [UUID_1],
          userTz: '',
        }).success,
      ).toBe(false);

      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: [UUID_1],
          userTz: 'Invalid Zone!',
        }).success,
      ).toBe(false);

      expect(
        quickCompletionsInputSchema.safeParse({
          experienceIds: [UUID_1],
          userTz: 'America/New_York',
          extra: true,
        }).success,
      ).toBe(false);
    });
  });
});
