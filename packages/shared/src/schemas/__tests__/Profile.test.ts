/**
 * Unit tests for Profile avatar preset catalog and Profile Zod schemas.
 *
 * Validates:
 *   - AVATAR_PRESET_IDS has 24 unique trademark-safe presets and excludes retired ids
 *   - isAvatarPresetId type guard accepts all valid ids and rejects retired/invalid values
 *   - profileSchema and profileAvatarInputSchema accept every preset id and null,
 *     and reject retired/unknown ids
 */

import { describe, expect, it } from 'vitest';

import { AVATAR_PRESET_IDS, isAvatarPresetId } from '../../constants/avatarPresets.js';
import { profileAvatarInputSchema, profileSchema } from '../Profile.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RETIRED_IDS = ['ear-balloon', 'ice-cream-bar'] as const;

describe('AVATAR_PRESET_IDS catalog', () => {
  it('contains 24 unique preset ids and excludes retired trademarked ids', () => {
    expect(AVATAR_PRESET_IDS).toHaveLength(24);
    expect(new Set(AVATAR_PRESET_IDS).size).toBe(24);
    for (const retired of RETIRED_IDS) {
      expect(AVATAR_PRESET_IDS).not.toContain(retired);
    }
  });

  it('isAvatarPresetId matches every active preset and rejects retired/invalid inputs', () => {
    for (const id of AVATAR_PRESET_IDS) {
      expect(isAvatarPresetId(id)).toBe(true);
    }
    for (const bad of [...RETIRED_IDS, '', 'unknown-preset', null, undefined, 42]) {
      expect(isAvatarPresetId(bad)).toBe(false);
    }
  });
});

describe('profileSchema & profileAvatarInputSchema', () => {
  it('accepts every valid preset id and null', () => {
    for (const preset of [...AVATAR_PRESET_IDS, null]) {
      expect(
        profileAvatarInputSchema.safeParse({ avatarPreset: preset }).success,
      ).toBe(true);
      expect(
        profileSchema.safeParse({
          userId: USER_ID,
          displayName: 'Explorer',
          avatarPreset: preset,
          overallCompletionPercent: 42.5,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects retired trademarked ids and unknown preset ids', () => {
    for (const bad of [...RETIRED_IDS, 'not-a-preset', '']) {
      expect(
        profileAvatarInputSchema.safeParse({ avatarPreset: bad }).success,
      ).toBe(false);
      expect(
        profileSchema.safeParse({
          userId: USER_ID,
          displayName: 'Explorer',
          avatarPreset: bad,
          overallCompletionPercent: 42.5,
        }).success,
      ).toBe(false);
    }
  });
});
