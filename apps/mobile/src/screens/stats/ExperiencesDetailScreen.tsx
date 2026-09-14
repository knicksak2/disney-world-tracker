/**
 * ExperiencesDetailScreen — the Unified Activity & Experiences screen of the Stats tab
 * (stats-experience-redesign R18–R23, task 18).
 *
 * A focused, bounded detail screen pushed onto the `StatsStack` from the
 * Overview hub's Activity & Experiences entry card. It unifies:
 *   1. Activity volume odometer counters (total rides, distinct days, avg/day, repeat multiplier)
 *   2. Hall of Fame Podium (top most-ridden attractions with medals and ride counts)
 *   3. Personal Records & Bests (Most Productive Day, Attraction Marathon Record)
 *   4. The full completed experiences catalog with repeat badges (`Nx`) and a sort toggle
 *      (Most Visited vs Date), wrapping the shared `ExperiencesList`.
 *
 * ## Its own scoped read + in-pane treatment (R14.5)
 *
 * The completions list data comes from `useOwnCompletionsQuery` (`['own-completions', ownUserId]`).
 * Its loading indicator and error-with-Retry are scoped to that completions read alone:
 * a completions failure never affects the coverage or ratings surfaces, and Retry re-issues
 * only the completions read.
 *
 * Activity overview data is read from the shared `['me-stats', { percentile: true }]` cache,
 * resolving instantly from cache when navigating from the Overview Hub (R4.1).
 *
 * Validates: Requirements 14.5, 18.1, 18.2, 18.3, 18.4, 19.1, 19.2, 20.1, 20.4, 21.1
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { FESTIVAL_SLUG_LABELS } from '@dwt/shared';
import { ApiError, apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { theme } from '../../theme/theme';

import { useOwnCompletionsQuery } from '../../hooks/useOwnCompletions';
import { ExperiencesList } from '../navigation/ExperiencesList';
import { useOpenExperience } from '../navigation/experienceNavigation';
import {
  formatMarathonRecord,
  formatOdometer,
  formatProductiveDay,
} from './statsView';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const EXPERIENCES_ERROR_TITLE = 'Couldn\u2019t load experiences';
const EXPERIENCES_ERROR_BODY =
  'Couldn\u2019t load your completed experiences. Please try again.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ExperiencesDetailScreen(): JSX.Element {
  const navigation = useNavigation();

  // Scoped Own_Completions_Read (R14.5)
  const completionsQuery = useOwnCompletionsQuery();

  // Shared stats query for activity metrics (reads from warm cache, R4.1)
  const statsQuery = useQuery<StatsResponse, ApiError>({
    queryKey: ['me-stats', { percentile: true }],
    queryFn: () => apiRequest<StatsResponse>('GET', '/me/stats?percentile=true'),
    staleTime: 30 * 1000,
  });

  const [sortBy, setSortBy] = React.useState<'visits' | 'date'>('visits');

  // Cross-stack navigation into the Catalog tab's ExperienceDetail (R15.2).
  const openExperience = useOpenExperience();

  const entries = completionsQuery.data?.entries;
  const activity = statsQuery.data?.activity;
  const festivals = statsQuery.data?.festivals;
  const hasActivity = Boolean(activity && activity.totalLogs > 0);

  const header = (
    <GradientHeader
      title={hasActivity ? 'Activity & Experiences' : 'Experiences'}
      subtitle={
        hasActivity && entries
          ? `${activity!.totalLogs} rides logged across ${entries.length} experiences.`
          : "Every experience you've completed."
      }
      icon="list"
      onBack={() => navigation.goBack()}
    />
  );

  // R14.5: in-pane loader while completions read is in flight
  if (completionsQuery.isFetching && entries === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="experiences-detail-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R14.5: in-pane error + retry on completions failure
  if (entries === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="experiences-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={EXPERIENCES_ERROR_TITLE}
            body={EXPERIENCES_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void completionsQuery.refetch();
            }}
            testID="experiences-detail-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Sort entries according to active sort option
  const sortedEntries = [...entries].sort((a, b) => {
    if (sortBy === 'visits') {
      const countA = a.repeatCount ?? 1;
      const countB = b.repeatCount ?? 1;
      if (countB !== countA) return countB - countA;
      return a.experienceName.localeCompare(b.experienceName);
    }
    return b.completedOn.localeCompare(a.completedOn);
  });

  const odo = activity ? formatOdometer(activity) : null;
  const productiveDay = activity?.personalRecords
    ? formatProductiveDay(activity.personalRecords.mostProductiveDay)
    : null;
  const marathonRecord = activity?.personalRecords
    ? formatMarathonRecord(activity.personalRecords.marathonRecord)
    : null;

  const firstAttraction = activity?.mostRidden[0];
  const secondAttraction = activity?.mostRidden[1];
  const thirdAttraction = activity?.mostRidden[2];

  return (
    <ScreenContainer>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="experiences-detail-screen"
      >
        {/* TOP SECTION: Activity Overview (Odometer, Podium, Records) */}
        {hasActivity && odo && (
          <View style={styles.activitySection} testID="activity-section">
            {/* Odometer 2x2 Grid */}
            <View style={styles.odometerGrid} testID="odometer-grid">
              <View style={styles.odometerCard} testID="odometer-total-rides">
                <Text style={styles.odometerVal}>{odo.totalRides}</Text>
                <Text style={styles.odometerLbl}>Total Rides Logged</Text>
              </View>
              <View style={styles.odometerCard} testID="odometer-park-days">
                <Text style={styles.odometerVal}>{odo.parkDays}</Text>
                <Text style={styles.odometerLbl}>Distinct Park Days</Text>
              </View>
              <View style={styles.odometerCard} testID="odometer-avg-day">
                <Text style={styles.odometerVal}>{odo.avgPerDay}</Text>
                <Text style={styles.odometerLbl}>Avg Rides / Day</Text>
              </View>
              <View style={styles.odometerCard} testID="odometer-repeat-multiplier">
                <Text style={styles.odometerVal}>{odo.repeatMultiplier}</Text>
                <Text style={styles.odometerLbl}>Repeat Multiplier</Text>
              </View>
            </View>

            {/* Hall of Fame Podium */}
            {activity && activity.mostRidden.length > 0 && (
              <View style={styles.podiumCard} testID="podium-card">
                <View style={styles.podiumHeader}>
                  <Text style={styles.podiumTitle}>👑 Most Ridden Attractions</Text>
                  <Text style={styles.podiumSubtitle}>All-time</Text>
                </View>

                {/* 3-Step Podium (2nd, 1st, 3rd) */}
                <View style={styles.podiumSteps}>
                  {/* 2nd place (Silver) */}
                  {secondAttraction ? (
                    <View style={styles.podiumColumn} testID="podium-step-2">
                      <Text style={styles.podiumMedal}>🥈</Text>
                      <Text style={styles.podiumName} numberOfLines={1}>
                        {secondAttraction.experienceName}
                      </Text>
                      <Text style={styles.podiumRides}>
                        {secondAttraction.count} rides
                      </Text>
                      <View style={[styles.podiumBar, styles.podiumBarSilver]} />
                    </View>
                  ) : null}

                  {/* 1st place (Gold) */}
                  {firstAttraction ? (
                    <View style={styles.podiumColumn} testID="podium-step-1">
                      <Text style={styles.podiumMedal}>🥇</Text>
                      <Text style={[styles.podiumName, styles.podiumNameGold]} numberOfLines={1}>
                        {firstAttraction.experienceName}
                      </Text>
                      <Text style={[styles.podiumRides, styles.podiumRidesGold]}>
                        {firstAttraction.count} rides
                      </Text>
                      <View style={[styles.podiumBar, styles.podiumBarGold]} />
                    </View>
                  ) : null}

                  {/* 3rd place (Bronze) */}
                  {thirdAttraction ? (
                    <View style={styles.podiumColumn} testID="podium-step-3">
                      <Text style={styles.podiumMedal}>🥉</Text>
                      <Text style={styles.podiumName} numberOfLines={1}>
                        {thirdAttraction.experienceName}
                      </Text>
                      <Text style={styles.podiumRides}>
                        {thirdAttraction.count} rides
                      </Text>
                      <View style={[styles.podiumBar, styles.podiumBarBronze]} />
                    </View>
                  ) : null}
                </View>

                {/* Ranks 4 & 5 list if present */}
                {activity!.mostRidden.length > 3 && (
                  <View style={styles.podiumRunnersUp}>
                    {activity!.mostRidden.slice(3, 5).map((attraction, idx) => (
                      <View key={attraction.experienceId} style={styles.runnerUpRow}>
                        <Text style={styles.runnerUpRank}>{idx + 4}.</Text>
                        <Text style={styles.runnerUpName} numberOfLines={1}>
                          {attraction.experienceName}
                        </Text>
                        <Text style={styles.runnerUpCount}>
                          {attraction.count} rides
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Personal Records & Bests */}
            {(productiveDay || marathonRecord) && (
              <View style={styles.recordsSection}>
                <Text style={styles.sectionTitle}>Personal Records & Bests</Text>
                {productiveDay && (
                  <View style={styles.recordCard} testID="record-productive-day">
                    <View style={[styles.recordIcon, { backgroundColor: '#fff4d6' }]}>
                      <Ionicons name="flash" size={18} color="#d4a017" />
                    </View>
                    <View style={styles.recordBody}>
                      <Text style={styles.recordHeadline}>{productiveDay.headline}</Text>
                      <Text style={styles.recordSubtext}>{productiveDay.subtext}</Text>
                    </View>
                  </View>
                )}
                {marathonRecord && (
                  <View style={styles.recordCard} testID="record-marathon">
                    <View style={[styles.recordIcon, { backgroundColor: '#eef2ff' }]}>
                      <Ionicons name="repeat" size={18} color="#3b5bdb" />
                    </View>
                    <View style={styles.recordBody}>
                      <Text style={styles.recordHeadline}>{marathonRecord.headline}</Text>
                      <Text style={styles.recordSubtext}>{marathonRecord.subtext}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Festival Booths */}
        {festivals && festivals.lifetimeCount > 0 && (
          <View style={styles.festivalSection} testID="festival-section">
            <Text style={styles.sectionTitle}>Festival Booths</Text>
            <View style={styles.festivalLifetimeCard} testID="festival-lifetime">
              <Text style={styles.festivalLifetimeVal}>{festivals.lifetimeCount}</Text>
              <Text style={styles.festivalLifetimeLbl}>Festival Booths Visited (Lifetime)</Text>
            </View>
            {festivals.byFestival.map((f) => (
              <View key={f.slug} style={styles.festivalRow} testID={`festival-row-${f.slug}`}>
                <Text style={styles.festivalRowLabel}>{FESTIVAL_SLUG_LABELS[f.slug]}</Text>
                <Text style={styles.festivalRowCount}>{f.count}</Text>
              </View>
            ))}
          </View>
        )}
        {festivals && festivals.lifetimeCount === 0 && (
          <View style={styles.festivalEmptyCard} testID="festival-empty">
            <Text style={styles.festivalEmptyText}>
              No festival booths visited yet — check back during the next EPCOT festival!
            </Text>
          </View>
        )}

        {/* BOTTOM SECTION: Completed Log Journal & Catalog List */}
        <View style={styles.catalogHeader}>
          <Text style={styles.sectionTitle}>
            Completed Journal ({entries.length})
          </Text>
          <View style={styles.sortToggleContainer}>
            <Pressable
              onPress={() => setSortBy('visits')}
              style={[
                styles.sortButton,
                sortBy === 'visits' && styles.sortButtonActive,
              ]}
              testID="sort-toggle-visits"
              accessibilityRole="button"
              accessibilityLabel="Sort by most visited"
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'visits' && styles.sortButtonTextActive,
                ]}
              >
                Most Visited
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSortBy('date')}
              style={[
                styles.sortButton,
                sortBy === 'date' && styles.sortButtonActive,
              ]}
              testID="sort-toggle-date"
              accessibilityRole="button"
              accessibilityLabel="Sort by date"
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'date' && styles.sortButtonTextActive,
                ]}
              >
                Date
              </Text>
            </Pressable>
          </View>
        </View>

        <ExperiencesList
          entries={sortedEntries}
          testIDPrefix="own"
          onOpenExperience={openExperience}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  retryBtn: {
    marginTop: theme.spacing.lg,
    alignSelf: 'center',
  },
  activitySection: {
    gap: theme.spacing.md,
  },
  odometerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  odometerCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: theme.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 2,
  },
  odometerVal: {
    ...theme.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: theme.color.primary,
  },
  odometerLbl: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  podiumCard: {
    backgroundColor: '#201032',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: '#3d1c5c',
  },
  podiumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  podiumTitle: {
    ...theme.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  podiumSubtitle: {
    ...theme.typography.meta,
    fontSize: 10,
    color: '#b7a3d9',
  },
  podiumSteps: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
  },
  podiumColumn: {
    flex: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  podiumMedal: {
    fontSize: 18,
    marginBottom: 2,
  },
  podiumName: {
    ...theme.typography.meta,
    fontSize: 10.5,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  podiumNameGold: {
    fontWeight: '800',
    fontSize: 11,
  },
  podiumRides: {
    ...theme.typography.meta,
    fontSize: 10.5,
    fontWeight: '800',
    color: '#f6c343',
    marginBottom: 4,
  },
  podiumRidesGold: {
    fontSize: 11.5,
  },
  podiumBar: {
    width: '100%',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  podiumBarGold: {
    height: 52,
    backgroundColor: 'rgba(246, 195, 67, 0.3)',
    borderTopWidth: 2,
    borderTopColor: '#f6c343',
  },
  podiumBarSilver: {
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  podiumBarBronze: {
    height: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  podiumRunnersUp: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: theme.spacing.xs,
    gap: 4,
  },
  runnerUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  runnerUpRank: {
    ...theme.typography.meta,
    color: '#b7a3d9',
    fontSize: 11,
    fontWeight: '700',
    width: 16,
  },
  runnerUpName: {
    ...theme.typography.meta,
    color: '#ffffff',
    fontSize: 11,
    flex: 1,
  },
  runnerUpCount: {
    ...theme.typography.meta,
    color: '#f6c343',
    fontSize: 11,
    fontWeight: '700',
  },
  recordsSection: {
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.spacing.sm,
  },
  recordIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBody: {
    flex: 1,
    gap: 1,
  },
  recordHeadline: {
    ...theme.typography.body,
    fontWeight: '700',
    fontSize: 12,
    color: theme.color.textPrimary,
  },
  recordSubtext: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  sortToggleContainer: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  sortButton: {
    paddingVertical: 4,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm - 2,
  },
  sortButtonActive: {
    backgroundColor: theme.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sortButtonText: {
    ...theme.typography.meta,
    fontSize: 10,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  sortButtonTextActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
  festivalSection: {
    gap: theme.spacing.xs,
  },
  festivalLifetimeCard: {
    backgroundColor: theme.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
    gap: 2,
  },
  festivalLifetimeVal: {
    ...theme.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: theme.color.primary,
  },
  festivalLifetimeLbl: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  festivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  festivalRowLabel: {
    ...theme.typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
    flex: 1,
  },
  festivalRowCount: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.primary,
    marginLeft: theme.spacing.sm,
  },
  festivalEmptyCard: {
    backgroundColor: theme.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
  },
  festivalEmptyText: {
    ...theme.typography.meta,
    fontSize: 12,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
});

