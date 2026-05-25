/**
 * StatsScreen — own completion statistics (task 17.4).
 *
 * Renders the User's overall, per-Park, and per-Experience_Category
 * completion percentages from `GET /me/stats`. The server already does
 * the math (rounding to one decimal place, capping at 100.0, treating
 * a zero denominator as 0.0 / count 0); this screen just lays the
 * numbers out as cards.
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
 *     using `formatPercent` (e.g. 42.5%, 100.0%, 0.0%). The server
 *     already returns the rounded value; `toFixed(1)` is a display-only
 *     normalization so values like `42` (which the server's
 *     `computePercent` could return as `42`, not `42.0`) still render
 *     as "42.0%". Counts render as "X of Y experiences" / "X of Y" on
 *     each card.
 *
 *   - **Stable ordering.** The screen iterates over the `PARKS` and
 *     `EXPERIENCE_CATEGORIES` constant tuples from `@dwt/shared` so the
 *     list order matches the canonical enum order rather than depending
 *     on JSON object key ordering. This also means a Park or Category
 *     with zero Experiences (R3.6, R3.7) still appears in the list with
 *     "0 of 0" and "0.0%" — the user sees a stable, predictable layout.
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
import { useQuery } from '@tanstack/react-query';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';

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
      <View style={styles.center} testID="stats-loading">
        <ActivityIndicator />
      </View>
    );
  }

  if (query.isError && query.data === undefined) {
    return (
      <View style={styles.center} testID="stats-error">
        <Text style={styles.errorText}>{ERROR_COPY}</Text>
      </View>
    );
  }

  // After the loading/error guards, `query.data` is defined whenever we
  // reach this branch (either fresh or from the cache). The `?? null`
  // fallback satisfies the type checker without changing behavior.
  const stats = query.data ?? null;
  if (stats === null) {
    return (
      <View style={styles.center} testID="stats-error">
        <Text style={styles.errorText}>{ERROR_COPY}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      testID="stats-screen"
    >
      <OverallCard breakdown={stats.overall} />

      <SectionHeader label="By Park" />
      {PARKS.map((park) => (
        <BreakdownCard
          key={park}
          title={park}
          breakdown={stats.byPark[park]}
          testID={`stats-park-${park}`}
        />
      ))}

      <SectionHeader label="By Category" />
      {EXPERIENCE_CATEGORIES.map((category) => (
        <BreakdownCard
          key={category}
          title={formatCategory(category)}
          breakdown={stats.byCategory[category]}
          testID={`stats-category-${category}`}
        />
      ))}
    </ScrollView>
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
    <View style={[styles.card, styles.overallCard]} testID="stats-overall">
      <Text style={styles.overallLabel}>Overall</Text>
      <Text style={styles.overallPercent}>{formatPercent(breakdown.percent)}</Text>
      <Text style={styles.overallCounts}>
        {`${breakdown.completed} of ${breakdown.total} experiences`}
      </Text>
    </View>
  );
}

function SectionHeader({ label }: { readonly label: string }): JSX.Element {
  return <Text style={styles.sectionHeader}>{label}</Text>;
}

function BreakdownCard({
  title,
  breakdown,
  testID,
}: {
  readonly title: string;
  readonly breakdown: StatsBreakdown;
  readonly testID?: string;
}): JSX.Element {
  return (
    <View style={styles.card} {...(testID !== undefined ? { testID } : {})}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardPercent}>{formatPercent(breakdown.percent)}</Text>
      </View>
      <Text style={styles.cardCounts}>
        {`${breakdown.completed} of ${breakdown.total}`}
      </Text>
    </View>
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

/**
 * Render the underscore-bearing `Character_Meet` enum as a friendlier
 * "Character Meet" label without losing the literal value used over the
 * wire. Mirrors the same helper in `CatalogScreen.tsx`.
 */
function formatCategory(value: ExperienceCategory): string {
  return value === 'Character_Meet' ? 'Character Meet' : value;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  errorText: {
    fontSize: 15,
    color: '#555555',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#ffffff',
  },
  card: {
    backgroundColor: '#f7f7f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  overallCard: {
    backgroundColor: '#003a9b',
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 20,
  },
  overallLabel: {
    color: '#cfd9f0',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  overallPercent: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 4,
  },
  overallCounts: {
    color: '#cfd9f0',
    fontSize: 14,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#444444',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
    flexShrink: 1,
    paddingRight: 8,
  },
  cardPercent: {
    fontSize: 16,
    fontWeight: '700',
    color: '#003a9b',
  },
  cardCounts: {
    fontSize: 13,
    color: '#666666',
  },
});
