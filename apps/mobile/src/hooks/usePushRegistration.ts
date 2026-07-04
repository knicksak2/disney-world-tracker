/**
 * Push registration + permission hook (task 18.1).
 *
 * Owns the device-side lifecycle of a `Push_Registration` so the
 * `Notification_Service` can deliver Share push notifications to the User's
 * device. Mounted once at the app root, it reacts to authentication state:
 *
 *   - On authentication, if `Notification_Permission` has never been
 *     requested on this device (OS status `undetermined`), it requests it
 *     (R9.1). If already granted it proceeds straight to registration.
 *   - On grant, it obtains the Expo `Push_Token` and registers it via
 *     `POST /me/push-registrations` within the registration window (R8.1),
 *     keyed by a stable device installation id persisted in
 *     `expo-secure-store` (R8.2).
 *   - If it cannot obtain a token or the API rejects the registration, it
 *     retries up to `MAX_REGISTRATION_RETRIES` times no more than
 *     `RETRY_DELAY_MS` apart, then continues without an active registration
 *     so all in-app sharing/Inbox functionality still works (R8.7).
 *   - On denial it registers nothing and the app continues normally (R9.2).
 *
 * Logout invalidation (R8.4/R8.8) is handled by the standalone
 * `invalidatePushRegistration` function rather than the hook, because the
 * request must be issued while the session token is still present (i.e.
 * *before* the logout flow clears it). It is fire-and-forget: the logout
 * flow does not block on the result, and a failed invalidation never blocks
 * completing logout.
 *
 * `expo-notifications` and `expo-secure-store` are imported as modules (not
 * injected) so unit tests (task 18.2) can mock them directly.
 *
 * Validates: Requirements 8.1, 8.2, 8.7, 8.8, 9.1, 9.2
 */

import { useEffect } from 'react';

import Constants from 'expo-constants';

import { apiRequest } from '../api/client';
import { getOrCreateDeviceId } from '../api/deviceId';
import { loadNotifications, type NotificationsApi } from '../env/notifications';
import { remotePushSupported } from '../env/pushSupport';
import { useSessionStore } from '../state/sessionStore';

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests can drive the retry timeline)
// ---------------------------------------------------------------------------

/**
 * Maximum number of *retries* after the initial registration attempt. With
 * the initial attempt this allows up to four total attempts, satisfying
 * "retry the registration up to 3 times" (R8.7).
 */
export const MAX_REGISTRATION_RETRIES = 3;

/**
 * Delay between registration attempts. Kept well under the 60-second ceiling
 * R8.7 places on the gap between attempts while still spacing retries out so
 * a transient API/network blip has time to clear.
 */
export const RETRY_DELAY_MS = 5_000;

/**
 * Per-attempt timeout for the `POST /me/push-registrations` call, forwarded
 * to `apiRequest` as an abort signal. Bounds a single attempt so a hung
 * request cannot stall the registration window (R8.1) indefinitely.
 */
export const REGISTRATION_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Endpoint contracts
// ---------------------------------------------------------------------------

const PUSH_REGISTRATIONS_PATH = '/me/push-registrations';

interface RegisterPushBody {
  readonly deviceId: string;
  readonly expoPushToken: string;
}

interface InvalidatePushBody {
  readonly deviceId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the EAS project id from `app.config.ts`'s `extra.eas.projectId`.
 * `getExpoPushTokenAsync` needs it to mint a token in EAS/standalone
 * builds; when absent (e.g. some dev contexts) we omit it and let
 * `expo-notifications` fall back to its own resolution.
 */
function resolveProjectId(): string | undefined {
  const eas = (
    Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined
  )?.eas;
  return typeof eas?.projectId === 'string' ? eas.projectId : undefined;
}

/** Resolve after `ms`, or immediately if the cancel signal has already fired. */
function delay(ms: number, cancel: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (cancel.cancelled) {
      resolve();
      return;
    }
    setTimeout(resolve, ms);
  });
}

/**
 * Obtain the Expo `Push_Token` for this device and register it with the API
 * as an active `Push_Registration` for the current User (R8.1, R8.2).
 *
 * Throws if the token cannot be obtained or the API rejects the
 * registration, so the caller's retry loop can react (R8.7).
 */
