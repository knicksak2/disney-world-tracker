/**
 * HomeScreen — The App's lead command center surface.
 *
 * Implements Task 15.6 (Requirements 2.1, 2.2, 2.3, 2.4, 2.5).
 * Features:
 *   1. Gradient Hero Header:
 *      - Time-aware personalized greeting pill ("✨ Good morning, [Name]!")
 *      - Header actions: NotificationBell with AttentionBadge & pill-variant AvatarChip ("You & Crew")
 *      - Hero title ("Ready for the Magic?") & park operating context subtitle
 *   2. Vacation Context Slot:
 *      - ActiveTripShortcut (for active in-park vacation)
 *      - UpcomingTripHero (countdown card for upcoming vacations)
 *   3. Action Dock:
 *      - 4 quick-action launch tiles (Live Waits, Log Ride, Log Snack, My Pins)
 *   4. Park Wait Pulse:
 *      - Horizontal line radar carousel across the 4 theme parks
 *   5. Highest-Rated Experiences:
 *      - Section card header with "See All" link navigating to Explore
 *      - Cached community leaderboard rows
 */

import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type {
  CrowdCalendarDayDTO,
  CurrentWeatherDTO,
  ExperienceCategory,
  ExperienceDTO,
  FoodItemDTO,
  LeaderboardEntryDTO,
  Park,
  PlannedItemDTO,
  TripDTO,
  TripStatus,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import ActiveTripShortcut from '../../components/ActiveTripShortcut';
import NotificationBell from '../../features/notifications/NotificationBell';
import type {
  MainTabParamList,
  RootStackParamList,
} from '../../navigation/RootNavigator';
import AvatarChip from '../navigation/AvatarChip';
import { navigateToTripSchedule } from '../../navigation/navigationRef';
import { tripsListKeys } from '../trips/TripsListScreen';
import { tripPlannedListKeys } from '../trips/TripPlannedListScreen';
import { getTodayWDW } from '../trips/TripScheduleScreen';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  ScreenContainer,
} from '../../theme/components';
import { ExperiencePicker } from '../trips/ExperiencePicker';
import LogVisitModal from '../catalog/LogVisitModal';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import LogFoodItemModal from '../catalog/LogFoodItemModal';
import ActionDock from './ActionDock';
import ExplorationPromptCard from './ExplorationPromptCard';
import HomeFavoritesSection from './HomeFavoritesSection';
import ParkWaitPulse from './ParkWaitPulse';
import UpcomingTripHero from './UpcomingTripHero';
import { buildOperatingContextSubtitle } from './operatingContext';
import { deriveTodaysPark } from './deriveTodaysPark';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

interface LeaderboardResponse {
  readonly entries: readonly LeaderboardEntryDTO[];
}

interface MeResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: {
    readonly displayName: string;
    readonly avatarPreset?: string | null;
  };
}

interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

type TripsListResponse = readonly TripStatusGroup[];

const CACHE_WINDOW_MS = 5 * 60 * 1000;

