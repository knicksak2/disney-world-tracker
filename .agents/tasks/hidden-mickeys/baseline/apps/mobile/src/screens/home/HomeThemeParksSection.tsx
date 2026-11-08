/**
 * HomeThemeParksSection — 2x2 Theme Parks Landmark Grid + Quick Log Buttons.
 *
 * Implements Task 20.3 (Requirements 2.7).
 * Features:
 *   1. Section header with title "The Parks" and "All Live Waits ›" link navigating to LiveWaitsScreen.
 *   2. 2x2 Theme Parks Landmark Grid for Magic Kingdom, EPCOT, Disney's Hollywood Studios,
 *      and Disney's Animal Kingdom. Each tile displays landmark artwork, experience count,
 *      and embedded live wait average badge (`⚡ XXm avg`); tapping any park navigates to DestinationScreen.
 *   3. Two equal-width Quick Log buttons directly below the 4 parks: "Log a Ride" and "Log Food",
 *      triggering the respective logging modals.
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
import { usePalette } from '../../theme/useAppTheme';
import { HOME_THEME_PARKS } from './HomeThemeParksSection.palette';

const THEME_PARKS: readonly DestinationId[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
] as const;

export interface HomeThemeParksSectionProps {
  readonly onSelectPark: (park: DestinationId) => void;
  readonly onOpenLiveWaits: () => void;
  readonly onOpenLogRide: () => void;
  readonly onOpenLogFood: () => void;
  readonly testID?: string;
}

export default function HomeThemeParksSection({
  onSelectPark,
  onOpenLiveWaits,
  onOpenLogRide,
  onOpenLogFood,
  testID = 'home-theme-parks-section',
}: HomeThemeParksSectionProps): JSX.Element {
  const styles = useStyles();

  // Query destination counts to display experience counts per park
  const destinationsQuery = useQuery<{
    readonly destinations: readonly { readonly destination: DestinationId; readonly count: number }[];
  }>({
    queryKey: ['catalog', 'destinations'],
    queryFn: () => apiRequest('GET', '/catalog/destinations'),
    staleTime: 5 * 60 * 1000,
  });

  const countById = useMemo(() => {
    const map = new Map<DestinationId, number>();
    for (const entry of destinationsQuery.data?.destinations ?? []) {
      map.set(entry.destination, entry.count);
    }
    return map;
  }, [destinationsQuery.data?.destinations]);

  return (
    <View style={styles.container} testID={testID}>
      {/* 1. Header with Title & All Live Waits link */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>The Parks</Text>
        </View>
        <Pressable
          onPress={onOpenLiveWaits}
          hitSlop={8}
          accessibilityRole="link"
          accessibilityLabel="View all live wait times"
          testID="home-parks-live-waits-link"
        >
          <Text style={styles.link}>All Live Waits ›</Text>
        </Pressable>
      </View>

      {/* 2. 2x2 Theme Parks Landmark Grid */}
      <View style={styles.parksGrid} testID="home-parks-grid">
        {THEME_PARKS.map((park) => (
          <ParkGridCard
            key={park}
            park={park}
            count={countById.get(park) ?? 0}
            onPress={() => onSelectPark(park)}
          />
        ))}
      </View>

      {/* 3. Quick Log Row underneath the 4 parks */}
      <View style={styles.logRow} testID="home-quick-log-row">
        <Pressable
          style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
          onPress={onOpenLogRide}
          accessibilityRole="button"
          accessibilityLabel="Log a ride or attraction"
          testID="home-quick-log-ride"
        >
          <View style={[styles.logIconWrap, styles.logRideIconWrap]}>
            <Text style={styles.logEmoji}>🎢</Text>
          </View>
          <View style={styles.logBtnTextCol}>
            <Text style={styles.logBtnTitle}>Log a Ride</Text>
            <Text style={styles.logBtnSubtitle}>Rate & check off</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
          onPress={onOpenLogFood}
          accessibilityRole="button"
          accessibilityLabel="Log food item or meal"
          testID="home-quick-log-food"
        >
          <View style={[styles.logIconWrap, styles.logFoodIconWrap]}>
            <Text style={styles.logEmoji}>🍽️</Text>
          </View>
          <View style={styles.logBtnTextCol}>
            <Text style={styles.logBtnTitle}>Log Food</Text>
            <Text style={styles.logBtnSubtitle}>Dishes & snacks</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Park Grid Card Subcomponent
