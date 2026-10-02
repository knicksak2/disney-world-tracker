/**
 * LiveWaitsScreen — Park-wide live wait times list with filtering and quick visit logging.
 *
 * Implements Task 6 (Requirements 10.1–10.11) with 100% visual parity to docs/redesign-mockup.html:
 *   - Vivid twilight gradient header with REAL-TIME LINE TIMES pill tag, refresh icon button,
 *     park title, and Park Hours / Updated time subtitle
 *   - Themed park selector chips with icons (🏰 Magic Kingdom, 🌐 EPCOT, 🎬 Studios, 🍃 Animal K.)
 *   - Crowd status / line radar card with calculated crowd level, average wait, peak time advice, and Tips
 *   - 4-way filter row: All ({count}), Walk-on (<25m), Lightning Lane, Headliners
 *   - Attraction cards with status dot (low/mod/high/down), attraction name, Land & ⚡ LL return/pricing meta,
 *     big bold wait number with MIN WAIT sublabel, and compact + Log button with non-overlapping spacing
 *   - React-query cached GET /parks/:park/live with stale fallback and retrieval footer
 *   - Pure row composition via buildLiveWaitsRows
 *   - Quick visit logging opening LogVisitModal
 *   - Themed EmptyState when live_unavailable with no cache
 *   - Tracks last-viewed park in liveWaitsStore
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  PARKS,
  PARK_LIVE_CACHE_TTL_SECONDS,
  type ExperienceDTO,
  type Park,
  type ParkLiveSnapshotDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { EmptyState, ScreenContainer } from '../../theme/components';
import {
  RetrievalFooter,
  StaleIndicator,
} from '../catalog/live/liveSectionShared';
import LogVisitModal from '../catalog/LogVisitModal';
import { useLiveWaitsStore } from '../../state/liveWaitsStore';
import { resolveDefaultLiveWaitsPark } from './defaultPark';
import { useFavoritedExperiences } from '../catalog/useFavoritedExperiences';
import {
  buildLiveWaitsRows,
  getWaitStatus,
  type LiveWaitsFilter,
  type LiveWaitsRow,
} from './parkLiveView';
import {
  calculateParkWaitAverage,
  classifyCrowdTrend,
} from '../home/pulseCalculations';
import { getParkHoursDetails } from '../trips/TripScheduleScreen';

export interface LiveWaitsScreenProps {
  readonly route?: {
    readonly params?: {
      readonly park?: Park;
      readonly filter?: LiveWaitsFilter;
    };
  };
  readonly navigation?: {
    readonly goBack?: () => void;
    readonly navigate?: (screen: string, params?: unknown) => void;
  };
}

const PARK_INFO: Record<string, { emoji: string; shortLabel: string }> = {
  'Magic Kingdom': { emoji: '🏰', shortLabel: 'Magic Kingdom' },
  'EPCOT': { emoji: '🌐', shortLabel: 'EPCOT' },
  'Hollywood Studios': { emoji: '🎬', shortLabel: 'Studios' },
  "Disney's Hollywood Studios": { emoji: '🎬', shortLabel: 'Studios' },
  'Animal Kingdom': { emoji: '🍃', shortLabel: 'Animal K.' },
  "Disney's Animal Kingdom": { emoji: '🍃', shortLabel: 'Animal K.' },
};

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return 'Live';
  const diffMs = Math.max(0, Date.now() - new Date(isoString).getTime());
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin <= 1) return 'Updated 1 min ago';
  return `Updated ${diffMin} min ago`;
}

function formatLightningLane(row: LiveWaitsRow): string | null {
  if (row.lightningLane?.returnStart) {
    try {
      const date = new Date(row.lightningLane.returnStart);
      if (!isNaN(date.getTime())) {
        const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const priceStr = row.lightningLane.price?.amount
          ? ` ($${row.lightningLane.price.amount})`
          : ' (Multi)';
        return `⚡ LL ${time}${priceStr}`;
      }
    } catch {
      // ignore parsing error and fallback
    }
  }
  if (row.lightningLane?.state && row.lightningLane.state !== 'CLOSED') {
    return `⚡ LL ${row.lightningLane.state}`;
  }
  if (row.isLightningLane) {
    return '⚡ LL';
  }
  return null;
}

export default function LiveWaitsScreen({
  route,
  navigation,
}: LiveWaitsScreenProps): JSX.Element {
  const insets = useContext(SafeAreaInsetsContext);
  const topInset = Math.max(insets?.top ?? 0, theme.spacing.xl);

  const queryClient = useQueryClient();
  const routePark = route?.params?.park;
  const routeFilter = route?.params?.filter;
  const lastViewedPark = useLiveWaitsStore((state) => state.lastViewedPark);
  const setLastViewedPark = useLiveWaitsStore((state) => state.setLastViewedPark);

  const [selectedPark, setSelectedPark] = useState<Park>(() => {
    if (routePark && (PARKS as readonly string[]).includes(routePark)) {
      return routePark;
    }
    return resolveDefaultLiveWaitsPark(null, lastViewedPark);
  });

  const [filter, setFilter] = useState<LiveWaitsFilter>(() => routeFilter ?? 'all');
  const [activeLogExperienceId, setActiveLogExperienceId] = useState<string | null>(null);

  // Sync route param changes when navigated with a new park or filter
  useEffect(() => {
    if (routePark && (PARKS as readonly string[]).includes(routePark)) {
      setSelectedPark(routePark);
    }
  }, [routePark]);

  useEffect(() => {
    if (routeFilter) {
      setFilter(routeFilter);
    }
  }, [routeFilter]);

  // Track most recently viewed park in Zustand (Requirement 10.1)
  useEffect(() => {
    setLastViewedPark(selectedPark);
  }, [selectedPark, setLastViewedPark]);

  // Live wait times snapshot query (Requirements 9.1, 10.1)
  const liveQuery = useQuery<ParkLiveSnapshotDTO, ApiError>({
    queryKey: ['park-live', selectedPark],
    queryFn: () =>
      apiRequest<ParkLiveSnapshotDTO>(
        'GET',
        `/parks/${encodeURIComponent(selectedPark)}/live`,
      ),
    staleTime: PARK_LIVE_CACHE_TTL_SECONDS * 1000,
  });

  // Catalog experiences query for facet/category matching (Requirement 10.5)
  const catalogQuery = useQuery<{ experiences: readonly ExperienceDTO[] }, ApiError>({
    queryKey: ['catalog', 'park', selectedPark],
    queryFn: () =>
      apiRequest<{ experiences: readonly ExperienceDTO[] }>(
        'GET',
        `/catalog?parkId=${encodeURIComponent(selectedPark)}`,
      ),
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

  const favoritedIds = useFavoritedExperiences();

  // All eligible rows (to compute total count in All chip)
  const allRows = useMemo(() => {
    if (!liveQuery.data?.entries) return [];
    return buildLiveWaitsRows(liveQuery.data.entries, experiencesById, 'all', favoritedIds);
  }, [liveQuery.data?.entries, experiencesById, favoritedIds]);

  // Filtered rows for display
  const rows = useMemo(() => {
    if (!liveQuery.data?.entries) return [];
    return buildLiveWaitsRows(liveQuery.data.entries, experiencesById, filter, favoritedIds);
  }, [liveQuery.data?.entries, experiencesById, filter, favoritedIds]);

  const parkWaitAvg = useMemo(() => {
    if (!liveQuery.data?.entries) return null;
    return calculateParkWaitAverage(liveQuery.data.entries);
  }, [liveQuery.data?.entries]);

  const crowdTrend = useMemo(() => {
    return classifyCrowdTrend(parkWaitAvg);
  }, [parkWaitAvg]);

  const crowdLevel = useMemo(() => {
    if (parkWaitAvg === null) return null;
    return Math.min(10, Math.max(1, Math.round(parkWaitAvg / 8)));
  }, [parkWaitAvg]);

  const crowdTip = useMemo(() => {
    if (parkWaitAvg === null) {
      return 'Lines peak between 1–3 PM. Check individual rides below!';
    }
    if (parkWaitAvg < 25) {
      return 'Lines are light right now! Great time to hit top headliners.';
    }
    if (parkWaitAvg < 45) {
      return 'Lines peak between 1–3 PM. Best to ride Space Mtn or Mine Train before noon!';
    }
    return 'Lines are heavy right now. Best to prioritize shows or walk-ons!';
  }, [parkWaitAvg]);

  const handleRefresh = () => {
    void liveQuery.refetch();
  };

  const parkHours = getParkHoursDetails(selectedPark).openTimeText;
  const updatedText = formatRelativeTime(liveQuery.data?.retrievedAt);

  // Wrapped in useCallback so FlatList/VirtualizedList sees a stable function
  // identity across renders. A plain `const` function defined in the component
  // body is still recreated fresh on every render, which defeats row memoization
  // (React.memo) the same way an inline JSX arrow would and triggers the
  // "large list that is slow to update" warning. Same fix pattern as
  // `renderRow` in DestinationScreen.tsx.
  const renderItem = useCallback(({ item }: { readonly item: LiveWaitsRow }) => {
    const status = getWaitStatus(item.waitMinutes, item.isClosedOrDown);
    const statusColor =
      status === 'low'
        ? '#22c55e'
        : status === 'mod'
        ? '#f59e0b'
        : status === 'high'
        ? '#ef4444'
        : '#8e889b';

    const llText = formatLightningLane(item);

    return (
      <View style={styles.waitCard} testID={`live-waits-row-${item.experienceId}`}>
        {/* Status Dot */}
        <View
          style={[styles.statusDot, { backgroundColor: statusColor }]}
          testID={`status-dot-${item.experienceId}`}
        />

        {/* Experience Details */}
        <Pressable
          style={styles.waitDetails}
          onPress={() => {
            navigation?.navigate?.('ExperienceDetail', {
              experienceId: item.experienceId,
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={item.name}
        >
          <Text style={styles.waitName} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.waitMetaRow}>
            {item.land ? (
              <Text style={styles.landText}>{item.land}</Text>
            ) : null}
            {llText ? (
              <Text style={styles.llBadgeText}>
                {item.land ? ` • ${llText}` : llText}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {/* Right Wait Time Box & Quick Log Button */}
        <View style={styles.waitTimeBox}>
          {item.isClosedOrDown ? (
            <Text style={styles.waitStatusClosed}>
              {item.waitMinutes !== null ? 'Down' : 'Closed'}
            </Text>
          ) : item.waitMinutes !== null ? (
            <View
              style={styles.timeDisplayBox}
              testID={`wait-time-${item.experienceId}`}
            >
              <Text style={styles.waitTimeNum}>{item.waitMinutes}</Text>
              <Text style={styles.waitTimeUnit}> min wait</Text>
            </View>
          ) : (
            <View style={styles.timeDisplayBox} testID={`wait-time-${item.experienceId}`}>
              <Text style={styles.waitStatusMuted}>--</Text>
            </View>
          )}

          <Pressable
            style={styles.quickLogBtn}
            onPress={() => setActiveLogExperienceId(item.experienceId)}
            accessibilityRole="button"
            accessibilityLabel={`Log visit for ${item.name}`}
            testID={`log-visit-${item.experienceId}`}
          >
            <Text style={styles.quickLogText}>+ Log</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [navigation, setActiveLogExperienceId]);

  const renderContent = () => {
    if ((liveQuery.isLoading && !liveQuery.data) || (catalogQuery.isLoading && !catalogQuery.data)) {
      return (
        <View style={styles.centered} testID="live-waits-loading">
          <ActivityIndicator
            size="large"
            color={theme.color.primary}
            accessibilityLabel="Loading live waits"
          />
        </View>
      );
    }

    if (liveQuery.isError && !liveQuery.data) {
      return (
        <View style={styles.errorContainer}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Live waits unavailable"
            body="We couldn't retrieve live waits for this park right now. Pull to try again or check back soon."
            testID="live-waits-unavailable"
          />
        </View>
      );
    }

    return (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.experienceId}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={liveQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor={theme.color.primary}
          />
        }
        ListHeaderComponent={
          <>
            {liveQuery.data?.stale ? (
              <View style={styles.staleBannerContainer}>
                <StaleIndicator />
              </View>
            ) : null}

            {/* Live Wait Alert / Crowd Status Card (Mockup Parity) */}
            <View style={styles.crowdAlertCard} testID="live-waits-crowd-card">
              <View style={styles.crowdAlertLeft}>
                <Text style={styles.crowdAlertLevel}>
                  {crowdLevel !== null
                    ? `Crowd Level ${crowdLevel} • ${crowdTrend} Lines (${parkWaitAvg}m avg)`
                    : 'Park Lines • Real-time Radar'}
                </Text>
                <Text style={styles.crowdAlertDesc} numberOfLines={2}>
                  {crowdTip}
                </Text>
              </View>
              <Pressable
                style={styles.tipsBtn}
                onPress={() => {
                  Alert.alert(
                    'Touring Tips',
                    'Lines typically peak between 1:00 PM – 4:00 PM. Target headliners during park open or evening fireworks for the shortest waits!',
                  );
                }}
                testID="live-waits-tips-button"
                accessibilityRole="button"
                accessibilityLabel="Touring Tips"
              >
                <Text style={styles.tipsBtnText}>Tips</Text>
              </Pressable>
            </View>

            {/* 4-Way Filter Pills (Mockup Parity) */}
            <View style={styles.filterRow} testID="live-waits-filter-row">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterPillsScroll}
              >
                <Pressable
                  onPress={() => setFilter('all')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === 'all' }}
                  accessibilityLabel={`All, ${allRows.length} rides`}
                  testID="filter-chip-all"
                  style={[
                    styles.filterPill,
                    filter === 'all' && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filter === 'all' && styles.filterPillTextActive,
                    ]}
                  >
                    {`All (${allRows.length})`}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setFilter('walkOn')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === 'walkOn' }}
                  accessibilityLabel="Walk-on less than 25 minutes"
                  testID="filter-chip-walkOn"
                  style={[
                    styles.filterPill,
                    filter === 'walkOn' && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filter === 'walkOn' && styles.filterPillTextActive,
                    ]}
                  >
                    Walk-on (&lt;25m)
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setFilter('lightningLane')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === 'lightningLane' }}
                  accessibilityLabel="Lightning Lane"
                  testID="filter-chip-lightningLane"
                  style={[
                    styles.filterPill,
                    filter === 'lightningLane' && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filter === 'lightningLane' && styles.filterPillTextActive,
                    ]}
                  >
                    Lightning Lane
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setFilter('headliners')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === 'headliners' }}
                  accessibilityLabel="Headliners"
                  testID="filter-chip-headliners"
                  style={[
                    styles.filterPill,
                    filter === 'headliners' && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filter === 'headliners' && styles.filterPillTextActive,
                    ]}
                  >
                    Headliners
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setFilter('favorites')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === 'favorites' }}
                  accessibilityLabel="Favorites"
                  testID="filter-chip-favorites"
                  style={[
                    styles.filterPill,
                    filter === 'favorites' && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filter === 'favorites' && styles.filterPillTextActive,
                    ]}
                  >
                    ❤️ Favorites
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="time-outline"
            title="No rides match this filter"
            body="Try switching to All to see every attraction."
            testID="live-waits-filter-empty"
          />
        }
        ListFooterComponent={
          liveQuery.data?.retrievedAt ? (
            <View style={styles.footerContainer}>
              <RetrievalFooter retrievedAt={liveQuery.data.retrievedAt} />
            </View>
          ) : null
        }
      />
    );
  };

  return (
    <ScreenContainer style={styles.container}>
      {/* Mockup Signature Gradient Header */}
      <LinearGradient
        colors={theme.gradient.headerVivid}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.headerContainer, { paddingTop: topInset + 10 }]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.headerGreetingRow}>
            {navigation?.goBack ? (
              <Pressable
                onPress={() => navigation.goBack!()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
              >
                <Ionicons name="arrow-back" size={20} color="#ffffff" />
              </Pressable>
            ) : null}
            <View style={styles.greetingPill}>
              <Ionicons name="time" size={13} color={theme.color.accent} style={{ marginRight: 4 }} />
              <Text style={styles.greetingPillText}>REAL-TIME LINE TIMES</Text>
            </View>
          </View>

          <Pressable
            style={styles.iconBtn}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel="Refresh wait times"
            testID="refresh-waits-button"
          >
            <Ionicons name="refresh" size={18} color="#ffffff" />
          </Pressable>
        </View>

        <Text style={styles.headerParkTitle}>{selectedPark}</Text>
        <Text style={styles.headerSubtitle}>
          {`Park Hours: ${parkHours} • ${updatedText}`}
        </Text>
      </LinearGradient>

      {/* Themed Park Selector (Icons + Pills) */}
      <View style={styles.parkSelectorWrapper} testID="live-waits-park-selector">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.parkChipsScroll}
        >
          {PARKS.map((park) => {
            const info = PARK_INFO[park] ?? { emoji: '🏰', shortLabel: park };
            const isActive = selectedPark === park;
            return (
              <Pressable
                key={park}
                onPress={() => setSelectedPark(park)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${info.emoji} ${info.shortLabel}, ${isActive ? 'selected' : 'not selected'}`}
                testID={`park-chip-${park}`}
                style={[
                  styles.parkChip,
                  isActive && styles.parkChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.parkChipText,
                    isActive && styles.parkChipTextActive,
                  ]}
                >
                  {`${info.emoji} ${info.shortLabel}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {renderContent()}

      {activeLogExperienceId ? (
        <LogVisitModal
          experienceId={activeLogExperienceId}
          visible={Boolean(activeLogExperienceId)}
          onClose={() => setActiveLogExperienceId(null)}
          onLogged={() => {
            setActiveLogExperienceId(null);
            void queryClient.invalidateQueries({
              queryKey: ['experience-completion', activeLogExperienceId],
            });
            void queryClient.invalidateQueries({ queryKey: ['me-stats'] });
          }}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.color.background,
  },
  headerContainer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  headerGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    padding: 4,
    marginRight: 2,
  },
  greetingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  greetingPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: theme.color.accent,
    letterSpacing: 0.6,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  headerParkTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
  },
  parkSelectorWrapper: {
    paddingTop: theme.spacing.sm,
    paddingBottom: 4,
  },
  parkChipsScroll: {
    paddingHorizontal: theme.spacing.md,
    gap: 8,
  },
  parkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  parkChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
    shadowColor: theme.color.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  parkChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  parkChipTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: 6,
    paddingBottom: theme.spacing.xl,
  },
  crowdAlertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#faf8ff',
    borderLeftWidth: 4,
    borderLeftColor: theme.color.primary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9e4f5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    marginTop: 4,
  },
  crowdAlertLeft: {
    flex: 1,
    marginRight: 10,
  },
  crowdAlertLevel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: theme.color.primary,
  },
  crowdAlertDesc: {
    fontSize: 10.5,
    color: theme.color.textSecondary,
    marginTop: 2,
    lineHeight: 14,
  },
  tipsBtn: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tipsBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.color.primary,
  },
  filterRow: {
    marginBottom: 8,
  },
  filterPillsScroll: {
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.color.surfaceAlt,
  },
  filterPillActive: {
    backgroundColor: 'rgba(91, 42, 134, 0.15)',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  filterPillTextActive: {
    color: theme.color.primary,
    fontWeight: '800',
  },
  waitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
    flexShrink: 0,
  },
  waitDetails: {
    flex: 1,
    marginRight: 10,
    justifyContent: 'center',
  },
  waitName: {
    ...theme.typography.title,
    fontSize: 14,
    fontWeight: '700',
    color: theme.color.textPrimary,
    lineHeight: 18,
  },
  waitMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  landText: {
    fontSize: 10.5,
    color: theme.color.textSecondary,
  },
  llBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#b45309',
  },
  waitTimeBox: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 64,
    flexShrink: 0,
  },
  timeDisplayBox: {
    alignItems: 'flex-end',
  },
  waitTimeNum: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.color.textPrimary,
    lineHeight: 22,
  },
  waitTimeUnit: {
    fontSize: 8.5,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  waitStatusClosed: {
    fontSize: 11.5,
    fontWeight: '800',
    color: theme.color.danger,
    lineHeight: 16,
  },
  waitStatusMuted: {
    fontSize: 12,
    color: theme.color.textSecondary,
  },
  quickLogBtn: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  quickLogText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.color.primary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  errorContainer: {
    flex: 1,
    paddingTop: theme.spacing.xl,
  },
  staleBannerContainer: {
    marginBottom: theme.spacing.sm,
  },
  footerContainer: {
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
});
