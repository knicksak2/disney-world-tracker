/**
 * Ratings section building blocks (stats-experience-redesign task 6.3).
 *
 * Shared, screen-agnostic building blocks for the ratings story, consumed by
 * `RatingsDetailScreen` (Own_Surface) and `FriendProfileScreen` (Friend_Surface)
 * so both surfaces render the same component tree (R11.1, R11.6).
 *
 * The top-level `RatingsSection` gates internally on `ratings.sufficient`
 * (via the pure `ratingsView` transform):
 *   - `sufficient` → the RICH view: `RatingDial` (average /10) + `RatingHistogram`
 *     (1–10 distribution) + `HighLowHeroCards` (highest / lowest) +
 *     `RatingAveragesGrid` (per-park / per-category averages) — R8.1.
 *   - otherwise → the UNLOCK / neutral empty state showing
 *     `ratedCompletionsCount` of `MINIMUM_RATINGS_THRESHOLD` — R8.2.
 *
 * Gating discipline (R8.3): while `!sufficient`, the section NEVER reads the
 * gated fields (`average`, `distribution`, `highest`, `lowest`, `averageByPark`,
 * `averageByCategory`). Only the rich branch dereferences them, so an
 * under-threshold `RatingStatistics` (which omits them on the wire) is safe.
 * `ratedCompletionsCount` is read in BOTH states (R8.4).
 *
 * Empty-state variant (R11.3): the Own_Surface shows a self-directed unlock
 * call-to-action ("Rate N more to unlock…"); the Friend_Surface shows a neutral
 * "Not enough ratings yet" message. `RatingsSection` / `RatingsUnlockEmptyState`
 * accept an `emptyVariant` prop to switch the copy without duplicating the tree.
 *
 * The chart primitives (`RatingDial`, `RatingHistogram`) come from
 * `theme/charts.tsx`; the `RatingDial` / `RatingHistogram` exports here are
 * thin labeled *wrappers* around them (aliased on import to avoid the name
 * clash), each adding a section label and a spoken accessibility label (R15.1).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 15.1
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import {
  RatingDial as RatingDialChart,
  RatingHistogram as RatingHistogramChart,
} from '../../../theme/charts';
import { Card, EmptyState, SectionLabel } from '../../../theme/components';
import { theme } from '../../../theme/theme';

import { MINIMUM_RATINGS_THRESHOLD } from '../../../api/statsTypes';
import type {
  RatedExperience,
  RatingDistribution,
  RatingStatistics,
} from '../../../api/statsTypes';
import { ratingsView, unlockRemaining } from '../statsView';

// ---------------------------------------------------------------------------
// Empty-state copy variant
// ---------------------------------------------------------------------------

/**
 * Which unlock/empty copy the ratings section shows when `!sufficient`:
 *   - `'self-unlock'` (default): self-directed CTA on the Own_Surface
 *     ("Rate N more to unlock your ratings"), R8.2.
 *   - `'neutral'`: friend-safe "Not enough ratings yet" on the Friend_Surface
 *     (R11.3), no self-directed call to action.
 */
export type RatingsEmptyVariant = 'self-unlock' | 'neutral';

// ---------------------------------------------------------------------------
// RatingDial wrapper — labeled average /10
// ---------------------------------------------------------------------------

export interface RatingDialProps {
  /** Average rating in `[1, 10]` (`ratings.average`). */
  readonly average: number;
  readonly testID?: string;
}

/**
 * Labeled wrapper around the `charts.tsx` `RatingDial` primitive: adds the
 * "Average rating" section label and a spoken accessibility label conveying the
 * value out of 10 (R15.1).
 */
