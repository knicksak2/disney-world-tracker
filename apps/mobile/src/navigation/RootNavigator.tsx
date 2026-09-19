import React, { useEffect } from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { AttentionItemRef, ExperienceCategory, Park } from '@dwt/shared';

import { setOnUnauthorizedCallback } from '../api/client';
import { useSessionStore } from '../state/sessionStore';
import ExploreStack, { type ExploreStackParamList } from './ExploreStack';
import TripsStack, { type TripsStackParamList } from './TripsStack';
import CollectionStack, { type CollectionStackParamList } from './CollectionStack';
import YouAndCrewStack, { type YouAndCrewStackParamList } from './YouAndCrewStack';
import HomeScreen from '../screens/home/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ExperienceDetailScreen from '../screens/catalog/ExperienceDetailScreen';
import MenuScreen from '../screens/catalog/MenuScreen';
import ShareComposerScreen from '../screens/share/ShareComposerScreen';
import FoodListDetailScreen from '../screens/foodLists/FoodListDetailScreen';
import FoodListDiscoveryScreen from '../screens/foodLists/FoodListDiscoveryScreen';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import { useClaimablePinsBadge } from '../components/pins/useClaimablePinsBadge';
import MagicFab from '../screens/quickAction/MagicFab';

/**
 * Root navigator for the mobile app (Tasks 12.1, 12.2, 12.6, Requirements 1.1, 1.2, 1.5, 7.2, 8.2).
 *
 * AuthStack (Login, Register) when token is null.
 * MainTabs (Home, Explore, FAB, Trips, Collection) + root modals/detail screens when authenticated.
 */

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Explore: NavigatorScreenParams<ExploreStackParamList> | undefined;
  Trips: NavigatorScreenParams<TripsStackParamList> | undefined;
  Collection: NavigatorScreenParams<CollectionStackParamList> | undefined;
};

export type ShareComposerParams =
  | {
      kind: 'experience';
      experienceId: string;
      experienceName: string;
      park: Park;
      category: ExperienceCategory;
      rating?: number;
      note?: string;
    }
  | {
      kind: 'progress';
      overallPercent: number;
      perParkPercent: { [park in Park]?: number };
      perCategoryPercent: { [category in ExperienceCategory]?: number };
    }
  | {
      kind: 'pinShowcase';
    };

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  ExperienceDetail: { experienceId: string };
  Menu: { experienceId: string };
  ShareComposer: ShareComposerParams;
  FoodListDetail: { foodListId: string };
  FoodListDiscovery: undefined;
  YouAndCrew: NavigatorScreenParams<YouAndCrewStackParamList> | undefined;
  NotificationCenter: { focusRef?: AttentionItemRef } | undefined;
  PinShowcase?: { userId?: string; readOnly?: boolean };
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

const TAB_ICONS: Record<
  keyof MainTabParamList,
  { readonly focused: keyof typeof Ionicons.glyphMap; readonly unfocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Explore: { focused: 'compass', unfocused: 'compass-outline' },
  Trips: { focused: 'map', unfocused: 'map-outline' },
  Collection: { focused: 'albums', unfocused: 'albums-outline' },
};

function EmptySlot(): JSX.Element {
  return <View />;
}

function MainTabsNavigator(): JSX.Element {
  const { count: claimableCount } = useClaimablePinsBadge();

  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#003a9b',
        tabBarInactiveTintColor: '#6b7280',
        tabBarIcon: ({ focused, color, size }) => {
          const glyphs = TAB_ICONS[route.name as keyof MainTabParamList];
          if (!glyphs) return null;
          const name = focused ? glyphs.focused : glyphs.unfocused;
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <MainTabs.Screen name="Home" component={HomeScreen} />
      <MainTabs.Screen
        name="Explore"
        component={ExploreStack}
        options={{ headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Explore', { screen: 'CatalogList' });
          },
        })}
      />
      <MainTabs.Screen
        name={'MagicFab' as any}
        component={EmptySlot}
        options={{
          tabBarButton: () => <MagicFab />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
          },
        }}
      />
      <MainTabs.Screen
        name="Trips"
        component={TripsStack}
        options={{ headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Trips', { screen: 'TripsList' });
          },
        })}
      />
      <MainTabs.Screen
        name="Collection"
        component={CollectionStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Vault',
          ...(claimableCount > 0
            ? {
                tabBarBadge: claimableCount > 99 ? '99+' : claimableCount,
                tabBarBadgeStyle: {
                  backgroundColor: '#d97706',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: '700',
                },
              }
            : {}),
        }}
      />
    </MainTabs.Navigator>
  );
}

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
      <RootStack.Screen
        name="ShareComposer"
        component={ShareComposerScreen}
        options={{ title: 'Share', presentation: 'modal' }}
      />
      <RootStack.Screen
        name="FoodListDetail"
        component={FoodListDetailScreen}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="FoodListDiscovery"
        component={FoodListDiscoveryScreen}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="YouAndCrew"
        component={YouAndCrewStack}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
        options={{ presentation: 'modal', headerShown: false }}
      />
      <RootStack.Screen
        name="PinShowcase"
        component={require('../screens/profile/PinShowcaseScreen').default}
        options={{ headerShown: false }}
      />
    </RootStack.Navigator>
  );
}

export default function RootNavigator(): JSX.Element {
  const token = useSessionStore((state) => state.token);
  const clearToken = useSessionStore((state) => state.clearToken);
  const queryClient = useQueryClient();

  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      void clearToken();
      queryClient.clear();
    });
    return () => {
      setOnUnauthorizedCallback(null);
    };
  }, [clearToken, queryClient]);

  return token === null ? <AuthStackNavigator /> : <RootStackNavigator />;
}
