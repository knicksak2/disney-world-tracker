/**
 * CompletionStatTile — a single fixed-enum coverage tile
 * (stats-experience-redesign task 6.1).
 *
 * Renders one fixed-enum member's `Completion_Cell` (a park, category, area
 * type, or the hotels-visited resort) as an at-a-glance tile: a `ProgressRing`
 * (R5.7) with the displayed percent, the member title/count, and either the
 * celebratory `CompleteBadge` (when `cell.completeBadge`, R5.8) or the "N to go"
 * affordance (when incomplete with any total, R5.9). A `total === 0` cell is
 * NEVER hidden — it renders in a reduced-emphasis (muted) `0.0%` / `0`
 * treatment (R5.5) and suppresses the "N to go" affordance (R12.2).
 *
 * The whole tile is a single accessible element whose spoken label conveys
 * completion beyond color (R15.1, R15.3, R15.5), reusing the pure display
 * transforms from `statsView.ts` (`displayedPercentLabel`, `showCompleteBadge`,
 * `remainingToGo`) and the `ProgressRing` / `CompleteBadge` primitives from
 * `theme/charts.tsx`, so it never recomputes any completion math.
 *
 * Validates: Requirements 5.4, 5.5, 5.7, 5.8, 5.9, 5.10, 12.2, 15.1, 15.3, 15.5
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CompletionCell } from '../../../api/statsTypes';
import { CompleteBadge, ProgressRing } from '../../../theme/charts';
import { theme } from '../../../theme/theme';
import {
  displayedPercentLabel,
  remainingToGo,
  showCompleteBadge,
} from '../statsView';

export interface CompletionStatTileProps {
  /** The member's display title (e.g. the park name or category label). */
  readonly title: string;
  /** The member's completion cell (server-computed; never recomputed here). */
  readonly cell: CompletionCell;
  /** Optional accent hue (e.g. park/category tint) for the ring. */
  readonly accentColor?: string;
  /** Optional Ionicons glyph shown beside the title (categories). */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
}

/**
 * Compose the single spoken label for the tile, conveying the member, its
 * completion count/percent, and — beyond color — either "Complete" or the
 * remaining count (R15.1, R15.3, R15.5). A `total === 0` cell reads as an empty
 * state ("nothing to complete yet").
 */
function tileAccessibilityLabel(title: string, cell: CompletionCell): string {
  if (cell.total === 0) {
    return `${title}: nothing to complete yet, 0.0 percent`;
  }
  const base = `${title}: ${cell.completed} of ${cell.total}, ${displayedPercentLabel(cell)} percent`;
  if (showCompleteBadge(cell)) return `${base}. Complete`;
  const remaining = remainingToGo(cell);
  return remaining !== null ? `${base}. ${remaining} to go` : base;
}

/**
 * One fixed-enum coverage tile with an at-a-glance completion ring.
 */
export function CompletionStatTile({
  title,
  cell,
  accentColor,
  icon,
  testID,
}: CompletionStatTileProps): JSX.Element {
  const muted = cell.total === 0;
  const complete = showCompleteBadge(cell);
  const remaining = remainingToGo(cell);
  const ringColor = muted
    ? theme.color.surfaceAlt
    : accentColor ?? theme.color.primary;

  return (
    <View
      style={[styles.tile, muted && styles.tileMuted]}
      accessible
      accessibilityLabel={tileAccessibilityLabel(title, cell)}
      testID={testID}
    >
      <ProgressRing
        percent={cell.percent}
        size={72}
        strokeWidth={8}
        color={ringColor}
        complete={complete}
        centerLabel={`${displayedPercentLabel(cell)}%`}
        accessibilityLabel={tileAccessibilityLabel(title, cell)}
      />
      <View style={styles.titleRow}>
        {icon !== undefined ? (
          <Ionicons
            name={icon}
            size={14}
            color={muted ? theme.color.textSecondary : accentColor ?? theme.color.primary}
            style={styles.titleIcon}
          />
        ) : null}
        <Text
          style={[styles.title, muted && styles.textMuted]}
          numberOfLines={2}
        >
          {title}
        </Text>
      </View>
      <Text style={[styles.counts, muted && styles.textMuted]}>
        {cell.completed} of {cell.total}
      </Text>
      {complete ? (
        <CompleteBadge />
      ) : remaining !== null ? (
        <Text style={styles.toGo}>{remaining} to go</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  tileMuted: {
    opacity: 0.55,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: theme.spacing.xs,
  },
  titleIcon: {
    marginRight: 2,
  },
  title: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },
  counts: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  textMuted: {
    color: theme.color.textSecondary,
  },
  toGo: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
