// Feature: experience-live-details, Task 11.1 — Show / Parade showtimes section
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
//
// The showtime live section for Show and Parade experiences (R7.3). It renders:
//   - the Operating_Status label (R5.3) with the stale indicator when set,
//   - each current-day Showtime's start time sorted ascending in park-local
//     time (R5.1), the optional end time (R5.4), and the optional Showtime_Type
//     label alongside it (R5.6),
//   - the "no performances scheduled" empty state when there are none (R5.2),
//   - the Retrieved_At and distinctly-labeled Upstream_Last_Updated stamps in
//     park-local time (R5.5, R5.7).
//
// Ordering comes from the pure `sortedShowtimes` helper; this component is
// presentation only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Showtime } from '@dwt/shared';

import { theme } from '../../../theme/theme';
import { Badge, Card, EmptyState, SectionLabel } from '../../../theme/components';
import { sortedShowtimes } from './liveView';
import { formatParkTime } from './parkTime';
import {
  RetrievalFooter,
  StaleIndicator,
  StatusBadge,
  type LiveSectionProps,
} from './liveSectionShared';

export default function ShowtimesSection({
  liveDetail,
  retrievedAt,
  stale,
  upstreamLastUpdated,
}: LiveSectionProps): JSX.Element {
  const showtimes = sortedShowtimes(liveDetail.showtimes);

  return (
    <Card style={styles.section} testID="showtimes-section">
      <SectionLabel>Today&apos;s Performances</SectionLabel>

      <View style={styles.statusRow}>
        <StatusBadge status={liveDetail.status} />
      </View>
      {stale ? <StaleIndicator /> : null}

      {showtimes.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No performance times scheduled"
          body="Check back later for today's showtimes."
          testID="showtimes-empty"
        />
      ) : (
        <View style={styles.list} testID="showtimes-list">
          {showtimes.map((showtime, index) => (
            <ShowtimeRow
              key={`${showtime.start}-${index}`}
              showtime={showtime}
            />
          ))}
        </View>
      )}

      <RetrievalFooter
        retrievedAt={retrievedAt}
        upstreamLastUpdated={upstreamLastUpdated}
      />
    </Card>
  );
}

/**
 * A single performance row: start time (R5.1), optional end time (R5.4), and
 * the optional Showtime_Type label (R5.6).
 */
function ShowtimeRow({ showtime }: { readonly showtime: Showtime }): JSX.Element {
  const timeRange =
    showtime.end !== undefined
      ? `${formatParkTime(showtime.start)} – ${formatParkTime(showtime.end)}`
      : formatParkTime(showtime.start);

  return (
    <View style={styles.showtimeRow} testID="showtime-row">
      <Text style={styles.showtimeTime} testID="showtime-time">
        {timeRange}
      </Text>
      {showtime.type !== undefined ? (
        <Badge label={showtime.type} testID="showtime-type" />
      ) : null}
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
  list: {
    gap: theme.spacing.sm,
  },
  showtimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  showtimeTime: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
});
