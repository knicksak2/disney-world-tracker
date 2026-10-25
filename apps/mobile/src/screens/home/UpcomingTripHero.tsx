/**
 * UpcomingTripHero — Pre-trip countdown hero card for the Home command center.
 *
 * Implements Task 20.2 (Requirements 2.7, 2.8; design.md Property 11).
 * Reads /me/trips (sharing tripsListKeys.list() cache with TripsListScreen).
 * Derives the earliest upcoming trip and displays:
 *   1. Prominent remaining days countdown badge, trip title, and date range.
 *   2. Travel party / crew preview with avatar stack and direct navigation to TripMembers.
 *   3. Next booking milestone banner (60-day dining / Lightning Lane window) with 1-tap
 *      jump into TripBookingTimeline.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { BookingTimelineDTO, TripDTO, TripMemberDTO, TripStatus } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import {
  navigateToBookingTimeline,
  navigateToTripDetail,
  navigateToTripMembers,
} from '../../navigation/navigationRef';
import { bookingKeys, fetchBookingTimeline } from '../trips/bookingTimelineApi';
import { tripsListKeys } from '../trips/TripsListScreen';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { calculateCountdownDays } from './countdown';
import { resolveEarliestActiveMilestone } from './milestoneDerivation';
import { UPCOMING_TRIP_HERO } from './UpcomingTripHero.palette';

interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

type TripsListResponse = readonly TripStatusGroup[];

function formatTripDateRange(trip: TripDTO): string {
  if (trip.startDate === trip.endDate) {
    return trip.startDate;
  }
  return `${trip.startDate} \u2013 ${trip.endDate}`;
}

export interface UpcomingTripHeroProps {
  readonly testID?: string;
  readonly hideIfActiveTrip?: boolean;
  readonly onPressTrip?: (tripId: string) => void;
  readonly onPressMilestone?: (tripId: string) => void;
  readonly onPressCrew?: (tripId: string) => void;
}

export default function UpcomingTripHero({
  testID = 'home-upcoming-trip-card',
  hideIfActiveTrip = true,
  onPressTrip,
  onPressMilestone,
  onPressCrew,
}: UpcomingTripHeroProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(UPCOMING_TRIP_HERO);

  const tripsQuery = useQuery<TripsListResponse>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    staleTime: 60 * 1000,
  });

  const groups = tripsQuery.data ?? [];
  const upcomingGroup = groups.find((g) => g.status === 'upcoming');
  const upcomingTrips = upcomingGroup?.trips ?? [];

  // Pick the soonest upcoming trip
  const sorted = useMemo(() => {
    return [...upcomingTrips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [upcomingTrips]);

  const trip = sorted[0];

  // Fetch members and booking timeline for the upcoming trip
  const membersQuery = useQuery<readonly TripMemberDTO[]>({
    queryKey: ['trips', 'members', trip?.id ?? ''],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${trip?.id}/members`),
    enabled: Boolean(trip?.id),
    staleTime: 30 * 1000,
  });

  const timelineQuery = useQuery<BookingTimelineDTO>({
    queryKey: bookingKeys.timeline(trip?.id ?? ''),
    queryFn: () => fetchBookingTimeline(trip?.id ?? ''),
    enabled: Boolean(trip?.id),
    staleTime: 30 * 1000,
  });

  const milestone = useMemo(() => {
    return resolveEarliestActiveMilestone(timelineQuery.data?.windows);
  }, [timelineQuery.data?.windows]);

  const members = membersQuery.data ?? [];
  const totalPartyCount = Math.max(members.length, 1);

  const hasActiveTrip = groups.some((g) => g.status === 'active' && g.trips.length > 0);

  if ((hideIfActiveTrip && hasActiveTrip) || !trip) {
    return null;
  }

  const daysLeft = calculateCountdownDays(trip.startDate);

  const handlePressTrip = () => {
    if (onPressTrip) {
      onPressTrip(trip.id);
    } else {
      navigateToTripDetail({ tripId: trip.id });
    }
  };

  const handlePressMilestone = () => {
    if (onPressMilestone) {
      onPressMilestone(trip.id);
    } else {
      navigateToBookingTimeline({ tripId: trip.id });
    }
  };

  const handlePressCrew = () => {
    if (onPressCrew) {
      onPressCrew(trip.id);
    } else {
      navigateToTripMembers({ tripId: trip.id });
    }
  };

  const avatarColors = [pal.avatarBg0, pal.avatarBg1, pal.avatarBg2, pal.avatarBg3];

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={handlePressTrip}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming vacation ${trip.name}, ${daysLeft} days to go`}
      testID={testID}
    >
      {/* 1. Header Row (Countdown badge, title, dates, open trip link) */}
      <View style={styles.headerRow} testID={`${testID}-header`}>
        <View style={styles.countdownCircle} testID={`${testID}-circle`}>
          <Text style={styles.countdownNum}>{daysLeft}</Text>
          <Text style={styles.countdownUnit}>{daysLeft === 1 ? 'DAY' : 'DAYS'}</Text>
        </View>

        <View style={styles.info}>
          <View style={styles.tagRow}>
            <Text style={styles.tag}>UPCOMING VACATION</Text>
            <View style={styles.openTripWrap}>
              <Text style={styles.openTripText}>Open Trip</Text>
              <Ionicons name="chevron-forward" size={13} color={t.color.primaryFg} />
            </View>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatTripDateRange(trip)}
          </Text>
        </View>
      </View>

      {/* 2. Travel Party / Crew Row */}
      <Pressable
        style={({ pressed }) => [styles.crewRow, pressed && styles.pressed]}
        onPress={handlePressCrew}
        accessibilityRole="button"
        accessibilityLabel={`Travel party with ${totalPartyCount} people, manage crew`}
        testID={`${testID}-crew`}
      >
        {totalPartyCount > 1 ? (
          <View style={styles.crewLeft}>
            <View style={styles.avatarStack}>
              {members.slice(0, 4).map((member, index) => (
                <View
                  key={member.userId}
                  style={[
                    styles.crewAvatar,
                    {
                      backgroundColor: avatarColors[index % avatarColors.length],
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
              {totalPartyCount > 4 ? (
                <View style={[styles.crewAvatar, styles.crewAvatarMore, { marginLeft: -8, zIndex: 5 }]}>
                  <Text style={styles.crewAvatarMoreText}>+{totalPartyCount - 4}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.crewText} numberOfLines={1}>
              {members.length > 1
                ? `With ${members.slice(1, 3).map((m) => m.displayName.split(' ')[0]).join(', ')}${
                    totalPartyCount > 3 ? ` & ${totalPartyCount - 3} others` : ''
                  }`
                : `${totalPartyCount} in travel party`}
            </Text>
          </View>
        ) : (
          <View style={styles.soloCrewLeft}>
            <Ionicons name="people-outline" size={16} color={pal.crewLink} />
            <Text style={styles.soloCrewText}>Just you so far • + Invite Crew</Text>
          </View>
        )}

        <View style={styles.crewRight}>
          <Text style={styles.manageCrewText}>
            {totalPartyCount > 1 ? `${totalPartyCount} Going ›` : 'Invite ›'}
          </Text>
        </View>
      </Pressable>

      {/* 3. Next Booking Milestone Banner */}
      {milestone && (
        <Pressable
          style={({ pressed }) => [
            styles.milestoneBanner,
            milestone.isOpenNow ? styles.milestoneOpenBanner : null,
            pressed && styles.pressed,
          ]}
          onPress={handlePressMilestone}
          accessibilityRole="button"
          accessibilityLabel={`${milestone.title}, ${milestone.subtitle}`}
          testID={`${testID}-milestone`}
        >
          <View style={styles.milestoneContent}>
            <View style={styles.milestoneTitleRow}>
              <Text
                style={[
                  styles.milestoneTitle,
                  milestone.isOpenNow ? styles.milestoneOpenTitle : null,
                ]}
                numberOfLines={1}
              >
                {milestone.title}
              </Text>
            </View>
            <Text
              style={[
                styles.milestoneSubtitle,
                milestone.isOpenNow ? styles.milestoneOpenSubtitle : null,
              ]}
              numberOfLines={1}
            >
              {milestone.subtitle}
            </Text>
          </View>
          <View style={styles.milestoneAction}>
            <Text
              style={[
                styles.milestoneActionText,
                milestone.isOpenNow ? styles.milestoneOpenActionText : null,
              ]}
            >
              Timeline ›
            </Text>
          </View>
        </Pressable>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: UPCOMING_TRIP_HERO[t.scheme].cardBorder,
    shadowColor: UPCOMING_TRIP_HERO[t.scheme].cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    marginHorizontal: t.spacing.md,
    marginTop: 12,
    marginBottom: 12,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  countdownCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: UPCOMING_TRIP_HERO[t.scheme].countdownBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  countdownNum: {
    fontSize: 19,
    fontWeight: '800',
    color: t.color.accent,
    lineHeight: 22,
  },
  countdownUnit: {
    fontSize: 8.5,
    fontWeight: '800',
    color: UPCOMING_TRIP_HERO[t.scheme].countdownSub,
    letterSpacing: 0.5,
  },
  info: {
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  tag: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.primaryLight,
    letterSpacing: 0.5,
  },
  openTripWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  openTripText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: UPCOMING_TRIP_HERO[t.scheme].divider,
  },
  crewLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  soloCrewLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  soloCrewText: {
    fontSize: 12,
    fontWeight: '600',
    color: UPCOMING_TRIP_HERO[t.scheme].crewText,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crewAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: UPCOMING_TRIP_HERO[t.scheme].crewAvatarBorder,
  },
  crewAvatarText: {
    fontSize: 10,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  crewAvatarMore: {
    backgroundColor: UPCOMING_TRIP_HERO[t.scheme].crewAvatarMoreBg,
  },
  crewAvatarMoreText: {
    fontSize: 9,
    fontWeight: '800',
    color: UPCOMING_TRIP_HERO[t.scheme].crewAvatarMoreText,
  },
  crewText: {
    fontSize: 12,
    fontWeight: '600',
    color: UPCOMING_TRIP_HERO[t.scheme].crewText,
    flexShrink: 1,
  },
  crewRight: {
    paddingLeft: 4,
  },
  manageCrewText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: UPCOMING_TRIP_HERO[t.scheme].crewLink,
  },
  milestoneBanner: {
    backgroundColor: UPCOMING_TRIP_HERO[t.scheme].milestoneBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UPCOMING_TRIP_HERO[t.scheme].milestoneBorder,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  milestoneOpenBanner: {
    backgroundColor: UPCOMING_TRIP_HERO[t.scheme].milestoneOpenBg,
    borderColor: UPCOMING_TRIP_HERO[t.scheme].milestoneOpenBorder,
  },
  milestoneContent: {
    flex: 1,
  },
  milestoneTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  milestoneTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneText,
  },
  milestoneOpenTitle: {
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneOpenText,
  },
  milestoneSubtitle: {
    fontSize: 10.5,
    fontWeight: '500',
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneSub,
    marginTop: 2,
  },
  milestoneOpenSubtitle: {
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneOpenText,
    opacity: 0.9,
  },
  milestoneAction: {
    paddingLeft: 2,
  },
  milestoneActionText: {
    fontSize: 11,
    fontWeight: '800',
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneText,
  },
  milestoneOpenActionText: {
    color: UPCOMING_TRIP_HERO[t.scheme].milestoneOpenText,
  },
}));
