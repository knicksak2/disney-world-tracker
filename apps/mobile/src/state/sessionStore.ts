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

/**
 * One-shot notice shown on the sign-in screen right after the user deleted their
 * account (account-deletion R1.13). In memory only: never written to secure
 * storage, so it cannot survive an app restart.
 */
export interface AccountDeletionNoticeState {
  readonly scheduledPurgeAt: string;
  readonly graceDays: number;
}

export interface SessionState {
  token: string | null;
  hydrated: boolean;
  /**
   * Non-persisted (account-deletion R1.13). `clearToken()` deliberately leaves it
   * alone so it survives the sign-out transition that follows a deletion request.
   */
  accountDeletionNotice: AccountDeletionNoticeState | null;
  /** Non-persisted (account-deletion R4.9): "welcome back" after a restoring sign-in. */
  accountRestoredNotice: boolean;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  setAccountDeletionNotice: (notice: AccountDeletionNoticeState) => void;
  dismissAccountDeletionNotice: () => void;
  setAccountRestoredNotice: (value: boolean) => void;
  dismissAccountRestoredNotice: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  hydrated: false,
  accountDeletionNotice: null,
  accountRestoredNotice: false,
  setToken: async (token: string) => {
    await setSessionToken(token);
    // Signing in again is what cancels a pending deletion, so a "scheduled for
    // deletion" banner left over from the request must not outlive a successful
    // sign-in (it would reappear on the next logout). The same goes for a
    // "welcome back" notice left undismissed by an earlier session: it belongs to
    // the sign-in that restored the account, so a later ordinary sign-in must not
    // inherit it. Login and Reset set the flag AFTER awaiting this call.
    set({ token, accountDeletionNotice: null, accountRestoredNotice: false });
  },
  clearToken: async () => {
    await clearSessionToken();
    set({ token: null });
  },
  loadFromStorage: async () => {
    const stored = await getSessionToken();
    set({ token: stored ?? null, hydrated: true });
  },
  setAccountDeletionNotice: (notice) => set({ accountDeletionNotice: notice }),
  dismissAccountDeletionNotice: () => set({ accountDeletionNotice: null }),
  setAccountRestoredNotice: (value) => set({ accountRestoredNotice: value }),
  dismissAccountRestoredNotice: () => set({ accountRestoredNotice: false }),
}));