export default function HomeScreen({ navigation }: Props): JSX.Element {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const insets = useContext(SafeAreaInsetsContext);
  const topInset = Math.max(insets?.top ?? 0, theme.spacing.xl);

  // Quick Action / Experience Logging modal flow state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTab, setPickerTab] = useState<'rides' | 'dining'>('rides');
  const [selectedRideExperience, setSelectedRideExperience] = useState<ExperienceDTO | null>(null);
  const [selectedDiningExperience, setSelectedDiningExperience] = useState<ExperienceDTO | null>(null);
  const [foodPickerVisible, setFoodPickerVisible] = useState(false);
  const [selectedFoodItem, setSelectedFoodItem] = useState<FoodItemDTO | null>(null);
  const [logFoodModalVisible, setLogFoodModalVisible] = useState(false);

  const handleSelectExperience = useCallback((exp: ExperienceDTO) => {
    setPickerVisible(false);
    if (pickerTab === 'rides') {
      setSelectedRideExperience(exp);
    } else {
      setSelectedDiningExperience(exp);
      setFoodPickerVisible(true);
    }
  }, [pickerTab]);

  // User identity for personalized greeting
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: CACHE_WINDOW_MS,
  });

  // Active or upcoming trip status query
  const tripsQuery = useQuery<TripsListResponse>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    staleTime: 60 * 1000,
  });

  // Catalog experiences query for Land metadata on leaderboard
  const catalogQuery = useQuery<{ experiences: readonly ExperienceDTO[] }>({
    queryKey: ['catalog', 'all'],
    queryFn: () => apiRequest<{ experiences: readonly ExperienceDTO[] }>('GET', '/catalog'),
    staleTime: 3600 * 1000,
  });

  const experiencesById = useMemo(() => {
    const map = new Map<string, ExperienceDTO>();
    if (catalogQuery.data?.experiences) {
      for (const exp of catalogQuery.data.experiences) {
        map.set(exp.id, exp);
      }
    }
    return map;
  }, [catalogQuery.data?.experiences]);

  const activeGroup = tripsQuery.data?.find((g) => g.status === 'active');
  const activeTrip = activeGroup?.trips?.[0];
  const upcomingGroup = tripsQuery.data?.find((g) => g.status === 'upcoming');
  const upcomingTrips = upcomingGroup?.trips ?? [];
  const hasUpcomingTrip = upcomingTrips.length > 0;
  const hasActiveTrip = Boolean(activeTrip);
  const showExplorationPrompt = tripsQuery.isSuccess && !hasActiveTrip && !hasUpcomingTrip;

  // Active trip planned items query for deriving today's park
  const activePlannedItemsQuery = useQuery<readonly PlannedItemDTO[]>({
    queryKey: tripPlannedListKeys.items(activeTrip?.id ?? ''),
    queryFn: () =>
      apiRequest<readonly PlannedItemDTO[]>(
        'GET',
        `/trips/${encodeURIComponent(activeTrip?.id ?? '')}/planned-items`,
      ),
    enabled: Boolean(activeTrip?.id),
    staleTime: 60 * 1000,
  });

  const todayStr = getTodayWDW();

  // Derive day numbers when on an active trip using calendar dates
  const { currentDay, totalDays } = useMemo(() => {
    if (!activeTrip?.startDate || !activeTrip?.endDate) {
      return { currentDay: 1, totalDays: 1 };
    }
    const [sY, sM, sD] = activeTrip.startDate.split('-').map(Number);
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    const [eY, eM, eD] = activeTrip.endDate.split('-').map(Number);
    if (!sY || !sM || !sD || !tY || !tM || !tD || !eY || !eM || !eD) {
      return { currentDay: 1, totalDays: 1 };
    }
    const startDate = new Date(sY, sM - 1, sD);
    const todayDate = new Date(tY, tM - 1, tD);
    const endDate = new Date(eY, eM - 1, eD);
    const total = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
    const diffDays = Math.floor((todayDate.getTime() - startDate.getTime()) / 86400000);
    const current = Math.min(total, Math.max(1, diffDays + 1));
    return { currentDay: current, totalDays: total };
  }, [activeTrip?.startDate, activeTrip?.endDate, todayStr]);

  // Derive current park from today's planned items or trip's touring hours
  const currentPark = useMemo<Park>(
    () =>
      deriveTodaysPark({
        activeTrip,
        plannedItems: activePlannedItemsQuery.data,
        todayStr,
        experiencesById,
      }),
    [activeTrip, activePlannedItemsQuery.data, todayStr, experiencesById],
  );

  // Single-day crowd calendar query for real operating hours
  const crowdCalendarQuery = useQuery<{ days: readonly CrowdCalendarDayDTO[] }>({
    queryKey: ['crowd-calendar', 'today', currentPark],
    queryFn: () =>
      apiRequest<{ days: readonly CrowdCalendarDayDTO[] }>(
        'GET',
        `/crowd-calendar?park=${encodeURIComponent(currentPark)}&from=${todayStr}&to=${todayStr}`,
      ),
    staleTime: 60 * 1000,
  });

  // Current weather query for real temperature and conditions
  const weatherQuery = useQuery<CurrentWeatherDTO>({
    queryKey: ['weather', 'current'],
    queryFn: () => apiRequest<CurrentWeatherDTO>('GET', '/weather/current'),
    staleTime: 60 * 60 * 1000,
  });

  // Dynamic header text based on vacation context
  const parkDisplay =
    currentPark === 'EPCOT'
      ? 'EPCOT'
      : currentPark === 'Magic Kingdom'
      ? 'the Magic Kingdom'
      : currentPark;

  const heroTitle = activeTrip
    ? `Day ${currentDay} at ${parkDisplay}!`
    : 'Ready for the Magic?';

  const todayCrowdDay = crowdCalendarQuery.data?.days?.[0];

  const heroSubtitle = buildOperatingContextSubtitle({
    park: currentPark,
    parkHours: todayCrowdDay?.parkHours,
    weather: weatherQuery.data?.current,
    dayContext: activeTrip ? { currentDay, totalDays } : undefined,
  });

  // Highest-rated leaderboard query
  const query = useQuery<LeaderboardResponse, ApiError>({
    queryKey: ['home', 'highest-rated'] as const,
    queryFn: () => apiRequest<LeaderboardResponse>('GET', '/home/highest-rated'),
    staleTime: CACHE_WINDOW_MS,
    gcTime: CACHE_WINDOW_MS,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      query.refetch(),
      meQuery.refetch(),
      tripsQuery.refetch(),
      catalogQuery.refetch(),
      activePlannedItemsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [query, meQuery, tripsQuery, catalogQuery, activePlannedItemsQuery]);

  const displayName = meQuery.data?.profile?.displayName?.trim();
  const firstName = displayName ? displayName.split(' ')[0] : 'Nicholas';
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = `✨ ${timeGreeting}, ${firstName}!`;

  const showLoading = query.isLoading && query.data === undefined;
  const entries = query.data?.entries ?? [];
  const showEmpty = !showLoading && !query.isError && entries.length === 0;
  const showList = !showLoading && !query.isError && entries.length > 0;

  return (
    <ScreenContainer style={styles.container}>
      {/* 1. Gradient Hero Header */}
      <LinearGradient
        colors={theme.gradient.headerVivid}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroHeader, { paddingTop: topInset + 12 }]}
        testID="home-header"
      >
        <Ionicons
          name="sparkles"
          size={14}
          color="rgba(255,255,255,0.3)"
          style={styles.sparkleTopRight}
        />
        <Ionicons
          name="star"
          size={10}
          color="rgba(255,255,255,0.2)"
          style={styles.sparkleMidLeft}
        />

        <View style={styles.headerTopRow}>
          <View style={styles.greetingPillWrap}>
            <Text style={styles.greetingPill} testID="home-greeting-pill">
              {greeting}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.iconCircleBtn}>
              <NotificationBell tintColor="#ffffff" size={18} />
            </View>
            <AvatarChip
              variant="pill"
              tintColor={theme.color.textOnPrimary}
              testID="avatar-chip"
            />
          </View>
        </View>

        <Text style={styles.heroTitle} testID="home-hero-title">
          {heroTitle}
        </Text>
        <Text style={styles.heroSubtitle} testID="home-hero-sub">
          {heroSubtitle}
        </Text>
      </LinearGradient>

      {/* Main Scrollable Body */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.color.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* 2. Vacation Context: Active Vacation, Upcoming Countdown Hero, or Exploration Prompt */}
        <ActiveTripShortcut />
        <UpcomingTripHero />
        {showExplorationPrompt && (
          <ExplorationPromptCard
            onPress={() => navigation.navigate('Trips' as any)}
          />
        )}

        {/* 3. Action Dock */}
        <ActionDock
          isActiveVacation={Boolean(activeTrip)}
          dayNumber={currentDay}
          style={!hasActiveTrip && !hasUpcomingTrip && !showExplorationPrompt ? styles.actionDockTopSpacing : undefined}
          onOpenSchedule={() => {
            if (activeTrip?.id) {
              navigateToTripSchedule({ tripId: activeTrip.id });
            }
          }}
          onOpenLogRide={() => {
            setPickerTab('rides');
            setPickerVisible(true);
          }}
          onOpenLogSnack={() => {
            setPickerTab('dining');
            setPickerVisible(true);
          }}
          onOpenLiveWaits={() =>
            navigation.navigate('Explore', {
              screen: 'LiveWaits' as any,
              params: { park: currentPark } as any,
            } as any)
          }
          onOpenMyPins={() =>
            navigation.navigate('Collection', { screen: 'PinBoard' as any } as any)
          }
        />

        {/* 4. Park Wait Pulse */}
        <ParkWaitPulse
          activePark={activeTrip ? currentPark : undefined}
          onSelectPark={(park) =>
            navigation.navigate('Explore', {
              screen: 'LiveWaits' as any,
              params: { park } as any,
            } as any)
          }
        />

        {/* 4b. Your Favorites (R8, Task 10.2, 10.5) */}
        <HomeFavoritesSection
          onSelectExperience={(experienceId) =>
            navigation.navigate('ExperienceDetail', { experienceId })
          }
          onSeeAll={() =>
            navigation.navigate('Explore', {
              screen: 'LiveWaits' as any,
              params: { filter: 'favorites' } as any,
            } as any)
          }
        />

        {/* 5. Community Favorites Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionIcon}>🏆</Text>
              <Text style={styles.sectionTitle}>Highest-Rated Experiences</Text>
            </View>
            <Pressable
              onPress={() =>
                navigation.navigate('Explore', { screen: 'CatalogList' } as any)
              }
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="See all experiences"
              testID="home-leaderboard-see-all"
            >
              <Text style={styles.sectionLink}>See All</Text>
            </Pressable>
          </View>

          {showLoading ? (
            <View style={styles.center} testID="home-leaderboard-loading">
              <ActivityIndicator color={theme.color.primary} />
            </View>
          ) : null}

          {query.isError && query.data === undefined ? (
            <View style={styles.center} testID="home-leaderboard-error">
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load the leaderboard"
                body="Pull to refresh later."
              />
            </View>
          ) : null}

          {showEmpty ? (
            <View style={styles.center} testID="home-leaderboard-empty">
              <EmptyState
                icon="sparkles-outline"
                title="No leaderboard yet — keep exploring!"
                body="Rate experiences to help the magic rise to the top."
              />
            </View>
          ) : null}

          {showList ? (
            <View style={styles.leaderboardList}>
              {entries.map((item, index) => (
                <LeaderboardRow
                  key={item.experienceId}
                  rank={index + 1}
                  entry={item}
                  land={experiencesById.get(item.experienceId)?.land}
                  onPress={() => {
                    navigation.navigate('ExperienceDetail', {
                      experienceId: item.experienceId,
                    });
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Experience Picker Modal for Log Ride / Log Snack */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerVisible(false)}
        testID="home-experience-picker-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} testID="home-picker-title">
                {pickerTab === 'rides' ? 'Select Attraction to Log' : 'Select Restaurant to Log Food'}
              </Text>
              <Pressable
                onPress={() => setPickerVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close picker"
                testID="home-picker-close-btn"
              >
                <Ionicons name="close" size={24} color={theme.color.textSecondary} />
              </Pressable>
            </View>
            <ExperiencePicker
              enabled={pickerVisible}
              defaultTab={pickerTab === 'rides' ? 'attractions' : 'dining'}
              showTabs={true}
              showParkFilter={true}
              fillContainer={true}
              testIDPrefix="home-picker"
              onSelect={handleSelectExperience}
            />
          </View>
        </View>
      </Modal>

      {/* Log Visit Modal for selected ride */}
      {selectedRideExperience && (
        <LogVisitModal
          experienceId={selectedRideExperience.id}
          visible={selectedRideExperience !== null}
          onClose={() => setSelectedRideExperience(null)}
          onLogged={() => {
            setSelectedRideExperience(null);
            void queryClient.invalidateQueries({ queryKey: ['home'] });
          }}
        />
      )}

      {/* Food Item Picker Modal for selected dining experience */}
      {selectedDiningExperience && (
        <FoodItemPickerModal
          experienceId={selectedDiningExperience.id}
          visible={foodPickerVisible}
          onClose={() => {
            setFoodPickerVisible(false);
            setSelectedDiningExperience(null);
          }}
          onSelectFoodItem={(item) => {
            setSelectedFoodItem(item);
            setFoodPickerVisible(false);
            setLogFoodModalVisible(true);
          }}
        />
      )}

      {/* Log Food Item Modal */}
      {selectedFoodItem && (
        <LogFoodItemModal
          foodItem={selectedFoodItem}
          visible={logFoodModalVisible}
          onClose={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItem(null);
            setSelectedDiningExperience(null);
          }}
          onLogged={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItem(null);
            setSelectedDiningExperience(null);
            void queryClient.invalidateQueries({ queryKey: ['home'] });
          }}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard Row Subcomponent
// ---------------------------------------------------------------------------

interface LeaderboardRowProps {
  readonly rank: number;
  readonly entry: LeaderboardEntryDTO;
  readonly land?: string | null | undefined;
  readonly onPress: () => void;
}

function LeaderboardRow({ rank, entry, land, onPress }: LeaderboardRowProps): JSX.Element {
  const meanLabel = entry.value.toFixed(1);
  const countLabel = `${entry.count} ${entry.count === 1 ? 'rating' : 'ratings'}`;
  const visual = theme.categoryVisual[entry.category];
  return (
    <Card
      onPress={onPress}
      accentColor={theme.parkAccent[entry.park]}
      style={styles.row}
      testID={`home-leaderboard-row-${entry.experienceId}`}
    >
      <View
        style={styles.rowInner}
        accessibilityLabel={`${entry.name}, ${entry.park}${land ? `, ${land}` : ''}, ${formatCategory(
          entry.category,
        )}, rated ${meanLabel} from ${countLabel}`}
      >
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.rowPark} numberOfLines={1}>
            {entry.park}{land ? ` • ${land}` : ''}
          </Text>
          <View style={styles.rowTags}>
            <Badge
              label={visual.label}
              color={visual.tint}
              icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            />
          </View>
        </View>
        <View style={styles.rowStats}>
          <View style={styles.ratingPill}>
            <Ionicons name="star" size={14} color={theme.color.starRating ?? '#f59e0b'} />
            <Text style={styles.ratingValue}>{meanLabel}</Text>
          </View>
          <Text style={styles.ratingCount}>{countLabel}</Text>
        </View>
      </View>
    </Card>
  );
}

