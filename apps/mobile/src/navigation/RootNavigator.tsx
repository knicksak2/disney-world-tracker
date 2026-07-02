import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { setOnUnauthorizedCallback } from '../api/client';
import { useSessionStore } from '../state/sessionStore';
import CatalogStack, { type CatalogStackParamList } from './CatalogStack';
import FriendsStack, { type FriendsStackParamList } from './FriendsStack';
import HomeScreen from '../screens/home/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RegisterScreen from '../screens/RegisterScreen';
import StatsScreen from '../screens/stats/StatsScreen';
import ExperienceDetailScreen from '../screens/catalog/ExperienceDetailScreen';
import MenuScreen from '../screens/catalog/MenuScreen';

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

/**
 * Root-level native stack that hosts the authenticated experience.
 *
 * `MainTabs` (the bottom-tab navigator) is the initial route, and
 * `ExperienceDetail` is registered as a sibling screen pushed *above* the
 * tabs. Promoting `ExperienceDetail` to the root stack (rather than nesting
 * it inside the Catalog tab) leaves the originating tab/screen intact
 * underneath, so a back request pops to the exact screen the User came from
 * regardless of which tab they started in. The native header is suppressed
 * (`headerShown: false`) so the screen presents only its themed in-content
 * header.
 */
export type RootStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
  /**
   * Dedicated Menu_Screen for a Restaurant_Experience, reachable by tapping
   * the Menu_Summary_Card on the detail screen (R4.2, R5.8). Registered as a
   * sibling of `ExperienceDetail` in task 7.1; the param type is declared here
   * so the card's `navigation.navigate('Menu', { experienceId })` type-checks.
   */
  Menu: { experienceId: string };
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function AuthStackNavigator(): JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

/**
 * Map each main tab to its Ionicons glyph (filled when focused, outline
 * otherwise). Kept as a module constant so the `screenOptions` callback
 * stays a cheap lookup rather than a per-render branch.
 */
const TAB_ICONS: Record<
  keyof MainTabParamList,
  { readonly focused: keyof typeof Ionicons.glyphMap; readonly unfocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Catalog: { focused: 'compass', unfocused: 'compass-outline' },
  Stats: { focused: 'stats-chart', unfocused: 'stats-chart-outline' },
  Friends: { focused: 'people', unfocused: 'people-outline' },
  Profile: { focused: 'person-circle', unfocused: 'person-circle-outline' },
};

function MainTabsNavigator(): JSX.Element {
  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#003a9b',
        tabBarInactiveTintColor: '#6b7280',
        tabBarIcon: ({ focused, color, size }) => {
          const glyphs = TAB_ICONS[route.name];
          const name = focused ? glyphs.focused : glyphs.unfocused;
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
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

/**
 * Authenticated root stack. Hosts `MainTabs` as the initial route and
 * registers `ExperienceDetail` as a sibling screen pushed above the tabs.
 *
 * `ExperienceDetail` is registered with `headerShown: false` so React
 * Navigation renders no native header bar; the screen supplies its own
 * themed header. `MainTabs` is likewise headerless, matching today's
 * behavior.
 */
function RootStackNavigator(): JSX.Element {
  return (
    <RootStack.Navigator initialRouteName="MainTabs">
      <RootStack.Screen
        name="MainTabs"
        component={MainTabsNavigator}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="ExperienceDetail"
        component={ExperienceDetailScreen}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="Menu"
        component={MenuScreen}
        options={{ headerShown: false }}
      />
    </RootStack.Navigator>
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

  return token === null ? <AuthStackNavigator /> : <RootStackNavigator />;
}
