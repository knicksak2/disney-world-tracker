/**
 * FacetCoverageTile — a single per-facet ("interest") coverage row
 * (stats-experience-redesign task 6.5; restyled to the design mockup).
 *
 * Renders one `FacetCoverage` entry as a ranked bar row matching the mockup: a
 * colored dot + facet label (with a gold trophy when complete) on the left, the
 * `completed / total · percent%` value on the right (green when complete), and
 * a thin colored `ProgressBar` beneath. The whole tile is exposed as a single
 * accessible element whose spoken label conveys completion beyond color
 * (R15.1, R15.3, R15.5).
 *
 * Validates: Requirements 9.1, 9.2, 15.1
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { FacetCoverage } from '../../../api/statsTypes';
import { ProgressBar } from '../../../theme/charts';
import { theme } from '../../../theme/theme';
import {
  displayedPercentLabel,
  remainingToGo,
  showCompleteBadge,
} from '../statsView';

export interface FacetCoverageTileProps {
  /** The per-facet coverage entry to render. */
  readonly facet: FacetCoverage;
  /** Accent hue for the dot + bar (assigned by the parent from a palette). */
  readonly color?: string;
  readonly testID?: string;
}

/**
 * Compose the single spoken label for the tile, conveying the facet, its
 * completion count/percent, and — beyond color — either "Complete" or the
 * remaining count (R15.1, R15.3, R15.5).
 */
function facetAccessibilityLabel(facet: FacetCoverage): string {
  const { label, cell } = facet;
  const base = `${label}: ${cell.completed} of ${cell.total}, ${displayedPercentLabel(cell)} percent`;
  if (showCompleteBadge(cell)) return `${base}. Complete`;
  const remaining = remainingToGo(cell);
  return remaining !== null ? `${base}. ${remaining} to go` : base;
}

/**
 * One facet ("interest") coverage tile, rendered as a labeled ranked bar row.
 */
export function FacetCoverageTile({
  facet,
  color,
  testID,
}: FacetCoverageTileProps): JSX.Element {
  const { label, cell } = facet;
  const complete = showCompleteBadge(cell);
  const dotColor = complete ? theme.color.success : color ?? theme.color.primary;
  return (
    <View
      style={styles.tile}
      accessible
      accessibilityLabel={facetAccessibilityLabel(facet)}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <View style={styles.nameWrap}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {complete ? <Text style={styles.trophy}>🏆</Text> : null}
        </View>
        <Text style={[styles.value, complete && styles.valueComplete]}>
          {cell.completed} / {cell.total} · {displayedPercentLabel(cell)}%
        </Text>
      </View>
      <ProgressBar
        percent={cell.percent}
        {...(color !== undefined ? { color } : {})}
        complete={complete}
        accessibilityLabel={facetAccessibilityLabel(facet)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexShrink: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  label: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  trophy: {
    fontSize: 12,
  },
  value: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  valueComplete: {
    color: theme.color.success,
    fontWeight: '700',
  },
});
