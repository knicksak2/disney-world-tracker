import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CatalogScreen from '../screens/catalog/CatalogScreen';
import DestinationScreen from '../screens/catalog/DestinationScreen';
import type { DestinationId } from '../screens/catalog/destinations';

/**
 * Catalog tab stack.
 *
 * The Catalog tab nests its own native stack hosting the Catalog_Home
 * (`CatalogList`) and the Level-2 per-Destination screen (`DestinationScreen`).
 * The per-Experience detail view (`ExperienceDetail`) is registered on the
 * root-level stack (`RootStack`) rather than here, so that returning from the
 * detail view lands on the originating screen regardless of which tab the
 * navigation began in.
 */
export type CatalogStackParamList = {
  CatalogList: undefined;
  /**
   * Level-2 Destination_Screen, parameterized by the selected Destination.
   * Registered on this stack (task 11.1); the param shape is declared here so
   * the screen and its navigators type-check.
   */
  DestinationScreen: { destination: DestinationId };
};

const Stack = createNativeStackNavigator<CatalogStackParamList>();

export default function CatalogStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="CatalogList"
        component={CatalogScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DestinationScreen"
        component={DestinationScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
