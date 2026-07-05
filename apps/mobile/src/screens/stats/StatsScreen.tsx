/**
 * StatsScreen — the Overview hub (stats-experience-redesign task 8.1).
 *
 * The Stats tab landing surface and the initial route of the `StatsStack`. A
 * compact, roughly screen-height hub that leads with a hero overall-completion
 * ring, an opt-in percentile brag banner, and a small curated set (3–4) of
 * tappable highlight / entry cards that drill into the focused detail screens.
 *
 * ## One source of truth (R4.1)
 *
 * The hub issues **exactly one** query keyed `['me-stats', { percentile: true }]`
 * (`GET /me/stats?percentile=true`, R10.1) and derives its hero ring, percentile
 * banner, and highlight cards from that single cached `StatsResponse` snapshot.
 * Every stat detail screen re-declares the identical query key, so drilling in
 * (or a background refetch) reads the same cache entry with no second fetch
 * (R4.1) — the hub never passes a `StatsResponse` through navigation params.
 *
 * ## Composition
 *
 *   - **OverallHeroCard** — the hero overall-completion `ProgressRing` from
 *     `coverage.overall`, celebratory at 100% (R1.1, R1.2).
 *   - **PercentileBanner** — the "you're ahead of X%" brag, shown iff
 *     `percentileRank` is a number and hidden when absent / `percentileUnavailable`
 *     (which never blocks any other section) (R10.3, R10.4, R10.5, R14.4).
 *   - **HighlightCard × N** — the curated cards from `buildOverviewHighlights`,
 *     rendered in the returned order (R1.3); each is a button that navigates to
 *     the matching `StatsStack` detail route (R1.4, R1.5).
 *
 * The header keeps the progress `Share_Entry_Point`: a themed share control that
 * opens the `Share_Composer` modal pre-populated with the migrated
 * `buildProgressShareParams` projection (nested `coverage.*` shape, R13.1),
 * disabled until the stats read has data to project.
 *
 * ## Loading / error (R14.1, R14.2)
 *
 * While the shared query is in flight with no cached data the hub shows a
 * view-level loading indicator (R14.1); on failure with no data it shows a
 * view-level error card with a Retry control that re-issues only the stats query
 * (R14.2). `percentileUnavailable` is treated purely as a data condition and
 * never gates the view (R14.4).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 10.1, 10.3, 10.4, 10.5,
 * 12.1, 13.1, 14.1, 14.2, 14.4, 16.1, 16.2, 16.3, 16.4
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import type {
  RootStackParamList,
  ShareComposerParams,
} from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import {
  HighlightCard,
  OverallHeroCard,
  PercentileBanner,
} from './components';
import {
  buildOverviewHighlights,
  buildProgressShareParams,
  type CoverageFocus,
  type HighlightTarget,
} from './statsView';
import { isProgressShareEntryEnabled } from './progressShareEntry';

// ---------------------------------------------------------------------------
// Shared cached stats query (one source of truth — R4.1)
// ---------------------------------------------------------------------------

/**
 * The shared Own_Stats query key. Byte-identical to the tuple every stat detail
 * screen re-declares, so the hub and all detail screens read one
 * `['me-stats', { percentile: true }]` cache entry (R4.1). The
 * `{ percentile: true }` variant matches the opt-in `?percentile=true` request
 * (R10.1).
 */
const OWN_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** 30 seconds — the shared freshness window all stats surfaces observe (R4.3). */
const STATS_STALE_TIME_MS = 30 * 1000;

const STATS_ERROR_TITLE = 'Couldn\u2019t load stats';
const STATS_ERROR_BODY = 'Couldn\u2019t load stats. Please try again later.';

/** Issue the opt-in `GET /me/stats?percentile=true` request (R10.1). */
async function fetchOwnStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>('GET', '/me/stats?percentile=true');
}

// ---------------------------------------------------------------------------
// Navigation typing
// ---------------------------------------------------------------------------

/**
 * Local mirror of the `StatsStackParamList` (wired in task 9.1) so the hub
 * type-checks standalone. Only small serializable hint params travel through
 * navigation — never a `StatsResponse` (R3.5); the `CoverageDetail` `focus`
 * union mirrors `CoverageFocus`.
 */
type StatsHubNavParamList = {
  StatsOverview: undefined;
  CoverageDetail: { focus?: CoverageFocus } | undefined;
  RatingsDetail: undefined;
  InterestsDetail: undefined;
  ExperiencesDetail: undefined;
};

/**
 * Drill into the `StatsStack` detail route named by a highlight's `target`
 * (R1.5). Only `CoverageDetail` carries an optional `focus` hint; the rest are
 * param-less.
 */
function navigateToHighlight(
  navigation: NavigationProp<StatsHubNavParamList>,
  target: HighlightTarget,
): void {
  switch (target.route) {
    case 'CoverageDetail':
      navigation.navigate(
        'CoverageDetail',
        target.focus !== undefined ? { focus: target.focus } : undefined,
      );
      return;
    case 'RatingsDetail':
      navigation.navigate('RatingsDetail');
      return;
    case 'InterestsDetail':
      navigation.navigate('InterestsDetail');
      return;
    case 'ExperiencesDetail':
      navigation.navigate('ExperiencesDetail');
      return;
  }
}

