// Feature: experience-live-details, Task 11.1 — Restaurant dining section
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
//
// The dining live section for Restaurant experiences (R7.4). It renders:
//   - the Operating_Status label (R6.1) with the stale indicator when set,
//   - the current-day Operating_Hours open/close in park-local time with the
//     optional Operating_Hours_Type label (R6.2, R6.5), or the "dining hours
//     unavailable" empty state when none carry both open and close (R6.3),
//   - the walk-up Dining_Availability as a first-class element independent of
//     hours, one row per entry with optional party size and estimated wait
//     (R6.6), or the "walk-up unavailable" empty state when the list is empty
//     (R6.7),
//   - the Retrieved_At and distinctly-labeled Upstream_Last_Updated stamps in
//     park-local time (R6.4, R6.8).
//
// The empty-state decisions come from the pure `diningHoursState` /
// `diningWalkupState` helpers; this component is presentation only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DiningAvailabilityEntry, OperatingHours } from '@dwt/shared';

import { theme } from '../../../theme/theme';
import { Badge, Card, EmptyState, SectionLabel } from '../../../theme/components';
import { diningHoursState, diningWalkupState } from './liveView';
import { formatParkTime } from './parkTime';
import {
  RetrievalFooter,
  StaleIndicator,
  StatusBadge,
  SubLabel,
  type LiveSectionProps,
} from './liveSectionShared';

export default function DiningSection({
  liveDetail,
  retrievedAt,
  stale,
  upstreamLastUpdated,
}: LiveSectionProps): JSX.Element {
  const hours = diningHoursState(liveDetail.operatingHours);
  const walkup = diningWalkupState(liveDetail.diningAvailability);

  return (
    <Card style={styles.section} testID="dining-section">
      <SectionLabel>Dining</SectionLabel>

      <View style={styles.statusRow}>
        <StatusBadge status={liveDetail.status} />
      </View>
      {stale ? <StaleIndicator /> : null}

      {/* Operating_Hours (R6.2, R6.5) or "hours unavailable" empty state (R6.3). */}
      <View style={styles.block} testID="dining-hours">
        <SubLabel>Hours</SubLabel>
        {hours.kind === 'unavailable' ? (
          <EmptyState
            icon="time-outline"
            title="Dining hours unavailable"
            body="Today's hours aren't available right now."
            testID="dining-hours-empty"
          />
        ) : (
          hours.hours.map((entry, index) => (
            <HoursRow key={`${entry.open}-${index}`} hours={entry} />
          ))
        )}
      </View>

      {/* Walk-up Dining_Availability (R6.6) or empty state (R6.7), independent
          of whether hours are present (R6.6). */}
      <View style={styles.block} testID="dining-walkup">
        <SubLabel>Walk-up availability</SubLabel>
        {walkup.kind === 'unavailable' ? (
          <EmptyState
            icon="people-outline"
            title="Walk-up dining unavailable"
            body="No walk-up availability is posted for today."
            testID="dining-walkup-empty"
          />
        ) : (
          walkup.entries.map((entry, index) => (
            <WalkupRow key={index} entry={entry} />
          ))
        )}
      </View>

      <RetrievalFooter
        retrievedAt={retrievedAt}
        upstreamLastUpdated={upstreamLastUpdated}
      />
    </Card>
  );
}

/**
 * A single set of current-day Operating_Hours: open–close in park-local time
 * (R6.2) with the optional Operating_Hours_Type label (R6.5).
 */
function HoursRow({ hours }: { readonly hours: OperatingHours }): JSX.Element {
  return (
    <View style={styles.hoursRow} testID="dining-hours-row">
      <Text style={styles.hoursText} testID="dining-hours-text">
        {formatParkTime(hours.open)} – {formatParkTime(hours.close)}
      </Text>
      {hours.type !== undefined ? (
        <Badge label={hours.type} testID="dining-hours-type" />
      ) : null}
    </View>
  );
}

/**
 * A single walk-up availability entry: party size and estimated wait are each
 * shown only when present (R6.6).
 */
function WalkupRow({
  entry,
}: {
  readonly entry: DiningAvailabilityEntry;
}): JSX.Element {
  const parts: string[] = [];
  if (entry.partySize !== undefined) {
    parts.push(`Party of ${entry.partySize}`);
  }
  if (entry.estimatedWaitMinutes !== undefined) {
    parts.push(`${entry.estimatedWaitMinutes} min wait`);
  }
  // An entry with neither field still renders as a present row so the
  // cardinality of the upstream list is preserved for the user.
  const label = parts.length > 0 ? parts.join(' · ') : 'Walk-up available';

  return (
    <View style={styles.walkupRow} testID="dining-walkup-row">
      <Text style={styles.walkupText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  block: {
    gap: theme.spacing.xs,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  hoursText: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  walkupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
  },
  walkupText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
});
