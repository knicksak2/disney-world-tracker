/**
 * ExploreStack — Navigation stack for the Explore tab.
 * (Task 7.3, Requirements 3.1, 3.2)
 *
 * Hosts:
 *   - CatalogList: The Catalog Home / Destination grid
 *   - DestinationScreen: Level-2 per-Destination experience list
 *   - CrowdCalendar: Crowd level forecast & recommendations
 *   - LiveWaits: Park-wide live wait times & status
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Park } from '@dwt/shared';

import ExploreHubScreen from '../screens/catalog/ExploreHubScreen';
import DestinationScreen from '../screens/catalog/DestinationScreen';
import type { DestinationId } from '../screens/catalog/destinations';
import ResortsDirectoryScreen from '../screens/catalog/ResortsDirectoryScreen';
import LiveWaitsScreen from '../screens/liveWaits/LiveWaitsScreen';

export type ExploreStackParamList = {
  CatalogList: undefined;
  DestinationScreen: { destination: DestinationId };
  ResortsDirectory: undefined;
  CrowdCalendar: undefined;
  LiveWaits: { park?: Park } | undefined;
};

/**
 * Backward-compatibility alias for existing screens typed against CatalogStackParamList.
 */
export type CatalogStackParamList = ExploreStackParamList;

const Stack = createNativeStackNavigator<ExploreStackParamList>();

export default function ExploreStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="CatalogList"
        component={ExploreHubScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DestinationScreen"
        component={DestinationScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ResortsDirectory"
        component={ResortsDirectoryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CrowdCalendar"
        component={require('../screens/catalog/CrowdCalendarScreen').default}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LiveWaits"
        component={LiveWaitsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

export { ExploreStack };
