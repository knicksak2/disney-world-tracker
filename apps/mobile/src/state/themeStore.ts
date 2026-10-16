// Feature: dark-mode — Zustand store for the Appearance preference.
//
// Mirrors `state/sessionStore.ts`'s shape exactly (`preference`/`hydrated`,
// a setter, `loadFromStorage`), same "thin I/O wrapper module + store module"
// split. Deliberately has no import of, or read access to, `sessionStore.ts`
// / `api/sessionStorage.ts` / the session token — the Appearance_Preference
// is a device-level, not account-level, setting (Requirement 3.4; Property 6).

import { create } from 'zustand';

import {
  getStoredAppearancePreference,
  setStoredAppearancePreference,
} from '../theme/appearanceStorage';
import { DEFAULT_APPEARANCE_PREFERENCE, type AppearancePreference } from '../theme/appearance';

export interface ThemeState {
  preference: AppearancePreference;
  hydrated: boolean;
  setPreference: (preference: AppearancePreference) => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: DEFAULT_APPEARANCE_PREFERENCE,
  hydrated: false,
  setPreference: async (preference) => {
    // Update in-memory state even if the write fails, so the current session's
    // UI still reflects the User's choice — never block on persistence
    // succeeding (design.md Error Handling).
    set({ preference });
    try {
      await setStoredAppearancePreference(preference);
    } catch {
      // Non-fatal: the next cold start may not see this change if the write
      // never succeeds, but the running session already does.
    }
  },
  loadFromStorage: async () => {
    const stored = await getStoredAppearancePreference();
    set({ preference: stored, hydrated: true });
  },
}));
