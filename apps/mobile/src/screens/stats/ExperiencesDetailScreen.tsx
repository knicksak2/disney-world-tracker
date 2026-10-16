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
import { makeStyles } from '../../theme/makeStyles';
import { withAlpha } from '../../theme/theme';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';

import { useOwnCompletionsQuery } from '../../hooks/useOwnCompletions';
import { ExperiencesList } from '../navigation/ExperiencesList';
import { useOpenExperience } from '../navigation/experienceNavigation';
import {
  formatMarathonRecord,
  formatOdometer,
  formatProductiveDay,
} from './statsView';
import { PODIUM, RECORD_ICON } from './ExperiencesDetailScreen.palette';

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
  const styles = useStyles();
  const t = useAppTheme();
  const recordIcon = usePalette(RECORD_ICON);
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
          <ActivityIndicator color={t.color.primaryFg} />
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
                    <View style={[styles.recordIcon, { backgroundColor: t.color.warningSurface }]}>
                      <Ionicons name="flash" size={18} color={t.color.accentDark} />
                    </View>
                    <View style={styles.recordBody}>
                      <Text style={styles.recordHeadline}>{productiveDay.headline}</Text>
                      <Text style={styles.recordSubtext}>{productiveDay.subtext}</Text>
                    </View>
                  </View>
                )}
                {marathonRecord && (
                  <View style={styles.recordCard} testID="record-marathon">
                    <View style={[styles.recordIcon, { backgroundColor: recordIcon.marathonBg }]}>
                      <Ionicons name="repeat" size={18} color={recordIcon.marathonFg} />
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

const useStyles = makeStyles((t) => ({
  scrollContent: {
    padding: t.spacing.lg,
    gap: t.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
  },
  retryBtn: {
    marginTop: t.spacing.lg,
    alignSelf: 'center',
  },
  activitySection: {
    gap: t.spacing.md,
  },
  odometerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  odometerCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: t.color.surface,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: 2,
  },
  odometerVal: {
    ...t.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  odometerLbl: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  podiumCard: {
    backgroundColor: PODIUM[t.scheme].bg,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    gap: t.spacing.sm,
    borderWidth: 1,
    borderColor: PODIUM[t.scheme].border,
  },
  podiumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  podiumTitle: {
    ...t.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  podiumSubtitle: {
    ...t.typography.meta,
    fontSize: 10,
    color: PODIUM[t.scheme].mutedText,
  },
  podiumSteps: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: t.spacing.xs,
    paddingTop: t.spacing.xs,
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
    ...t.typography.meta,
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.textOnPrimary,
    textAlign: 'center',
  },
  podiumNameGold: {
    fontWeight: '800',
    fontSize: 11,
  },
  podiumRides: {
    ...t.typography.meta,
    fontSize: 10.5,
    fontWeight: '800',
    color: t.color.accent,
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
    backgroundColor: withAlpha(t.color.accent, 0.3),
    borderTopWidth: 2,
    borderTopColor: t.color.accent,
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
    paddingTop: t.spacing.xs,
    gap: 4,
  },
  runnerUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  runnerUpRank: {
    ...t.typography.meta,
    color: PODIUM[t.scheme].mutedText,
    fontSize: 11,
    fontWeight: '700',
    width: 16,
  },
  runnerUpName: {
    ...t.typography.meta,
    color: t.color.textOnPrimary,
    fontSize: 11,
    flex: 1,
  },
  runnerUpCount: {
    ...t.typography.meta,
    color: t.color.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  recordsSection: {
    gap: t.spacing.xs,
  },
  sectionTitle: {
    ...t.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: t.spacing.sm,
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
    ...t.typography.body,
    fontWeight: '700',
    fontSize: 12,
    color: t.color.textPrimary,
  },
  recordSubtext: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  sortToggleContainer: {
    flexDirection: 'row',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
    padding: 2,
  },
  sortButton: {
    paddingVertical: 4,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.sm - 2,
  },
  sortButtonActive: {
    // Dark: lighter than the `surfaceAlt` track so it reads raised (Requirement 9.12).
    backgroundColor: t.scheme === 'dark' ? t.color.borderStrong : t.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sortButtonText: {
    ...t.typography.meta,
    fontSize: 10,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  sortButtonTextActive: {
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  festivalSection: {
    gap: t.spacing.xs,
  },
  festivalLifetimeCard: {
    backgroundColor: t.color.surface,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
    gap: 2,
  },
  festivalLifetimeVal: {
    ...t.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  festivalLifetimeLbl: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  festivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.color.surface,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  festivalRowLabel: {
    ...t.typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textPrimary,
    flex: 1,
  },
  festivalRowCount: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: t.color.primaryFg,
    marginLeft: t.spacing.sm,
  },
  festivalEmptyCard: {
    backgroundColor: t.color.surface,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
  },
  festivalEmptyText: {
    ...t.typography.meta,
    fontSize: 12,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
}));

