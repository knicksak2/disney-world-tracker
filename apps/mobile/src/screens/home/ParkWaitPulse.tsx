/**
 * ParkWaitPulse — Horizontal line radar carousel across the 4 theme parks.
 *
 * Implements Task 15.5 (Requirements 2.1, 2.5; design.md Property 7).
 * Reads /parks/:park/live for Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom.
 * Displays integer average wait times and crowd trend classifications.
 * Tapping any park card navigates to LiveWaitsScreen for that park.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Park, ParkLiveSnapshotDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { navigateToLiveWaits } from '../../navigation/navigationRef';
import { theme } from '../../theme/theme';
import {
  calculateParkWaitAverage,
  classifyCrowdTrend,
  type CrowdTrend,
} from './pulseCalculations';

const THEME_PARKS: readonly Park[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
] as const;

const PARK_COLORS: Record<string, string> = {
  'Magic Kingdom': '#7e57c2',
  EPCOT: '#2f80ed',
  'Hollywood Studios': '#e8505b',
  'Animal Kingdom': '#3fa34d',
};

const TREND_COLORS: Record<CrowdTrend, { readonly bg: string; readonly text: string }> = {
  'Walk-on': { bg: '#dcfce7', text: '#15803d' },
  'Light lines': { bg: '#dcfce7', text: '#15803d' },
  Moderate: { bg: '#fef3c7', text: '#b45309' },
  Heavy: { bg: '#fee2e2', text: '#b91c1c' },
};

function ParkPill({
  park,
  isActive = false,
  onPress,
}: {
  readonly park: Park;
  readonly isActive?: boolean;
  readonly onPress: (park: Park) => void;
}): JSX.Element {
  const liveQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', park],
    queryFn: () =>
      apiRequest<ParkLiveSnapshotDTO>(
        'GET',
        `/parks/${encodeURIComponent(park)}/live`,
      ),
    staleTime: 60 * 1000,
  });

  const entries = liveQuery.data?.entries ?? [];
  const avgWait = calculateParkWaitAverage(entries);
  const trend = classifyCrowdTrend(avgWait);
  const trendColor = TREND_COLORS[trend];
  const parkColor = PARK_COLORS[park] ?? theme.color.primary;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.pill,
        isActive && styles.pillActive,
        pressed && styles.pillPressed,
      ]}
      onPress={() => onPress(park)}
      accessibilityRole="button"
      accessibilityLabel={`${park}, ${avgWait !== null ? `${avgWait} minutes average` : 'open'}, ${trend}${isActive ? ', active park' : ''}`}
      testID={`home-pulse-pill-${park}`}
    >
      <Text style={[styles.parkName, { color: parkColor }]} numberOfLines={1}>
        {park}
      </Text>

      <View style={styles.waitRow}>
        <Text style={styles.waitNum} testID={`home-pulse-wait-${park}`}>
          {avgWait !== null ? avgWait : '--'}
        </Text>
        <Text style={styles.waitUnit}>min avg</Text>
      </View>

      <View style={[styles.trendBadge, { backgroundColor: trendColor.bg }]}>
        <Text style={[styles.trendText, { color: trendColor.text }]}>
          {trend}
        </Text>
      </View>
    </Pressable>
  );
}

export interface ParkWaitPulseProps {
  readonly onSelectPark?: (park: Park) => void;
  readonly activePark?: Park | null | undefined;
  readonly testID?: string;
}

export default function ParkWaitPulse({
  onSelectPark,
  activePark = null,
  testID = 'home-park-wait-pulse',
}: ParkWaitPulseProps): JSX.Element {
  const handleParkPress = (park: Park) => {
    if (onSelectPark) {
      onSelectPark(park);
    } else {
      navigateToLiveWaits(park);
    }
  };

  const handleAllParks = () => {
    if (onSelectPark) {
      onSelectPark('Magic Kingdom');
    } else {
      navigateToLiveWaits('Magic Kingdom');
    }
  };

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.icon}>⏱️</Text>
          <Text style={styles.title}>Park Wait Pulse</Text>
        </View>
        <Pressable
          onPress={handleAllParks}
          hitSlop={8}
          accessibilityRole="link"
          accessibilityLabel="View live wait times for all parks"
          testID="home-pulse-see-all"
        >
          <Text style={styles.link}>All Parks ›</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {THEME_PARKS.map((park) => (
          <ParkPill
            key={park}
            park={park}
            isActive={activePark === park}
            onPress={handleParkPress}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.primary,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.md,
    gap: 10,
  },
  pill: {
    width: 124,
    backgroundColor: theme.color.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#eee6f7',
    gap: 4,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  pillActive: {
    borderWidth: 2,
    borderColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  pillPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  parkName: {
    fontSize: 11,
    fontWeight: '800',
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  waitNum: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.color.textPrimary,
    lineHeight: 22,
  },
  waitUnit: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  trendBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 2,
  },
  trendText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
