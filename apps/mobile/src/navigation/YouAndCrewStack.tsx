import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FriendsListScreen from '../screens/friends/FriendsListScreen';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../screens/friends/FriendProfileScreen';
import FriendsSearchScreen from '../screens/friends/FriendsSearchScreen';
import InboxScreen from '../screens/share/InboxScreen';
import SentSharesScreen from '../screens/share/SentSharesScreen';
import TripRecapScreen from '../screens/share/TripRecapScreen';
import TripRecapAlbumScreen from '../screens/share/TripRecapAlbumScreen';
import FriendFoodHistoryScreen from '../screens/friends/FriendFoodHistoryScreen';
import PinShowcaseScreen from '../screens/profile/PinShowcaseScreen';
import YouAndCrewScreen from '../screens/youAndCrew/YouAndCrewScreen';
import BlockedUsersScreen from '../screens/youAndCrew/BlockedUsersScreen';
import DeleteAccountScreen from '../screens/youAndCrew/DeleteAccountScreen';

export type { FriendProfileParams };

/**
 * YouAndCrewStack — hosts the You & Crew profile, friends, sharing, and settings.
 * (Tasks 7.2, Requirements 7.1, 7.4)
 */
export type YouAndCrewStackParamList = {
  YouAndCrewMain: undefined;
  FriendProfile: FriendProfileParams;
  FriendFoodHistory: { friendId: string; displayName: string };
  FriendsSearch: undefined;
  Inbox: { shareId?: string } | undefined;
  Sent: undefined;
  PinShowcase: { userId?: string; readOnly?: boolean } | undefined;
  /** Read-only Trip recap opened from a `tripSummary` Share (photo-uploads R15.13). */
  TripRecap: { shareId: string };
  /** Read-only album of every approved Trip photo behind a shared recap (photo-uploads R15.31, D35). */
  TripRecapAlbum: { shareId: string; tripName?: string };
  FriendsList?: undefined;
  BlockedUsers: undefined;
  /** Self-service account deletion: review, re-authenticate, confirm (account-deletion R1). */
  DeleteAccount: undefined;
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
      <Stack.Screen
        name="TripRecap"
        component={TripRecapScreen}
        options={{ title: 'Trip recap' }}
      />
      <Stack.Screen
        name="TripRecapAlbum"
        component={TripRecapAlbumScreen}
        options={{ title: 'All trip photos' }}
      />
      <Stack.Screen
        name="FriendFoodHistory"
        component={FriendFoodHistoryScreen}
        options={{ title: 'Food History' }}
      />
      <Stack.Screen
        name="BlockedUsers"
        component={BlockedUsersScreen}
        options={{ title: 'Blocked Users' }}
      />
      <Stack.Screen
        name="DeleteAccount"
        component={DeleteAccountScreen}
        options={{ title: 'Delete account' }}
      />
    </Stack.Navigator>
  );
}
