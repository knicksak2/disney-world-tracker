// Feature: photo-uploads, Task 22.7 — the four Trip Summary stat tiles, extracted so
// the shared Trip Recap screen renders the same tiles (Requirement 15.23).
//
// Moved verbatim from TripSummaryScreen.tsx. The icon sits directly inside the
// disc `View` that carries the background colour (a Summary test reads that
// relationship), so keep that structure.

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme, withAlpha } from '../../../theme/theme';
import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../../theme/useAppTheme';
import { Card } from '../../../theme/components';
import { SUMMARY_STAT } from '../TripSummaryScreen.palette';

export interface SummaryStatTilesProps {
  readonly distinctExperienceCount: number;
  readonly totalCompletionsCount: number;
  readonly totalRatingsCount: number;
  readonly parksExploredCount: number;
  /** Tile ids are `${testIDPrefix}-distinct`, `-total-completions`, `-total-ratings`, `-parks-explored`. */
  readonly testIDPrefix: string;
  readonly testID?: string | undefined;
}

export function SummaryStatTiles({
  distinctExperienceCount,
  totalCompletionsCount,
  totalRatingsCount,
  parksExploredCount,
  testIDPrefix,
  testID,
}: SummaryStatTilesProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const stat = usePalette(SUMMARY_STAT);

  return (
    <View style={styles.quickStatsGrid} {...(testID !== undefined ? { testID } : {})}>
      {/* Distinct Experiences (R14.1) */}
      <Card style={styles.statGridCard} testID={`${testIDPrefix}-distinct`}>
        <View style={[styles.statIconBadge, { backgroundColor: stat.violetBg }]}>
          <Ionicons name="sparkles" size={18} color={stat.violetIcon} />
        </View>
        <Text style={styles.statGridValue} testID={`${testIDPrefix}-distinct-count`}>
          {distinctExperienceCount}
        </Text>
        <Text style={styles.statGridLabel}>
          {distinctExperienceCount === 1 ? 'Distinct Ride' : 'Distinct Rides & Shows'}
        </Text>
      </Card>

      {/* Total Group Completions */}
      <Card style={styles.statGridCard} testID={`${testIDPrefix}-total-completions`}>
        <View style={[styles.statIconBadge, { backgroundColor: stat.redBg }]}>
          <Ionicons name="checkmark-done-circle" size={18} color={stat.redIcon} />
        </View>
        <Text style={styles.statGridValue} testID={`${testIDPrefix}-total-completions-count`}>
          {totalCompletionsCount}
        </Text>
        <Text style={styles.statGridLabel}>Total Logged Rides</Text>
      </Card>

      {/* Ratings Submitted */}
      <Card style={styles.statGridCard} testID={`${testIDPrefix}-total-ratings`}>
        <View style={[styles.statIconBadge, { backgroundColor: withAlpha(t.color.accent, 0.18) }]}>
          <Ionicons name="star" size={18} color={t.color.accent} />
        </View>
        <Text style={styles.statGridValue} testID={`${testIDPrefix}-total-ratings-count`}>
          {totalRatingsCount}
        </Text>
        <Text style={styles.statGridLabel}>Ratings Given</Text>
      </Card>

      {/* Parks Explored */}
      <Card style={styles.statGridCard} testID={`${testIDPrefix}-parks-explored`}>
        <View style={[styles.statIconBadge, { backgroundColor: stat.greenBg }]}>
          <Ionicons name="compass" size={18} color={stat.greenIcon} />
        </View>
        <Text style={styles.statGridValue} testID={`${testIDPrefix}-parks-explored-count`}>
          {parksExploredCount}
        </Text>
        <Text style={styles.statGridLabel}>Parks Explored</Text>
      </Card>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  quickStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statGridCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  statIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statGridValue: {
    ...theme.typography.heading,
    fontSize: 24,
    color: t.color.textPrimary,
  },
  statGridLabel: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
  },
}));
