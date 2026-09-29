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
import type { AttentionItemRef } from '@dwt/shared';

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
  navigationRef.navigate('YouAndCrew', {
    screen: 'Inbox',
    params,
  });
  return true;
}

/**
 * Navigate to `YouAndCrewMain`.
 */
export function navigateToFriendsList(): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('YouAndCrew', {
    screen: 'YouAndCrewMain',
  });
  return true;
}

// ---------------------------------------------------------------------------
// Notification_Center deep-link routing (Tasks 12.2, Requirements 8.2).
//
// A tapped push for a Friend_Request, Trip_Invite, Rode_With_Tag, or Share opens
// the Notification_Center as a root-level modal sheet.
// ---------------------------------------------------------------------------

/**
 * Navigate to the Notification_Center's Attention_Feed for a tapped push
 * notification, optionally carrying a `focusRef` that names the referenced
 * Attention_Item so the screen can surface it while it is still pending.
 */
export function navigateToNotificationCenter(params?: {
  readonly focusRef?: AttentionItemRef;
}): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('NotificationCenter', params);
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

/**
 * Navigate to `FoodListDetail` for a tapped food-list share / role-change
 * push notification carrying `{ foodListId }` (Requirement 10.1, Task 8.12).
 */
export function navigateToFoodListDetail(params: { readonly foodListId: string }): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('FoodListDetail', params);
  return true;
}

/**
 * Navigate to `ExperienceListDetail` for a tapped experience-list share /
 * role-change push notification carrying `{ experienceListId }` (Requirement
 * 10.1, Task 14.1).
 */
export function navigateToExperienceListDetail(params: {
  readonly experienceListId: string;
}): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('ExperienceListDetail', params);
  return true;
}

/**
 * Navigate to `LiveWaits` screen under Explore tab (Requirement 4.3).
 */
export function navigateToLiveWaits(park: string): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Explore',
    params: {
      screen: 'LiveWaits',
      params: { park: park as any },
    },
  });
  return true;
}

/**
 * Navigate to `PinBoard` under Collection tab, optionally celebrating awarded pins (Requirement 4.5).
 */
export function navigateToPinBoard(celebratePinIds?: readonly string[]): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Collection',
    params: {
      screen: 'PinBoard',
      params: celebratePinIds ? { celebratePinIds: [...celebratePinIds] } : undefined,
    },
  });
  return true;
}

/**
 * Navigate to the `TripSchedule` section of an active trip (Requirement 4.6).
 * Seeds `TripDetail` in the Trips stack so the user can easily navigate back to the
 * rest of the trip (the hub) instead of jumping out of the Trips flow.
 */
export function navigateToTripSchedule(params: { readonly tripId: string }): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'TripDetail',
      params: { tripId: params.tripId },
    },
  });
  navigationRef.navigate('MainTabs', {
    screen: 'Trips',
    params: {
      screen: 'TripSchedule',
      params,
    },
  });
  return true;
}

