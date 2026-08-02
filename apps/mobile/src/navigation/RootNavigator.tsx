import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { isAvatarPresetId, type ExperienceCategory, type Park } from '@dwt/shared';

import { apiRequest, setOnUnauthorizedCallback } from '../api/client';
import { renderAvatarPreset } from '../avatars/AvatarPresets';
import { useSessionStore } from '../state/sessionStore';
import CatalogStack, { type CatalogStackParamList } from './CatalogStack';
import FriendsStack, { type FriendsStackParamList } from './FriendsStack';
import ProfileStack, { type ProfileStackParamList } from './ProfileStack';
import TripsStack, { type TripsStackParamList } from './TripsStack';
import HomeScreen from '../screens/home/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ExperienceDetailScreen from '../screens/catalog/ExperienceDetailScreen';
import MenuScreen from '../screens/catalog/MenuScreen';
import ShareComposerScreen from '../screens/share/ShareComposerScreen';

/**
 * Root navigator for the mobile app.
 *
 * The navigator picks one of two stacks based on whether a session token
 * is present:
 *
 *   - No token  → AuthStack (Login, Register).
 *   - Token set → MainTabs (Home, Catalog, Trips, Friends, Profile).
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
  /**
   * The Trips tab nests its own native stack (`TripsStack`) hosting the
   * `Trips_List_Screen` (`TripsList`, the initial route), the `Trip_Detail_View`
   * hub and its section screens, and the invite / rode-with deep-link targets.
   * Selecting the tab reaches the Trips list in a single tap (R17.1, R17.2).
   * Typed as `NavigatorScreenParams<TripsStackParamList>` (matching the other
   * nested tabs) so a caller holding the root ref — e.g. the notification tap
   * handler (task 17.8) — can deep-link a specific Trips route via
   * `navigate('MainTabs', { screen: 'Trips', params: { screen: 'TripInvite',
   * params: { tripInviteId } } })`.
   */
  Trips: NavigatorScreenParams<TripsStackParamList> | undefined;
  /**
   * The Friends tab nests its own native stack (`FriendsStack`). Same
   * `NavigatorScreenParams` shape as the Catalog tab so callers can
   * jump directly to the search screen via
   * `navigation.navigate('Friends', { screen: 'FriendsSearch' })`.
   */
  Friends: NavigatorScreenParams<FriendsStackParamList> | undefined;
  /**
   * The Profile tab nests its own native stack (`ProfileStack`) hosting the
   * Profile screen (`ProfileMain`, the initial route) and the re-hosted
   * personal statistics view (`Stats` = the whole `StatsStack`), which is no
   * longer a top-level tab (R17.1, R17.3). Typing the param as
   * `NavigatorScreenParams<ProfileStackParamList>` lets callers open the
   * Profile screen with `{ userId }` — `navigate('Profile', { screen:
   * 'ProfileMain', params: { userId } })` — or deep-link a Stats detail route
   * via `navigate('MainTabs', { screen: 'Profile', params: { screen: 'Stats',
   * params: { screen: 'RatingsDetail' } } })`. Params dispatched to the tab
   * with no `screen` flow down to `ProfileMain`.
   */
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

/**
 * Pre-populated params for the `Share_Composer` (R2.1, R3.2, R3.3).
 *
 * The composer no longer lets the User pick the payload kind or type a raw
 * Experience identifier; instead every `Share_Entry_Point` opens it with a
 * fully derived, read-only payload. The discriminant `kind` selects between
 * the two payload variants:
 *
 *   - `experience` — carries the referenced Experience's id, name, Park, and
 *     Experience_Category, plus the viewer's Rating (whole number 1–10) and
 *     Note (≤2000 chars) when present. The optional `rating`/`note` fields
 *     drive the include/exclude toggles (R2.14).
 *   - `progress` — carries the viewer's overall, per-Park, and
 *     per-Experience_Category completion percentages, each to one decimal
 *     place as displayed on the Progress_Screen (R1.8).
 */
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
  /**
   * The bottom-tab navigator. Typed as `NavigatorScreenParams<MainTabParamList>`
   * (rather than `undefined`) so a caller holding only the root navigation ref
   * — e.g. the notification tap handler (task 20.1) — can dispatch a single
   * nested `navigate('MainTabs', { screen: 'Friends', params: { screen:
   * 'Inbox', … } })` that walks all the way down to the `Inbox` (R10.1).
   */
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  ExperienceDetail: { experienceId: string };
  /**
   * Dedicated Menu_Screen for a Restaurant_Experience, reachable by tapping
   * the Menu_Summary_Card on the detail screen (R4.2, R5.8). Registered as a
   * sibling of `ExperienceDetail` in task 7.1; the param type is declared here
   * so the card's `navigation.navigate('Menu', { experienceId })` type-checks.
   */
  Menu: { experienceId: string };
  /**
   * Share_Composer, promoted from `FriendsStack` to the root stack and
   * presented as a modal (R3.2). Hosting it here lets every
   * `Share_Entry_Point` — the Experience_Detail_View and the Progress_Screen,
   * both reachable from the root stack — open it with one cross-navigator-safe
   * `navigate('ShareComposer', params)` call and return via `goBack()`.
   */
  ShareComposer: ShareComposerParams;
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
  Trips: { focused: 'map', unfocused: 'map-outline' },
  Friends: { focused: 'people', unfocused: 'people-outline' },
  Profile: { focused: 'person-circle', unfocused: 'person-circle-outline' },
};

/**
 * `/me` response shape (subset). Mirrors `MeResponseBody` in
 * `apps/api/src/services/auth/routes.ts`; only the fields the tab icon needs
 * are typed here.
 */
interface MeResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: {
    readonly displayName: string;
    readonly avatarPreset: string | null;
  };
}

