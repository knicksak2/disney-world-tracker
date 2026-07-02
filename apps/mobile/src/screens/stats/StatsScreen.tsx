/**
 * StatsScreen — the Own_Stats_View (task 9.1).
 *
 * Reorganizes the User's own completion statistics into the same tabbed
 * navigation used by the Friend_Profile_View. The screen keeps its existing
 * `me-stats` query (`GET /me/stats`) and renders an `Own_Stats_Selector`
 * (`TabSelector` with `OWN_STATS_TABS`) over four mutually-exclusive modes
 * resolved by `useViewMode(['Own_Overview','Own_Parks','Own_Categories',
 * 'Own_Experiences'])`:
 *
 *   - **Own_Overview** — the overall Completion_Statistic: percentage to one
 *     decimal place plus completed / total counts. A zero total renders as
 *     0.0% / 0 (R9.1–R9.3).
 *   - **Own_Parks** — one `Own_Park_Stat` per catalog Park, in `PARKS` order,
 *     from `byPark` (R10.1–R10.3).
 *   - **Own_Categories** — one `Own_Category_Stat` per Experience_Category, in
 *     `EXPERIENCE_CATEGORIES` order, from `byCategory` (R11.1–R11.3).
 *   - **Own_Experiences** — the shared `ExperiencesList` over the
 *     Own_Completions_Read entries (`testIDPrefix="own"`), with its own
 *     Experience_Filter (R13.*, R14.*).
 *
 * Loading / error scoping:
 *
 *   - The `Own_Stats_Selector` and the three stats modes are gated on the
 *     `GET /me/stats` read: while it is in flight with no prior data the
 *     screen shows a view-level loading indicator (R12.1); on failure or the
 *     synthetic 30-second timeout it shows a view-level error message plus a
 *     retry control that re-issues only `GET /me/stats` (R12.3, R12.5,
 *     R12.6). On success the selector and the selected mode render (R12.2).
 *   - The Own_Experiences pane owns its **own** loading / error / retry,
 *     scoped to the Own_Completions_Read via `useOwnCompletionsQuery`
 *     (R12.7–R12.9). Both reads are fetched once and read from cache on every
 *     mode switch, so switching modes never re-issues a read (R12.4).
 *
 * There is no `profile_forbidden` branch: both `GET /me/stats` and the
 * Own_Completions_Read (on the owner path) return only the requesting User's
 * own data, so the forbidden authorization state cannot occur here (R12
 * intro).
 *
 * The server already does the percentage math (rounding to one decimal,
 * capping at 100.0, zero-safe denominators); `formatPercent` re-applies
 * `toFixed(1)` purely so a whole-number percent still shows its trailing
 * decimal, and the per-breakdown display guards re-assert the zero-total
 * contract (R9.3, R10.3, R11.3) defensively.
 *
 * Validates: Requirements 8.1, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2,
 * 10.3, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8,
 * 12.9, 13.1, 13.2, 13.3, 13.4
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
  type CompletionEntryDTO,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { useOwnCompletionsQuery } from '../../hooks/useOwnCompletions';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';
import {
  OWN_STATS_TABS,
  TabSelector,
  type OwnStatsViewMode,
} from '../navigation/TabSelector';
import { ExperiencesList } from '../navigation/ExperiencesList';
import { useViewMode } from '../navigation/useViewMode';
import { CompletionRow } from '../navigation/CompletionRow';
import { CompactEmptyState } from '../navigation/CompactEmptyState';
import { GroupSection } from '../navigation/GroupSection';
import { groupByCategory, groupByPark } from '../navigation/grouping';
import { useGroupSections } from '../navigation/useGroupSections';
import { useOpenExperience } from '../navigation/experienceNavigation';

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

const STATS_ERROR_TITLE = 'Couldn\u2019t load stats';
const STATS_ERROR_BODY = 'Couldn\u2019t load stats. Please try again later.';
const EXPERIENCES_ERROR_BODY =
  'We couldn\u2019t load your completed experiences. Please try again.';

/** The Own_Stats_View_Modes, in fixed selector order (R8.1). */
const OWN_STATS_MODES = [
  'Own_Overview',
  'Own_Parks',
  'Own_Categories',
  'Own_Experiences',
] as const satisfies readonly [OwnStatsViewMode, ...OwnStatsViewMode[]];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StatsScreen(): JSX.Element {
  const query = useQuery<StatsResponse, ApiError>({
    queryKey: ['me-stats'] as const,
    queryFn: fetchStats,
    staleTime: STATS_STALE_TIME_MS,
  });

  // Single source of truth for the active Own_Stats_View_Mode (R8.3, R8.4,
  // R8.8). Mounted unconditionally so the selection survives the loading /
  // error gates below.
  const { mode, select } = useViewMode(OWN_STATS_MODES);

  // The Own_Completions_Read powers the Own_Experiences pane and the bodies of
  // the Own_Parks / Own_Categories Group_Sections; it is fetched once and read
  // from cache on every re-entry, so a mode switch never re-issues it (R12.4).
  // Mounted at the screen level so it is not torn down when another mode is
  // showing.
  const completionsQuery = useOwnCompletionsQuery();

  // Per-Screen_Session Expanded/Collapsed state for the Own_Parks and
  // Own_Categories Group_Sections. Mounted at the screen level so the state
  // survives mode switches and re-renders (R10.2) and resets to all-Collapsed
  // when the screen is presented anew (R8.1, R10.3). A single instance backs
  // both grouped modes; keys are namespaced per mode (`parks:` / `categories:`)
  // to avoid collisions.
  const sections = useGroupSections();

  // Cross-stack navigation into the Catalog tab's ExperienceDetail screen.
  // Mounted at the screen level so the repeat-tap guard (R5.1, R5.2) and its
  // focus-based reset (R5.3) span the whole Screen_Session; the same callback
  // is threaded into every Completed_Experience_Row across all modes (R3.1,
  // R3.3, R11.3).
  const openExperience = useOpenExperience();

  // R12.1: while `GET /me/stats` is in flight with no prior data, show the
  // view-level loading indicator. `isFetching` (rather than `isLoading`) so a
  // re-issued request after a retry shows the loader again (R12.6).
  if (query.isFetching && query.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" />
        <View style={styles.center} testID="stats-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R12.3, R12.5: any `GET /me/stats` failure (including the synthetic
  // 30-second timeout) with no prior data gates the whole view to an error
  // message plus a retry control that re-issues only `GET /me/stats`.
  if (query.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Your Stats" icon="stats-chart" />
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

  // R12.2: `GET /me/stats` succeeded — render the Own_Stats_Selector and the
  // selected mode's content.
  const stats = query.data;

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
        <TabSelector tabs={OWN_STATS_TABS} active={mode} onSelect={select} />

        {mode === 'Own_Overview' ? <OwnOverviewPane stats={stats} /> : null}
        {mode === 'Own_Parks' ? (
          <OwnParksPane
            stats={stats}
            entries={completionsQuery.data?.entries}
            isExpanded={sections.isExpanded}
            toggle={sections.toggle}
            onOpenExperience={openExperience}
          />
        ) : null}
        {mode === 'Own_Categories' ? (
          <OwnCategoriesPane
            stats={stats}
            entries={completionsQuery.data?.entries}
            isExpanded={sections.isExpanded}
            toggle={sections.toggle}
            onOpenExperience={openExperience}
          />
        ) : null}
        {mode === 'Own_Experiences' ? (
          <OwnExperiencesPane
            isFetching={completionsQuery.isFetching}
            entries={completionsQuery.data?.entries}
            onRetry={() => {
              void completionsQuery.refetch();
            }}
            onOpenExperience={openExperience}
          />
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Own_Overview pane (R9.1–R9.3)
// ---------------------------------------------------------------------------

function OwnOverviewPane({
  stats,
}: {
  readonly stats: StatsResponse;
}): JSX.Element {
  const display = displayBreakdown(stats.overall);
  return (
    <View testID="own-overview">
      <Card style={styles.overallCard} testID="stats-overall">
        <View style={styles.overallIconCircle}>
          <Ionicons name="sparkles" size={22} color={theme.color.accent} />
        </View>
        <Text style={styles.overallLabel}>Overall completion</Text>
        <Text style={styles.overallPercent}>{display.percent}</Text>
        <Text style={styles.overallCounts}>
          {`${display.completed} of ${display.total} experiences`}
        </Text>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Own_Parks pane (R10.1–R10.3) — collapsible Group_Sections (R7.*, R8.2, R11.*)
// ---------------------------------------------------------------------------

function OwnParksPane({
  stats,
  entries,
  isExpanded,
  toggle,
  onOpenExperience,
}: {
  readonly stats: StatsResponse;
  readonly entries: readonly CompletionEntryDTO[] | undefined;
  readonly isExpanded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  // One group per catalog Park, in `PARKS` order, including zero-count Parks —
  // none omitted (R7.2, R8.2). `groupByPark` keeps only named entries, in
  // source order.
  const groups = groupByPark(entries ?? [], PARKS);

  return (
    <View testID="own-parks">
      <SectionLabel style={styles.sectionLabel}>By Park</SectionLabel>
      {groups.map((group) => {
        const key = `parks:${group.park}`;
        return (
          <GroupSection
            key={group.park}
            sectionKey={key}
            expanded={isExpanded(key)}
            onToggle={toggle}
            accessibilityLabel={group.park}
            testID={`stats-section-park-${group.park}`}
            header={
              <BreakdownCard
                title={group.park}
                breakdown={stats.byPark[group.park]}
                accentColor={theme.parkAccent[group.park]}
                testID={`stats-park-${group.park}`}
              />
            }
          >
            {group.entries.length === 0 ? (
              <CompactEmptyState
                message={`No completed Experiences in ${group.park} yet.`}
                testID={`stats-park-empty-${group.park}`}
              />
            ) : (
              group.entries.map((entry, index) => (
                <CompletionRow
                  key={`${entry.experienceName}-${entry.completedOn}-${index}`}
                  entry={entry}
                  fields="parks"
                  onOpenExperience={onOpenExperience}
                  testID={`stats-park-${group.park}-row-${index}`}
                />
              ))
            )}
          </GroupSection>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Own_Categories pane (R11.1–R11.3) — collapsible Group_Sections
// (R7.*, R8.2, R11.*)
// ---------------------------------------------------------------------------

function OwnCategoriesPane({
  stats,
  entries,
  isExpanded,
  toggle,
  onOpenExperience,
}: {
  readonly stats: StatsResponse;
  readonly entries: readonly CompletionEntryDTO[] | undefined;
  readonly isExpanded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  // One group per Experience_Category, in `EXPERIENCE_CATEGORIES` order,
  // including zero-count Categories — none omitted (R7.2, R8.2).
  const groups = groupByCategory(entries ?? [], EXPERIENCE_CATEGORIES);

  return (
    <View testID="own-categories">
      <SectionLabel style={styles.sectionLabel}>By Category</SectionLabel>
      {groups.map((group) => {
        const visual = theme.categoryVisual[group.category];
        const key = `categories:${group.category}`;
        return (
          <GroupSection
            key={group.category}
            sectionKey={key}
            expanded={isExpanded(key)}
            onToggle={toggle}
            accessibilityLabel={visual.label}
            testID={`stats-section-category-${group.category}`}
            header={
              <BreakdownCard
                title={visual.label}
                breakdown={stats.byCategory[group.category]}
                accentColor={visual.tint}
                icon={visual.glyph as keyof typeof Ionicons.glyphMap}
                testID={`stats-category-${group.category}`}
              />
            }
          >
            {group.entries.length === 0 ? (
              <CompactEmptyState
                message={`No completed ${visual.label} experiences yet.`}
                testID={`stats-category-empty-${group.category}`}
              />
            ) : (
              group.entries.map((entry, index) => (
                <CompletionRow
                  key={`${entry.experienceName}-${entry.completedOn}-${index}`}
                  entry={entry}
                  fields="categories"
                  onOpenExperience={onOpenExperience}
                  testID={`stats-category-${group.category}-row-${index}`}
                />
              ))
            )}
          </GroupSection>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Own_Experiences pane (R13.*, R14.* via ExperiencesList; R12.7–R12.9)
// ---------------------------------------------------------------------------

function OwnExperiencesPane({
  isFetching,
  entries,
  onRetry,
  onOpenExperience,
}: {
  readonly isFetching: boolean;
  readonly entries: readonly CompletionEntryDTO[] | undefined;
  readonly onRetry: () => void;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  // R12.7: in-pane loader while the Own_Completions_Read is in flight with no
  // prior data (covers a re-issue after retry, R12.9).
  if (isFetching && entries === undefined) {
    return (
      <View testID="own-experiences">
        <Card style={styles.card} testID="own-experiences-loading">
          <ActivityIndicator color={theme.color.primary} />
        </Card>
      </View>
    );
  }

  // R12.8: a failed Own_Completions_Read (including the 30-second timeout)
  // with no prior data shows an in-pane error message plus a retry control
  // scoped to the Own_Completions_Read.
  if (entries === undefined) {
    return (
      <View testID="own-experiences">
        <Card style={styles.card} testID="own-experiences-error">
          <View style={styles.errorWrap}>
            <Ionicons
              name="cloud-offline-outline"
              size={22}
              color={theme.color.textSecondary}
            />
            <Text style={styles.errorText}>{EXPERIENCES_ERROR_BODY}</Text>
            <PrimaryButton
              label="Retry"
              icon="refresh-outline"
              onPress={onRetry}
              testID="own-experiences-error-retry"
              style={styles.retryBtn}
            />
          </View>
        </Card>
      </View>
    );
  }

  // R13.*, R14.*: render the shared list (it owns the Experience_Filter and
  // the empty-state / no-match messages).
  return (
    <View testID="own-experiences">
      <ExperiencesList
        entries={entries}
        testIDPrefix="own"
        onOpenExperience={onOpenExperience}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

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
  const display = displayBreakdown(breakdown);
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
        <Badge label={display.percent} color={accentColor ?? theme.color.primary} />
      </View>
      <Text style={styles.cardCounts}>
        {`${display.completed} of ${display.total}`}
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
 * Normalize a `StatsBreakdown` for display, re-asserting the zero-total
 * contract defensively (R9.3, R10.3, R11.3): when `total` is zero the
 * percentage shows as 0.0% and the completed count as 0, regardless of what
 * the server sent. The server already enforces this, so for non-zero totals
 * the values pass through unchanged (only `toFixed(1)` formatting is applied).
 */
function displayBreakdown(breakdown: StatsBreakdown): {
  readonly percent: string;
  readonly completed: number;
  readonly total: number;
} {
  if (breakdown.total === 0) {
    return { percent: '0.0%', completed: 0, total: 0 };
  }
  return {
    percent: formatPercent(breakdown.percent),
    completed: breakdown.completed,
    total: breakdown.total,
  };
}

/**
 * Render a percent number with exactly one decimal place. The server
 * already rounds to one decimal (R9.1, R10.2, R11.2); `toFixed(1)` is a
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
    gap: theme.spacing.md,
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
  errorWrap: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
    marginTop: theme.spacing.xs,
  },
});
