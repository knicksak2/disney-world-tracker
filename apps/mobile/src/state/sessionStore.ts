import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * Session state for the mobile client.
 *
 * The session token is the server-issued opaque bearer token returned by
 * `/auth/login` and `/auth/register`. We persist it in `expo-secure-store`
 * (Keychain on iOS, EncryptedSharedPreferences on Android) so the user
 * stays signed in across app launches and the token is never written to
 * plain JS storage (R6.10, R6.11).
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

const SESSION_TOKEN_KEY = 'dwt.sessionToken';

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
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    set({ token });
  },
  clearToken: async () => {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    set({ token: null });
  },
  loadFromStorage: async () => {
    const stored = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    set({ token: stored ?? null, hydrated: true });
  },
}));
