import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { ExperienceDTO, TripDTO, TripStatus } from '@dwt/shared';

import { apiRequest, type ApiError } from '../../api/client';
import { tripsListKeys } from '../trips/TripsListScreen';
import { makeStyles } from '../../theme/makeStyles';
import { withAlpha } from '../../theme/theme';
import { useAppTheme } from '../../theme/useAppTheme';

const HOME_SEARCH_DEBOUNCE_MS = 250;
const POPULAR_TOOLS_IDS = [
  'tool-waits',
  'tool-crowds',
  'tool-dining',
  'tool-mickeys',
  'tool-pins',
] as const;

interface ToolShortcut {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly breadcrumb: string;
  readonly keywords: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly tag: string;
  readonly onPress: () => void;
}

interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

type TripsListResponse = readonly TripStatusGroup[];

function scoreTextMatch(query: string, title: string, subtitle: string, keywords: string): number {
  const t = title.toLowerCase();
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.split(/[\s&/]+/).some((word) => word.startsWith(query))) return 60;
  if (t.includes(query)) return 40;
  if (subtitle.toLowerCase().includes(query)) return 25;
  if (keywords.toLowerCase().includes(query)) return 15;
  return 0;
}

function formatTripStatusSubtitle(status: TripStatus, trip: TripDTO): string {
  const statusLabel =
    status === 'active' ? 'Active Trip' : status === 'upcoming' ? 'Upcoming Trip' : 'Past Trip';
  if (trip.startDate && trip.endDate) {
    return `${statusLabel} · ${trip.startDate} to ${trip.endDate}`;
  }
  return statusLabel;
}

type TripScopedScreen =
  | 'TripSchedule'
  | 'TripReservations'
  | 'TripPackingList'
  | 'TripBudget'
  | 'TripExpenses'
  | 'TripDiningPlan'
  | 'TripBookingTimeline'
  | 'TripFeed'
  | 'TripAlbum'
  | 'TripSummary'
  | 'TripPlannedList'
  | 'TripMembers';

interface PendingTripTool {
  readonly title: string;
  readonly screen: TripScopedScreen;
}

