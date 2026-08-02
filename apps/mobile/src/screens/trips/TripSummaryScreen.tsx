// Feature: trips, Task 17.6 — Trip_Summary screen
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5
//
// Behavior summary:
//   - This is the Trip_Summary section of the Trip_Detail_View hub (the
//     `TripSummary` route, R18.1/R18.6). It reads `GET /trips/:id/summary`,
//     which returns a `TripSummaryDTO` derived server-side from Trip_Log_Entries,
//     confirmed Rode_With_Tags, and the referenced canonical Ratings (R14.6).
//     The screen renders exactly what the derivation hands it, so all ordering
//     and counting rules live in one place (`services/trips/summary.ts`).
//   - It shows the distinct-Experience count as a non-negative integer that is
//     0 when nothing was completed in the Trip context (R14.1).
//   - It shows up to 5 top-rated Experiences, already ranked by the server
//     (descending mean canonical Rating, then descending rating count, then
//     ascending name, R14.2). When no completed Experience has a referenced
//     canonical Rating the `topRated` list is empty and the screen renders an
//     empty-state indication that no rated Experiences exist (R14.3).
//   - It shows, per Trip_Member, their Trip_Log_Entry count (R14.4) and their
//     confirmed Rode_With_Tag count (R14.5), each 0 where the Member has none.
//
// Loading/error/timeout handling mirrors `TripFeedScreen` / `TripsListScreen`:
// a loading indication while in flight and under 10s, an error indication with
// Retry on failure or timeout, enforced with a per-attempt `AbortController`
// and `retry: false`. Membership failures collapse to the non-disclosing
// "no longer available" copy (R14.8, R15.2). Styling follows the shared
// "Magical / Whimsical" theme (compact gradient header with a back control,
// themed cards), mirroring the sibling section screens.

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import { Ionicons } from '@expo/vector-icons';

