/**
 * Property tests for `theme/appearance.ts`'s pure functions (dark-mode spec).
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2, 3.3
 */

import fc from 'fast-check';

import {
  APPEARANCE_PREFERENCE_VALUES,
  isAppearancePreference,
  resolveActiveTheme,
  type AppearancePreference,
} from '../appearance';

// Feature: dark-mode, Property 1: fallback is total
//
// For any arbitrary string that is not exactly 'system', 'light', or
// 'dark', `isAppearancePreference` returns `false`. (The AsyncStorage-level
// half of this property — that `getStoredAppearancePreference()` resolves
// to the default for such a value without throwing — is covered by
// `appearanceStorage.test.ts`'s explicit missing/throwing/corrupt cases,
// introduced in a later task since `appearanceStorage.ts` does not exist
// yet at this point in the dependency graph.)
describe('Property 1: fallback is total', () => {
  it('isAppearancePreference returns false for any string outside the valid set', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        fc.pre(!(APPEARANCE_PREFERENCE_VALUES as readonly string[]).includes(value));
        expect(isAppearancePreference(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('isAppearancePreference returns false for null and undefined', () => {
    expect(isAppearancePreference(null)).toBe(false);
    expect(isAppearancePreference(undefined)).toBe(false);
  });
});

// Feature: dark-mode, Property 2: pinned preference is scheme-invariant
describe('Property 2: pinned preference is scheme-invariant', () => {
  it('resolveActiveTheme applied to a fixed light/dark preference always returns that preference, regardless of any sequence of OS scheme values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppearancePreference>('light', 'dark'),
        fc.array(
          fc.constantFrom<'light' | 'dark' | null | undefined>(
            'light',
            'dark',
            null,
            undefined,
          ),
        ),
        (preference, osSchemes) => {
          for (const osScheme of osSchemes) {
            expect(resolveActiveTheme(preference, osScheme)).toBe(preference);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("only 'system' lets the OS value flow through", () => {
    fc.assert(
      fc.property(fc.constantFrom<'light' | 'dark'>('light', 'dark'), (osScheme) => {
        expect(resolveActiveTheme('system', osScheme)).toBe(osScheme);
      }),
      { numRuns: 100 },
    );
  });
});
