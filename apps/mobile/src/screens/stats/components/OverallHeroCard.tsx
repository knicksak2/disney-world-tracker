/**
 * OverallHeroCard — the Overview hub's headline overall-completion card
 * (stats-experience-redesign task 6.5; restyled to the design mockup).
 *
 * Leads the hub with a large overall-completion `ProgressRing` derived from
 * `coverage.overall` (R1.1), showing the displayed percent and the
 * `completed / total` count inside the ring. WHERE `coverage.overall.completeBadge`
 * is true, the ring switches to the celebratory gold treatment and a
 * `CompleteBadge` is shown (R1.2, R15.3); otherwise a warm "N left to go" line
 * sits below. All values read through the pure `statsView` transforms (no math
 * recompute).
 *
 * Validates: Requirements 1.1, 1.2, 15.1, 15.4
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { ActivityStatistics, CompletionCell } from '../../../api/statsTypes';
import { CompleteBadge, ProgressRing } from '../../../theme/charts';
import { Card } from '../../../theme/components';
import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../../theme/useAppTheme';
import { displayedPercentLabel } from '../statsView';

import { HERO_METRIC } from './OverallHeroCard.palette';

export interface OverallHeroCardProps {
  /** The overall coverage cell driving the hero ring. */
  readonly overall: CompletionCell;
  /** Activity statistics driving the right pillar of the dual-pillar layout. */
  readonly activity?: ActivityStatistics | undefined;
  /** Ring diameter override (defaults to a hero-sized ring). */
  readonly size?: number;
  readonly testID?: string;
}

/**
 * Compose the single spoken label for the hero, conveying overall completion
 * and — beyond color — the "Complete" state when earned (R15.1, R15.3).
 */
function heroAccessibilityLabel(overall: CompletionCell): string {
  const base = `Overall completion: ${overall.completed} of ${overall.total}, ${displayedPercentLabel(overall)} percent`;
  return overall.completeBadge ? `${base}. Complete` : base;
}

/**
 * The hero overall-completion card for the Overview hub.
 * When `activity` is present and contains logs, renders a Dual-Pillar Hero:
 * Catalog coverage ring on the left, activity volume / repeat stats on the right.
 */
export function OverallHeroCard({
  overall,
  activity,
  size,
  testID,
}: OverallHeroCardProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const metric = usePalette(HERO_METRIC);
  const complete = overall.completeBadge;
  const hasActivity = Boolean(activity && activity.totalLogs > 0);
  const ringSize = size ?? (hasActivity ? 116 : 168);
  const strokeWidth = hasActivity ? 12 : 16;

  return (
    <Card style={styles.card} {...(testID !== undefined ? { testID } : {})}>
      <Text style={styles.label}>
        {hasActivity ? 'Magic & Activity Overview' : 'Overall completion'}
      </Text>

      {hasActivity ? (
        <View style={styles.dualLayout}>
          <View style={styles.ringCol}>
            <ProgressRing
              percent={overall.percent}
              size={ringSize}
              strokeWidth={strokeWidth}
              complete={complete}
              centerLabel={`${displayedPercentLabel(overall)}%`}
              centerSubLabel={`${overall.completed} / ${overall.total}`}
              accessibilityLabel={heroAccessibilityLabel(overall)}
              testID="overall-hero-ring"
            />
            <Text style={styles.ringMeta}>Coverage</Text>
          </View>

          <View style={styles.activityCol} testID="hero-activity-pillar">
            <View style={styles.metricRow}>
              <View style={[styles.metricIcon, { backgroundColor: t.color.surfaceAlt }]}>
                <Ionicons name="flash" size={15} color={t.color.primaryFg} />
              </View>
              <View style={styles.metricInfo}>
                <Text style={styles.metricVal}>{activity!.totalLogs}</Text>
                <Text style={styles.metricLbl}>Rides Logged</Text>
              </View>
            </View>

            <View style={styles.metricRow}>
              <View style={[styles.metricIcon, { backgroundColor: metric.parkDaysBg }]}>
                <Ionicons name="calendar" size={15} color={metric.parkDaysFg} />
              </View>
              <View style={styles.metricInfo}>
                <Text style={styles.metricVal}>{activity!.distinctParkDays}</Text>
                <Text style={styles.metricLbl}>Park Days</Text>
              </View>
            </View>

            <View style={styles.metricRow}>
              <View style={[styles.metricIcon, { backgroundColor: metric.repeatBg }]}>
                <Ionicons name="repeat" size={15} color={metric.repeatFg} />
              </View>
              <View style={styles.metricInfo}>
                <Text style={styles.metricVal}>
                  {activity!.repeatMultiplier.toFixed(1)}×
                </Text>
                <Text style={styles.metricLbl}>Repeat Multiplier</Text>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <ProgressRing
          percent={overall.percent}
          size={ringSize}
          strokeWidth={strokeWidth}
          complete={complete}
          centerLabel={`${displayedPercentLabel(overall)}%`}
          centerSubLabel={`${overall.completed} / ${overall.total}`}
          accessibilityLabel={heroAccessibilityLabel(overall)}
          testID="overall-hero-ring"
        />
      )}

      {complete ? (
        <CompleteBadge testID="overall-hero-complete-badge" />
      ) : (
        <Text style={styles.count} numberOfLines={2}>
          {overall.remaining} experiences left to go ✨
        </Text>
      )}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    alignItems: 'center',
    gap: t.spacing.md,
  },
  label: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dualLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: t.spacing.sm,
    gap: t.spacing.md,
  },
  ringCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ringMeta: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  activityCol: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: t.color.border,
    paddingLeft: t.spacing.md,
    gap: t.spacing.sm,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricInfo: {
    gap: 1,
  },
  metricVal: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
    fontWeight: '800',
    lineHeight: 18,
  },
  metricLbl: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontSize: 10,
  },
  count: {
    ...t.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
}));

