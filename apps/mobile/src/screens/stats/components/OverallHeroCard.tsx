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
import { StyleSheet, Text } from 'react-native';

import type { CompletionCell } from '../../../api/statsTypes';
import { CompleteBadge, ProgressRing } from '../../../theme/charts';
import { Card } from '../../../theme/components';
import { theme } from '../../../theme/theme';
import { displayedPercentLabel } from '../statsView';

export interface OverallHeroCardProps {
  /** The overall coverage cell driving the hero ring. */
  readonly overall: CompletionCell;
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
 */
export function OverallHeroCard({
  overall,
  size = 168,
  testID,
}: OverallHeroCardProps): JSX.Element {
  const complete = overall.completeBadge;
  return (
    <Card style={styles.card} {...(testID !== undefined ? { testID } : {})}>
      <Text style={styles.label}>Overall completion</Text>
      <ProgressRing
        percent={overall.percent}
        size={size}
        strokeWidth={16}
        complete={complete}
        centerLabel={`${displayedPercentLabel(overall)}%`}
        centerSubLabel={`${overall.completed} / ${overall.total}`}
        accessibilityLabel={heroAccessibilityLabel(overall)}
        testID="overall-hero-ring"
      />
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

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  count: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
});
