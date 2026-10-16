// Feature: dark-mode — AsyncStorage persistence boundary for the Appearance
// preference.
//
// Mirrors `api/sessionStorage.ts`'s shape and reasoning: one key, one "not
// found" sentinel, dependency-light so it's trivial to mock. The sole
// difference is the backing store (`AsyncStorage` here vs. `expo-secure-store`
// there) — this preference is a device-level display setting, not a security
// credential, so plain `AsyncStorage` is appropriate.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_APPEARANCE_PREFERENCE,
  isAppearancePreference,
  type AppearancePreference,
} from './appearance';

/**
 * AsyncStorage key under which the Appearance_Preference is persisted
 * (local-only — Requirement 3.1). The `dwt.` prefix matches the existing
 * `dwt.session.token` SecureStore key's namespacing convention.
 */
export const APPEARANCE_PREFERENCE_KEY = 'dwt.appearance.preference';

/**
 * Persist the Appearance_Preference to on-device storage.
 *
 * Stored as the raw enum string itself (e.g. `"dark"`), not a JSON
 * envelope — there is nothing to version or nest.
 */
export async function setStoredAppearancePreference(
  preference: AppearancePreference,
): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, preference);
}

/**
 * Read the persisted preference, falling back to the default when the key is
 * missing (never set), the read throws (unreadable), or the stored string is
 * not one of the three valid values (corrupt) — Requirement 3.3. Never
 * throws.
 */
export async function getStoredAppearancePreference(): Promise<AppearancePreference> {
  try {
    const raw = await AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY);
    return isAppearancePreference(raw) ? raw : DEFAULT_APPEARANCE_PREFERENCE;
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCE;
  }
}
