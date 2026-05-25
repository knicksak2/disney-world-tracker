import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';

import { setOnUnauthorizedCallback } from '../api/client';
import { useSessionStore } from '../state/sessionStore';
import CatalogStack, { type CatalogStackParamList } from './CatalogStack';
import FriendsStack, { type FriendsStackParamList } from './FriendsStack';
import HomeScreen from '../screens/home/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RegisterScreen from '../screens/RegisterScreen';
import StatsScreen from '../screens/stats/StatsScreen';

/**
 * Root navigator for the mobile app.
 *
 * The navigator picks one of two stacks based on whether a session token
 * is present:
 *
 *   - No token  → AuthStack (Login, Register).
 *   - Token set → MainTabs (Home, Catalog, Stats, Friends, Profile).
 *
 * Switching between the two is driven by the `useSessionStore` selector
 * for `token`. When the API client reports a 401, the registered
 * unauthorized callback clears the token, which re-renders this component
 * and flips us back into the auth stack (R6.10).
 */

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  /**
   * The Catalog tab nests its own native stack (`CatalogStack`). Typing
   * the param as `NavigatorScreenParams<CatalogStackParamList>` lets
   * other tabs dispatch a cross-stack navigation into a specific
   * Catalog screen via `navigation.navigate('Catalog', { screen, params })`.
   */
  Catalog: NavigatorScreenParams<CatalogStackParamList> | undefined;
  Stats: undefined;
  /**
   * The Friends tab nests its own native stack (`FriendsStack`). Same
   * `NavigatorScreenParams` shape as the Catalog tab so callers can
   * jump directly to the search screen via
   * `navigation.navigate('Friends', { screen: 'FriendsSearch' })`.
   */
  Friends: NavigatorScreenParams<FriendsStackParamList> | undefined;
  /**
   * The Profile tab can be opened with no params (own profile) or with
   * `{ userId }` to view another User's Profile (e.g., navigated from the
   * friends list). When `userId` is omitted or matches the signed-in user,
   * the screen shows the editing affordances; otherwise it renders read-only
   * (R7.4, R7.8).
   */
  Profile: { userId?: string } | undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();

function AuthStackNavigator(): JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function MainTabsNavigator(): JSX.Element {
  return (
    <MainTabs.Navigator>
      <MainTabs.Screen name="Home" component={HomeScreen} />
      <MainTabs.Screen
        name="Catalog"
        component={CatalogStack}
        options={{ headerShown: false }}
      />
      <MainTabs.Screen name="Stats" component={StatsScreen} />
      <MainTabs.Screen
        name="Friends"
        component={FriendsStack}
        options={{ headerShown: false }}
      />
      <MainTabs.Screen name="Profile" component={ProfileScreen} />
    </MainTabs.Navigator>
  );
}

export default function RootNavigator(): JSX.Element {
  const token = useSessionStore((state) => state.token);
  const clearToken = useSessionStore((state) => state.clearToken);

  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      // Fire and forget — the store handles persistence; the navigator
      // re-renders once `token` flips to null.
      void clearToken();
    });
    return () => {
      setOnUnauthorizedCallback(null);
    };
  }, [clearToken]);

  return token === null ? <AuthStackNavigator /> : <MainTabsNavigator />;
}
