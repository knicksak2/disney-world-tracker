/**
 * Shared navigation container ref (task 20.1).
 *
 * The notification tap handler (`useNotificationResponse`) runs at the app
 * root — outside any screen — so it cannot reach a screen-scoped
 * `useNavigation`. Instead it dispatches navigation imperatively through this
 * module-level ref, which is attached to the app's single
 * `NavigationContainer` in `App.tsx`.
 *
 * Deep-linking a tapped Share notification lands the User on the `Inbox`
 * (R10.1), which lives at the bottom of the navigator tree:
 *
 *   RootStack ▸ MainTabs ▸ Friends ▸ FriendsStack ▸ Inbox
 *
 * `navigateToInbox` issues one nested `navigate` that walks that path in a
 * single call and, when a resolvable Share id is present, forwards it as the
 * `Inbox` screen's `shareId` param so the Inbox can drive the rest of the
 * deep-link (navigate to the Share's destination and mark it read, R10.2, or
 * show a "no longer available" message when the Share is gone, R10.4). When no
 * Share id is carried it opens the Inbox with its current contents (R10.5).
 *
 * It returns `false` when the container is not yet mounted/ready so the caller
 * can retry until the app reaches a foreground-interactive state (R10.1).
 */

import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Navigate to the `Inbox`, optionally carrying a deep-link `shareId`.
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry within the
 * foreground-navigation window, R10.1).
 */
export function navigateToInbox(params?: { readonly shareId?: string }): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Friends',
    params: {
      screen: 'Inbox',
      params,
    },
  });
  return true;
}

/**
 * Navigate to the `FriendsList`, the screen that renders incoming pending
 * Friend_Requests with their Accept/Decline actions. Used to deep-link a
 * tapped friend-request push notification.
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry within the
 * foreground-navigation window).
 */
export function navigateToFriendsList(): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Friends',
    params: {
      screen: 'FriendsList',
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Trips deep-link routing (trips task 16.3).
//
// The Trip notification tap handler (task 17.8) runs at the app root, so — like
// the Share/friend-request handlers above — it dispatches navigation through
// this module-level ref rather than a screen-scoped `useNavigation`. Each Trip
// deep-link target lives at the bottom of the navigator tree:
//
//   RootStack ▸ MainTabs ▸ Trips ▸ TripsStack ▸ {TripInvite | RodeWithConfirm}
//
// The helpers below issue one nested `navigate` that walks that path in a
// single call, forwarding only the routing id(s) the notification carries.
// They return `false` when the container is not yet mounted/ready so the caller
// can retry within the foreground-navigation window (R18.2–R18.4).
// ---------------------------------------------------------------------------

/**
 * Navigate to the `Trip_Invite` accept/decline view for a tapped Trip_Invite
 * push notification, forwarding the notification's `tripInviteId` (R18.2).
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry within the
 * foreground-navigation window).
 */
export function navigateToTripInvite(params: { readonly tripInviteId: string }): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'TripInvite',
      params,
    },
  });
  return true;
}

/**
 * Navigate to the `Rode_With_Tag` confirm/decline view for a tapped
 * Rode_With_Tag push notification, forwarding the notification's `rodeWithTagId`
 * and `tripLogEntryId` (R18.3).
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry within the
 * foreground-navigation window).
 */
export function navigateToRodeWithTag(params: {
  readonly rodeWithTagId: string;
  readonly tripLogEntryId: string;
}): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'RodeWithConfirm',
      params,
    },
  });
  return true;
}

/**
 * Navigate to the `Trip_Detail_View` hub for a specific Trip. Used by the
 * `Active_Trip_Shortcut` (task 17.7) to open the User's active Trip directly
 * from a surface outside the Trips tab (R19.2) or after a selection from its
 * chooser (R19.5), and available to any other non-Trips surface that needs to
 * deep-link into a single Trip.
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry once the app reaches a
 * foreground-interactive state).
 */
export function navigateToTripDetail(params: { readonly tripId: string }): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'TripDetail',
      params,
    },
  });
  return true;
}

/**
 * Navigate to the `Trips_List_Screen`, the fallback target when a tapped Trip
 * notification's referenced Trip / Trip_Invite / Rode_With_Tag no longer exists
 * or the User is no longer a Trip_Member (R18.5), and the fallback for the
 * `Active_Trip_Shortcut` when its target Trip is no longer `active` or the User
 * is no longer a Trip_Member (R19.6). The "no longer available" message is
 * surfaced by the Trips_List_Screen (via the shared Trips-list notice); this
 * helper only performs the navigation.
 *
 * Returns `true` once the dispatch is issued, or `false` when the navigation
 * container is not ready yet (the caller should retry within the
 * foreground-navigation window).
 */
export function navigateToTripsList(): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'TripsList',
    },
  });
  return true;
}
