import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FriendsListScreen from '../screens/friends/FriendsListScreen';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../screens/friends/FriendProfileScreen';
import FriendsSearchScreen from '../screens/friends/FriendsSearchScreen';
import InboxScreen from '../screens/share/InboxScreen';
import SentSharesScreen from '../screens/share/SentSharesScreen';

/**
 * Friends tab stack.
 *
 * The Friends tab nests its own native stack so the user can drill from
 * the friends list (`FriendsList`) into the user search
 * (`FriendsSearch`) or the Share inbox (`Inbox`) without leaving the tab.
 *
 * The Inbox is a regular pushed screen because the user navigates to it
 * to manage existing shares. The Share composer is no longer part of this
 * stack — it was promoted to the root stack as a modal (R3.2) so it can be
 * opened from any `Share_Entry_Point` (see `RootStackParamList`).
 *
 * The Sent screen is the minimal "Sent Shares" surface (task 21.2): it lists
 * the User's sent shares and, per share, its reactions with reactor display
 * names (R11.7). Like the Inbox it is a pushed screen reached from the Friends
 * page.
 *
 * The stack is intentionally narrow — we add screens here only when the
 * Friends tab needs to drill in. Anything that should appear from any
 * tab (e.g. the global Profile view) belongs higher up.
 */

export type FriendsStackParamList = {
  FriendsList: undefined;
  FriendProfile: FriendProfileParams;
  FriendsSearch: undefined;
  /**
   * The Share inbox. Reached both by an in-app tap on the Friends page (no
   * params) and by a Share push-notification tap, which forwards the tapped
   * Share's id as `shareId` so the Inbox can navigate on to the Share's
   * destination and mark it read (R10.2) or, when the Share is gone, show a
   * "no longer available" message alongside the current inbox contents
   * (R10.4). Absent/undefined params open the inbox normally (R10.5).
   */
  Inbox: { shareId?: string } | undefined;
  /**
   * The Sent Shares surface (task 21.2). Lists the User's sent shares and, per
   * share, its reactions with reactor display names (R11.7). Reached by an
   * in-app tap on the Friends page; takes no params.
   */
  Sent: undefined;
};

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export default function FriendsStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="FriendsList"
        component={FriendsListScreen}
        options={{ title: 'Friends' }}
      />
      <Stack.Screen
        name="FriendProfile"
        component={FriendProfileScreen}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="FriendsSearch"
        component={FriendsSearchScreen}
        options={{ title: 'Find friends' }}
      />
      <Stack.Screen
        name="Inbox"
        component={InboxScreen}
        options={{ title: 'Inbox' }}
      />
      <Stack.Screen
        name="Sent"
        component={SentSharesScreen}
        options={{ title: 'Sent' }}
      />
    </Stack.Navigator>
  );
}
