// Feature: social-sharing-loop, R8.2 (stable device installation id)
//
// Thin wrapper over `expo-secure-store` that mints and persists a stable
// device installation identifier. The identifier is the "device" key the
// Push_Registration_Service upserts on: `POST /me/push-registrations` keys a
// registration on `(user_id, device_id)` so that a device which rotates its
// Expo Push_Token replaces its prior registration rather than accumulating
// duplicates (R8.2), and `DELETE /me/push-registrations` invalidates *this*
// device's registration on logout (R8.4/R8.8).
//
// The id is generated exactly once per install and then read back on every
// subsequent launch. It lives in SecureStore alongside the session token so
// it survives app restarts and is never written to plain JS storage. It is
// NOT a secret — it only needs to be stable and unique per install — but
// reusing the same secure store keeps all persisted device identity in one
// place and one dependency.

import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore key under which the stable device installation id is
 * persisted. The `dwt.` prefix namespaces the key so it cannot collide with
 * keys written by other apps sharing the on-device secure store, matching
 * the convention used by `SESSION_TOKEN_KEY`.
 */
export const DEVICE_ID_KEY = 'dwt.push.deviceId';

/**
 * Generate a RFC-4122-shaped v4 identifier.
 *
 * A device installation id only has to be stable and collision-resistant per
 * install; it is not a security token. We therefore avoid pulling in a crypto
 * dependency and build the id from `Math.random`, which is sufficient for an
 * install-scoped identifier that is generated once and then persisted.
 */
function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Return this device's stable installation id, minting and persisting one on
 * first call. Subsequent calls (including across app launches) return the
 * same value read back from SecureStore.
 *
 * Concurrent callers on a fresh install can race, but the read-then-write is
 * idempotent enough for our purposes: whichever value wins is persisted and
 * returned consistently thereafter.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing !== null && existing.length > 0) {
    return existing;
  }
  const deviceId = generateDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
