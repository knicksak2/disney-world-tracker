/**
 * RatingsDetailScreen — the Ratings drill-in of the Stats tab
 * (stats-experience-redesign task 7.3).
 *
 * A focused, bounded detail screen pushed onto the `StatsStack` from the
 * Overview hub's Ratings highlight card. It presents the full ratings story via
 * the shared `RatingsSection` building block (task 6.3): when
 * `ratings.sufficient` is true it renders the RICH view (average dial, 1–10
 * distribution histogram, highest/lowest hero cards, per-park/per-category
 * averages, R8.1); otherwise it renders the UNLOCK empty state showing
 * `ratedCompletionsCount` of `MINIMUM_RATINGS_THRESHOLD` (R8.2). All gating
 * discipline (never reading the gated fields when `!sufficient`, R8.3) lives in
 * `RatingsSection`.
 *
 * One source of truth (R4.2, R4.3): the screen reads the SAME cached
 * `['me-stats', { percentile: true }]` query the Overview hub issues rather
 * than receiving a `StatsResponse` through navigation params. When the hub has
 * already populated that cache entry within its freshness window, mounting this
 * screen renders from the identical cached snapshot with no additional fetch
 * (P12). Entered as a cold deep-link with no cached snapshot, the screen issues
 * the query itself and shows the same loading → error/Retry treatment against
 * that shared query (R14.3) — mirroring `CoverageDetailScreen`.
 *
 * The hero cards can open an experience: `onOpenExperience` is wired to the
 * shared `useOpenExperience` cross-stack navigation so tapping the
 * highest/lowest card pushes the Catalog `ExperienceDetail` (R15.2).
 *
 * Validates: Requirements 4.2, 8.1, 8.2, 8.3, 8.4, 14.3
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { theme } from '../../theme/theme';

import { RatingsSection } from './components/RatingsSection';
import { useOpenExperience } from '../navigation/experienceNavigation';

// ---------------------------------------------------------------------------
// Shared cached stats query (one source of truth — R4.1, R4.2)
// ---------------------------------------------------------------------------

/**
 * The shared Own_Stats query key. Byte-identical to the tuple the Overview hub
 * registers, so the hub and every stat detail screen read one cache entry
 * (R4.2, R4.5). The `{ percentile: true }` variant matches the hub's opt-in
 * `?percentile=true` request (R10.1); the ratings detail ignores the percentile
 * data but shares the entry so no second network round-trip is incurred (P12).
 */
const OWN_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** 30 seconds — mirrors the hub's staleness window so the shared entry behaves
 * identically regardless of which surface primed it (R4.3). */
const STATS_STALE_TIME_MS = 30 * 1000;

const RATINGS_ERROR_TITLE = 'Couldn\u2019t load ratings';
const RATINGS_ERROR_BODY = 'Couldn\u2019t load your stats. Please try again later.';

/** Issue the opt-in `GET /me/stats?percentile=true` request (R10.1). */
async function fetchOwnStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>('GET', '/me/stats?percentile=true');
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function RatingsDetailScreen(): JSX.Element {
  const navigation = useNavigation();

  // Read the shared cached snapshot (R4.2). A warm cache renders with no
  // refetch (P12); a cold deep-link triggers the fetch here (R14.3).
  const query = useQuery<StatsResponse, ApiError>({
    queryKey: OWN_STATS_QUERY_KEY,
    queryFn: fetchOwnStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  // Cross-stack navigation into the Catalog tab's ExperienceDetail, threaded
  // into the ratings hero cards (highest / lowest) so they open the experience
  // (R15.2). Mounted at the screen level so its repeat-tap guard spans the
  // whole session.
  const openExperience = useOpenExperience();

  const header = (
    <GradientHeader
      title="Ratings"
      subtitle="How you've rated your Disney experiences."
      icon="star"
      onBack={() => navigation.goBack()}
    />
  );

  // R14.3: cold deep-link with no cached snapshot — while the shared query is in
  // flight with no data, show a view-level loading indicator. `isFetching`
  // (rather than `isLoading`) so a re-issued request after a retry shows the
  // loader again.
  if (query.isFetching && query.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="ratings-detail-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R14.3: any shared-query failure with no prior data gates the view to an
  // error message plus a Retry control that re-issues only the shared stats
  // query.
  if (query.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="ratings-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={RATINGS_ERROR_TITLE}
            body={RATINGS_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void query.refetch();
            }}
            testID="ratings-detail-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Success — render the shared ratings section from the cached snapshot. The
  // section gates internally on `ratings.sufficient` (rich vs. unlock), so this
  // screen simply hands it the `ratings` object and the open-experience
  // affordance (R8.1–R8.4).
  const stats = query.data;

  return (
    <ScreenContainer>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="ratings-detail-screen"
      >
        <RatingsSection
          ratings={stats.ratings}
          onOpenExperience={openExperience}
          testID="ratings-detail-section"
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
    gap: theme.spacing.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  retryBtn: {
    marginTop: theme.spacing.lg,
  },
});
