import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FriendsListScreen from '../screens/friends/FriendsListScreen';
import FriendsSearchScreen from '../screens/friends/FriendsSearchScreen';
import InboxScreen from '../screens/share/InboxScreen';
import ShareComposerScreen from '../screens/share/ShareComposerScreen';

/**
 * Friends tab stack.
 *
 * The Friends tab nests its own native stack so the user can drill from
 * the friends list (`FriendsList`) into the user search
 * (`FriendsSearch`), the Share composer (`ShareComposer`), or the
 * Share inbox (`Inbox`) without leaving the tab.
 *
 * The composer is presented modally; the Inbox is a regular pushed
 * screen because the user navigates to it to manage existing shares
 * rather than as an interrupting compose flow.
 *
 * The stack is intentionally narrow — we add screens here only when the
 * Friends tab needs to drill in. Anything that should appear from any
 * tab (e.g. the global Profile view) belongs higher up.
 */

export type FriendsStackParamList = {
  FriendsList: undefined;
  FriendsSearch: undefined;
  ShareComposer: undefined;
  Inbox: undefined;
};

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export default function FriendsStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="FriendsList"
        component={FriendsListScreen}
        options={{ title: 'Friends', headerShown: false }}
      />
      <Stack.Screen
        name="FriendsSearch"
        component={FriendsSearchScreen}
        options={{ title: 'Find friends' }}
      />
      <Stack.Screen
        name="ShareComposer"
        component={ShareComposerScreen}
        options={{ title: 'Share', presentation: 'modal' }}
      />
      <Stack.Screen
        name="Inbox"
        component={InboxScreen}
        options={{ title: 'Inbox' }}
      />
    </Stack.Navigator>
  );
}
