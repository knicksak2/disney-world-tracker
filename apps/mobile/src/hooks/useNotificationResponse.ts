/**
 * Notification tap deep-linking handler (task 20.1).
 *
 * Mounted once at the app root (`App.tsx`), this hook turns a tapped push
 * notification into an in-app deep link. A Share notification routes to the
 * Inbox per Requirement 10; a friend-request notification (carrying a
 * `friendRequestId`) routes to the `FriendsList` where the incoming request can
 * be accepted or declined:
 *
 *   - It reacts to a tap whether the App was NOT running (cold start), in the
 *     background, or in the foreground. A cold-start tap is recovered from
 *     `getLastNotificationResponseAsync`; a background/foreground tap arrives
 *     through the response listener (R10.1).
 *   - On a tap it navigates to the `Inbox` as soon as the navigation container
 *     is ready — i.e. within the foreground-interactive window (R10.1) —
 *     forwarding a resolvable `shareId` so the `Inbox` can continue to the
 *     Share's destination and mark it read (R10.2) or show a "no longer
 *     available" message when the Share is gone (R10.4).
 *   - When the App is not authenticated it holds the pending tap and defers
 *     navigation until authentication completes, then opens the Inbox (R10.3).
 *   - When the notification carries no resolvable Share id it still opens the
 *     Inbox with its current contents (R10.5).
 *
 * The navigation itself is delegated to `navigateToInbox` (the shared
 * navigation ref) and, for the destination hop and read-state, to the
 * `InboxScreen`'s existing tap-through wiring (task 8.1) via the `shareId`
 * param — so the Requirement 5 destination logic lives in exactly one place.
 *
 * `expo-notifications` is imported as a module (not injected) so unit tests
 * (task 20.2) can mock it directly.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { useCallback, useEffect, useRef } from 'react';

import type * as NotificationsModule from 'expo-notifications';

import { loadNotifications } from '../env/notifications';
import {
  navigateToFriendsList,
  navigateToInbox,
} from '../navigation/navigationRef';
import { useSessionStore } from '../state/sessionStore';

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests can drive the readiness timeline)
// ---------------------------------------------------------------------------

/**
 * Upper bound on how long we keep retrying the Inbox navigation while the
 * navigation container comes up after a cold-start tap. Kept under the 3-second
 * foreground-navigation budget (R10.1); in practice the container is ready
 * within a few frames and the first attempt succeeds.
 */
export const FOREGROUND_NAV_TIMEOUT_MS = 3_000;

/** Delay between navigation-readiness retries. */
export const NAV_READY_POLL_MS = 100;

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Extract a resolvable Share id from a tapped notification response.
 *
 * The Share id travels in the notification's `data` payload under `shareId`.
 * Returns the id when present as a non-empty string, or `null` when the
 * response is absent or carries no resolvable id — the R10.5 case, where the
 * Inbox is opened with its current contents and no destination hop.
 */
export function extractShareId(
  response: NotificationsModule.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification?.request?.content?.data;
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const shareId = (data as { shareId?: unknown }).shareId;
  return typeof shareId === 'string' && shareId.length > 0 ? shareId : null;
}

/**
 * Detect a friend-request tap. A friend-request notification carries a
 * `friendRequestId` in its `data` payload (and no `shareId`); its tap opens the
 * `FriendsList` where the incoming request can be accepted or declined rather
 * than the Share inbox.
 */
export function isFriendRequestTap(
  response: NotificationsModule.NotificationResponse | null | undefined,
): boolean {
  const data = response?.notification?.request?.content?.data;
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const friendRequestId = (data as { friendRequestId?: unknown })
    .friendRequestId;
  return typeof friendRequestId === 'string' && friendRequestId.length > 0;
}

/**
 * Classify a tapped notification into its navigation target. Friend-request
 * taps route to the `FriendsList`; everything else is treated as a Share tap
 * (carrying a resolvable `shareId`, or none for the R10.5 open-inbox case).
 */
