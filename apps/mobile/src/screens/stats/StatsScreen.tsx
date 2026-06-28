/**
 * StatsScreen — own completion statistics (task 17.4).
 *
 * Renders the User's overall, per-Park, and per-Experience_Category
 * completion percentages from `GET /me/stats`. The server already does
 * the math (rounding to one decimal place, capping at 100.0, treating
 * a zero denominator as 0.0 / count 0); this screen just lays the
 * numbers out as themed cards.
 *
 * Behavior:
 *
 *   - **Fetch.** A single `useQuery` against `GET /me/stats` via
 *     `apiRequest`. The response shape matches `StatsResponse` from
 *     `apps/api/src/services/stats/routes.ts`:
 *
 *       {
 *         overall:           { completed, total, percent },
 *         byPark:            { [Park]:     { completed, total, percent } },
 *         byCategory:        { [Category]: { completed, total, percent } },
 *         byParkAndCategory: { [Park]: { [Category]: { … } } }
 *       }
 *
 *     We only render `overall`, `byPark`, and `byCategory` here; the
 *     fourth dimension exists for future drill-downs.
 *
 *   - **Loading state.** While the first fetch is in flight, the screen
 *     shows an `ActivityIndicator` (R3.4 — "within 2 seconds" — is the
 *     server's responsibility; we just signal progress to the user).
 *
 *   - **Error state.** Any non-2xx surfaces as the copy
 *     "Couldn't load stats. Please try again later." with no automatic
 *     retry — react-query's default retry is disabled at the App-level
 *     `defaultOptions.queries.retry: 1`, and we leave that behavior in
 *     place rather than overriding it here.
 *
 *   - **Rendering.** Percentages are displayed with one decimal place
 *     using `formatPercent` (e.g. 42.5%, 100.0%, 0.0%). Counts render
 *     as "X of Y experiences" / "X of Y" on each card. Per-Park and
 *     per-Category cards carry their accent hue / category glyph from
 *     the theme.
 *
 *   - **Stable ordering.** The screen iterates over the `PARKS` and
 *     `EXPERIENCE_CATEGORIES` constant tuples from `@dwt/shared` so the
 *     list order matches the canonical enum order rather than depending
 *     on JSON object key ordering. This also means a Park or Category
 *     with zero Experiences (R3.6, R3.7) still appears in the list with
 *     "0 of 0" and "0.0%" — the user sees a stable, predictable layout.
 *
 * Styling: uses the shared "Magical / Whimsical" theme — a gradient
 * hero header, the overall completion as a hero stat in a `Card`, and
 * per-Park / per-Category breakdowns as themed cards. See
 * `theme/theme.ts` and `theme/components.tsx`.
 *
 * Validates: Requirements R3.1, R3.2, R3.3, R3.4
 */

import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

/**
 * One row of a stats roll-up. Mirrors `StatsBreakdown` in
 * `apps/api/src/services/stats/routes.ts`. `percent` is already in
 * `[0.0, 100.0]` to one decimal place; `formatPercent` re-applies
 * `toFixed(1)` for display so values that happen to be whole numbers
 * still render with the trailing decimal.
 */
interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

/**
 * Response shape for `GET /me/stats`. Modeled inline rather than
 * importing `StatsResponse` from the API package because the mobile
 * client must not depend on backend internals; the shape is part of the
 * public route contract.
 */
interface StatsResponse {
  readonly overall: StatsBreakdown;
  readonly byPark: { readonly [park in Park]: StatsBreakdown };
  readonly byCategory: {
    readonly [category in ExperienceCategory]: StatsBreakdown;
  };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: StatsBreakdown;
    };
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 30 seconds — stats are cheap to refetch and benefit from being fresh. */
const STATS_STALE_TIME_MS = 30 * 1000;

