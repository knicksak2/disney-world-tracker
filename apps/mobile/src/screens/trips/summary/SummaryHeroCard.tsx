// Feature: photo-uploads, Task 22.7 — the Trip Summary hero card, extracted so the
// shared Trip Recap screen renders the same card (Requirement 15.23).
//
// Moved verbatim from TripSummaryScreen.tsx; the Summary passes its original copy
// ("Vacation Wrap-Up", "A Magical Adventure!") and ids, so its output is unchanged.

import React from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { theme, withAlpha } from '../../../theme/theme';
import { makeStyles } from '../../../theme/makeStyles';
import { usePalette } from '../../../theme/useAppTheme';
import { ProgressRing } from '../../../theme/charts';
import { SUMMARY_HERO } from '../TripSummaryScreen.palette';
import { isItineraryComplete, itineraryPercent } from './summaryFormat';

export interface SummaryHeroCardProps {
  /** Large title line ("A Magical Adventure!" or the trip name). */
  readonly title: string;
  /** Pill label above the title ("Vacation Wrap-Up" or "Shared by <name>"). */
  readonly badgeLabel: string;
  /** Pill glyph; defaults to `sparkles`. */
  readonly badgeIcon?: keyof typeof Ionicons.glyphMap | undefined;
  readonly subtitle?: string | undefined;
  readonly plannedCompletedCount: number;
  readonly plannedTotalCount: number;
  /**
   * When provided and the plan is empty, this friendly line replaces the
   * "0 of 0" progress text (the ring is never shown for an empty plan).
   */
  readonly emptyPlannedLine?: string | undefined;
  readonly testID: string;
  readonly plannedTestID: string;
  readonly plannedCountTestID: string;
  readonly titleTestID?: string | undefined;
  /** Exposes the title to assistive tech as a heading. */
  readonly titleIsHeader?: boolean | undefined;
}

export function SummaryHeroCard({
  title,
  badgeLabel,
  badgeIcon = 'sparkles',
  subtitle,
  plannedCompletedCount,
  plannedTotalCount,
  emptyPlannedLine,
  testID,
  plannedTestID,
  plannedCountTestID,
  titleTestID,
  titleIsHeader = false,
}: SummaryHeroCardProps): JSX.Element {
  const styles = useStyles();
  const hero = usePalette(SUMMARY_HERO);
  const percent = itineraryPercent(plannedCompletedCount, plannedTotalCount);
  const complete = isItineraryComplete(plannedCompletedCount, plannedTotalCount);

  return (
    <LinearGradient
      colors={[hero.gradStart, hero.gradMid, hero.gradEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.heroCard}
      testID={testID}
    >
      <View style={styles.heroGlow} />
      <View style={styles.heroHeader}>
        <View style={styles.heroBadge}>
          <Ionicons name={badgeIcon} size={14} color={hero.gold} />
          <Text style={styles.heroBadgeText}>{badgeLabel}</Text>
        </View>
        <Text
          style={styles.heroTitle}
          {...(titleIsHeader ? { accessibilityRole: 'header' as const } : {})}
          {...(titleTestID !== undefined ? { testID: titleTestID } : {})}
        >
          {title}
        </Text>
        {subtitle !== undefined ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
      </View>

      {plannedTotalCount > 0 ? (
        <View style={styles.heroRingRow} testID={plannedTestID}>
          <ProgressRing
            percent={percent}
            size={110}
            strokeWidth={11}
            complete={complete}
            centerLabel={`${percent}%`}
            centerSubLabel="Itinerary Done"
            accessibilityLabel={`${percent}% of planned experiences completed`}
          />
          <View style={styles.heroProgressTextCol}>
            <Text style={styles.heroProgressNum} testID={plannedCountTestID}>
              {plannedCompletedCount} of {plannedTotalCount}
            </Text>
            <Text style={styles.heroProgressLabel}>planned Experiences completed</Text>
            {complete ? (
              <View style={styles.congratsPill}>
                <Ionicons name="ribbon" size={13} color={hero.gold} />
                <Text style={styles.congratsText}>100% Itinerary Completed! 🎉</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : emptyPlannedLine !== undefined ? (
        <View style={styles.heroRingRow} testID={plannedTestID}>
          <View style={styles.heroCastleBadge}>
            <Ionicons name="trophy" size={32} color={hero.gold} />
          </View>
          <View style={styles.heroProgressTextCol}>
            <Text style={styles.heroProgressLabel} testID={plannedCountTestID}>
              {emptyPlannedLine}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.heroRingRow} testID={plannedTestID}>
          <View style={styles.heroCastleBadge}>
            <Ionicons name="trophy" size={32} color={hero.gold} />
          </View>
          <View style={styles.heroProgressTextCol}>
            <Text style={styles.heroProgressNum} testID={plannedCountTestID}>
              0 of 0
            </Text>
            <Text style={styles.heroProgressLabel}>planned Experiences completed</Text>
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

const useStyles = makeStyles((t) => ({
  heroCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    overflow: 'hidden',
    position: 'relative',
    ...t.shadow.floating,
  },
  heroGlow: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: withAlpha(t.color.accent, 0.15),
  },
  heroHeader: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: SUMMARY_HERO[t.scheme].badgeBg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  heroBadgeText: {
    ...theme.typography.meta,
    color: SUMMARY_HERO[t.scheme].gold,
    fontWeight: '700',
  },
  heroTitle: {
    ...theme.typography.heading,
    fontSize: 24,
    lineHeight: 28,
    color: t.color.textOnPrimary,
  },
  heroSubtitle: {
    ...theme.typography.body,
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  heroRingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  heroCastleBadge: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: SUMMARY_HERO[t.scheme].castleBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: SUMMARY_HERO[t.scheme].castleBorder,
  },
  heroProgressTextCol: {
    flex: 1,
    gap: 2,
  },
  heroProgressNum: {
    ...theme.typography.heading,
    fontSize: 22,
    color: t.color.textOnPrimary,
  },
  heroProgressLabel: {
    ...theme.typography.meta,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  congratsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: SUMMARY_HERO[t.scheme].congratsBg,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  congratsText: {
    ...theme.typography.meta,
    color: SUMMARY_HERO[t.scheme].gold,
    fontWeight: '700',
    fontSize: 12,
  },
}));
