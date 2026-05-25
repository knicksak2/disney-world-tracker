// Feature: disney-world-tracker, R6.10 (mobile session token storage)
//
// Thin wrapper over `expo-secure-store` so the rest of the mobile app never
// reaches into the platform secure-store API directly. Centralizing here means
// the API client and the auth/profile flows agree on:
//
//   - the SecureStore key (`SESSION_TOKEN_KEY`)
//   - the "no token stored" sentinel (`null`)
//   - the clearing semantics on logout / 401
//
// Keeping this module dependency-light (only `expo-secure-store`) also makes
// it trivial to mock from tests via `vi.mock('expo-secure-store')`.

import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore key under which the bearer session token is persisted.
 *
 * The `dwt.` prefix namespaces the key so it cannot collide with keys written
 * by other apps that share the same on-device SecureStore (Keychain on iOS,
 * Keystore-backed SharedPreferences on Android).
 */
export const SESSION_TOKEN_KEY = 'dwt.session.token';

/**
 * Persist the bearer session token in SecureStore.
 *
 * Called after a successful `POST /auth/register` or `POST /auth/login`.
 *
 * @param token Opaque bearer token issued by the backend.
 */
export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

/**
 * Retrieve the persisted bearer session token, or `null` when no session is
 * stored. The API client uses this to decide whether to attach an
 * `Authorization: Bearer <token>` header.
 */
export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

/**
 * Remove the persisted bearer session token.
 *
 * Called on logout and on any 401 response from the API (R6.10 — once a
 * session credential is invalid, the app must stop using it). Safe to call
 * when no token is stored: `expo-secure-store#deleteItemAsync` is a no-op in
 * that case.
 */
export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}
