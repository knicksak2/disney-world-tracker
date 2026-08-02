// Feature: trips, Task 16.3 — TripsStack + deep-link routing scaffolding
//
// The Trips tab nests its own native stack (mirroring `CatalogStack` /
// `FriendsStack` / `ProfileStack`) hosting the `Trips_List_Screen`
// (`TripsList`, the initial route), the `Trip_Detail_View` hub (`TripDetail`),
// that hub's section screens (Planned_List, Trip_Activity — the consolidated
// feed + logging on the `TripFeed` route, Trip_Members, Trip_Summary — R18.1,
// R18.6, R20), and the two notification
// deep-link targets: the Trip_Invite accept/decline view (`TripInvite`, R18.2)
// and the Rode_With_Tag confirmation view (`RodeWithConfirm`, R18.3).
//
// This defines the stack STRUCTURE and its param list and wires the stack into
// the Trips tab so a single tap reaches the list (R17.2). Every route now
// resolves to its concrete screen. The deep-link tap handler that dispatches
// into `TripInvite` / `RodeWithConfirm` lives in the notification-response hook;
// the routing capability and param types it depends on are set up here and in
// `navigationRef.ts`.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import TripsListScreen from '../screens/trips/TripsListScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import TripEditScreen from '../screens/trips/TripEditScreen';
import TripPlannedListScreen from '../screens/trips/TripPlannedListScreen';
import TripFeedScreen from '../screens/trips/TripFeedScreen';
import TripMembersScreen from '../screens/trips/TripMembersScreen';
import TripSummaryScreen from '../screens/trips/TripSummaryScreen';
import TripInviteScreen from '../screens/trips/TripInviteScreen';
import RodeWithConfirmScreen from '../screens/trips/RodeWithConfirmScreen';

/**
 * Trips tab stack param list.
 *
 * Screen params are intentionally minimal and serializable — only routing ids
 * travel through navigation (never a fetched Trip payload). The section
 * screens each carry the `tripId` of the Trip whose section they present. The
 * two deep-link targets carry only the id(s) the notification forwards:
 * `TripInvite` the `tripInviteId` (matching the `{ tripInviteId }` push data,
 * R6.6/R6.7) and `RodeWithConfirm` the `rodeWithTagId` plus its
 * `tripLogEntryId` (matching the `{ rodeWithTagId, tripLogEntryId }` push data,
 * R10.8) so the confirm view can resolve the tag and its log entry.
 */
export type TripsStackParamList = {
  /** Trips_List_Screen — the Trips tab landing (initial route, R16, R17.2). */
  TripsList: undefined;
  /** Trip_Detail_View hub for a single Trip (R18.1, R18.6). */
  TripDetail: { tripId: string };
  /** Trip edit form (Organizer-gated): name, description, dates, resorts (R3.8, R21). */
  TripEdit: { tripId: string };
  /** Planned_List section of a Trip (R18.1, R18.6). */
  TripPlannedList: { tripId: string };
  /** Trip_Activity section of a Trip — the consolidated feed + logging (R20). */
  TripFeed: { tripId: string };
  /** Trip_Members section of a Trip (R18.1, R18.6). */
  TripMembers: { tripId: string };
  /** Trip_Summary section of a Trip (R18.1, R18.6). */
  TripSummary: { tripId: string };
  /**
   * Trip_Invite accept/decline deep-link target. Reached when a User taps a
   * Trip_Invite push notification (R18.2); the `tripInviteId` is the routing id
   * carried by the notification's `{ tripInviteId }` data payload.
   */
  TripInvite: { tripInviteId: string };
  /**
   * Rode_With_Tag confirm/decline deep-link target. Reached when a User taps a
   * Rode_With_Tag push notification (R18.3); carries the `rodeWithTagId` and
   * its `tripLogEntryId` from the notification's `{ rodeWithTagId,
   * tripLogEntryId }` data payload.
   */
  RodeWithConfirm: { rodeWithTagId: string; tripLogEntryId: string };
};

const Stack = createNativeStackNavigator<TripsStackParamList>();

export default function TripsStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TripsList" component={TripsListScreen} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} />
      <Stack.Screen name="TripEdit" component={TripEditScreen} />
      <Stack.Screen name="TripPlannedList" component={TripPlannedListScreen} />
      <Stack.Screen name="TripFeed" component={TripFeedScreen} />
      <Stack.Screen name="TripMembers" component={TripMembersScreen} />
      <Stack.Screen name="TripSummary" component={TripSummaryScreen} />
      <Stack.Screen name="TripInvite" component={TripInviteScreen} />
      <Stack.Screen name="RodeWithConfirm" component={RodeWithConfirmScreen} />
    </Stack.Navigator>
  );
}
