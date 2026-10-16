/**
 * Unit tests for `theme/appearance.ts`'s pure functions.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2, 3.3
 */

import {
  APPEARANCE_PREFERENCE_VALUES,
  DEFAULT_APPEARANCE_PREFERENCE,
  isAppearancePreference,
  resolveActiveTheme,
  resolveStatusBarStyle,
} from '../appearance';

describe('APPEARANCE_PREFERENCE_VALUES / DEFAULT_APPEARANCE_PREFERENCE', () => {
  it('contains exactly the three valid preference values (Requirement 1.1)', () => {
    expect(APPEARANCE_PREFERENCE_VALUES).toEqual(['system', 'light', 'dark']);
  });

  it("defaults to 'system' (Requirement 1.2)", () => {
    expect(DEFAULT_APPEARANCE_PREFERENCE).toBe('system');
  });
});

describe('isAppearancePreference', () => {
  it.each(['system', 'light', 'dark'])('returns true for the valid value %s', (value) => {
    expect(isAppearancePreference(value)).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isAppearancePreference('')).toBe(false);
  });

  it('returns false for a plausible-looking but wrong string', () => {
    expect(isAppearancePreference('Dark')).toBe(false);
    expect(isAppearancePreference('SYSTEM')).toBe(false);
    expect(isAppearancePreference('auto')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isAppearancePreference(null)).toBe(false);
    expect(isAppearancePreference(undefined)).toBe(false);
    expect(isAppearancePreference(42)).toBe(false);
    expect(isAppearancePreference(true)).toBe(false);
    expect(isAppearancePreference({})).toBe(false);
    expect(isAppearancePreference(['dark'])).toBe(false);
  });
});

describe('resolveActiveTheme', () => {
  describe("preference === 'system'", () => {
    it("resolves to 'dark' when the OS scheme is 'dark'", () => {
      expect(resolveActiveTheme('system', 'dark')).toBe('dark');
    });

    it("resolves to 'light' when the OS scheme is 'light'", () => {
      expect(resolveActiveTheme('system', 'light')).toBe('light');
    });

    it("falls back to 'light' when the OS scheme is null (Requirement 1.3)", () => {
      expect(resolveActiveTheme('system', null)).toBe('light');
    });

    it("falls back to 'light' when the OS scheme is undefined (Requirement 1.3)", () => {
      expect(resolveActiveTheme('system', undefined)).toBe('light');
    });
  });

  describe("preference === 'light' (Requirement 1.4 — explicit preference always wins)", () => {
    it.each(['light', 'dark', null, undefined] as const)(
      "resolves to 'light' regardless of OS scheme %s",
      (osScheme) => {
        expect(resolveActiveTheme('light', osScheme)).toBe('light');
      },
    );
  });

  describe("preference === 'dark' (Requirement 1.4 — explicit preference always wins)", () => {
    it.each(['light', 'dark', null, undefined] as const)(
      "resolves to 'dark' regardless of OS scheme %s",
      (osScheme) => {
        expect(resolveActiveTheme('dark', osScheme)).toBe('dark');
      },
    );
  });
});

describe('resolveStatusBarStyle', () => {
  it("returns 'dark' content style for a light Active theme (Requirement 6.2)", () => {
    expect(resolveStatusBarStyle('light')).toBe('dark');
  });

  it("returns 'light' content style for a dark Active theme (Requirement 6.2)", () => {
    expect(resolveStatusBarStyle('dark')).toBe('light');
  });
});