export function HomeSearchBar(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [pendingTripTool, setPendingTripTool] = useState<PendingTripTool | null>(null);
  const [noTripToolPrompt, setNoTripToolPrompt] = useState<{ readonly title: string } | null>(
    null,
  );

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setDebouncedQuery('');
      return;
    }
    const handle = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, HOME_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  const catalogQuery = useQuery<{ experiences: readonly ExperienceDTO[] }, ApiError>({
    queryKey: ['catalog', 'search', debouncedQuery] as const,
    queryFn: () => {
      const params = new URLSearchParams({ q: debouncedQuery });
      return apiRequest<{ experiences: readonly ExperienceDTO[] }>(
        'GET',
        `/catalog?${params.toString()}`,
      );
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    enabled: trimmed.length >= 1,
    staleTime: 60 * 1000,
    retry: false,
  });

  const allTrips = useMemo(() => {
    const groups = tripsQuery.data ?? [];
    const ordered: Array<{ status: TripStatus; trip: TripDTO }> = [];
    for (const group of groups) {
      for (const trip of group.trips ?? []) {
        ordered.push({ status: group.status, trip });
      }
    }
    return ordered;
  }, [tripsQuery.data]);

  const activeOrUpcomingTrips = useMemo(
    () => allTrips.filter((entry) => entry.status === 'active' || entry.status === 'upcoming'),
    [allTrips],
  );

  const toolShortcuts = useMemo<readonly ToolShortcut[]>(() => {
    const makeTripTool = (
      id: string,
      title: string,
      singleSubPrefix: string,
      breadcrumb: string,
      keywords: string,
      icon: keyof typeof Ionicons.glyphMap,
      screen: TripScopedScreen,
    ): ToolShortcut => ({
      id,
      title,
      subtitle:
        activeOrUpcomingTrips.length === 0
          ? tripsQuery.isLoading
            ? singleSubPrefix
            : 'Start a trip to unlock this tool'
          : activeOrUpcomingTrips.length === 1
          ? `${singleSubPrefix} · ${activeOrUpcomingTrips[0]!.trip.name}`
          : `Choose a trip (${activeOrUpcomingTrips.length})`,
      breadcrumb,
      keywords,
      icon,
      tag: 'Trips',
      onPress: () =>
        activeOrUpcomingTrips.length === 0
          ? setNoTripToolPrompt({ title })
          : activeOrUpcomingTrips.length === 1
          ? navigation.navigate('Trips', {
              screen,
              params: { tripId: activeOrUpcomingTrips[0]!.trip.id },
            })
          : setPendingTripTool({ title, screen }),
    });

    return [
      // Explore & Parks
      {
        id: 'tool-waits',
        title: 'Live Waits',
        subtitle: 'Real-time standby wait times across parks',
        breadcrumb: 'Explore › Live Waits',
        keywords: 'wait times standby lightning lane queue',
        icon: 'time-outline',
        tag: 'Explore',
        onPress: () => navigation.navigate('Explore', { screen: 'LiveWaits' }),
      },
      {
        id: 'tool-crowds',
        title: 'Crowd Calendar',
        subtitle: '1–10 daily park crowd forecast',
        breadcrumb: 'Explore › Crowds',
        keywords: 'crowd calendar forecast busy levels',
        icon: 'bar-chart-outline',
        tag: 'Explore',
        onPress: () => navigation.navigate('Explore', { screen: 'CrowdCalendar' }),
      },
      {
        id: 'tool-explore',
        title: 'Explore Parks & Catalog',
        subtitle: 'Browse all theme parks, dining & resorts',
        breadcrumb: 'Explore',
        keywords: 'explore catalog parks rides dining shows browse',
        icon: 'compass-outline',
        tag: 'Explore',
        onPress: () => navigation.navigate('Explore', { screen: 'CatalogList' }),
      },
      {
        id: 'tool-mk',
        title: 'Magic Kingdom',
        subtitle: 'Rides, dining & entertainment',
        breadcrumb: 'Explore › Magic Kingdom',
        keywords: 'magic kingdom mk castle park',
        icon: 'sparkles-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Magic Kingdom' },
          }),
      },
      {
        id: 'tool-epcot',
        title: 'EPCOT',
        subtitle: 'Rides, festivals & World Showcase',
        breadcrumb: 'Explore › EPCOT',
        keywords: 'epcot world showcase park',
        icon: 'planet-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'EPCOT' },
          }),
      },
      {
        id: 'tool-hs',
        title: 'Hollywood Studios',
        subtitle: 'Star Wars, Toy Story & thrill rides',
        breadcrumb: 'Explore › Hollywood Studios',
        keywords: 'hollywood studios hs galaxy edge park',
        icon: 'film-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Hollywood Studios' },
          }),
      },
      {
        id: 'tool-ak',
        title: 'Animal Kingdom',
        subtitle: 'Pandora, safaris & trails',
        breadcrumb: 'Explore › Animal Kingdom',
        keywords: 'animal kingdom ak pandora safari park',
        icon: 'leaf-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Animal Kingdom' },
          }),
      },
      {
        id: 'tool-springs',
        title: 'Disney Springs',
        subtitle: 'Dining, shopping & nightlife',
        breadcrumb: 'Explore › Disney Springs',
        keywords: 'disney springs shopping dining',
        icon: 'bag-handle-outline',
        tag: 'Places',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Disney Springs' },
          }),
      },
      {
        id: 'tool-typhoon',
        title: 'Typhoon Lagoon',
        subtitle: 'Water park attractions & dining',
        breadcrumb: 'Explore › Typhoon Lagoon',
        keywords: 'water park typhoon lagoon slides',
        icon: 'water-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Typhoon Lagoon' },
          }),
      },
      {
        id: 'tool-blizzard',
        title: 'Blizzard Beach',
        subtitle: 'Water park attractions & dining',
        breadcrumb: 'Explore › Blizzard Beach',
        keywords: 'water park blizzard beach slides',
        icon: 'snow-outline',
        tag: 'Park',
        onPress: () =>
          navigation.navigate('Explore', {
            screen: 'DestinationScreen',
            params: { destination: 'Blizzard Beach' },
          }),
      },
      {
        id: 'tool-resorts',
        title: 'Resort Hotels',
        subtitle: 'All Disney World hotels, dining & pools',
        breadcrumb: 'Explore › Resorts',
        keywords: 'resorts hotels pools lodging',
        icon: 'bed-outline',
        tag: 'Places',
        onPress: () => navigation.navigate('Explore', { screen: 'ResortsDirectory' }),
      },

      // Trips & Planning
      {
        id: 'tool-trips',
        title: 'My Trips',
        subtitle: 'View active, upcoming & past vacations',
        breadcrumb: 'Trips',
        keywords: 'trips vacations itineraries plans',
        icon: 'airplane-outline',
        tag: 'Trips',
        onPress: () => navigation.navigate('Trips', { screen: 'TripsList' }),
      },
      {
        id: 'tool-dining',
        title: 'Dining Plan Calculator',
        subtitle: 'Compare Disney Dining Plans for your trip',
        breadcrumb: 'Trips › Dining Plan',
        keywords: 'dining plan calculator meals quick service worth it',
        icon: 'restaurant-outline',
        tag: 'Tool',
        onPress: () => navigation.navigate('Trips', { screen: 'DiningPlanCalculator' }),
      },
      makeTripTool(
        'tool-schedule',
        'Trip Schedule Builder',
        'Park days & routing',
        'Trips › Schedule Builder',
        'schedule itinerary planner day timeline optimize',
        'calendar-outline',
        'TripSchedule',
      ),
      makeTripTool(
        'tool-reservations',
        'Trip Reservations',
        'Dining & LL bookings',
        'Trips › Reservations',
        'reservations adr dining lightning lane bookings',
        'bookmark-outline',
        'TripReservations',
      ),
      makeTripTool(
        'tool-packing',
        'Packing List',
        'Shared checklists',
        'Trips › Packing List',
        'packing list luggage checklist essentials',
        'briefcase-outline',
        'TripPackingList',
      ),
      makeTripTool(
        'tool-budget',
        'Trip Budget',
        'Savings & spending plan',
        'Trips › Budget',
        'budget savings spending plan',
        'wallet-outline',
        'TripBudget',
      ),
      makeTripTool(
        'tool-expenses',
        'Trip Expenses & Balances',
        'Shared costs & splits',
        'Trips › Expenses',
        'expenses balances split money ledger owed',
        'cash-outline',
        'TripExpenses',
      ),
      makeTripTool(
        'tool-trip-dining',
        'Trip Dining Plan',
        'Dining plan fit for this trip',
        'Trips › Dining Plan',
        'dining plan trip meals worth it',
        'restaurant-outline',
        'TripDiningPlan',
      ),
      makeTripTool(
        'tool-booking-timeline',
        'Booking Timeline',
        '60-day ADR & LL dates',
        'Trips › Booking Timeline',
        'booking timeline 60 days adr window milestones',
        'hourglass-outline',
        'TripBookingTimeline',
      ),
      makeTripTool(
        'tool-trip-feed',
        'Trip Activity & Feed',
        'Live trip log & check-ins',
        'Trips › Activity',
        'trip feed activity log check-ins',
        'pulse-outline',
        'TripFeed',
      ),
      makeTripTool(
        'tool-trip-album',
        'Trip Photo Album',
        'Shared trip photos',
        'Trips › Album',
        'trip album photos gallery pictures',
        'images-outline',
        'TripAlbum',
      ),
      makeTripTool(
        'tool-trip-summary',
        'Trip Summary & Recap',
        'Stats & highlights for this trip',
        'Trips › Summary',
        'trip summary recap highlights stats',
        'document-text-outline',
        'TripSummary',
      ),
      makeTripTool(
        'tool-trip-planned',
        'Trip Must-Dos & Planned List',
        'Rides & dining saved for this trip',
        'Trips › Planned List',
        'planned list must dos rides dining bucket',
        'checkbox-outline',
        'TripPlannedList',
      ),
      makeTripTool(
        'tool-trip-members',
        'Trip Crew & Members',
        'Party, guests & invites',
        'Trips › Members',
        'trip members crew party guests invites',
        'people-outline',
        'TripMembers',
      ),

      // You / Vault
      {
        id: 'tool-pins',
        title: 'Pins & Showcase',
        subtitle: 'Collectible pins & corkboard hub',
        breadcrumb: 'You › Pins',
        keywords: 'pins showcase corkboard badges achievements',
        icon: 'ribbon-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'CollectionHome',
            params: { initialTab: 'pins' },
          }),
      },
      {
        id: 'tool-pin-board',
        title: 'Pin Collection',
        subtitle: 'All collectible pins & progress filters',
        breadcrumb: 'You › Pins › Collection',
        keywords: 'pin collection board badges unlocked progress',
        icon: 'grid-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'PinBoard' }),
      },
      {
        id: 'tool-pin-showcase',
        title: 'Pin Showcase Editor',
        subtitle: 'Arrange pins on your corkboard',
        breadcrumb: 'You › Pins › Showcase',
        keywords: 'pin showcase corkboard customize arrange',
        icon: 'easel-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'PinShowcase' }),
      },
      {
        id: 'tool-food-lists',
        title: 'Food Lists',
        subtitle: 'Saved snack & dining wishlists',
        breadcrumb: 'You › Lists',
        keywords: 'food lists snacks dining treats collections',
        icon: 'fast-food-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'MyFoodLists' }),
      },
      {
        id: 'tool-discover-food-lists',
        title: 'Discover Food Lists',
        subtitle: 'Browse public community snack lists',
        breadcrumb: 'Explore › Food Lists',
        keywords: 'discover food lists community public snacks',
        icon: 'compass-outline',
        tag: 'Explore',
        onPress: () => navigation.navigate('FoodListDiscovery'),
      },
      {
        id: 'tool-experience-lists',
        title: 'Experience Lists',
        subtitle: 'Saved ride, show & attraction lists',
        breadcrumb: 'You › Lists',
        keywords: 'experience lists rides attractions shows bucket collections',
        icon: 'list-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'MyExperienceLists' }),
      },
      {
        id: 'tool-discover-experience-lists',
        title: 'Discover Experience Lists',
        subtitle: 'Browse public community ride & show lists',
        breadcrumb: 'Explore › Experience Lists',
        keywords: 'discover experience lists community public rides',
        icon: 'compass-outline',
        tag: 'Explore',
        onPress: () => navigation.navigate('ExperienceListDiscovery'),
      },
      {
        id: 'tool-food-history',
        title: 'Food History & Treats',
        subtitle: 'Logged snacks, drinks & ratings',
        breadcrumb: 'You › Food',
        keywords: 'food history treats snacks logged meals ratings',
        icon: 'ice-cream-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'MyFoodHistory' }),
      },
      {
        id: 'tool-my-photos',
        title: 'My Photos',
        subtitle: 'Your uploaded park & trip photos',
        breadcrumb: 'You › Photos',
        keywords: 'photos pictures gallery uploads camera',
        icon: 'images-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'MyPhotos' }),
      },
      {
        id: 'tool-passport',
        title: 'Park Completion Passport',
        subtitle: 'Overall park progress & stats',
        breadcrumb: 'You › Stats',
        keywords: 'passport stats completion progress coverage',
        icon: 'stats-chart-outline',
        tag: 'You',
        onPress: () => navigation.navigate('Collection', { screen: 'Stats' }),
      },
      {
        id: 'tool-food-stats',
        title: 'Food Stats',
        subtitle: 'Top treats, restaurants & food insights',
        breadcrumb: 'You › Stats › Food',
        keywords: 'food stats insights dining analytics',
        icon: 'pie-chart-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'Stats',
            params: { screen: 'FoodStatsDetail' },
          }),
      },
      {
        id: 'tool-activity-experiences',
        title: 'Activity & Experiences',
        subtitle: 'Total rides logged, personal records & most ridden',
        breadcrumb: 'You › Stats › Activity',
        keywords: 'activity experiences rides logged most ridden records marathon festival booths',
        icon: 'trophy-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'Stats',
            params: { screen: 'ExperiencesDetail' },
          }),
      },
      {
        id: 'tool-coverage-stats',
        title: 'Park Coverage Stats',
        subtitle: 'Completion breakdown by park, category & resorts',
        breadcrumb: 'You › Stats › Coverage',
        keywords: 'coverage stats parks completion breakdown resorts',
        icon: 'map-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'Stats',
            params: { screen: 'CoverageDetail' },
          }),
      },
      {
        id: 'tool-ratings-stats',
        title: 'Ratings Breakdown',
        subtitle: 'Your star ratings & top-rated experiences',
        breadcrumb: 'You › Stats › Ratings',
        keywords: 'ratings stats stars reviews top rated',
        icon: 'star-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'Stats',
            params: { screen: 'RatingsDetail' },
          }),
      },
      {
        id: 'tool-interests-stats',
        title: 'Interests & Facets',
        subtitle: 'Thrill levels, themes & ride types you love',
        breadcrumb: 'You › Stats › Interests',
        keywords: 'interests facets thrill themes stats profile',
        icon: 'heart-outline',
        tag: 'You',
        onPress: () =>
          navigation.navigate('Collection', {
            screen: 'Stats',
            params: { screen: 'InterestsDetail' },
          }),
      },

      // Crew, Social, Games & Settings
      {
        id: 'tool-mickeys',
        title: 'Hidden Mickeys',
        subtitle: 'Scavenger hunt clues & progress',
        breadcrumb: 'Explore › Hidden Mickeys',
        keywords: 'hidden mickeys scavenger hunt clues',
        icon: 'sparkles-outline',
        tag: 'Game',
        onPress: () => navigation.navigate('HiddenMickeys'),
      },
      {
        id: 'tool-submit-mickey',
        title: 'Submit a Hidden Mickey',
        subtitle: 'Share a new Hidden Mickey spot',
        breadcrumb: 'Explore › Hidden Mickeys › Submit',
        keywords: 'submit hidden mickey add report spot',
        icon: 'add-circle-outline',
        tag: 'Game',
        onPress: () => navigation.navigate('SubmitMickey'),
      },
      {
        id: 'tool-my-mickeys',
        title: 'My Mickey Submissions',
        subtitle: 'Track Hidden Mickeys you submitted',
        breadcrumb: 'Explore › Hidden Mickeys › Submissions',
        keywords: 'my submissions hidden mickeys status',
        icon: 'checkmark-done-outline',
        tag: 'Game',
        onPress: () => navigation.navigate('MySubmissions'),
      },
      {
        id: 'tool-friends',
        title: 'Friends & Crew',
        subtitle: 'Manage your friends & requests',
        breadcrumb: 'You › Crew & Settings',
        keywords: 'friends crew social requests',
        icon: 'people-outline',
        tag: 'Crew',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'FriendsList' }),
      },
      {
        id: 'tool-find-friends',
        title: 'Find Friends',
        subtitle: 'Search & add people you know',
        breadcrumb: 'You › Crew & Settings › Find Friends',
        keywords: 'find add friends search crew',
        icon: 'person-add-outline',
        tag: 'Crew',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'FriendsSearch' }),
      },
      {
        id: 'tool-inbox',
        title: 'Shared Inbox',
        subtitle: 'Recommendations & trip recaps from friends',
        breadcrumb: 'You › Crew & Settings › Inbox',
        keywords: 'inbox shares received recommendations recaps',
        icon: 'mail-outline',
        tag: 'Crew',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'Inbox' }),
      },
      {
        id: 'tool-sent',
        title: 'Sent Shares',
        subtitle: 'Things you shared with your crew',
        breadcrumb: 'You › Crew & Settings › Sent',
        keywords: 'sent shares history',
        icon: 'paper-plane-outline',
        tag: 'Crew',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'Sent' }),
      },
      {
        id: 'tool-notifications',
        title: 'Notifications',
        subtitle: 'Friend requests, tags & alerts',
        breadcrumb: 'Home › Notifications',
        keywords: 'notifications alerts bell updates',
        icon: 'notifications-outline',
        tag: 'You',
        onPress: () => navigation.navigate('NotificationCenter'),
      },
      {
        id: 'tool-settings',
        title: 'Profile, Crew & Settings',
        subtitle: 'Avatar, theme, crew & account preferences',
        breadcrumb: 'You › Crew & Settings',
        keywords: 'settings profile avatar theme account dark mode security logout tour guide',
        icon: 'settings-outline',
        tag: 'You',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'YouAndCrewMain' }),
      },
      {
        id: 'tool-blocked',
        title: 'Blocked Users',
        subtitle: 'Manage blocked accounts & privacy',
        breadcrumb: 'You › Crew & Settings › Blocked',
        keywords: 'blocked users privacy safety',
        icon: 'shield-checkmark-outline',
        tag: 'You',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'BlockedUsers' }),
      },
      {
        id: 'tool-onboarding-preview',
        title: 'Preview Onboarding',
        subtitle: 'Test the 3-step welcome flow & Home Start Here card',
        breadcrumb: 'You › Crew & Settings › Onboarding Preview',
        keywords: 'onboarding tour welcome guide preview start here',
        icon: 'sparkles-outline',
        tag: 'You',
        onPress: () => navigation.navigate('OnboardingFlow', { mode: 'preview' }),
      },
      {
        id: 'tool-feedback',
        title: 'Send Feedback',
        subtitle: 'Report a bug or suggest a feature',
        breadcrumb: 'You › Crew & Settings › Feedback',
        keywords: 'feedback bug report support help',
        icon: 'chatbox-ellipses-outline',
        tag: 'You',
        onPress: () => navigation.navigate('YouAndCrew', { screen: 'Feedback' }),
      },
    ];
  }, [navigation, activeOrUpcomingTrips, tripsQuery.isLoading]);

  const popularTools = useMemo(() => {
    const byId = new Map(toolShortcuts.map((tool) => [tool.id, tool]));
    return POPULAR_TOOLS_IDS.map((id) => byId.get(id)).filter(
      (tool): tool is ToolShortcut => Boolean(tool),
    );
  }, [toolShortcuts]);

  const matchingTrips = useMemo(() => {
    if (!trimmed) return [];
    const q = trimmed.toLowerCase();
    const isGenericTripQuery = 'trips'.startsWith(q) || q === 'vacation';
    return allTrips
      .filter(({ trip }) => {
        if (isGenericTripQuery) return true;
        return (
          trip.name.toLowerCase().includes(q) ||
          (trip.description ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 3);
  }, [trimmed, allTrips]);

  const matchingTools = useMemo(() => {
    if (!trimmed) return [];
    const q = trimmed.toLowerCase();
    return toolShortcuts
      .map((item) => ({
        item,
        score: scoreTextMatch(q, item.title, item.subtitle, item.keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.item);
  }, [trimmed, toolShortcuts]);

  const matchingExperiences = useMemo(() => {
    if (debouncedQuery.length < 2) return [];
    return (catalogQuery.data?.experiences ?? []).slice(0, 5);
  }, [debouncedQuery, catalogQuery.data?.experiences]);

  const hasQuery = trimmed.length > 0;
  const showPopularTools = focused && !hasQuery;
  const hasAnyMatches =
    matchingTrips.length > 0 || matchingTools.length > 0 || matchingExperiences.length > 0;

  return (
    <View style={styles.wrap} testID="home-search-bar">
      <View style={styles.inputRow}>
        <Ionicons name="search-outline" size={17} color={t.color.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search rides, trips, lists, or tools..."
          placeholderTextColor={t.color.textSecondary}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          testID="home-search-input"
        />
        {hasQuery ? (
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setQuery('');
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID="home-search-clear"
          >
            <Ionicons name="close-circle" size={18} color={t.color.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {showPopularTools ? (
        <View style={styles.resultsCard} testID="home-search-popular-tools">
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderText}>POPULAR TOOLS</Text>
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setFocused(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close popular tools"
              testID="home-search-popular-close"
            >
              <Ionicons name="close" size={16} color={t.color.textSecondary} />
            </Pressable>
          </View>
          {popularTools.map((tool) => (
            <Pressable
              key={tool.id}
              style={styles.resultRow}
              onPress={() => {
                Keyboard.dismiss();
                setFocused(false);
                tool.onPress();
              }}
              accessibilityRole="button"
              testID={`home-search-popular-${tool.id}`}
            >
              <View style={styles.resultIcon}>
                <Ionicons name={tool.icon} size={16} color={t.color.primaryFg} />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {tool.title}
                </Text>
                <Text style={styles.resultBreadcrumb} numberOfLines={1}>
                  {tool.breadcrumb}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={t.color.textSecondary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {hasQuery ? (
        <View style={styles.resultsCard} testID="home-search-results">
          {matchingTrips.length > 0 ? (
            <View style={styles.sectionHeaderRow} testID="home-search-section-trips">
              <Text style={styles.sectionHeaderText}>YOUR TRIPS</Text>
            </View>
          ) : null}
          {matchingTrips.map(({ status, trip }) => (
            <Pressable
              key={trip.id}
              style={styles.resultRow}
              onPress={() => {
                Keyboard.dismiss();
                setQuery('');
                navigation.navigate('Trips', {
                  screen: 'TripDetail',
                  params: { tripId: trip.id },
                });
              }}
              accessibilityRole="button"
              testID={`home-search-trip-${trip.id}`}
            >
              <View style={styles.resultIcon}>
                <Ionicons name="airplane-outline" size={16} color={t.color.primaryFg} />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {trip.name}
                </Text>
                <Text style={styles.resultSub} numberOfLines={1}>
                  {formatTripStatusSubtitle(status, trip)}
                </Text>
              </View>
              <Text style={styles.resultTag}>Trip ›</Text>
            </Pressable>
          ))}

          {matchingTools.length > 0 ? (
            <View style={styles.sectionHeaderRow} testID="home-search-section-tools">
              <Text style={styles.sectionHeaderText}>APP TOOLS</Text>
            </View>
          ) : null}
          {matchingTools.map((tool) => (
            <Pressable
              key={tool.id}
              style={styles.resultRow}
              onPress={() => {
                Keyboard.dismiss();
                setQuery('');
                tool.onPress();
              }}
              accessibilityRole="button"
              testID={`home-search-result-${tool.id}`}
            >
              <View style={styles.resultIcon}>
                <Ionicons name={tool.icon} size={16} color={t.color.primaryFg} />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {tool.title}
                </Text>
                <Text style={styles.resultSub} numberOfLines={1}>
                  {tool.subtitle}
                </Text>
                <Text style={styles.resultBreadcrumb} numberOfLines={1}>
                  {tool.breadcrumb}
                </Text>
              </View>
              <Text style={styles.resultTag}>{tool.tag} ›</Text>
            </Pressable>
          ))}

          {matchingExperiences.length > 0 ? (
            <View style={styles.sectionHeaderRow} testID="home-search-section-experiences">
              <Text style={styles.sectionHeaderText}>EXPERIENCES &amp; DINING</Text>
            </View>
          ) : null}

          {matchingExperiences.map((exp) => (
            <Pressable
              key={exp.id}
              style={styles.resultRow}
              onPress={() => {
                Keyboard.dismiss();
                setQuery('');
                navigation.navigate('ExperienceDetail', { experienceId: exp.id });
              }}
              accessibilityRole="button"
              testID={`home-search-exp-${exp.id}`}
            >
              <View style={styles.resultIcon}>
                <Ionicons name="sparkles-outline" size={16} color={t.color.primaryFg} />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {exp.name}
                </Text>
                <Text style={styles.resultSub} numberOfLines={1}>
                  {exp.park ?? exp.resortArea ?? exp.category}
                </Text>
              </View>
              <Text style={styles.resultTag}>Go ›</Text>
            </Pressable>
          ))}

          {!hasAnyMatches ? (
            <View style={styles.emptyRow}>
              <Text style={styles.resultSub}>
                {catalogQuery.isFetching
                  ? 'Searching...'
                  : `No matches for "${trimmed}"`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Modal
        visible={pendingTripTool !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingTripTool(null)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setPendingTripTool(null)}
          testID="home-search-trip-picker"
        >
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {pendingTripTool?.title ?? 'Choose a Trip'}
              </Text>
              <Pressable
                onPress={() => setPendingTripTool(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close trip picker"
              >
                <Ionicons name="close" size={20} color={t.color.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.pickerSubtitle}>Select which trip to open:</Text>
            <ScrollView style={styles.pickerList}>
              {activeOrUpcomingTrips.map(({ status, trip }) => (
                <Pressable
                  key={trip.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    const targetScreen = pendingTripTool?.screen;
                    setPendingTripTool(null);
                    if (targetScreen) {
                      navigation.navigate('Trips', {
                        screen: targetScreen,
                        params: { tripId: trip.id },
                      });
                    }
                  }}
                  accessibilityRole="button"
                  testID={`home-search-trip-pick-${trip.id}`}
                >
                  <View style={styles.resultIcon}>
                    <Ionicons name="airplane-outline" size={16} color={t.color.primaryFg} />
                  </View>
                  <View style={styles.resultText}>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {trip.name}
                    </Text>
                    <Text style={styles.resultSub} numberOfLines={1}>
                      {formatTripStatusSubtitle(status, trip)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.color.textSecondary} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={noTripToolPrompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setNoTripToolPrompt(null)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setNoTripToolPrompt(null)}
          testID="home-search-no-trip-modal"
        >
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {noTripToolPrompt?.title ?? 'Trip Tool'}
              </Text>
              <Pressable
                onPress={() => setNoTripToolPrompt(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={t.color.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.pickerSubtitle}>
              {noTripToolPrompt?.title} lives inside a Trip. Create or join a trip to start using it.
            </Text>
            <View style={styles.noTripActions}>
              <Pressable
                style={styles.noTripCancelBtn}
                onPress={() => setNoTripToolPrompt(null)}
                accessibilityRole="button"
                testID="home-search-no-trip-cancel-btn"
              >
                <Text style={styles.noTripCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.noTripCreateBtn}
                onPress={() => {
                  setNoTripToolPrompt(null);
                  navigation.navigate('Trips', { screen: 'TripsList' });
                }}
                accessibilityRole="button"
                testID="home-search-no-trip-create-btn"
              >
                <Text style={styles.noTripCreateText}>Create a Trip</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    paddingHorizontal: t.spacing.md,
    marginTop: t.spacing.md,
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  input: {
    flex: 1,
    fontSize: 13.5,
    color: t.color.textPrimary,
    paddingVertical: 0,
  },
  resultsCard: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    overflow: 'hidden',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  sectionHeaderText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.6,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  resultIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  resultSub: {
    fontSize: 11.5,
    color: t.color.textSecondary,
    marginTop: 1,
  },
  resultBreadcrumb: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.primaryFg,
    marginTop: 2,
  },
  resultTag: {
    fontSize: 11.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  emptyRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: withAlpha(t.color.background, 0.72),
    justifyContent: 'center',
    padding: t.spacing.lg,
  },
  pickerCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
    maxHeight: '70%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  pickerSubtitle: {
    fontSize: 12.5,
    color: t.color.textSecondary,
    marginBottom: t.spacing.sm,
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  noTripActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: t.spacing.sm,
  },
  noTripCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
  },
  noTripCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  noTripCreateBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: t.radius.md,
    backgroundColor: t.color.primary,
  },
  noTripCreateText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
}));