async function registerDevice(notifications: NotificationsApi): Promise<void> {
  const deviceId = await getOrCreateDeviceId();

  const projectId = resolveProjectId();
  const tokenResponse = await notifications.getExpoPushTokenAsync(
    projectId !== undefined ? { projectId } : undefined,
  );
  const expoPushToken = tokenResponse.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRATION_TIMEOUT_MS);
  try {
    const body: RegisterPushBody = { deviceId, expoPushToken };
    await apiRequest<null>('POST', PUSH_REGISTRATIONS_PATH, body, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ensure `Notification_Permission` is granted, requesting it only when it has
 * never been requested on this device (OS status `undetermined`, R9.1).
 *
 * Returns `true` when permission is granted (register), `false` when the User
 * has denied it or declines the prompt (register nothing and continue, R9.2).
 */
async function ensurePermissionGranted(
  notifications: NotificationsApi,
): Promise<boolean> {
  const current = await notifications.getPermissionsAsync();
  if (current.status === 'granted') {
    return true;
  }
  // Only prompt when permission has never been requested (R9.1). A prior
  // denial is respected: we do not re-prompt and we register nothing (R9.2).
  if (current.status === 'undetermined') {
    const requested = await notifications.requestPermissionsAsync();
    return requested.status === 'granted';
  }
  return false;
}

/**
 * Run the full permission + registration flow with bounded retries.
 *
 * The permission decision itself is not retried — only token acquisition and
 * the API registration are (R8.7). `cancel` lets the hook abandon an
 * in-flight flow (and any pending inter-attempt delay) when the User logs out
 * or the component unmounts.
 */
async function runRegistrationFlow(cancel: { cancelled: boolean }): Promise<void> {
  // Load expo-notifications only where remote push is supported. In Expo Go
  // this is null and the whole flow no-ops (R8.7, R9.2) without ever evaluating
  // the module (which would crash at load in Expo Go, SDK 53+).
  const notifications = loadNotifications();
  if (notifications === null) {
    return;
  }

  let granted: boolean;
  try {
    granted = await ensurePermissionGranted(notifications);
  } catch {
    // Treat a permission-probe failure as "not granted": register nothing
    // and continue (R9.2). It is not a registration failure to retry.
    return;
  }

  if (!granted || cancel.cancelled) {
    return;
  }

  for (let attempt = 0; attempt <= MAX_REGISTRATION_RETRIES; attempt += 1) {
    if (cancel.cancelled) {
      return;
    }
    try {
      await registerDevice(notifications);
      return;
    } catch {
      // Out of retries — continue without an active registration (R8.7).
      if (attempt === MAX_REGISTRATION_RETRIES) {
        return;
      }
      await delay(RETRY_DELAY_MS, cancel);
    }
  }
}

/**
 * Request invalidation of this device's `Push_Registration` (R8.4).
 *
 * Fire-and-forget by contract: it resolves without throwing even when the
 * request fails so the logout flow can call it and proceed without blocking
 * on the result (R8.8). MUST be called while the session token is still
 * present — i.e. before the logout flow clears the session — so the
 * authenticated `DELETE` reaches the API.
 */
export async function invalidatePushRegistration(): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const body: InvalidatePushBody = { deviceId };
    await apiRequest<null>('DELETE', PUSH_REGISTRATIONS_PATH, body);
  } catch {
    // R8.8: invalidation is best-effort; a failure never blocks logout.
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drive push registration off authentication state. Mount once near the app
 * root. When a session token is present (and hydration has completed so we do
 * not act on a not-yet-known session), it runs the permission + registration
 * flow exactly once for that authenticated session; the flow is abandoned if
 * the User logs out or the host unmounts before it finishes.
 */
export function usePushRegistration(): void {
  const token = useSessionStore((state) => state.token);
  const hydrated = useSessionStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated || token === null) {
      return;
    }

    // Expo Go (SDK 53+) has no remote-push support, so obtaining a token would
    // throw. Skip registration and continue without one — all in-App sharing
    // and Inbox functionality still works (R8.7, R9.2). A development or
    // production build reports a supported environment and runs the flow.
    if (!remotePushSupported()) {
      return;
    }

    const cancel = { cancelled: false };
    void runRegistrationFlow(cancel);

    return () => {
      cancel.cancelled = true;
    };
  }, [hydrated, token]);
}
