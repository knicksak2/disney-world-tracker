/**
 * UpcomingTripHero — Pre-trip countdown hero card for the Home command center.
 *
 * Implements Task 15.4 (Requirements 2.1).
 * Reads /me/trips (sharing tripsListKeys.list() cache with TripsListScreen).
 * Derives the earliest upcoming trip and displays remaining days, trip name,
 * and date range with 1-tap navigation into TripDetailScreen.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { TripDTO, TripStatus } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { navigateToTripDetail } from '../../navigation/navigationRef';
import { tripsListKeys } from '../trips/TripsListScreen';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { calculateCountdownDays } from './countdown';
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
  readonly onPressTrip?: (tripId: string) => void;
}

export default function UpcomingTripHero({
  testID = 'home-upcoming-trip-card',
  onPressTrip,
}: UpcomingTripHeroProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const tripsQuery = useQuery<TripsListResponse>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    staleTime: 60 * 1000,
  });

  const groups = tripsQuery.data ?? [];
  const upcomingGroup = groups.find((g) => g.status === 'upcoming');
  const upcomingTrips = upcomingGroup?.trips ?? [];

  if (upcomingTrips.length === 0) {
    return null;
  }

  // Pick the soonest upcoming trip
  const sorted = [...upcomingTrips].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const trip = sorted[0];
  if (!trip) {
    return null;
  }

  const daysLeft = calculateCountdownDays(trip.startDate);
  const handlePress = () => {
    if (onPressTrip) {
      onPressTrip(trip.id);
    } else {
      navigateToTripDetail({ tripId: trip.id });
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming vacation ${trip.name}, ${daysLeft} days to go`}
      testID={testID}
    >
      <View style={styles.countdownCircle} testID={`${testID}-circle`}>
        <Text style={styles.countdownNum}>{daysLeft}</Text>
        <Text style={styles.countdownUnit}>{daysLeft === 1 ? 'DAY' : 'DAYS'}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.tag}>UPCOMING VACATION</Text>
        <Text style={styles.title} numberOfLines={1}>
          {trip.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatTripDateRange(trip)}
        </Text>
      </View>

      <View style={styles.arrowWrap}>
        <Ionicons name="arrow-forward" size={18} color={t.color.primaryFg} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color.surface,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: UPCOMING_TRIP_HERO[t.scheme].cardBorder,
    shadowColor: UPCOMING_TRIP_HERO[t.scheme].cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    marginHorizontal: t.spacing.md,
    marginTop: 12,
    marginBottom: 12,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  countdownCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: UPCOMING_TRIP_HERO[t.scheme].countdownBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  countdownNum: {
    fontSize: 18,
    fontWeight: '800',
    color: t.color.accent,
    lineHeight: 20,
  },
  countdownUnit: {
    fontSize: 8.5,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.5,
  },
  info: {
    flex: 1,
  },
  tag: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.primaryLight,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  meta: {
    fontSize: 11.5,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  arrowWrap: {
    paddingLeft: 4,
  },
}));
