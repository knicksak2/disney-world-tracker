/**
 * LabeledCellList — a ranked list of labeled completion bars
 * (stats-experience-redesign task 6.1; restyled to the design mockup).
 *
 * Renders comparison dimensions (per-Park, per-Category, per-Area, per-Land,
 * per-Resort_Area, and the per-resort activity `byResort`) as ranked rows that
 * match the mockup: a colored dot + label (with a gold trophy when complete) on
 * the left, the `completed / total · percent%` value on the right (green when
 * complete), and a thin colored `ProgressBar` beneath. Rows render **in the
 * order supplied** — the list does no sorting of its own, so a caller that
 * wants the server's `byResort` order (R6.1) or a most→least-complete ranking
 * passes already-ordered rows. The whole row is a single accessible element
 * conveying completion beyond color (R15.1, R15.3, R15.5).
 *
 * When there are no rows it renders a compact empty state (R6.3).
 *
 * Validates: Requirements 5.6, 5.8, 5.9, 5.10, 6.1, 6.3, 12.2, 15.1, 15.3, 15.5
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CompletionCell } from '../../../api/statsTypes';
import { ProgressBar } from '../../../theme/charts';
import { EmptyState } from '../../../theme/components';
import { theme } from '../../../theme/theme';
import {
  displayedPercentLabel,
  remainingToGo,
  showCompleteBadge,
} from '../statsView';

/**
 * One ranked row: a stable `key`, a display `label`, its `Completion_Cell`, and
 * an optional accent `color` for the dot + bar fill. Both `LabeledCell`
 * (`{ label, cell }`) and `ResortCoverage` (`{ resortId, label, cell }`) map
 * onto this at the call site — the resorts lens passes `key: resortId` and
 * reads only `resortId` / `label` / `cell` (R6.2).
 */
export interface LabeledCellRow {
  readonly key: string;
  readonly label: string;
  readonly cell: CompletionCell;
  readonly color?: string;
}

export interface LabeledCellListProps {
  /** The ranked rows, rendered in the order given (no re-sorting). */
  readonly rows: readonly LabeledCellRow[];
  /** Compact empty-state title when `rows` is empty. */
  readonly emptyTitle?: string;
  /** Compact empty-state body when `rows` is empty. */
  readonly emptyBody?: string;
  /** Prefix for per-row `testID`s (`<prefix>-<key>`). */
  readonly rowTestIDPrefix?: string;
  readonly testID?: string;
}

/**
 * Compose the single spoken label for a row (R15.1, R15.3, R15.5).
 */
function rowAccessibilityLabel(label: string, cell: CompletionCell): string {
  const base = `${label}: ${cell.completed} of ${cell.total}, ${displayedPercentLabel(cell)} percent`;
  if (showCompleteBadge(cell)) return `${base}. Complete`;
  const remaining = remainingToGo(cell);
  return remaining !== null ? `${base}. ${remaining} to go` : base;
}

function LabeledCellRowView({
  row,
  testID,
}: {
  readonly row: LabeledCellRow;
  readonly testID?: string;
}): JSX.Element {
  const { label, cell, color } = row;
  const complete = showCompleteBadge(cell);
  const dotColor = complete ? theme.color.success : color ?? theme.color.primary;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={rowAccessibilityLabel(label, cell)}
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
        accessibilityLabel={rowAccessibilityLabel(label, cell)}
      />
    </View>
  );
}

/**
 * A ranked list of labeled completion bars, or a compact empty state.
 */
export function LabeledCellList({
  rows,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  rowTestIDPrefix,
  testID,
}: LabeledCellListProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="albums-outline"
        title={emptyTitle}
        {...(emptyBody !== undefined ? { body: emptyBody } : {})}
        {...(testID !== undefined ? { testID } : {})}
      />
    );
  }
  return (
    <View style={styles.list} testID={testID}>
      {rows.map((row) => (
        <LabeledCellRowView
          key={row.key}
          row={row}
          {...(rowTestIDPrefix !== undefined
            ? { testID: `${rowTestIDPrefix}-${row.key}` }
            : {})}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: theme.spacing.xs,
  },
  row: {
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
