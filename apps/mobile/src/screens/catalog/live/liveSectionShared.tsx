// Feature: experience-live-details, Task 11.1 — shared live-section presentation
//
// Validates: Requirements 4.1, 4.5, 4.6, 4.13, 5.3, 5.5, 5.7, 6.1, 6.4, 6.8
//
// The three category live sections (Ride/Character_Meet, Show/Parade,
// Restaurant) share a common header/footer: the Operating_Status label, the
// stale indicator, and the two distinctly-labeled timestamps (Retrieved_At and
// Upstream_Last_Updated) rendered in park-local time. Those pieces live here so
// each section composes them consistently rather than re-deriving them.

import React from 'react';
import { Text, View } from 'react-native';

import type {
  BoardingGroupState,
  LightningLaneState,
  LiveDetailDTO,
  OperatingStatus,
} from '@dwt/shared';

import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme } from '../../../theme/useAppTheme';
import { Badge, SectionLabel } from '../../../theme/components';
import { formatParkDateTime, formatParkTime } from './parkTime';
import { formatLightningLanePrice, humanizeCoarseState } from './liveView';

/**
 * Props shared by every live section. Mirrors the `LiveDetailResponseDTO`
 * envelope flattened with the `upstreamLastUpdated` lifted out of the detail so
 * the screen (task 11.2) can pass it explicitly: `liveDetail`, the
 * `retrievedAt` stamp, the `stale` flag, and the optional upstream stamp.
 */
export interface LiveSectionProps {
  readonly liveDetail: LiveDetailDTO;
  readonly retrievedAt: string;
  readonly stale: boolean;
  readonly upstreamLastUpdated?: string;
}

/**
 * Render the Operating_Status as exactly one of the labels Operating, Closed,
 * Down, Refurbishment, or Unknown (R4.1, R6.1) — the enum literal is already
 * the user-facing label.
 */
export function StatusBadge({
  status,
}: {
  readonly status: OperatingStatus;
}): JSX.Element {
  const t = useAppTheme();
  // Per-status badge tint. Operating reads as success, hard-down/closed as
  // danger, refurbishment as a warning hue, and Unknown as a neutral grey.
  const statusColor: Record<OperatingStatus, string> = {
    Operating: t.color.success,
    Closed: t.color.danger,
    Down: t.color.danger,
    Refurbishment: t.color.warning,
    Unknown: t.color.textSecondary,
  };
  return (
    <Badge
      label={status}
      color={statusColor[status]}
      testID="live-operating-status"
    />
  );
}

/**
 * The "information may be out of date" stale indicator (R3.5, R4.6, R5 / R6).
 * Rendered only when the served Live_Detail carries the stale flag; the
 * accompanying Retrieved_At time is shown in the footer below.
 */
export function StaleIndicator(): JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.staleRow} testID="live-stale-indicator">
      <Text style={styles.staleText}>
        Live information may be out of date.
      </Text>
    </View>
  );
}

/**
 * The retrieval footer: the Retrieved_At time always, and the
 * Upstream_Last_Updated time when present — each in park-local time and
 * distinctly labeled so the two stamps are never confused (R4.5, R4.13, R5.5,
 * R5.7, R6.4, R6.8).
 */
export function RetrievalFooter({
  retrievedAt,
  upstreamLastUpdated,
}: {
  readonly retrievedAt: string;
  readonly upstreamLastUpdated?: string | undefined;
}): JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText} testID="live-retrieved-at">
        Retrieved {formatParkDateTime(retrievedAt)}
      </Text>
      {upstreamLastUpdated !== undefined ? (
        <Text style={styles.footerText} testID="live-upstream-last-updated">
          Source updated {formatParkDateTime(upstreamLastUpdated)}
        </Text>
      ) : null}
    </View>
  );
}

/** A labeled key/value row used throughout the sections. */
export function DetailRow({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID?: string;
}): JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/** A sub-heading inside a live section (e.g. "Standby", "Forecast"). */
export function SubLabel({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  const styles = useStyles();
  return <SectionLabel style={styles.subLabel}>{children}</SectionLabel>;
}

/**
 * Lightning Lane block (R11.6). Renders the coarse Lightning Lane price,
 * return-window state, and return window when ThemeParks.wiki provides them.
 * Returns `null` when no sub-field is presentable so the section shows nothing
 * rather than an empty heading.
 */
export function LightningLaneBlock({
  state,
}: {
  readonly state: LightningLaneState;
}): JSX.Element | null {
  const styles = useStyles();
  const rows: { readonly label: string; readonly value: string; readonly testID: string }[] = [];

  if (state.price !== undefined) {
    rows.push({
      label: 'Price',
      value: formatLightningLanePrice(state.price.amount, state.price.currency),
      testID: 'lightning-lane-price',
    });
  }
  const coarse = humanizeCoarseState(state.state);
  if (coarse !== undefined) {
    rows.push({ label: 'Status', value: coarse, testID: 'lightning-lane-state' });
  }
  if (state.returnStart !== undefined && state.returnEnd !== undefined) {
    rows.push({
      label: 'Return window',
      value: `${formatParkTime(state.returnStart)} \u2013 ${formatParkTime(state.returnEnd)}`,
      testID: 'lightning-lane-window',
    });
  }
  if (rows.length === 0 && state.available !== undefined) {
    rows.push({
      label: 'Availability',
      value: state.available ? 'Available' : 'Not available',
      testID: 'lightning-lane-available',
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.block} testID="lightning-lane">
      <SubLabel>Lightning Lane</SubLabel>
      {rows.map((row) => (
        <DetailRow key={row.testID} label={row.label} value={row.value} testID={row.testID} />
      ))}
    </View>
  );
}

/**
 * Boarding group / virtual-queue block (R11.7). Renders the coarse
 * boarding-group state and current allocated group range when ThemeParks.wiki
 * provides them; `null` when nothing is presentable.
 */
export function BoardingGroupBlock({
  state,
}: {
  readonly state: BoardingGroupState;
}): JSX.Element | null {
  const styles = useStyles();
  const rows: { readonly label: string; readonly value: string; readonly testID: string }[] = [];

  const coarse = humanizeCoarseState(state.state);
  if (coarse !== undefined) {
    rows.push({ label: 'Status', value: coarse, testID: 'boarding-group-state' });
  }
  if (
    typeof state.currentGroupStart === 'number' &&
    typeof state.currentGroupEnd === 'number'
  ) {
    rows.push({
      label: 'Now boarding',
      value: `Groups ${state.currentGroupStart}\u2013${state.currentGroupEnd}`,
      testID: 'boarding-group-range',
    });
  }
  if (rows.length === 0 && state.available !== undefined) {
    rows.push({
      label: 'Availability',
      value: state.available ? 'Available' : 'Not available',
      testID: 'boarding-group-available',
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.block} testID="boarding-group">
      <SubLabel>Virtual Queue</SubLabel>
      {rows.map((row) => (
        <DetailRow key={row.testID} label={row.label} value={row.value} testID={row.testID} />
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: t.spacing.xs,
  },
  staleRow: {
    backgroundColor: t.color.warningSurface,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  staleText: {
    ...t.typography.meta,
    color: t.color.warningText,
  },
  footer: {
    marginTop: t.spacing.xs,
    gap: 2,
  },
  footerText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
  },
  detailLabel: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  detailValue: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
  },
  subLabel: {
    ...t.typography.subtitle,
    marginBottom: t.spacing.xs,
  },
}));