import type { TripSummaryDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripSummary'>;

/** Wire shape of `GET /trips/:id/summary`: the derived Trip_Summary (R14.6). */
type TripSummaryResponse = TripSummaryDTO;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for the Trip_Summary read; scoped per Trip. */
export const tripSummaryKeys = {
  summary: (tripId: string) => ['trips', 'summary', tripId] as const,
};

/**
 * A retrieval that does not complete within 10 seconds is treated as a failure
 * rather than surfaced as an empty summary. Enforced per attempt via an
 * `AbortController`, mirroring the Trips list and feed reads.
 */
const SUMMARY_LOAD_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripSummaryScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;

  const summaryQuery = useQuery<TripSummaryResponse, ApiError>({
    queryKey: tripSummaryKeys.summary(tripId),
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, SUMMARY_LOAD_TIMEOUT_MS);
      try {
        return await apiRequest<TripSummaryResponse>(
          'GET',
          `/trips/${tripId}/summary`,
          undefined,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    retry: false,
  });

  const backToHub = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripDetail', { tripId });
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (summaryQuery.isLoading && summaryQuery.data === undefined) {
    return (
      <ScreenContainer>
        <SummaryHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-summary-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Load error (membership failures collapse to trip_forbidden — R14.8/R15.2)
  // -------------------------------------------------------------------------

  if (summaryQuery.isError && summaryQuery.data === undefined) {
    return (
      <ScreenContainer>
        <SummaryHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-summary-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this summary"
            body={readErrorMessage(summaryQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void summaryQuery.refetch();
            }}
            testID="trip-summary-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const summary = summaryQuery.data ?? {
    distinctExperienceCount: 0,
    topRated: [],
    perMember: [],
    plannedTotalCount: 0,
    plannedCompletedCount: 0,
  };

  return (
    <ScreenContainer>
      <SummaryHeader onBack={backToHub} />
      <ScrollView contentContainerStyle={styles.content} testID="trip-summary">
        {/* Distinct-Experience count (R14.1). */}
        <Card style={styles.statCard} testID="trip-summary-distinct">
          <View style={styles.statIconCircle}>
            <Ionicons name="sparkles" size={20} color={theme.color.primary} />
          </View>
          <View style={styles.statText}>
            <Text style={styles.statValue} testID="trip-summary-distinct-count">
              {summary.distinctExperienceCount}
            </Text>
            <Text style={styles.statLabel}>
              {summary.distinctExperienceCount === 1
                ? 'distinct Experience completed'
                : 'distinct Experiences completed'}
            </Text>
          </View>
        </Card>

        {/*
          Planned-vs-completed counts (Planned List Completion Sync R5.4).
          Rides the same `GET /trips/:id/summary` read — no new fetch. The DTO
          already reports `0`/`0` for an empty Planned_List, so the values are
          rendered as-is.
        */}
        <Card style={styles.statCard} testID="trip-summary-planned">
          <View style={styles.statIconCircle}>
            <Ionicons name="map" size={20} color={theme.color.primary} />
          </View>
          <View style={styles.statText}>
            <Text style={styles.statValue} testID="trip-summary-planned-count">
              {summary.plannedCompletedCount} of {summary.plannedTotalCount}
            </Text>
            <Text style={styles.statLabel}>planned Experiences completed</Text>
          </View>
        </Card>

        {/* Up to 5 top-rated Experiences, or the empty state (R14.2, R14.3). */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top-rated moments</Text>
          {summary.topRated.length === 0 ? (
            <View testID="trip-summary-toprated-empty">
              <EmptyState
                icon="star-outline"
                title="No rated Experiences yet"
                body="Once Members rate the Experiences they completed on this trip, the highest-rated ones will shine here."
              />
            </View>
          ) : (
            <View style={styles.list} testID="trip-summary-toprated">
              {summary.topRated.map((exp, index) => (
                <Card
                  key={exp.experienceId}
                  style={styles.rankRow}
                  testID={`trip-summary-toprated-${exp.experienceId}`}
                >
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.rankBody}>
                    <Text style={styles.rankName} numberOfLines={2}>
                      {exp.experienceName}
                    </Text>
                    <Text style={styles.rankMeta}>
                      {formatMeanRating(exp.meanRating)} {'\u00B7'}{' '}
                      {exp.ratingCount === 1
                        ? '1 rating'
                        : `${exp.ratingCount} ratings`}
                    </Text>
                  </View>
                  <View style={styles.ratingPill}>
                    <Ionicons name="star" size={14} color={theme.color.primary} />
                    <Text style={styles.ratingPillText}>
                      {formatMeanRating(exp.meanRating)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>

        {/* Per-Member contribution counts (R14.4, R14.5). */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Member contributions</Text>
          {summary.perMember.length === 0 ? (
            <View testID="trip-summary-permember-empty">
              <EmptyState
                icon="people-outline"
                title="No contributions yet"
                body="Log entries and confirmed rode-with tags will show up here for each Member."
              />
            </View>
          ) : (
            <View style={styles.list} testID="trip-summary-permember">
              {summary.perMember.map((member) => (
                <Card
                  key={member.memberId}
                  style={styles.memberRow}
                  testID={`trip-summary-member-${member.memberId}`}
                >
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.displayName}
                  </Text>
                  <View style={styles.memberStats}>
                    <View style={styles.memberStat}>
                      <Text
                        style={styles.memberStatValue}
                        testID={`trip-summary-member-${member.memberId}-logs`}
                      >
                        {member.logEntryCount}
                      </Text>
                      <Text style={styles.memberStatLabel}>
                        {member.logEntryCount === 1 ? 'log entry' : 'log entries'}
                      </Text>
                    </View>
                    <View style={styles.memberStat}>
                      <Text
                        style={styles.memberStatValue}
                        testID={`trip-summary-member-${member.memberId}-tags`}
                      >
                        {member.confirmedTagCount}
                      </Text>
                      <Text style={styles.memberStatLabel}>
                        {member.confirmedTagCount === 1
                          ? 'confirmed tag'
                          : 'confirmed tags'}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Shared compact header for every state of the Trip_Summary screen. */
function SummaryHeader({ onBack }: { readonly onBack: () => void }): JSX.Element {
  return (
    <GradientHeader
      title="Trip Summary"
      subtitle="Look back on what the group accomplished."
      icon="ribbon"
      compact
      onBack={onBack}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a mean canonical Rating for display. Ratings are whole numbers 1–10
 * (R12.4), so a mean is shown to at most one decimal place, dropping a trailing
 * `.0` so a straight integer mean reads cleanly.
 */
function formatMeanRating(mean: number): string {
  if (!Number.isFinite(mean)) {
    return '—';
  }
  const rounded = Math.round(mean * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Map a read error to user-facing copy (non-disclosure, R14.8/R15.2). */
function readErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  statIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
  },
  statText: {
    flexShrink: 1,
    gap: theme.spacing.xs,
  },
  statValue: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  statLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  list: {
    gap: theme.spacing.md,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
  },
  rankBadgeText: {
    ...theme.typography.meta,
    color: theme.color.primary,
    fontWeight: '700',
  },
  rankBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  rankName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rankMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  ratingPillText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '700',
  },
  memberRow: {
    gap: theme.spacing.sm,
  },
  memberName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  memberStats: {
    flexDirection: 'row',
    gap: theme.spacing.xl,
  },
  memberStat: {
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
  },
  memberStatValue: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  memberStatLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
