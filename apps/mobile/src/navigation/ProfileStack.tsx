import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { AttentionItemRef } from '@dwt/shared';

import ProfileScreen from '../screens/ProfileScreen';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import StatsStack, { type StatsStackParamList } from './StatsStack';

/**
 * Profile tab stack (trips task 16.1).
 *
 * The Profile tab nests its own native stack so the personal statistics view
 * — formerly a top-level bottom tab — can be **re-hosted** here and reached
 * through a navigation control on the Profile screen (R17.3, R17.4) rather
 * than occupying one of the five top-level tabs (R17.1). Nesting the whole
 * existing `StatsStack` unchanged preserves every previously reachable Stats
 * screen (the Overview hub plus the Coverage/Ratings/Interests/Experiences
 * detail routes), so relocation costs no reachability (R17.5).
 *
 * This mirrors the `CatalogStack`/`FriendsStack` pattern: the bottom tab bar
 * stays visible, native back/gestures come for free, and the initial route
 * (`ProfileMain`) is the Profile screen itself.
 */
export type ProfileStackParamList = {
  /**
   * The Profile screen — the Profile tab landing (initial route). Accepts an
   * optional `{ userId }` (own Profile when omitted or matching the signed-in
   * user, otherwise a read-only view). Params dispatched to the Profile tab
   * flow down to this initial route.
   */
  ProfileMain: { userId?: string } | undefined;
  /**
   * The re-hosted personal statistics view. Typed as
   * `NavigatorScreenParams<StatsStackParamList>` (matching the Catalog/Friends
   * tabs) so a caller holding the root ref can still deep-link a specific
   * detail route via `navigate('MainTabs', { screen: 'Profile', params: {
   * screen: 'Stats', params: { screen: 'RatingsDetail' } } })`. Only small
   * serializable hint params travel through navigation — never a
   * `StatsResponse` (R3.5).
   */
  Stats: NavigatorScreenParams<StatsStackParamList> | undefined;
  /**
   * The Notification_Center's Attention_Feed surface, re-hosted on the Profile
   * tab's stack and reached through the Profile_Notifications_Entry on the
   * Profile screen (notification-center R10.2, R10.5). Hosting it here — rather
   * than as a sixth bottom tab — keeps the tab bar unchanged (Home, Catalog,
   * Trips, Friends, Profile; R10.1) while the Profile-tab Attention_Badge keeps
   * the User alerted app-wide.
   *
   * Renders the signed-in User's own feed. Optionally carries a `focusRef`
   * naming a specific Attention_Item to surface when the center is opened from
   * a tapped push notification (notification-center R13.1, R13.2); the field is
   * additive/optional so opening the center with no params (from the
   * Profile_Notifications_Entry) still renders the full feed.
   */
  NotificationCenter: { focusRef?: AttentionItemRef } | undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="Stats" component={StatsStack} />
      <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} />
    </Stack.Navigator>
  );
}
