/**
 * Notification tap deep-linking handler.
 *
 * Mounted once at the app root (`App.tsx`), this hook turns a tapped push
 * notification into an in-app deep link. Following the Notification_Center
 * consolidation (notification-center task 16.1), a tapped push for any of the
 * four supported domains — a Share, a friend-request (carrying a
 * `friendRequestId`), a Trip_Invite (carrying `{ tripInviteId }`), or a
 * Rode_With_Tag (carrying `{ rodeWithTagId, tripLogEntryId }`) — now opens the
 * single Notification_Center rather than a per-domain handler screen (R13.1,
 * R13.4):
 *
 *   - It reacts to a tap whether the App was NOT running (cold start), in the
 *     background, or in the foreground. A cold-start tap is recovered from
 *     `getLastNotificationResponseAsync`; a background/foreground tap arrives
 *     through the response listener.
 *   - On a tap it navigates to the Notification_Center as soon as the
 *     navigation container is ready — i.e. within the foreground-interactive
 *     window (R13.1) — forwarding a `focusRef` derived from the payload so the
 *     center can surface the referenced Attention_Item while it is still
 *     pending (R13.2).
 *   - When the App is not authenticated it holds the pending tap and defers
 *     navigation until authentication completes, then opens the
 *     Notification_Center. A tap that is never authenticated within the session
 *     is dropped rather than navigated (the tap is only ever consumed once the
 *     store reports an authenticated session).
 *   - When the notification carries no resolvable routing id (e.g. a
 *     friend-request tap) it still opens the feed with its current contents.
 *
 * Surfacing the referenced item, or the "no longer available" indication when
 * it is no longer pending (R13.3), is owned by `NotificationCenterScreen`
 * (task 16.2). The handler's sole job is to classify the tap and dispatch to
 * `navigateToNotificationCenter` with the appropriate `focusRef`.
 *
 * `expo-notifications` is imported as a module (not injected) so unit tests can
 * mock it directly.
 *
 * Validates: Requirements 13.1, 13.4
 */

import { useCallback, useEffect, useRef } from 'react';

import type * as NotificationsModule from 'expo-notifications';

import { loadNotifications } from '../env/notifications';
import { navigateToNotificationCenter } from '../navigation/navigationRef';
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
 * Extract a routing Trip_Invite id from a tapped notification response. A
 * Trip_Invite push notification carries `{ tripInviteId }` in its `data`
 * payload (R6.6, R6.7); its tap opens the invite accept/decline view (R18.2).
 * Returns the id when present as a non-empty string, or `null` otherwise.
 */
export function extractTripInviteId(
  response: NotificationsModule.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification?.request?.content?.data;
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const tripInviteId = (data as { tripInviteId?: unknown }).tripInviteId;
  return typeof tripInviteId === 'string' && tripInviteId.length > 0
    ? tripInviteId
    : null;
}

/**
 * Extract the routing ids of a Rode_With_Tag tap. A Rode_With_Tag push
 * notification carries `{ rodeWithTagId, tripLogEntryId }` in its `data`
 * payload (R10.8); its tap opens the tag confirm view (R18.3). Returns both ids
 * when each is present as a non-empty string, or `null` when either is absent.
 */
export function extractRodeWithTag(
  response: NotificationsModule.NotificationResponse | null | undefined,
): { readonly rodeWithTagId: string; readonly tripLogEntryId: string } | null {
  const data = response?.notification?.request?.content?.data;
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const rodeWithTagId = (data as { rodeWithTagId?: unknown }).rodeWithTagId;
  const tripLogEntryId = (data as { tripLogEntryId?: unknown }).tripLogEntryId;
  if (
    typeof rodeWithTagId === 'string' &&
    rodeWithTagId.length > 0 &&
    typeof tripLogEntryId === 'string' &&
    tripLogEntryId.length > 0
  ) {
    return { rodeWithTagId, tripLogEntryId };
  }
  return null;
}

/**
 * Classify a tapped notification into its navigation target. A Trip_Invite tap
 * (carrying `{ tripInviteId }`, R18.2) routes to the invite accept/decline
 * view; a Rode_With_Tag tap (carrying `{ rodeWithTagId, tripLogEntryId }`,
 * R18.3) routes to the tag confirm view; a friend-request tap routes to the
 * `FriendsList`; everything else is treated as a Share tap (carrying a
 * resolvable `shareId`, or none for the R10.5 open-inbox case). The Trip kinds
 * are checked first so their routing ids take precedence over the Share
 * fallback.
 */
export function classifyTap(
  response: NotificationsModule.NotificationResponse | null | undefined,
): PendingTap {
  const tripInviteId = extractTripInviteId(response);
  if (tripInviteId !== null) {
    return { kind: 'tripInvite', tripInviteId };
  }
  const rodeWith = extractRodeWithTag(response);
  if (rodeWith !== null) {
    return {
      kind: 'rodeWithTag',
      rodeWithTagId: rodeWith.rodeWithTagId,
      tripLogEntryId: rodeWith.tripLogEntryId,
    };
  }
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
 * carries no id and routes to the `FriendsList`; a Trip_Invite tap carries its
 * `tripInviteId` (R18.2) and a Rode_With_Tag tap its `rodeWithTagId` plus
 * `tripLogEntryId` (R18.3) and route into the Trips tab.
 */
export type PendingTap =
  | { readonly kind: 'share'; readonly shareId: string | null }
  | { readonly kind: 'friendRequest' }
  | { readonly kind: 'tripInvite'; readonly tripInviteId: string }
  | {
      readonly kind: 'rodeWithTag';
      readonly rodeWithTagId: string;
      readonly tripLogEntryId: string;
    };

/**
 * Dispatch a pending tap to its navigation target through the shared
 * navigation ref. Returns whatever the navigation helper returns — `true` once
 * the dispatch is issued, or `false` when the container is not ready yet so the
 * caller can retry within the foreground-navigation window (R13.1).
 *
 * All four notification kinds — Friend_Request, Trip_Invite, Rode_With_Tag, and
 * Share — now open the single Notification_Center rather than a per-domain
 * handler screen (R13.1, R13.4). Each kind forwards the identifiers it carries
 * as a `focusRef` so the center can surface the referenced Attention_Item while
 * it is still pending (R13.2); when the referenced item is no longer pending or
 * otherwise unavailable, the screen shows the "no longer available" indication
 * (R13.3, owned by the screen — task 16.2). A friend-request tap carries no
 * routing id, so it opens the feed without a `focusRef`.
 */
function dispatchPendingTap(pending: PendingTap): boolean {
  switch (pending.kind) {
    case 'friendRequest':
      // The friend-request push carries no request id, so open the feed with
      // no focus target; the pending request still appears in the list.
      return navigateToNotificationCenter();
    case 'tripInvite':
      return navigateToNotificationCenter({
        focusRef: { inviteId: pending.tripInviteId },
      });
    case 'rodeWithTag':
      return navigateToNotificationCenter({
        focusRef: {
          tagId: pending.rodeWithTagId,
          tripLogEntryId: pending.tripLogEntryId,
        },
      });
    case 'share':
      return navigateToNotificationCenter(
        pending.shareId !== null
          ? { focusRef: { shareId: pending.shareId } }
          : undefined,
      );
  }
}

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
   * Attempt to consume the pending tap: open its target once the App is
   * authenticated (R10.3, R7.8, R18.4) and the navigation container is ready
   * (R10.1). Reads the session straight from the store so it is never stale
   * across the listener and effect call sites.
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
      const navigated = dispatchPendingTap(pending);
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
