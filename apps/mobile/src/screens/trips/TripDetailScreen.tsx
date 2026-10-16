// Feature: trips, Task 17.2 — Trip_Detail_View hub
//
// Validates: Requirements 18.1, 18.6
//
// Behavior summary:
//   - Reads `GET /trips/:id` via TanStack Query for the Trip header info
//     (name, description, date range, derived Trip_Status). Membership is
//     enforced server-side by the Trip_Member_Rule; a non-member / missing
//     Trip collapses to the same `trip_forbidden` response, which this screen
//     surfaces as an error with a Retry control (R15.2 non-disclosure).
//   - Presents the redesigned hub:
//       • Elevated Hero card with Resort chip and interactive Crew Preview row
//         navigating to TripMembersScreen (preserving `trip-detail-section-members`).
//       • Auto-computed "Up Next" live glance card derived from today's reservations
//         and scheduled items via `GET /trips/:id/planned-items`.
//       • 2x2 Command Grid (Vacation Tools) for Planned List, Schedule Builder,
//         Reservations, and Trip Activity.
//       • Celebratory Wrap-Up Hero (past trips) / Progress Card (active trips)
//         navigating to TripSummaryScreen (`trip-detail-section-summary`).
//       • Attached Food Lists and Attached Experience Lists sections, each with
//         detach protection.
//
// The concrete section screens arrive in later 17.x tasks; this hub wires
// the navigation controls to their routes (already declared on
// `TripsStackParamList`). Styling follows the shared "Magical / Whimsical"
// theme, mirroring `TripsListScreen`.

import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';