function formatCategory(value: ExperienceCategory): string {
  return value === 'Character_Meet' ? 'Character Meet' : value;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    padding: 0,
    backgroundColor: theme.color.background,
  },
  heroHeader: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    position: 'relative',
    overflow: 'hidden',
  },
  sparkleTopRight: {
    position: 'absolute',
    top: 24,
    right: 20,
  },
  sparkleMidLeft: {
    position: 'absolute',
    top: 54,
    left: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  greetingPillWrap: {
    flex: 1,
    marginRight: 8,
  },
  greetingPill: {
    fontSize: 11,
    fontWeight: '800',
    color: '#f6c343',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 26,
  },
  heroSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.82)',
    marginTop: 3,
    fontWeight: '500',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  actionDockTopSpacing: {
    marginTop: 12,
  },
  sectionContainer: {
    paddingHorizontal: theme.spacing.md,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionIcon: {
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.primary,
  },
  leaderboardList: {
    gap: theme.spacing.sm,
  },
  center: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  rowText: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  rowPark: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  rowTags: {
    flexDirection: 'row',
    marginTop: 4,
  },
  rowStats: {
    alignItems: 'flex-end',
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingValue: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  ratingCount: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.color.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    height: '90%',
    width: '100%',
    ...theme.shadow.floating,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    marginBottom: theme.spacing.xs,
  },
  modalTitle: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
  },
});
