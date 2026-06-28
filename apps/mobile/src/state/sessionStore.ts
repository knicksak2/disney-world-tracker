import { create } from 'zustand';

import {
  clearSessionToken,
  getSessionToken,
  setSessionToken,
} from '../api/sessionStorage';

/**
 * Session state for the mobile client.
 *
 * The session token is the server-issued opaque bearer token returned by
 * `/auth/login` and `/auth/register`. We persist it in `expo-secure-store`
 * (Keychain on iOS, EncryptedSharedPreferences on Android) so the user
 * stays signed in across app launches and the token is never written to
 * plain JS storage (R6.10, R6.11).
 *
 * IMPORTANT: persistence goes through the shared `api/sessionStorage`
 * helpers rather than calling `expo-secure-store` directly. Those same
 * helpers are what `api/client.ts#apiRequest` reads to attach the
 * `Authorization: Bearer <token>` header. Using a single module (and thus
 * a single SecureStore key, `dwt.session.token`) is what keeps the
 * navigator's view of "am I signed in?" in lockstep with the token the API
 * client actually sends. A previous version of this store wrote to a
 * different key (`dwt.sessionToken`), so the navigator showed the main tabs
 * while every authenticated request went out with no token and 401'd.
 *
 * The store exposes three mutations:
 *   - `setToken`     — call after a successful login/register.
 *   - `clearToken`   — call on logout, or from the unauthorized callback
 *                      registered by the navigator when the API client
 *                      sees a 401.
 *   - `loadFromStorage` — call once on app start to hydrate the in-memory
 *                      state from secure storage.
 *
 * `hydrated` flips to `true` after `loadFromStorage` resolves, so the UI
 * can show a splash/loading state until we know whether the user has a
 * valid session.
 */

export interface SessionState {
  token: string | null;
  hydrated: boolean;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  hydrated: false,
  setToken: async (token: string) => {
    await setSessionToken(token);
    set({ token });
  },
  clearToken: async () => {
    await clearSessionToken();
    set({ token: null });
  },
  loadFromStorage: async () => {
    const stored = await getSessionToken();
    set({ token: stored ?? null, hydrated: true });
  },
}));