import {
  completedExperienceIdsFromFeed,
  type Park,
  type PlannedItemDTO,
  type TripDTO,
  type TripFeedItemDTO,
  type TripMemberDTO,
  type TripStatus,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme, withAlpha, type AppTheme, type ColorScheme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import {
  CREW_AVATAR,
  GLANCE,
  HUB_SECTION_COLOR,
  HUB_TILE,
  PAST_HERO,
  PROGRESS_CARD,
} from './TripDetailScreen.palette';
import {
  Badge,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { formatParkTime } from '../catalog/live/parkTime';
import AttachedFoodListsSection from './AttachedFoodListsSection';
import AttachedExperienceListsSection from './AttachedExperienceListsSection';
import GroupFavoritesSection from './GroupFavoritesSection';
import { tripDetailKeys } from './tripDetailQueryKeys';
import { tripPlannedListKeys } from './TripPlannedListScreen';
import { tripFeedKeys } from './TripFeedScreen';

/** Wire shape of `GET /me`: the caller's identity (to gate the Edit control). */
interface MeResponse {
  readonly user: { readonly id: string };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripDetail'>;

/** Wire shape of `GET /trips/:id`: the Trip header info for a Trip_Member. */
type TripDetailResponse = TripDTO;

/**
 * A single hub section control. `route` is the `TripsStackParamList` route the
 * control opens; every section route takes exactly `{ tripId }`, so a shared
 * navigate call reaches any of them (R18.6).
 */
export interface HubSection {
  readonly key: string;
  readonly route:
    | 'TripPlannedList'
    | 'TripSchedule'
    | 'TripReservations'
    | 'TripExpenses'
    | 'TripFeed'
    | 'TripMembers'
    | 'TripSummary';
  readonly title: string;
  readonly body: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly color: string;
}

// ---------------------------------------------------------------------------
// Constants (Byte-for-byte invariant: checked by tripStructureRegression test)
// ---------------------------------------------------------------------------

/**
 * Query key for a single Trip's header info; keyed by Trip_Identifier.
 * Re-exported from `tripDetailQueryKeys.ts` so existing `from './TripDetailScreen'`
 * imports elsewhere in the app keep working unchanged.
 */
export { tripDetailKeys } from './tripDetailQueryKeys';

/** A hub section without its scheme-dependent colour. */
type HubSectionDef = Omit<HubSection, 'key' | 'color'> & {
  readonly key: keyof typeof HUB_SECTION_COLOR.light;
};

/** The colour-free hub section definitions, in canonical presentation order. */
const HUB_SECTION_DEFS: readonly HubSectionDef[] = [
  {
    key: 'planned',
    route: 'TripPlannedList',
    title: 'Planned List',
    body: 'Experiences the group wants to do together.',
    icon: 'list-outline',
  },
  {
    key: 'schedule',
    route: 'TripSchedule',
    title: 'Schedule Builder',
    body: 'Plan and optimize your day-by-day timeline.',
    icon: 'calendar-outline',
  },
  {
    key: 'reservations',
    route: 'TripReservations',
    title: 'Reservations',
    body: 'Dining, Lightning Lane, and other bookings you hold.',
    icon: 'ticket-outline',
  },
  {
    key: 'expenses',
    route: 'TripExpenses',
    title: 'Expenses',
    body: 'Shared ledger, balances, and settlements.',
    icon: 'cash-outline',
  },
  {
    key: 'activity',
    route: 'TripFeed',
    title: 'Trip Activity',
    body: 'Log completions and follow, react to, and comment on the group.',
    icon: 'chatbubbles-outline',
  },
  {
    key: 'members',
    route: 'TripMembers',
    title: 'Members',
    body: 'Who is on this Trip and their roles.',
    icon: 'people-outline',
  },
  {
    key: 'summary',
    route: 'TripSummary',
    title: 'Summary',
    body: 'Group counts, top-rated moments, and contributions.',
    icon: 'stats-chart-outline',
  },
];

/**
 * The hub sections for `scheme`, each carrying that scheme's section colour.
 * Any consumer that paints with `color` must call this with `t.scheme`.
 */
export function hubSectionsFor(scheme: ColorScheme): readonly HubSection[] {
  return HUB_SECTION_DEFS.map((d) => ({ ...d, color: HUB_SECTION_COLOR[scheme][d.key] }));
}

/**
 * The hub sections with their light colours — the reference set the
 * tripStructureRegression snapshot pins byte-for-byte. Painting consumers use
 * `hubSectionsFor(t.scheme)` instead.
 */
export const HUB_SECTIONS: readonly HubSection[] = hubSectionsFor('light');

/** Human labels + badge colors for each derived Trip_Status, from the active theme. */
function statusMetaFor(t: AppTheme): Record<
  TripStatus,
  { readonly label: string; readonly color: string }
> {
  return {
    active: { label: 'Active', color: t.color.success },
    upcoming: { label: 'Upcoming', color: t.color.primaryFg },
    past: { label: 'Past', color: t.color.textSecondary },
  };
}

/** Glance-card park pill tint + text per park, from the active theme. */
function parkColorsFor(t: AppTheme): Record<string, { bg: string; text: string }> {
  return {
    'magic-kingdom': {
      bg: withAlpha(t.parkAccent['Magic Kingdom'], 0.15),
      text: t.parkAccent['Magic Kingdom'],
    },
    'epcot': { bg: withAlpha(t.parkAccent.EPCOT, 0.15), text: t.parkAccent.EPCOT },
    'hollywood-studios': {
      bg: withAlpha(t.parkAccent['Hollywood Studios'], 0.15),
      text: t.parkAccent['Hollywood Studios'],
    },
    'animal-kingdom': {
      bg: withAlpha(t.parkAccent['Animal Kingdom'], 0.15),
      text: t.color.success,
    },
  };
}

const PARK_LABELS: Record<string, string> = {
  'magic-kingdom': 'Magic Kingdom',
  'epcot': 'EPCOT',
  'hollywood-studios': 'Hollywood Studios',
  'animal-kingdom': 'Animal Kingdom',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDisplayTime(timeStr?: string | null): string {
  if (!timeStr) return '';
  if (timeStr.includes('T')) {
    return formatParkTime(timeStr);
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (match && match[1] && match[2]) {
    const hours = parseInt(match[1], 10);
    const mins = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${h12}:${mins} ${ampm}`;
  }
  return timeStr;
}

function getVacationDayText(startDate: string, endDate: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (today < startDate) {
    return null;
  }
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  const nowMs = new Date(`${today}T00:00:00Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || Number.isNaN(nowMs)) {
    return null;
  }
  const totalDays = Math.max(
    1,
    Math.round((endMs - startMs) / (24 * 3600 * 1000)) + 1,
  );
  const currentDay = Math.min(
    totalDays,
    Math.max(1, Math.round((nowMs - startMs) / (24 * 3600 * 1000)) + 1),
  );
  return `Day ${currentDay} of ${totalDays}`;
}

export function deriveGlanceCard(
  items: readonly PlannedItemDTO[],
  todayDate: string,
  resortName?: string,
): {
  type: 'reservation' | 'schedule' | 'quiet';
  title: string;
  park?: Park | string | null | undefined;
  time?: string | null | undefined;
  meta?: string | undefined;
} {
  // 1. Confirmed reservation today
  const reservationsToday = items.filter(
    (i) => i.reservationKind != null && i.plannedDate === todayDate,
  );
  if (reservationsToday.length > 0) {
    const sorted = [...reservationsToday].sort((a, b) =>
      (a.plannedTime ?? '99:99').localeCompare(b.plannedTime ?? '99:99'),
    );
    const target = sorted[0];
    if (target) {
      return {
        type: 'reservation',
        title: target.experienceName ?? target.customTitle ?? 'Reservation',
        park: target.park,
        time: target.plannedTime ? formatDisplayTime(target.plannedTime) : null,
        meta: target.partySize ? `Party of ${target.partySize}` : undefined,
      };
    }
  }

  // 2. Scheduled target today
  const scheduleToday = items.filter(
    (i) =>
      i.reservationKind == null &&
      i.plannedDate === todayDate &&
      i.plannedTime != null,
  );
  if (scheduleToday.length > 0) {
    const sorted = [...scheduleToday].sort((a, b) =>
      (a.plannedTime ?? '99:99').localeCompare(b.plannedTime ?? '99:99'),
    );
    const target = sorted[0];
    if (target) {
      return {
        type: 'schedule',
        title: target.experienceName ?? target.customTitle ?? 'Scheduled Experience',
        park: target.park,
        time: target.plannedTime ? formatDisplayTime(target.plannedTime) : null,
        meta: target.isLightningLane ? '⚡ Lightning Lane' : '🎢 Standby',
      };
    }
  }

  // 3. Fallback: Quiet / Pool / Rest day
  return {
    type: 'quiet',
    title: 'No Scheduled Plans Today',
    meta: resortName
      ? `Relax at ${resortName} or explore Disney Springs!`
      : 'Relax at your resort or explore Disney Springs!',
  };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripDetailScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const crewAvatar = usePalette(CREW_AVATAR);
  const glancePal = usePalette(GLANCE);
  const tile = usePalette(HUB_TILE);
  const progressCard = usePalette(PROGRESS_CARD);
  const { tripId } = route.params;

  const tripQuery = useQuery<TripDetailResponse, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDetailResponse>('GET', `/trips/${tripId}`),
    staleTime: 30 * 1000,
  });

  // Editing a Trip is Organizer-gated server-side (R3.8). To show the Edit
  // control only to Organizers, resolve the caller's role from `GET /me` +
  // the roster; a failed/unexpected read simply hides the control (the server
  // remains the authority). Reads are non-blocking and never gate the hub.
  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () =>
      apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    staleTime: 30 * 1000,
    retry: false,
  });

  // Query planned items for the auto-computed glance card and tool grid badges
  const itemsQuery = useQuery<readonly PlannedItemDTO[], ApiError>({
    queryKey: tripPlannedListKeys.items(tripId),
    queryFn: () =>
      apiRequest<readonly PlannedItemDTO[]>('GET', `/trips/${tripId}/planned-items`),
    staleTime: 30 * 1000,
    retry: false,
  });

  // Query activity feed for celebration milestones and activity tile badge
  const feedQuery = useQuery<readonly TripFeedItemDTO[], ApiError>({
    queryKey: tripFeedKeys.feed(tripId),
    queryFn: () =>
      apiRequest<readonly TripFeedItemDTO[]>('GET', `/trips/${tripId}/feed`),
    staleTime: 30 * 1000,
    retry: false,
  });

  const callerId = meQuery.data?.user?.id;
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const isOrganizer =
    callerId !== undefined &&
    members.some(
      (member) => member.userId === callerId && member.role === 'organizer',
    );

  const plannedItems = Array.isArray(itemsQuery.data) ? itemsQuery.data : [];
  const feedItems = Array.isArray(feedQuery.data) ? feedQuery.data : [];

  const reservations = useMemo(
    () => plannedItems.filter((i) => i.reservationKind != null),
    [plannedItems],
  );

  const completedIds = useMemo(
    () => completedExperienceIdsFromFeed(feedItems),
    [feedItems],
  );

  const completedCount = useMemo(() => {
    let count = 0;
    for (const item of plannedItems) {
      if (completedIds && item.experienceId && completedIds.has(item.experienceId)) {
        count++;
      }
    }
    return count;
  }, [plannedItems, completedIds]);

  const handleBack = useCallback(() => {
    const state = navigation.getState();
    const tripsListIndex = state?.routes?.findIndex(
      (r) => r.name === 'TripsList',
    );
    if (
      tripsListIndex !== undefined &&
      tripsListIndex >= 0 &&
      state.index > tripsListIndex
    ) {
      navigation.goBack();
    } else {
      navigation.navigate('TripsList');
    }
  }, [navigation]);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (tripQuery.isLoading && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trip"
          icon="map"
          compact
          onBack={handleBack}
        />
        <View style={styles.center} testID="trip-detail-loading">
          <ActivityIndicator color={t.color.primaryFg} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Error + Retry (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (tripQuery.isError && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trip"
          icon="map"
          compact
          onBack={handleBack}
        />
        <View style={styles.center} testID="trip-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this trip"
            body={detailErrorMessage(tripQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tripQuery.refetch();
            }}
            testID="trip-detail-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const trip = tripQuery.data as TripDetailResponse;
  const statusMeta = statusMetaFor(t)[trip.status];
  const parkColors = parkColorsFor(t);
  const avatarColors = [
    t.color.primary,
    crewAvatar.sky,
    crewAvatar.success,
    crewAvatar.amber,
    crewAvatar.danger,
  ];
  const isCompleted = trip.status === 'past';

  const todayDate = new Date().toISOString().slice(0, 10);
  const glance = deriveGlanceCard(plannedItems, todayDate, trip.resorts?.[0]?.name);
  const dayText = trip ? getVacationDayText(trip.startDate, trip.endDate) : null;

  return (
    <ScreenContainer>
      <GradientHeader
        title={trip.name}
        subtitle={formatDateRange(trip)}
        icon="map"
        compact
        onBack={handleBack}
        right={
          <View style={styles.headerRight}>
            <Badge label={statusMeta.label} color={statusMeta.color} />
            {isOrganizer ? (
              <Pressable
                onPress={() => {
                  navigation.navigate('TripEdit', { tripId });
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit trip"
                hitSlop={8}
                style={styles.editButton}
                testID="trip-detail-edit"
              >
                <Ionicons name="create-outline" size={22} color={t.color.textOnPrimary} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.content} testID="trip-detail-hub" keyboardShouldPersistTaps="handled">
        {trip.description.trim().length > 0 ? (
          <Text style={styles.description}>{trip.description}</Text>
        ) : null}

        {/* Hero Card: Resort info & Crew Preview row */}
        <View style={styles.heroCard} testID="trip-detail-hero">
          {trip.resorts.length > 0 ? (
            <View style={styles.resorts} testID="trip-detail-resorts">
              <View style={styles.resortChips}>
                {trip.resorts.map((resort) => (
                  <View
                    key={resort.id}
                    style={styles.resortChip}
                    testID={`trip-detail-resort-${resort.id}`}
                  >
                    <Ionicons
                      name="bed-outline"
                      size={14}
                      color={t.color.primaryFg}
                    />
                    <Text style={styles.resortChipText}>{resort.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Elevated Crew Row (R18.1 Members section control) */}
          <Pressable
            style={styles.crewRow}
            onPress={() => {
              navigation.navigate('TripMembers', { tripId });
            }}
            accessibilityRole="button"
            accessibilityLabel="Manage crew members"
            testID="trip-detail-section-members"
          >
            <View style={styles.crewLeft}>
              <Text style={styles.crewLabel}>
                {isCompleted ? 'TRAVEL PARTY' : 'CREW'}{members.length > 0 ? ` (${members.length})` : ''}
              </Text>
              <View style={styles.managePill}>
                <Text style={styles.managePillText}>Manage ›</Text>
              </View>
            </View>
            <View style={styles.crewRight}>
              <View style={styles.avatarStack}>
                {members.slice(0, 4).map((member, index) => (
                  <View
                    key={member.userId}
                    style={[
                      styles.crewAvatar,
                      {
                        backgroundColor:
                          avatarColors[index % avatarColors.length],
                        marginLeft: index === 0 ? 0 : -8,
                        zIndex: 10 - index,
                      },
                    ]}
                  >
                    <Text style={styles.crewAvatarText}>
                      {member.displayName?.charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                ))}
                {members.length > 4 ? (
                  <View
                    style={[
                      styles.crewAvatar,
                      styles.crewAvatarMore,
                      { marginLeft: -8, zIndex: 5 },
                    ]}
                  >
                    <Text style={styles.crewAvatarMoreText}>
                      +{members.length - 4}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        </View>

        {/* Live Glance Card (Active/Upcoming) vs Wrap-Up Hero (Past Trips) */}
        {!isCompleted ? (
          <View style={styles.glanceContainer} testID="trip-detail-glance-card">
            <View style={styles.glanceHeader}>
              <Text style={styles.glanceSectionLabel}>⚡ LIVE GLANCE</Text>
            </View>

            {glance.type === 'reservation' ? (
              <Pressable
                style={[styles.glanceCard, styles.glanceCardReservation]}
                onPress={() => {
                  navigation.navigate('TripReservations', { tripId });
                }}
                accessibilityRole="button"
                accessibilityLabel="Upcoming reservation"
                testID="trip-detail-glance-reservation"
              >
                <View style={styles.glanceTagRow}>
                  <Ionicons name="restaurant-outline" size={12} color={glancePal.reservationTag} />
                  <Text style={styles.glanceTagReservation}>
                    UP NEXT TODAY · RESERVATION
                  </Text>
                </View>
                <Text style={styles.glanceTitle} numberOfLines={1}>
                  {glance.title}
                </Text>
                <View style={styles.glanceMetaRow}>
                  {glance.park ? (
                    <View
                      style={[
                        styles.parkPill,
                        {
                          backgroundColor:
                            parkColors[glance.park]?.bg ?? glancePal.parkPillFallbackBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.parkPillText,
                          {
                            color:
                              parkColors[glance.park]?.text ??
                              t.color.primaryFg,
                          },
                        ]}
                      >
                        {PARK_LABELS[glance.park] ?? glance.park}
                      </Text>
                    </View>
                  ) : null}
                  {glance.time ? (
                    <Text style={styles.glanceMetaText}>⏰ {glance.time}</Text>
                  ) : null}
                  {glance.meta ? (
                    <Text style={styles.glanceMetaText}>👥 {glance.meta}</Text>
                  ) : null}
                </View>
              </Pressable>
            ) : glance.type === 'schedule' ? (
              <Pressable
                style={[styles.glanceCard, styles.glanceCardSchedule]}
                onPress={() => {
                  navigation.navigate('TripSchedule', { tripId });
                }}
                accessibilityRole="button"
                accessibilityLabel="Upcoming schedule target"
                testID="trip-detail-glance-schedule"
              >
                <View style={styles.glanceTagRow}>
                  <Ionicons name="flag-outline" size={12} color={glancePal.scheduleTag} />
                  <Text style={styles.glanceTagSchedule}>
                    UP NEXT TODAY · SCHEDULE TARGET
                  </Text>
                </View>
                <Text style={styles.glanceTitle} numberOfLines={1}>
                  {glance.title}
                </Text>
                <View style={styles.glanceMetaRow}>
                  {glance.park ? (
                    <View
                      style={[
                        styles.parkPill,
                        {
                          backgroundColor:
                            parkColors[glance.park]?.bg ?? glancePal.parkPillFallbackBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.parkPillText,
                          {
                            color:
                              parkColors[glance.park]?.text ??
                              t.color.primaryFg,
                          },
                        ]}
                      >
                        {PARK_LABELS[glance.park] ?? glance.park}
                      </Text>
                    </View>
                  ) : null}
                  {glance.time ? (
                    <Text style={styles.glanceMetaText}>
                      🎯 {glance.time} Target
                    </Text>
                  ) : null}
                  {glance.meta ? (
                    <Text style={styles.glanceMetaText}>{glance.meta}</Text>
                  ) : null}
                </View>
              </Pressable>
            ) : (
              <View
                style={[styles.glanceCard, styles.glanceCardQuiet]}
                testID="trip-detail-glance-rest"
              >
                <View style={styles.glanceTagRow}>
                  <Ionicons name="sunny-outline" size={12} color={glancePal.quietTag} />
                  <Text style={styles.glanceTagQuiet}>
                    TODAY · RESORT & FREE TIME
                  </Text>
                </View>
                <Text style={styles.glanceTitleQuiet}>{glance.title}</Text>
                <Text style={styles.glanceBodyQuiet}>{glance.meta}</Text>
                <View style={styles.glanceActionsRow}>
                  <Pressable
                    style={styles.glanceBtnPrimary}
                    onPress={() =>
                      navigation.navigate('TripPlannedList', { tripId })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Add from Wishlist"
                  >
                    <Text style={styles.glanceBtnPrimaryText}>
                      + Add from Wishlist
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.glanceBtnSecondary}
                    onPress={() =>
                      navigation.navigate('TripSchedule', { tripId })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Open Schedule"
                  >
                    <Text style={styles.glanceBtnSecondaryText}>
                      Open Schedule
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ) : (
          /* Past Trip: Celebratory Wrap-Up Hero (Summary section control) */
          <Pressable
            style={styles.pastHeroCard}
            onPress={() => navigation.navigate('TripSummary', { tripId })}
            accessibilityRole="button"
            accessibilityLabel="Trip summary recap"
            testID="trip-detail-section-summary"
          >
            <View style={styles.pastHeroBadgeRow}>
              <View style={styles.pastHeroBadge}>
                <Text style={styles.pastHeroBadgeText}>🏆 TRIP COMPLETE</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.color.textOnPrimary} />
            </View>
            <Text style={styles.pastHeroTitle}>Magical Vacation Recap</Text>
            <Text style={styles.pastHeroSubtitle}>
              Relive top moments, superlative awards, and park progress ›
            </Text>
          </Pressable>
        )}

        {/* 2x2 Command Grid: Vacation Tools */}
        <View style={styles.toolsSection}>
          <Text style={styles.toolsSectionLabel}>
            {isCompleted ? 'TRIP ARCHIVE' : 'VACATION TOOLS'}
          </Text>
          <View style={styles.grid} testID="trip-detail-grid">
            <View style={styles.gridRow}>
              {/* Tile 1: Planned List */}
              <Pressable
                style={styles.hubTile}
                onPress={() =>
                  navigation.navigate('TripPlannedList', { tripId })
                }
                accessibilityRole="button"
                accessibilityLabel="Planned List"
                testID="trip-detail-section-planned"
              >
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>
                    {plannedItems.length} Items
                  </Text>
                </View>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: `${t.color.primary}18` },
                  ]}
                >
                  <Ionicons
                    name="list-outline"
                    size={20}
                    color={t.color.primaryFg}
                  />
                </View>
                <Text style={styles.tileTitle}>Planned List</Text>
                <Text style={styles.tileDesc} numberOfLines={2}>
                  Group wishlist & park targets.
                </Text>
              </Pressable>

              {/* Tile 2: Schedule Builder */}
              <Pressable
                style={styles.hubTile}
                onPress={() => navigation.navigate('TripSchedule', { tripId })}
                accessibilityRole="button"
                accessibilityLabel="Schedule Builder"
                testID="trip-detail-section-schedule"
              >
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>Timeline</Text>
                </View>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: `${t.color.primaryLight}18` },
                  ]}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={t.color.primaryLight}
                  />
                </View>
                <Text style={styles.tileTitle}>Schedule Builder</Text>
                <Text style={styles.tileDesc} numberOfLines={2}>
                  Day-by-day optimizer & timeline.
                </Text>
              </Pressable>
            </View>

            <View style={styles.gridRow}>
              {/* Tile 3: Reservations */}
              <Pressable
                style={styles.hubTile}
                onPress={() =>
                  navigation.navigate('TripReservations', { tripId })
                }
                accessibilityRole="button"
                accessibilityLabel="Reservations"
                testID="trip-detail-section-reservations"
              >
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>
                    {reservations.length} Booked
                  </Text>
                </View>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: withAlpha(t.color.accent, 0.2) },
                  ]}
                >
                  <Ionicons
                    name="ticket-outline"
                    size={20}
                    color={tile.reservationsIcon}
                  />
                </View>
                <Text style={styles.tileTitle}>Reservations</Text>
                <Text style={styles.tileDesc} numberOfLines={2}>
                  Dining, Lightning Lane & bookings.
                </Text>
              </Pressable>

              {/* Tile 4: Trip Activity */}
              <Pressable
                style={styles.hubTile}
                onPress={() => navigation.navigate('TripFeed', { tripId })}
                accessibilityRole="button"
                accessibilityLabel="Trip Activity"
                testID="trip-detail-section-activity"
              >
                <View style={styles.tileBadge}>
                  <Text style={[styles.tileBadgeText, { color: tile.activityText }]}>
                    {feedItems.length} Logs
                  </Text>
                </View>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: tile.activityBg },
                  ]}
                >
                  <Ionicons
                    name="chatbubbles-outline"
                    size={20}
                    color={tile.activityIcon}
                  />
                </View>
                <Text style={styles.tileTitle}>Trip Activity</Text>
                <Text style={styles.tileDesc} numberOfLines={2}>
                  Group completions & reactions.
                </Text>
              </Pressable>
            </View>

            <View style={styles.gridRow}>
              {/* Tile 5: Expenses */}
              <Pressable
                style={styles.hubTile}
                onPress={() =>
                  navigation.navigate('TripExpenses', { tripId })
                }
                accessibilityRole="button"
                accessibilityLabel="Expenses"
                testID="trip-detail-section-expenses"
              >
                <View style={styles.tileBadge}>
                  <Text style={[styles.tileBadgeText, { color: t.color.primaryFg }]}>
                    Ledger
                  </Text>
                </View>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: `${t.color.primary}18` },
                  ]}
                >
                  <Ionicons
                    name="cash-outline"
                    size={20}
                    color={t.color.primaryFg}
                  />
                </View>
                <Text style={styles.tileTitle}>Expenses</Text>
                <Text style={styles.tileDesc} numberOfLines={2}>
                  Shared ledger & balances.
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Attached Food Lists section (R22, Task 24.6) */}
        <AttachedFoodListsSection
          tripId={tripId}
          foodLists={trip.foodLists}
          isOrganizer={isOrganizer}
          callerId={callerId}
          callerDisplayName={
            members.find((m) => m.userId === callerId)?.displayName
          }
          navigation={navigation}
          onOpenFoodList={(foodListId) => {
            (navigation as any).navigate('FoodListDetail', { foodListId });
          }}
        />

        {/* Attached Experience Lists section (R14, Task 19.1) */}
        <AttachedExperienceListsSection
          tripId={tripId}
          experienceLists={trip.experienceLists}
          isOrganizer={isOrganizer}
          callerId={callerId}
          callerDisplayName={
            members.find((m) => m.userId === callerId)?.displayName
          }
          navigation={navigation}
          onOpenExperienceList={(experienceListId) => {
            (navigation as any).navigate('ExperienceListDetail', { experienceListId });
          }}
        />

        {/* Group Favorites section (R9, Task 11.2) */}
        <GroupFavoritesSection
          tripId={tripId}
          onSelectExperience={(experienceId) => {
            (navigation as any).navigate('ExperienceDetail', { experienceId });
          }}
        />

        {/* Vacation Progress Card (Active/Upcoming Summary section control) */}
        {!isCompleted ? (
          <Pressable
            style={styles.summaryCardPressable}
            onPress={() => navigation.navigate('TripSummary', { tripId })}
            accessibilityRole="button"
            accessibilityLabel="Trip Summary"
            testID="trip-detail-section-summary"
          >
            <LinearGradient
              colors={[progressCard.gradStart, progressCard.gradEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.summaryCard}
            >
              <View style={styles.summaryTopRow}>
                <View style={styles.summaryIconWrap}>
                  <Text style={styles.summaryEmoji}>
                    {completedCount > 0 ? '🏆' : '✨'}
                  </Text>
                </View>
                <View style={styles.summaryTextWrap}>
                  <View style={styles.summaryEyebrowRow}>
                    <Text style={styles.summaryEyebrowText}>
                      {completedCount > 0
                        ? 'VACATION MILESTONE'
                        : 'VACATION UNDERWAY'}
                      {dayText ? ` · ${dayText.toUpperCase()}` : ''}
                    </Text>
                    <Text style={styles.summaryRecapLink}>Recap ›</Text>
                  </View>
                  <Text style={styles.summaryTitle}>
                    {completedCount > 0
                      ? `${completedCount} of ${plannedItems.length} completed!`
                      : `${feedItems.length} magical moment${feedItems.length === 1 ? '' : 's'} logged!`}
                  </Text>
                  <Text style={styles.summarySub}>
                    Tap to see live group superlatives & top ratings ›
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={t.color.accent}
                />
              </View>
              {plannedItems.length > 0 && completedCount > 0 ? (
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.round(
                            (completedCount / plannedItems.length) * 100,
                          ),
                        )}%`,
                      },
                    ]}
                  />
                </View>
              ) : null}
            </LinearGradient>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a Trip's date range; collapses a single-day Trip to one date. */
function formatDateRange(trip: TripDTO): string {
  return trip.startDate === trip.endDate
    ? trip.startDate
    : `${trip.startDate} \u2013 ${trip.endDate}`;
}

/** Map an API error to user-facing copy for the Trip detail hub (R15.2). */
export function detailErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    case 'rate_limit_exceeded':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((t) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  editButton: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  description: {
    ...theme.typography.body,
    color: t.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },

  // Hero Card
  heroCard: {
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.sm,
    shadowColor: t.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  resorts: {
    gap: theme.spacing.xs,
  },
  resortChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  resortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: `${t.color.primary}12`,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  resortChipText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },

  // Crew Row
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  crewLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  crewLabel: {
    ...theme.typography.meta,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  managePill: {
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  managePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  crewRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crewAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.color.surface,
  },
  crewAvatarText: {
    color: t.color.textOnPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  crewAvatarMore: {
    backgroundColor: t.color.surfaceAlt,
  },
  crewAvatarMoreText: {
    color: t.color.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },

  // Glance Card
  glanceContainer: {
    gap: 4,
  },
  glanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  glanceSectionLabel: {
    ...theme.typography.meta,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  glanceCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1.5,
    borderColor: GLANCE[t.scheme].cardBorder,
    backgroundColor: t.color.surface,
    gap: 4,
    shadowColor: t.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  glanceCardReservation: {
    borderColor: GLANCE[t.scheme].reservationBorder,
  },
  glanceCardSchedule: {
    borderColor: GLANCE[t.scheme].scheduleBorder,
  },
  glanceCardQuiet: {
    borderStyle: 'dashed',
    borderColor: GLANCE[t.scheme].quietBorder,
    backgroundColor: t.color.surfaceAlt,
  },
  glanceTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  glanceTagReservation: {
    fontSize: 10,
    fontWeight: '800',
    color: GLANCE[t.scheme].reservationTag,
    letterSpacing: 0.5,
  },
  glanceTagSchedule: {
    fontSize: 10,
    fontWeight: '800',
    color: GLANCE[t.scheme].scheduleTag,
    letterSpacing: 0.5,
  },
  glanceTagQuiet: {
    fontSize: 10,
    fontWeight: '800',
    color: GLANCE[t.scheme].quietTag,
    letterSpacing: 0.5,
  },
  glanceTitle: {
    ...theme.typography.subtitle,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  glanceTitleQuiet: {
    ...theme.typography.subtitle,
    fontWeight: '800',
    color: t.color.textPrimary,
    fontSize: 14,
  },
  glanceBodyQuiet: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    marginBottom: 4,
  },
  glanceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: 2,
  },
  glanceMetaText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  parkPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  parkPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  glanceActionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: 4,
  },
  glanceBtnPrimary: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: theme.radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  glanceBtnPrimaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  glanceBtnSecondary: {
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: theme.radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  glanceBtnSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textSecondary,
  },

  // Past Trip Hero
  pastHeroCard: {
    backgroundColor: t.color.primaryDark,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(t.color.accent, 0.35),
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 3,
  },
  pastHeroBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  pastHeroBadge: {
    backgroundColor: withAlpha(t.color.accent, 0.2),
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pastHeroBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: t.color.accent,
    letterSpacing: 0.5,
  },
  pastHeroTitle: {
    ...theme.typography.title,
    color: t.color.textOnPrimary,
    fontSize: 17,
  },
  pastHeroSubtitle: {
    ...theme.typography.meta,
    color: PAST_HERO[t.scheme].subtitle,
  },

  // 2x2 Command Grid (Vacation Tools)
  toolsSection: {
    gap: theme.spacing.xs,
  },
  toolsSectionLabel: {
    ...theme.typography.meta,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  grid: {
    gap: theme.spacing.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  hubTile: {
    flex: 1,
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: 4,
    position: 'relative',
    shadowColor: t.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  tileBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  tileBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  tileIconWrap: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  tileTitle: {
    ...theme.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  tileDesc: {
    ...theme.typography.meta,
    fontSize: 10.5,
    lineHeight: 14,
    color: t.color.textSecondary,
  },

  // Vacation Progress Card
  summaryCardPressable: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: theme.spacing.sm,
  },
  summaryCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: withAlpha(t.color.accent, 0.25),
    gap: 10,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withAlpha(t.color.accent, 0.15),
    borderWidth: 1.5,
    borderColor: withAlpha(t.color.accent, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryEmoji: {
    fontSize: 20,
  },
  summaryTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  summaryEyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryEyebrowText: {
    fontSize: 10,
    fontWeight: '800',
    color: t.color.accent,
    letterSpacing: 0.5,
  },
  summaryRecapLink: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.accent,
  },
  summaryTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: t.color.textOnPrimary,
    marginTop: 2,
  },
  summarySub: {
    fontSize: 10.5,
    color: PROGRESS_CARD[t.scheme].sub,
    opacity: 0.85,
    marginTop: 2,
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: t.color.accent,
    borderRadius: 3,
  },
}));
