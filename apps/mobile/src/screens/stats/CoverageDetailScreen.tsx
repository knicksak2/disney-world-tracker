/**
 * CoverageDetailScreen — the Own_Surface coverage drill-in
 * (stats-experience-redesign task 7.1; restyled to the design mockup).
 *
 * A focused, bounded detail screen: an "at a glance" header (a small overall
 * completion ring + a summary of parks complete and the closest park), a
 * `Lens_Switcher` offering exactly the five lenses **Parks · Categories · Areas
 * · Lands · Resorts** (exactly one active, **Parks** default, R5.1, R5.2), and
 * the active lens's ranked-bar content via the shared `CoverageSection` (only
 * the active lens is rendered, R5.3).
 *
 * ## One source of truth (R4.2, R4.3, R14.3)
 *
 * The screen reads the SAME cached `['me-stats', { percentile: true }]` query
 * the Overview hub issues (identical query key), never receiving a
 * `StatsResponse` through navigation params (R4.2, R3.5). Entered cold it shows
 * the same view-level loading and error-with-Retry treatment against that
 * shared query (R14.3); Retry re-issues only the shared stats read.
 *
 * The optional `focus` route param (a small serializable hint incl. `'resorts'`,
 * R3.5) selects the initial lens so a deep-link can land on a specific lens.
 *
 * Validates: Requirements 4.2, 4.3, 5.1, 5.2, 5.3, 5.6, 5.7, 5.11, 6.1, 6.2,
 * 6.3, 6.4, 14.3, 16.4
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
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import { ProgressRing } from '../../theme/charts';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { theme } from '../../theme/theme';
import { buildCoverageGlance, displayedPercentLabel, type CoverageFocus } from './statsView';
import { CoverageSection, type CoverageLens } from './components';

// ---------------------------------------------------------------------------
// Shared cached stats query (R4.2, R4.3)
// ---------------------------------------------------------------------------

export const SHARED_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** 30 seconds — matches the hub's freshness window (R4.3). */
const STATS_STALE_TIME_MS = 30 * 1000;

/** Fetch the opted-in stats snapshot (`?percentile=true`, R10.1). */
function fetchSharedStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>('GET', '/me/stats?percentile=true');
}

const STATS_ERROR_TITLE = 'Couldn\u2019t load coverage';
const STATS_ERROR_BODY = 'Couldn\u2019t load your coverage. Please try again.';

// ---------------------------------------------------------------------------
// Lenses (R5.1)
// ---------------------------------------------------------------------------

const LENSES: readonly CoverageLens[] = [
  'parks',
  'categories',
  'areas',
  'lands',
  'resorts',
];

const LENS_LABELS: { readonly [lens in CoverageLens]: string } = {
  parks: 'Parks',
  categories: 'Categories',
  areas: 'Areas',
  lands: 'Lands',
  resorts: 'Resorts',
};

/** Map the optional deep-link `focus` hint onto the lens that owns it. */
function lensForFocus(focus: CoverageFocus | undefined): CoverageLens {
  switch (focus) {
    case 'categories':
      return 'categories';
    case 'areas':
    case 'resortAreas':
      return 'areas';
    case 'lands':
      return 'lands';
    case 'resort':
    case 'resorts':
      return 'resorts';
    case 'parks':
    case undefined:
    default:
      return 'parks';
  }
}

// ---------------------------------------------------------------------------
// Route typing
// ---------------------------------------------------------------------------

type CoverageDetailRoute = RouteProp<
  { CoverageDetail: { focus?: CoverageFocus } | undefined },
  'CoverageDetail'
>;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CoverageDetailScreen(): JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<CoverageDetailRoute>();
  const focus = route.params?.focus;

  const query = useQuery<StatsResponse, ApiError>({
    queryKey: SHARED_STATS_QUERY_KEY,
    queryFn: fetchSharedStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  const [lens, setLens] = React.useState<CoverageLens>(() => lensForFocus(focus));

  const header = (
    <GradientHeader title="Coverage" icon="map" compact onBack={() => navigation.goBack()} />
  );

  // R14.3: cold deep-link with no cached snapshot — view-level loading.
  if (query.isFetching && query.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="coverage-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R14.3: failed cold read → error + Retry (re-issues only the shared query).
  if (query.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="coverage-error">
          <EmptyState icon="cloud-offline-outline" title={STATS_ERROR_TITLE} body={STATS_ERROR_BODY} />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void query.refetch();
            }}
            testID="coverage-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const { coverage } = query.data;
  const glance = buildCoverageGlance(coverage);

  return (
    <ScreenContainer>
      {header}
      <ScrollView contentContainerStyle={styles.scrollContent} testID="coverage-screen">
        {/* At a glance: small overall ring + parks-complete / closest summary. */}
        <Card style={styles.glanceCard} testID="coverage-glance">
          <ProgressRing
            percent={glance.overall.percent}
            size={64}
            strokeWidth={7}
            centerLabel={`${displayedPercentLabel(glance.overall)}%`}
            accessibilityLabel={`Overall completion ${displayedPercentLabel(glance.overall)} percent`}
          />
          <View style={styles.glanceText}>
            <Text style={styles.glanceSummary}>{glance.summary}</Text>
            {glance.closest !== null ? (
              <Text style={styles.glanceClosest}>
                Closest: {glance.closest.label} · {glance.closest.remaining} to go
              </Text>
            ) : (
              <Text style={styles.glanceClosest}>
                {glance.overall.completed} of {glance.overall.total} complete
              </Text>
            )}
          </View>
        </Card>

        {/* Lens_Switcher: a single segmented control — exactly one active,
            Parks default (R5.1, R5.2). */}
        <View style={styles.seg} testID="coverage-lens-switcher">
          {LENSES.map((option) => {
            const active = lens === option;
            return (
              <Pressable
                key={option}
                onPress={() => setLens(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`coverage-lens-${option}`}
                style={[styles.segItem, active && styles.segItemActive]}
              >
                <Text
                  style={[styles.segText, active && styles.segTextActive]}
                  numberOfLines={1}
                >
                  {LENS_LABELS[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Only the active lens is rendered (R5.3). */}
        <Card style={styles.lensCard}>
          <CoverageSection coverage={coverage} lens={lens} testID={`coverage-${lens}`} />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  glanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
  },
  glanceText: {
    flexShrink: 1,
    gap: 2,
  },
  glanceSummary: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  glanceClosest: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 4,
    gap: 2,
  },
  segItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: theme.radius.sm,
  },
  segItemActive: {
    backgroundColor: theme.color.surface,
    ...theme.shadow.card,
  },
  segText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  segTextActive: {
    color: theme.color.primary,
  },
  lensCard: {
    paddingVertical: theme.spacing.sm,
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
});