export function classifyTap(
  response: NotificationsModule.NotificationResponse | null | undefined,
): PendingTap {
  if (isFriendRequestTap(response)) {
    return { kind: 'friendRequest' };
  }
  return { kind: 'share', shareId: extractShareId(response) };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * A tapped notification awaiting navigation. A Share tap carries its resolved
 * Share id (or `null` for the R10.5 open-inbox case); a friend-request tap
 * carries no id and routes to the `FriendsList`.
 */
export type PendingTap =
  | { readonly kind: 'share'; readonly shareId: string | null }
  | { readonly kind: 'friendRequest' };

export function useNotificationResponse(): void {
  const token = useSessionStore((state) => state.token);
  const hydrated = useSessionStore((state) => state.hydrated);

  // The most recent tap that has not yet been navigated. A ref (not state)
  // because the value is consumed by imperative navigation, not rendered.
  const pendingRef = useRef<PendingTap | null>(null);
  // Guards against overlapping readiness-retry loops when `flush` is called
  // repeatedly (listener + auth/hydration effects) for the same pending tap.
  const flushingRef = useRef(false);

  /**
   * Attempt to consume the pending tap: open the Inbox once the App is
   * authenticated (R10.3) and the navigation container is ready (R10.1). Reads
   * the session straight from the store so it is never stale across the
   * listener and effect call sites.
   */
  const flush = useCallback((): void => {
    if (flushingRef.current) {
      return;
    }
    if (pendingRef.current === null) {
      return;
    }

    const { token: currentToken, hydrated: isHydrated } =
      useSessionStore.getState();
    // Defer until we know the auth state (hydration) and are authenticated.
    // An unauthenticated tap is held so that, after the User authenticates,
    // this same pending tap opens the Inbox (R10.3).
    if (!isHydrated || currentToken === null) {
      return;
    }

    flushingRef.current = true;
    const startedAt = Date.now();

    const tryNavigate = (): void => {
      const pending = pendingRef.current;
      if (pending === null) {
        flushingRef.current = false;
        return;
      }
      const navigated =
        pending.kind === 'friendRequest'
          ? navigateToFriendsList()
          : navigateToInbox(
              pending.shareId !== null
                ? { shareId: pending.shareId }
                : undefined,
            );
      if (navigated) {
        pendingRef.current = null;
        flushingRef.current = false;
        return;
      }
      // Container not ready yet — retry until the foreground-navigation
      // window elapses (R10.1).
      if (Date.now() - startedAt >= FOREGROUND_NAV_TIMEOUT_MS) {
        flushingRef.current = false;
        return;
      }
      setTimeout(tryNavigate, NAV_READY_POLL_MS);
    };

    tryNavigate();
  }, []);

  // Cold start (App was not running): recover the tap that launched the App.
  useEffect(() => {
    // Load expo-notifications only where remote push is supported. In Expo Go
    // (SDK 53+) this is null and the effect no-ops without evaluating the
    // module (which would crash at load) — the App simply opens normally.
    const notifications = loadNotifications();
    if (notifications === null) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const last = await notifications.getLastNotificationResponseAsync();
        if (cancelled || last === null || last === undefined) {
          return;
        }
        pendingRef.current = classifyTap(last);
        flush();
      } catch {
        // A failure to read the launch response must not crash startup; the
        // App simply opens normally.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flush]);

  // Background / foreground taps while the App is running.
  useEffect(() => {
    // Load expo-notifications only where remote push is supported; in Expo Go
    // this is null and no listener is attached (attaching would throw).
    const notifications = loadNotifications();
    if (notifications === null) {
      return undefined;
    }
    const subscription = notifications.addNotificationResponseReceivedListener(
      (response) => {
        pendingRef.current = classifyTap(response);
        flush();
      },
    );
    return () => {
      subscription.remove();
    };
  }, [flush]);

  // Re-attempt a held tap once authentication (R10.3) or hydration completes.
  useEffect(() => {
    flush();
  }, [token, hydrated, flush]);
}