export function RatingDial({ average, testID }: RatingDialProps): JSX.Element {
  return (
    <View testID={testID}>
      <SectionLabel>Average rating</SectionLabel>
      <RatingDialChart
        average={average}
        accessibilityLabel={`Average rating ${average.toFixed(1)} out of 10`}
        {...(testID !== undefined ? { testID: `${testID}-dial` } : {})}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// RatingHistogram wrapper — labeled 1..10 distribution
// ---------------------------------------------------------------------------

export interface RatingHistogramProps {
  /** Distribution map 1..10 → count (`ratings.distribution`). */
  readonly distribution: RatingDistribution;
  /** Optional bin (1..10) to emphasize, e.g. the rounded average. */
  readonly highlightValue?: number;
  readonly testID?: string;
}

const RATING_VALUES: readonly (keyof RatingDistribution)[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

/**
 * Labeled wrapper around the `charts.tsx` `RatingHistogram` primitive: adds the
 * "Rating distribution" section label and a spoken accessibility label naming
 * the total rated count (R15.1). Normalization (tallest non-zero bin → 1,
 * baseline for zero bins) lives in the primitive (R8.6).
 */
export function RatingHistogram({
  distribution,
  highlightValue,
  testID,
}: RatingHistogramProps): JSX.Element {
  const total = RATING_VALUES.reduce(
    (sum, value) => sum + (distribution[value] ?? 0),
    0,
  );
  return (
    <View testID={testID}>
      <SectionLabel>Rating distribution</SectionLabel>
      <RatingHistogramChart
        distribution={distribution}
        {...(highlightValue !== undefined ? { highlightValue } : {})}
        accessibilityLabel={`Distribution of your ${total} ratings across values 1 through 10`}
        {...(testID !== undefined ? { testID: `${testID}-histogram` } : {})}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// HighLowHeroCards — highest / lowest rated experiences
// ---------------------------------------------------------------------------

export interface HighLowHeroCardsProps {
  /** The user's highest-rated experience (`ratings.highest`). */
  readonly highest?: RatedExperience;
  /** The user's lowest-rated experience (`ratings.lowest`). */
  readonly lowest?: RatedExperience;
  /**
   * Invoked when a hero card is activated. Optional so the cards render as
   * static tiles when a surface has no experience-open affordance wired yet
   * (the detail screen supplies it in task 7.3).
   */
  readonly onOpenExperience?: (experienceId: string) => void;
  readonly testID?: string;
}

function HeroCard({
  label,
  tone,
  experience,
  onOpenExperience,
  testID,
}: {
  readonly label: string;
  readonly tone: 'high' | 'low';
  readonly experience: RatedExperience;
  readonly onOpenExperience?: (experienceId: string) => void;
  readonly testID?: string;
}): JSX.Element {
  const accentColor = tone === 'high' ? theme.color.success : theme.color.primary;
  const spoken = `${label}: ${experience.name}, rated ${experience.value} out of 10`;
  return (
    <Card
      accentColor={accentColor}
      style={styles.heroCard}
      {...(testID !== undefined ? { testID } : {})}
      {...(onOpenExperience !== undefined
        ? {
            onPress: () => onOpenExperience(experience.experienceId),
            accessibilityRole: 'button' as const,
            accessibilityLabel: `${spoken}. Opens the experience.`,
          }
        : {})}
    >
      <View
        {...(onOpenExperience === undefined
          ? { accessible: true, accessibilityLabel: spoken }
          : {})}
      >
        <Text style={styles.heroLabel}>{label}</Text>
        <Text style={styles.heroName} numberOfLines={2}>
          {experience.name}
        </Text>
        <Text style={[styles.heroValue, { color: accentColor }]}>
          {experience.value}/10
        </Text>
      </View>
    </Card>
  );
}

/**
 * Side-by-side "highest" and "lowest" rated hero cards. Each present card is a
 * single accessible element naming the experience and its value; when
 * `onOpenExperience` is supplied it becomes a button (R15.1, R15.2). Renders
 * only the cards whose experience is present.
 */
export function HighLowHeroCards({
  highest,
  lowest,
  onOpenExperience,
  testID,
}: HighLowHeroCardsProps): JSX.Element | null {
  if (highest === undefined && lowest === undefined) return null;
  return (
    <View style={styles.heroRow} testID={testID}>
      {highest !== undefined ? (
        <HeroCard
          label="Highest rated"
          tone="high"
          experience={highest}
          {...(onOpenExperience !== undefined ? { onOpenExperience } : {})}
          {...(testID !== undefined ? { testID: `${testID}-highest` } : {})}
        />
      ) : null}
      {lowest !== undefined ? (
        <HeroCard
          label="Lowest rated"
          tone="low"
          experience={lowest}
          {...(onOpenExperience !== undefined ? { onOpenExperience } : {})}
          {...(testID !== undefined ? { testID: `${testID}-lowest` } : {})}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RatingAveragesGrid — per-park / per-category averages
// ---------------------------------------------------------------------------

export interface RatingAveragesGridProps {
  /** Partial per-park average map (`ratings.averageByPark`). */
  readonly averageByPark?: Partial<Record<Park, number>>;
  /** Partial per-category average map (`ratings.averageByCategory`). */
  readonly averageByCategory?: Partial<Record<ExperienceCategory, number>>;
  readonly testID?: string;
}

function AverageRow({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: number;
  readonly testID?: string;
}): JSX.Element {
  return (
    <View
      style={styles.averageRow}
      accessible
      accessibilityLabel={`${label}: average ${value.toFixed(1)} out of 10`}
      testID={testID}
    >
      <Text style={styles.averageLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.averageValue}>{value.toFixed(1)}</Text>
    </View>
  );
}

/**
 * A two-column grid of per-park and per-category rating averages. Iterates the
 * canonical `PARKS` / `EXPERIENCE_CATEGORIES` orders (R9.2-style determinism)
 * and renders only the members present in the partial maps. Renders nothing
 * when both maps are absent/empty.
 */
export function RatingAveragesGrid({
  averageByPark,
  averageByCategory,
  testID,
}: RatingAveragesGridProps): JSX.Element | null {
  const parkRows = PARKS.map((park) => ({
    key: park,
    label: park,
    value: averageByPark?.[park],
  })).filter(
    (row): row is { key: Park; label: Park; value: number } =>
      typeof row.value === 'number',
  );

  const categoryRows = EXPERIENCE_CATEGORIES.map((category) => ({
    key: category,
    label: theme.categoryVisual[category].label,
    value: averageByCategory?.[category],
  })).filter(
    (row): row is { key: ExperienceCategory; label: string; value: number } =>
      typeof row.value === 'number',
  );

  if (parkRows.length === 0 && categoryRows.length === 0) return null;

  return (
    <View style={styles.averagesWrap} testID={testID}>
      {parkRows.length > 0 ? (
        <View style={styles.averagesColumn}>
          <SectionLabel>By park</SectionLabel>
          {parkRows.map((row) => (
            <AverageRow
              key={row.key}
              label={row.label}
              value={row.value}
              {...(testID !== undefined
                ? { testID: `${testID}-park-${row.key}` }
                : {})}
            />
          ))}
        </View>
      ) : null}
      {categoryRows.length > 0 ? (
        <View style={styles.averagesColumn}>
          <SectionLabel>By category</SectionLabel>
          {categoryRows.map((row) => (
            <AverageRow
              key={row.key}
              label={row.label}
              value={row.value}
              {...(testID !== undefined
                ? { testID: `${testID}-category-${row.key}` }
                : {})}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RatingsUnlockEmptyState — under-threshold gate
// ---------------------------------------------------------------------------

export interface RatingsUnlockEmptyStateProps {
  /** Always-present rated-completion count, shown as progress toward `threshold`. */
  readonly ratedCompletionsCount: number;
  /** The unlock threshold (`MINIMUM_RATINGS_THRESHOLD`, value 3). */
  readonly threshold: number;
  /**
   * Copy variant (R11.3): `'self-unlock'` (default) shows a self-directed CTA;
   * `'neutral'` shows the friend-safe "Not enough ratings yet" message.
   */
  readonly variant?: RatingsEmptyVariant;
  readonly testID?: string;
}

/**
 * The under-threshold ratings gate. Reads only `ratedCompletionsCount` (R8.4)
 * and derives the remaining count via the pure `unlockRemaining` transform;
 * never touches a gated field (R8.3). Switches between the self-directed unlock
 * CTA and the friend-safe neutral message via `variant` (R8.2, R11.3).
 */
export function RatingsUnlockEmptyState({
  ratedCompletionsCount,
  threshold,
  variant = 'self-unlock',
  testID,
}: RatingsUnlockEmptyStateProps): JSX.Element {
  const remaining = unlockRemaining(
    { sufficient: false, ratedCompletionsCount },
    threshold,
  );
  const progress = `${ratedCompletionsCount}/${threshold}`;

  if (variant === 'neutral') {
    return (
      <EmptyState
        icon="star-outline"
        title="Not enough ratings yet"
        body={`Ratings appear once ${threshold} experiences are rated (${progress}).`}
        {...(testID !== undefined ? { testID } : {})}
      />
    );
  }

  const body =
    remaining > 0
      ? `Rate ${remaining} more experience${remaining === 1 ? '' : 's'} to unlock your ratings (${progress}).`
      : `Your ratings are unlocking (${progress}).`;

  return (
    <EmptyState
      icon="star-outline"
      title="Unlock your ratings"
      body={body}
      {...(testID !== undefined ? { testID } : {})}
    />
  );
}

// ---------------------------------------------------------------------------
// RatingsSection — top-level gated section
// ---------------------------------------------------------------------------

export interface RatingsSectionProps {
  /** The full rating statistics; the section gates internally on `sufficient`. */
  readonly ratings: RatingStatistics;
  /**
   * Empty-state copy variant when `!sufficient` (R11.3). Defaults to
   * `'self-unlock'` for the Own_Surface; the Friend_Surface passes `'neutral'`.
   */
  readonly emptyVariant?: RatingsEmptyVariant;
  /** Forwarded to `HighLowHeroCards` so hero cards can open an experience. */
  readonly onOpenExperience?: (experienceId: string) => void;
  readonly testID?: string;
}

/**
 * The ratings story section. Chooses the rich view vs. the unlock/neutral empty
 * state purely from `ratings.sufficient` (via `ratingsView`), and — crucially —
 * only dereferences the gated fields inside the rich branch (R8.1, R8.2, R8.3).
 * `ratedCompletionsCount` is read in both branches (R8.4).
 */
export function RatingsSection({
  ratings,
  emptyVariant = 'self-unlock',
  onOpenExperience,
  testID,
}: RatingsSectionProps): JSX.Element {
  if (ratingsView(ratings) === 'unlock') {
    // UNLOCK / neutral branch — read ONLY `ratedCompletionsCount` (R8.3, R8.4).
    return (
      <RatingsUnlockEmptyState
        ratedCompletionsCount={ratings.ratedCompletionsCount}
        threshold={MINIMUM_RATINGS_THRESHOLD}
        variant={emptyVariant}
        {...(testID !== undefined ? { testID } : {})}
      />
    );
  }

  // RICH branch — sufficient guarantees the gated fields are present, but read
  // defensively so a missing field degrades to hiding that block rather than
  // throwing.
  const {
    average,
    distribution,
    highest,
    lowest,
    averageByPark,
    averageByCategory,
    ratedCompletionsCount,
  } = ratings;
  const highlightValue =
    typeof average === 'number' ? Math.round(average) : undefined;

  return (
    <View style={styles.section} testID={testID}>
      {typeof average === 'number' ? (
        <Card style={styles.dialCard}>
          <View style={styles.dialCardLeft}>
            <RatingDial average={average} />
          </View>
          <View style={styles.dialCardRight}>
            <Text style={styles.ratedCountLabel}>across</Text>
            <Text style={styles.ratedCount}>
              {ratedCompletionsCount} rated experience
              {ratedCompletionsCount === 1 ? '' : 's'}
            </Text>
          </View>
        </Card>
      ) : (
        <Text style={styles.ratedCount}>
          {ratedCompletionsCount} rated experience
          {ratedCompletionsCount === 1 ? '' : 's'}
        </Text>
      )}
      {distribution !== undefined ? (
        <Card>
          <RatingHistogram
            distribution={distribution}
            {...(highlightValue !== undefined ? { highlightValue } : {})}
          />
        </Card>
      ) : null}
      <HighLowHeroCards
        {...(highest !== undefined ? { highest } : {})}
        {...(lowest !== undefined ? { lowest } : {})}
        {...(onOpenExperience !== undefined ? { onOpenExperience } : {})}
      />
      {averageByPark !== undefined || averageByCategory !== undefined ? (
        <Card>
          <RatingAveragesGrid
            {...(averageByPark !== undefined ? { averageByPark } : {})}
            {...(averageByCategory !== undefined ? { averageByCategory } : {})}
          />
        </Card>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    gap: theme.spacing.lg,
  },
  dialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  dialCardLeft: {
    flexShrink: 1,
  },
  dialCardRight: {
    alignItems: 'flex-end',
  },
  ratedCountLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  ratedCount: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  heroRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  heroCard: {
    flex: 1,
  },
  heroLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  heroName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  heroValue: {
    ...theme.typography.heading,
  },
  averagesWrap: {
    flexDirection: 'row',
    gap: theme.spacing.xl,
  },
  averagesColumn: {
    flex: 1,
  },
  averageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  averageLabel: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    flexShrink: 1,
  },
  averageValue: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
});