/**
 * Profile tab icon. When the signed-in user has chosen an avatar preset, the
 * tab shows that avatar (with a tint ring when the tab is focused) so their
 * identity is reflected in the tab bar. Otherwise it falls back to the default
 * person-circle glyph. Reads `/me` via React Query under the shared `['me']`
 * key, so it reuses the same cached response the Profile screen primes.
 */
function ProfileTabIcon({
  focused,
  color,
  size,
}: {
  readonly focused: boolean;
  readonly color: string;
  readonly size: number;
}): JSX.Element {
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
  });

  const preset = meQuery.data?.profile.avatarPreset ?? null;
  const glyphs = TAB_ICONS.Profile;

  if (isAvatarPresetId(preset)) {
    return (
      <View
        style={[
          styles.profileAvatar,
          {
            width: size + 6,
            height: size + 6,
            borderRadius: (size + 6) / 2,
            borderColor: focused ? color : 'transparent',
          },
        ]}
        testID="profile-tab-avatar"
      >
        {renderAvatarPreset(preset, size)}
      </View>
    );
  }

  return (
    <Ionicons
      name={focused ? glyphs.focused : glyphs.unfocused}
      size={size}
      color={color}
    />
  );
}

/**
 * React Query key for the lightweight unread-inbox tally
 * (`GET /me/inbox/unread-count`). It is intentionally a child of the Inbox
 * screen's `['inbox']` key so that screen's `invalidateQueries(['inbox'])`
 * (a prefix match) also refreshes this count the moment the User opens or
 * deletes a Share — the badge and the inbox never drift.
 */
const INBOX_UNREAD_QUERY_KEY = ['inbox', 'unread'] as const;

/**
 * How often the tab-bar badge re-polls its two sources while the app is
 * foregrounded. A minute keeps a freshly arrived Share or friend request
 * visible app-wide without a restart, while staying light on the API.
 */
const NOTIFICATION_POLL_MS = 60_000;

/** `GET /me/inbox/unread-count` response shape. */
interface InboxUnreadCountResponse {
  readonly count: number;
}

/**
 * `GET /me/friends` response (subset). Only the incoming-request list length
 * feeds the badge; mirrors the `incomingRequests` field the friends screen
 * already reads under the shared `['friends']` key.
 */
interface FriendsBadgeResponse {
  readonly incomingRequests: readonly unknown[];
}

/**
 * Combined count of things waiting for the User under the Friends tab:
 * unread inbox Shares plus pending incoming friend requests. Both are the
 * "messages" a User can receive from another User, so they roll up into one
 * indicator (the app has no notification surface outside this tab today).
 *
 * Reuses the same React Query keys the Inbox and Friends screens use, so the
 * badge shares their cache and updates immediately when those screens mutate
 * (accept a request, open a Share). A polling interval keeps it fresh while
 * the User sits on another tab.
 */
function useNotificationBadgeCount(): number {
  const unreadQuery = useQuery<InboxUnreadCountResponse>({
    queryKey: INBOX_UNREAD_QUERY_KEY,
    queryFn: () =>
      apiRequest<InboxUnreadCountResponse>('GET', '/me/inbox/unread-count'),
    refetchInterval: NOTIFICATION_POLL_MS,
  });

  const requestsQuery = useQuery<FriendsBadgeResponse, unknown, number>({
    queryKey: ['friends'],
    queryFn: () => apiRequest<FriendsBadgeResponse>('GET', '/me/friends'),
    refetchInterval: NOTIFICATION_POLL_MS,
    select: (data) => data.incomingRequests.length,
  });

  const unreadShares = unreadQuery.data?.count ?? 0;
  const pendingRequests = requestsQuery.data ?? 0;
  return unreadShares + pendingRequests;
}

/**
 * Friends tab icon with an unread indicator. Renders the standard people
 * glyph plus a count badge when there are unread inbox Shares or pending
 * friend requests, so the User can tell — from any tab — that something is
 * waiting for them. Runs its own queries in the tab bar (like
 * `ProfileTabIcon`) so the badge shows even before the Friends tab has ever
 * been opened; the count updates live as the underlying React Query cache
 * changes.
 */
function FriendsTabIcon({
  focused,
  color,
  size,
}: {
  readonly focused: boolean;
  readonly color: string;
  readonly size: number;
}): JSX.Element {
  const count = useNotificationBadgeCount();
  const glyphs = TAB_ICONS.Friends;
  const name = focused ? glyphs.focused : glyphs.unfocused;

  return (
    <View style={styles.tabIconContainer}>
      <Ionicons name={name} size={size} color={color} />
      {count > 0 ? (
        <View style={styles.badge} testID="friends-tab-badge">
          <Text style={styles.badgeText} numberOfLines={1}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MainTabsNavigator(): JSX.Element {
  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#003a9b',
        tabBarInactiveTintColor: '#6b7280',
        tabBarIcon: ({ focused, color, size }) => {
          if (route.name === 'Profile') {
            return <ProfileTabIcon focused={focused} color={color} size={size} />;
          }
          if (route.name === 'Friends') {
            return <FriendsTabIcon focused={focused} color={color} size={size} />;
          }
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
      <MainTabs.Screen
        name="Trips"
        component={TripsStack}
        options={{ headerShown: false }}
      />
      <MainTabs.Screen
        name="Friends"
        component={FriendsStack}
        options={{ headerShown: false }}
      />
      <MainTabs.Screen
        name="Profile"
        component={ProfileStack}
        options={{ headerShown: false }}
      />
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
      <RootStack.Screen
        name="ShareComposer"
        component={ShareComposerScreen}
        options={{ title: 'Share', presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

const styles = StyleSheet.create({
  profileAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  tabIconContainer: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#e11d48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});

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