// ---------------------------------------------------------------------------
// Share_Entry_Point
// ---------------------------------------------------------------------------

/**
 * Hook returning `openShareComposer(params)`, which opens the `Share_Composer`
 * modal pre-populated with a `progress` payload:
 *
 *   navigation.navigate('ShareComposer', params)
 *
 * The composer lives on the root stack (above `MainTabs`), so a `navigate`
 * from the Stats tab bubbles up past the tab / Stats stack navigators to
 * present it modally and returns here via `goBack()`.
 *
 * A `useRef` in-flight guard collapses a burst of taps before the modal is
 * presented into a single navigation so no duplicate composer is stacked; it
 * is cleared whenever the hub regains focus (including on returning from the
 * composer), re-arming a deliberate later share.
 */
function useOpenShareComposer(): (params: ShareComposerParams) => void {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const inFlightRef = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      inFlightRef.current = false;
    }, []),
  );

  return React.useCallback(
    (params: ShareComposerParams) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      navigation.navigate('ShareComposer', params);
    },
    [navigation],
  );
}

/**
 * The hub's `Share_Entry_Point`. A themed header control that opens the
 * `Share_Composer` with the viewer's progress snapshot. It is disabled while
 * the stats read has not yet produced data; in that state its press is inert
 * and it is exposed to assistive tech as a disabled button.
 */
function ShareProgressButton({
  disabled,
  onPress,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Share your progress"
      accessibilityState={{ disabled }}
      hitSlop={8}
      testID="stats-share-button"
      style={({ pressed }) => [
        styles.shareBtn,
        pressed && !disabled && styles.shareBtnPressed,
        disabled && styles.shareBtnDisabled,
      ]}
    >
      <Ionicons
        name="share-outline"
        size={22}
        color={theme.color.textOnPrimary}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StatsScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp<StatsHubNavParamList>>();

  // The single shared stats query — the one source of truth every detail screen
  // reads from (R4.1). Opts into the percentile brag (`?percentile=true`, R10.1).
  const query = useQuery<StatsResponse, ApiError>({
    queryKey: OWN_STATS_QUERY_KEY,
    queryFn: fetchOwnStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  // Opens the Share_Composer modal on the root stack with the progress
  // snapshot. Mounted at the screen level so its in-flight guard spans the
  // whole Screen_Session.
  const openShareComposer = useOpenShareComposer();

  // The progress Share_Entry_Point. Disabled until the stats read has data to
  // project; once present the press builds the `progress` params from the
  // nested `coverage.*` displayed percentages (R13.1).
  const stats = query.data;
  const shareControl = (
    <ShareProgressButton
      disabled={!isProgressShareEntryEnabled(stats === undefined)}
      onPress={() => {
        if (stats !== undefined) {
          openShareComposer(buildProgressShareParams(stats));
        }
      }}
    />
  );

  // R14.1: while the shared query is in flight with no prior data, show the
  // view-level loading indicator. `isFetching` (rather than `isLoading`) so a
  // re-issued request after a retry shows the loader again.
  if (query.isFetching && query.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" right={shareControl} />
        <View style={styles.center} testID="stats-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R14.2: any stats-read failure with no prior data gates the whole view to an
  // error message plus a Retry control that re-issues only the stats query.
  if (stats === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" right={shareControl} />
        <View style={styles.center} testID="stats-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={STATS_ERROR_TITLE}
            body={STATS_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void query.refetch();
            }}
            testID="stats-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Success — derive the hero, percentile banner, and curated highlight cards
  // from the single cached snapshot (R1.1, R1.3, R4.1).
  const highlights = buildOverviewHighlights(stats);

  return (
    <ScreenContainer>
      <GradientHeader
        title="Your Stats"
        subtitle="Track how much magic you've experienced."
        icon="stats-chart"
        right={shareControl}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="stats-screen"
      >
        {/* Hero overall-completion ring (R1.1, R1.2). */}
        <OverallHeroCard overall={stats.coverage.overall} testID="stats-hero" />

        {/* Opt-in percentile brag — renders null when absent / unavailable,
            never blocking the sections below (R10.3, R10.4, R10.5, R14.4). */}
        <PercentileBanner stats={stats} testID="stats-percentile-banner" />

        {/* Curated highlight / entry cards in the order returned (R1.3); each
            drills into its detail route (R1.4, R1.5). */}
        {highlights.map((highlight) => (
          <HighlightCard
            key={highlight.id}
            highlight={highlight}
            onPress={() => navigateToHighlight(navigation, highlight.target)}
            testID={`stats-highlight-${highlight.id}`}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Migration re-export
// ---------------------------------------------------------------------------

/**
 * Re-export the migrated progress-share projection from its canonical home
 * (`statsView`) so existing importers of `buildProgressShareParams` from this
 * module keep resolving during the migration (task 11.1 repoints them). The
 * flat inline projection that previously lived here has been removed in favour
 * of the nested `coverage.*` implementation.
 */
export { buildProgressShareParams } from './statsView';

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
  shareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.primary,
  },
  shareBtnPressed: {
    opacity: 0.85,
  },
  shareBtnDisabled: {
    opacity: 0.4,
  },
});
