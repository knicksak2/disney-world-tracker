import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';

import CollectionScreen from '../screens/collection/CollectionScreen';
import PinBoardScreen from '../screens/profile/PinBoardScreen';
import PinShowcaseScreen from '../screens/profile/PinShowcaseScreen';
import AttributionScreen from '../screens/profile/AttributionScreen';
import MyFoodHistoryScreen from '../screens/catalog/MyFoodHistoryScreen';
import MyFoodListsScreen from '../screens/foodLists/MyFoodListsScreen';
import MyExperienceListsScreen from '../screens/experienceLists/MyExperienceListsScreen';
import StatsStack, { type StatsStackParamList } from './StatsStack';

/**
 * Collection tab stack (Requirements 6.1, 6.2, design.md Section 5).
 *
 * Hosts:
 *   - CollectionHome (new landing route)
 *   - PinBoard, PinAttribution, PinShowcase (moved from ProfileStack, unchanged)
 *   - MyFoodHistory, MyFoodLists (moved from RootStack, unchanged)
 *   - Stats (nesting the existing StatsStack unchanged, exactly as ProfileStack did)
 */
export type CollectionStackParamList = {
  CollectionHome: undefined;
  PinBoard: { celebratePinIds?: string[] } | undefined;
  PinAttribution: undefined;
  PinShowcase: { userId?: string; readOnly?: boolean } | undefined;
  MyFoodHistory: undefined;
  MyFoodLists: undefined;
  MyExperienceLists: undefined;
  Stats: NavigatorScreenParams<StatsStackParamList> | undefined;
};

const Stack = createNativeStackNavigator<CollectionStackParamList>();

export default function CollectionStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CollectionHome" component={CollectionScreen} />
      <Stack.Screen name="PinBoard" component={PinBoardScreen} />
      <Stack.Screen name="PinAttribution" component={AttributionScreen} />
      <Stack.Screen name="PinShowcase" component={PinShowcaseScreen} />
      <Stack.Screen name="MyFoodHistory" component={MyFoodHistoryScreen} />
      <Stack.Screen name="MyFoodLists" component={MyFoodListsScreen} />
      <Stack.Screen name="MyExperienceLists" component={MyExperienceListsScreen} />
      <Stack.Screen name="Stats" component={StatsStack} />
    </Stack.Navigator>
  );
}
