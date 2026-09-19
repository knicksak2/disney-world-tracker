import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FriendsListScreen from '../screens/friends/FriendsListScreen';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../screens/friends/FriendProfileScreen';
import FriendsSearchScreen from '../screens/friends/FriendsSearchScreen';
import InboxScreen from '../screens/share/InboxScreen';
import SentSharesScreen from '../screens/share/SentSharesScreen';
import PinShowcaseScreen from '../screens/profile/PinShowcaseScreen';
import YouAndCrewScreen from '../screens/youAndCrew/YouAndCrewScreen';

export type { FriendProfileParams };

/**
 * YouAndCrewStack — hosts the You & Crew profile, friends, sharing, and settings.
 * (Tasks 7.2, Requirements 7.1, 7.4)
 */
export type YouAndCrewStackParamList = {
  YouAndCrewMain: undefined;
  FriendProfile: FriendProfileParams;
  FriendsSearch: undefined;
  Inbox: { shareId?: string } | undefined;
  Sent: undefined;
  PinShowcase: { userId?: string; readOnly?: boolean } | undefined;
  FriendsList?: undefined;
};

const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

export default function YouAndCrewStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="YouAndCrewMain"
        component={YouAndCrewScreen}
        options={{ title: 'You & Crew' }}
      />
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
        options={{ title: 'Sent Shares' }}
      />
      <Stack.Screen
        name="PinShowcase"
        component={PinShowcaseScreen}
        options={{ title: 'Pin Showcase' }}
      />
    </Stack.Navigator>
  );
}
