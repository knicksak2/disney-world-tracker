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
import { StyleSheet, Text, View } from 'react-native';

import type { LiveDetailDTO, OperatingStatus } from '@dwt/shared';

import { theme } from '../../../theme/theme';
import { Badge, SectionLabel } from '../../../theme/components';
import { formatParkDateTime } from './parkTime';

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
 * Per-status badge tint. Operating reads as success, hard-down/closed as
 * danger, refurbishment as a warning hue, and Unknown as a neutral grey.
 */
const STATUS_COLOR: Record<OperatingStatus, string> = {
  Operating: theme.color.success,
  Closed: theme.color.danger,
  Down: theme.color.danger,
  Refurbishment: theme.color.warning,
  Unknown: theme.color.textSecondary,
};

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
  return (
    <Badge
      label={status}
      color={STATUS_COLOR[status]}
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
  return <SectionLabel style={styles.subLabel}>{children}</SectionLabel>;
}

const styles = StyleSheet.create({
  staleRow: {
    backgroundColor: theme.color.warningSurface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  staleText: {
    ...theme.typography.meta,
    color: theme.color.warningText,
  },
  footer: {
    marginTop: theme.spacing.xs,
    gap: 2,
  },
  footerText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  detailLabel: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  detailValue: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  subLabel: {
    ...theme.typography.subtitle,
    marginBottom: theme.spacing.xs,
  },
});
