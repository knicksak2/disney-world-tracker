import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CatalogScreen from '../screens/catalog/CatalogScreen';
import ExperienceDetailScreen from '../screens/catalog/ExperienceDetailScreen';

/**
 * Catalog tab stack.
 *
 * The Catalog tab nests its own native stack so the user can drill from
 * the list (`CatalogList`) into the per-Experience detail view
 * (`ExperienceDetail`) without leaving the tab. The list screen owns
 * tasks 16.1/16.2; the detail screen is owned by task 16.3 (currently a
 * placeholder).
 */
export type CatalogStackParamList = {
  CatalogList: undefined;
  ExperienceDetail: { experienceId: string };
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
        name="ExperienceDetail"
        component={ExperienceDetailScreen}
        options={{ title: 'Experience' }}
      />
    </Stack.Navigator>
  );
}
