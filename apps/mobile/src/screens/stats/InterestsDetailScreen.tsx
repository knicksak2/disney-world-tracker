/**
 * InterestsDetailScreen — the Interests drill-in of the Stats tab
 * (stats-experience-redesign task 7.5).
 *
 * A focused, bounded detail screen pushed onto the `StatsStack` from the
 * Overview hub's Interests highlight card. It presents the per-facet
 * ("interests") coverage story via the shared `InterestsSection` building block
 * (task 6.5): the `coverage.byFacetValue` entries are rendered as a ranked list
 * of `FacetCoverageTile`s ordered for display through the pure
 * `sortFacetsForDisplay` transform (percent desc, total desc, case-insensitive
 * label asc — R9.2), one tile per facet (R9.1). When there are no facets it
 * falls back to a compact empty state (R9.3). All ordering/empty-state
 * discipline lives inside `InterestsSection`.
 *
 * One source of truth (R4.2, R4.3): the screen reads the SAME cached
 * `['me-stats', { percentile: true }]` query the Overview hub issues rather
 * than receiving a `StatsResponse` through navigation params. When the hub has
 * already populated that cache entry within its freshness window, mounting this
 * screen renders from the identical cached snapshot with no additional fetch
 * (P12). Entered as a cold deep-link with no cached snapshot, the screen issues
 * the query itself and shows the same loading → error/Retry treatment against
 * that shared query (R14.3) — mirroring `CoverageDetailScreen` and
 * `RatingsDetailScreen`.
 *
 * Validates: Requirements 4.2, 9.1, 9.2, 9.3, 14.3
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

import { InterestsSection } from './components';

// ---------------------------------------------------------------------------
// Shared cached stats query (one source of truth — R4.2, R4.3)
// ---------------------------------------------------------------------------

/**
 * The shared Own_Stats query key. Byte-identical to the tuple the Overview hub
 * registers, so the hub and every stat detail screen read one cache entry
 * (R4.2, R4.5). The `{ percentile: true }` variant matches the hub's opt-in
 * `?percentile=true` request (R10.1); the interests detail ignores the
 * percentile data but shares the entry so no second network round-trip is
 * incurred (P12).
 */
const OWN_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** 30 seconds — mirrors the hub's staleness window so the shared entry behaves
 * identically regardless of which surface primed it (R4.3). */
const STATS_STALE_TIME_MS = 30 * 1000;

const INTERESTS_ERROR_TITLE = 'Couldn\u2019t load interests';
const INTERESTS_ERROR_BODY = 'Couldn\u2019t load your stats. Please try again later.';

/** Issue the opt-in `GET /me/stats?percentile=true` request (R10.1). */
async function fetchOwnStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>('GET', '/me/stats?percentile=true');
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function InterestsDetailScreen(): JSX.Element {
  const navigation = useNavigation();

  // Read the shared cached snapshot (R4.2). A warm cache renders with no
  // refetch (P12); a cold deep-link triggers the fetch here (R14.3).
  const query = useQuery<StatsResponse, ApiError>({
    queryKey: OWN_STATS_QUERY_KEY,
    queryFn: fetchOwnStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  const header = (
    <GradientHeader
      title="Interests"
      subtitle="The kinds of experiences you explore most."
      icon="sparkles"
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
        <View style={styles.center} testID="interests-detail-loading">
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
        <View style={styles.center} testID="interests-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={INTERESTS_ERROR_TITLE}
            body={INTERESTS_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void query.refetch();
            }}
            testID="interests-detail-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Success — render the shared interests section from the cached snapshot. The
  // section orders the facets via `sortFacetsForDisplay` and falls back to a
  // compact empty state when there are none (R9.1–R9.3).
  const stats = query.data;

  return (
    <ScreenContainer>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="interests-detail-screen"
      >
        <InterestsSection
          facets={stats.coverage.byFacetValue}
          testID="interests-detail-section"
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
