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
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Park, ParkLiveSnapshotDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { navigateToLiveWaits } from '../../navigation/navigationRef';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import {
  calculateParkWaitAverage,
  classifyCrowdTrend,
  type CrowdTrend,
} from './pulseCalculations';
import { PARK_WAIT_PULSE } from './ParkWaitPulse.palette';

const THEME_PARKS: readonly Park[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
] as const;

/** The parks that carry their own accent on a pill (all four theme parks). */
const ACCENTED_PARKS: ReadonlySet<string> = new Set<string>(THEME_PARKS);

function ParkPill({
  park,
  isActive = false,
  onPress,
}: {
  readonly park: Park;
  readonly isActive?: boolean;
  readonly onPress: (park: Park) => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(PARK_WAIT_PULSE);
  const trendColors: Record<CrowdTrend, { readonly bg: string; readonly text: string }> = {
    'Walk-on': { bg: pal.walkOnBg, text: pal.walkOnText },
    'Light lines': { bg: pal.lightLinesBg, text: pal.lightLinesText },
    Moderate: { bg: pal.moderateBg, text: pal.moderateText },
    Heavy: { bg: pal.heavyBg, text: pal.heavyText },
  };
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
  const trendColor = trendColors[trend];
  const parkColor = ACCENTED_PARKS.has(park) ? t.parkAccent[park] : t.color.primaryFg;

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
  const styles = useStyles();
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

const useStyles = makeStyles((t) => ({
  container: {
    marginBottom: t.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.md,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 16,
    ...t.textDefault,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  scrollContent: {
    paddingHorizontal: t.spacing.md,
    gap: 10,
  },
  pill: {
    width: 124,
    backgroundColor: t.color.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: PARK_WAIT_PULSE[t.scheme].pillBorder,
    gap: 4,
    shadowColor: PARK_WAIT_PULSE[t.scheme].pillShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  pillActive: {
    borderWidth: 2,
    borderColor: PARK_WAIT_PULSE[t.scheme].activeBorder,
    shadowColor: PARK_WAIT_PULSE[t.scheme].activeShadow,
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
    color: t.color.textPrimary,
    lineHeight: 22,
  },
  waitUnit: {
    fontSize: 10,
    fontWeight: '600',
    color: t.color.textSecondary,
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
}));
