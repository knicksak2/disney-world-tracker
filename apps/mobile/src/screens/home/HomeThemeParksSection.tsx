/**
 * HomeThemeParksSection — Compact single-row 4-park Live Park Pulse strip.
 *
 * Replaces the 2x2 landmark grid, duplicate Log a Ride / Log Food buttons, and
 * Hidden Mickeys banner per first-run-onboarding Requirement 6.1–6.3.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import type { ParkLiveSnapshotDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import type { DestinationId } from '../catalog/destinations';
import { DESTINATION_VISUALS } from '../catalog/destinationVisuals';
import { calculateParkWaitAverage } from './pulseCalculations';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { HOME_THEME_PARKS } from './HomeThemeParksSection.palette';

const THEME_PARKS: readonly DestinationId[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
] as const;

const PARK_SHORT_LABEL: Readonly<Record<string, string>> = {
  'Magic Kingdom': 'MK',
  EPCOT: 'EP',
  'Hollywood Studios': 'HS',
  'Animal Kingdom': 'AK',
};

export interface HomeThemeParksSectionProps {
  readonly onSelectPark: (park: DestinationId) => void;
  readonly onOpenLiveWaits: () => void;
  readonly currentPark?: DestinationId | null | undefined;
  readonly testID?: string;
}

export default function HomeThemeParksSection({
  onSelectPark,
  onOpenLiveWaits,
  testID = 'home-theme-parks-section',
}: HomeThemeParksSectionProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="pulse-outline" size={16} color={t.color.primaryFg} />
          <Text style={styles.title}>Live Park Pulse</Text>
        </View>
        <Pressable
          onPress={onOpenLiveWaits}
          hitSlop={8}
          accessibilityRole="link"
          accessibilityLabel="View all live waits"
          testID="home-parks-live-waits-link"
        >
          <Text style={styles.link}>All Live Waits ›</Text>
        </Pressable>
      </View>

      <View style={styles.pulseStrip} testID="home-parks-pulse-strip">
        {THEME_PARKS.map((park) => (
          <ParkPulseChip
            key={park}
            park={park}
            shortCode={PARK_SHORT_LABEL[park] ?? park}
            onPress={() => onSelectPark(park)}
          />
        ))}
      </View>
    </View>
  );
}

function ParkPulseChip({
  park,
  shortCode,
  onPress,
}: {
  readonly park: DestinationId;
  readonly shortCode: string;
  readonly onPress: () => void;
}): JSX.Element {
  const styles = useStyles();
  const pal = usePalette(HOME_THEME_PARKS);
  const visual = DESTINATION_VISUALS[park];

  const liveWaitQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', park],
    queryFn: () =>
      apiRequest<ParkLiveSnapshotDTO>('GET', `/parks/${encodeURIComponent(park)}/live`),
    staleTime: 60 * 1000,
  });

  const avgWait = useMemo(() => {
    if (!liveWaitQuery.data?.entries) return null;
    return calculateParkWaitAverage(liveWaitQuery.data.entries);
  }, [liveWaitQuery.data]);

  return (
    <Pressable
      style={({ pressed }) => [styles.parkChip, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${park}${avgWait !== null ? `, ${avgWait} minutes average wait` : ''}`}
      testID={`home-park-tile-${park}`}
    >
      <LinearGradient
        colors={visual?.gradient ?? [pal.fallback0, pal.fallback1, pal.fallback2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.chipInner}>
        <View style={styles.chipTopRow}>
          <Text style={styles.parkEmoji}>{visual?.icon ?? '🏰'}</Text>
          <Text style={styles.shortCodeText}>{shortCode}</Text>
        </View>
        <View style={styles.waitBadge} testID={`home-park-wait-${park}`}>
          <Ionicons name="flash" size={9} color={pal.waitPulseText} />
          <Text style={styles.waitText} numberOfLines={1}>
            {avgWait !== null ? `${avgWait}m avg` : '--'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginHorizontal: t.spacing.md,
    marginTop: 4,
    marginBottom: t.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    ...t.typography.heading,
    fontSize: 16,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  pulseStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  parkChip: {
    flex: 1,
    minHeight: 68,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: HOME_THEME_PARKS[t.scheme].tileBorder,
    shadowColor: HOME_THEME_PARKS[t.scheme].tileShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 2,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  chipInner: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: 'space-between',
    gap: 6,
  },
  chipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  parkEmoji: {
    fontSize: 15,
    ...t.textDefault,
  },
  shortCodeText: {
    fontSize: 13,
    fontWeight: '800',
    color: HOME_THEME_PARKS[t.scheme].tileTitle,
    letterSpacing: 0.3,
  },
  waitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: HOME_THEME_PARKS[t.scheme].waitPulseBg,
    borderWidth: 1,
    borderColor: HOME_THEME_PARKS[t.scheme].waitPulseBorder,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  waitText: {
    fontSize: 10,
    fontWeight: '800',
    color: HOME_THEME_PARKS[t.scheme].waitPulseText,
  },
}));