const ERROR_COPY = 'Couldn\u2019t load stats. Please try again later.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StatsScreen(): JSX.Element {
  const query = useQuery<StatsResponse, ApiError>({
    queryKey: ['me-stats'] as const,
    queryFn: fetchStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  if (query.isLoading && query.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" />
        <View style={styles.center} testID="stats-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (query.isError && query.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" />
        <View style={styles.center} testID="stats-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load stats"
            body={ERROR_COPY}
          />
        </View>
      </ScreenContainer>
    );
  }

  // After the loading/error guards, `query.data` is defined whenever we
  // reach this branch (either fresh or from the cache). The `?? null`
  // fallback satisfies the type checker without changing behavior.
  const stats = query.data ?? null;
  if (stats === null) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" />
        <View style={styles.center} testID="stats-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load stats"
            body={ERROR_COPY}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <GradientHeader
        title="Your Stats"
        subtitle="Track how much magic you've experienced."
        icon="stats-chart"
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="stats-screen"
      >
        <OverallCard breakdown={stats.overall} />

        <SectionLabel style={styles.sectionLabel}>By Park</SectionLabel>
        {PARKS.map((park) => (
          <BreakdownCard
            key={park}
            title={park}
            breakdown={stats.byPark[park]}
            accentColor={theme.parkAccent[park]}
            testID={`stats-park-${park}`}
          />
        ))}

        <SectionLabel style={styles.sectionLabel}>By Category</SectionLabel>
        {EXPERIENCE_CATEGORIES.map((category) => {
          const visual = theme.categoryVisual[category];
          return (
            <BreakdownCard
              key={category}
              title={visual.label}
              breakdown={stats.byCategory[category]}
              accentColor={visual.tint}
              icon={visual.glyph as keyof typeof Ionicons.glyphMap}
              testID={`stats-category-${category}`}
            />
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function OverallCard({
  breakdown,
}: {
  readonly breakdown: StatsBreakdown;
}): JSX.Element {
  return (
    <Card style={styles.overallCard} testID="stats-overall">
      <View style={styles.overallIconCircle}>
        <Ionicons name="sparkles" size={22} color={theme.color.accent} />
      </View>
      <Text style={styles.overallLabel}>Overall completion</Text>
      <Text style={styles.overallPercent}>
        {formatPercent(breakdown.percent)}
      </Text>
      <Text style={styles.overallCounts}>
        {`${breakdown.completed} of ${breakdown.total} experiences`}
      </Text>
    </Card>
  );
}

function BreakdownCard({
  title,
  breakdown,
  accentColor,
  icon,
  testID,
}: {
  readonly title: string;
  readonly breakdown: StatsBreakdown;
  readonly accentColor?: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
}): JSX.Element {
  return (
    <Card
      {...(accentColor !== undefined ? { accentColor } : {})}
      {...(testID !== undefined ? { testID } : {})}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          {icon !== undefined ? (
            <Ionicons
              name={icon}
              size={16}
              color={accentColor ?? theme.color.primary}
              style={styles.cardIcon}
            />
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <Badge
          label={formatPercent(breakdown.percent)}
          color={accentColor ?? theme.color.primary}
        />
      </View>
      <Text style={styles.cardCounts}>
        {`${breakdown.completed} of ${breakdown.total}`}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Issue the `GET /me/stats` request. */
async function fetchStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>('GET', '/me/stats');
}

/**
 * Render a percent number with exactly one decimal place. The server
 * already rounds to one decimal (R3.1-R3.3, R3.8); `toFixed(1)` is a
 * display-only normalization so an integer-valued percent like `42`
 * still renders as "42.0%". Defensive against `NaN` / non-finite values
 * by falling back to "0.0%".
 */
function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
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
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  overallCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  overallIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  overallLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  overallPercent: {
    ...theme.typography.display,
    fontSize: 48,
    color: theme.color.primary,
    marginBottom: theme.spacing.xs,
  },
  overallCounts: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  sectionLabel: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingRight: theme.spacing.sm,
  },
  cardIcon: {
    marginRight: theme.spacing.sm,
  },
  cardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  cardCounts: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
