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