// ---------------------------------------------------------------------------

function ParkGridCard({
  park,
  count,
  onPress,
}: {
  readonly park: DestinationId;
  readonly count: number;
  readonly onPress: () => void;
}): JSX.Element {
  const styles = useStyles();
  const pal = usePalette(HOME_THEME_PARKS);
  const visual = DESTINATION_VISUALS[park];

  const liveWaitQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', park],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', `/parks/${encodeURIComponent(park)}/live`),
    staleTime: 60 * 1000,
  });

  const avgWait = useMemo(() => {
    if (!liveWaitQuery.data?.entries) return null;
    return calculateParkWaitAverage(liveWaitQuery.data.entries);
  }, [liveWaitQuery.data]);

  return (
    <Pressable
      style={({ pressed }) => [styles.parkCard, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${park}, ${count} experiences${avgWait !== null ? `, ${avgWait} minutes average wait` : ''}`}
      testID={`home-park-tile-${park}`}
    >
      <LinearGradient
        colors={visual?.gradient ?? [pal.fallback0, pal.fallback1, pal.fallback2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {visual?.watermarkGlyph && (
        <Ionicons
          name={visual.watermarkGlyph}
          size={78}
          color={pal.watermark}
          style={styles.parkWatermark}
        />
      )}

      <View style={styles.parkCardInner}>
        <View style={styles.parkCardTopRow}>
          <View style={styles.parkIconBadge}>
            <Text style={styles.parkIconText}>{visual?.icon ?? '🏰'}</Text>
          </View>
          {avgWait !== null && (
            <View style={styles.parkWaitBadge} testID={`home-park-wait-${park}`}>
              <Ionicons name="flash" size={10} color={pal.waitPulseText} />
              <Text style={styles.parkWaitText}>{avgWait}m avg</Text>
            </View>
          )}
        </View>

        <View style={styles.parkCardBottom}>
          <Text style={styles.parkTitle} numberOfLines={1}>
            {park}
          </Text>
          <Text style={styles.parkCountText}>
            {count} {count === 1 ? 'experience' : 'experiences'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    ...t.typography.heading,
    fontSize: 17,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  parksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  parkCard: {
    width: '48.5%',
    height: 116,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: HOME_THEME_PARKS[t.scheme].tileBorder,
    shadowColor: HOME_THEME_PARKS[t.scheme].tileShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 2,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  parkWatermark: {
    position: 'absolute',
    right: -10,
    bottom: -10,
  },
  parkCardInner: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  parkCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  parkIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: HOME_THEME_PARKS[t.scheme].iconBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parkIconText: {
    fontSize: 17,
    ...t.textDefault,
  },
  parkWaitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: HOME_THEME_PARKS[t.scheme].waitPulseBg,
    borderWidth: 1,
    borderColor: HOME_THEME_PARKS[t.scheme].waitPulseBorder,
    paddingVertical: 2.5,
    paddingHorizontal: 6.5,
    borderRadius: 12,
  },
  parkWaitText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: HOME_THEME_PARKS[t.scheme].waitPulseText,
  },
  parkCardBottom: {
    gap: 1,
  },
  parkTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: HOME_THEME_PARKS[t.scheme].tileTitle,
    lineHeight: 18,
  },
  parkCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: HOME_THEME_PARKS[t.scheme].tileSubtitle,
  },
  logRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  logButton: {
    flex: 1,
    backgroundColor: HOME_THEME_PARKS[t.scheme].logBtnBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HOME_THEME_PARKS[t.scheme].logBtnBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: HOME_THEME_PARKS[t.scheme].logBtnShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  logIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logRideIconWrap: {
    backgroundColor: HOME_THEME_PARKS[t.scheme].logRideIconBg,
  },
  logFoodIconWrap: {
    backgroundColor: HOME_THEME_PARKS[t.scheme].logFoodIconBg,
  },
  logEmoji: {
    fontSize: 19,
    ...t.textDefault,
  },
  logBtnTextCol: {
    flex: 1,
  },
  logBtnTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  logBtnSubtitle: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 1,
  },
}));

