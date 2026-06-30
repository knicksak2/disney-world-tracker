// Feature: experience-live-details, Task 11.1 — Ride / Character_Meet live section
//
// Validates: Requirements 4.1, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13
//
// The wait/status live section for Ride and Character_Meet experiences (R7.2).
// It renders:
//   - the Operating_Status label (R4.1) with the stale indicator when set (R4.6),
//   - the standby Wait_Time / no-wait-posted indicator, gated purely on status
//     and wait presence via `waitStatusDisplay` (R4.2, R4.3, R4.4),
//   - the Single_Rider_Wait, distinctly labeled (R4.7),
//   - the Return_Window state + park-local window (R4.8),
//   - the Paid_Return_Window's formatted price verbatim from upstream (R4.9),
//   - the Boarding_Group_Status allocation + current group range (R4.10),
//   - the upcoming Wait_Time_Forecast sorted ascending with the single lowest
//     entry highlighted, or the empty state when none (R4.11, R4.12),
//   - the Retrieved_At and distinctly-labeled Upstream_Last_Updated stamps in
//     park-local time (R4.5, R4.13).
//
// All ordering/selection/gating logic comes from the pure `liveView.ts` helpers;
// this component is presentation only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../theme/theme';
import { Badge, Card, EmptyState, SectionLabel } from '../../../theme/components';
import {
  lowestWaitEntry,
  upcomingForecast,
  waitStatusDisplay,
} from './liveView';
import { formatParkTime } from './parkTime';
import ForecastChart from './ForecastChart';
import {
  DetailRow,
  RetrievalFooter,
  StaleIndicator,
  StatusBadge,
  SubLabel,
  type LiveSectionProps,
} from './liveSectionShared';

export default function RideLiveSection({
  liveDetail,
  retrievedAt,
  stale,
  upstreamLastUpdated,
  now = new Date(),
}: LiveSectionProps & { readonly now?: Date }): JSX.Element {
  const wait = waitStatusDisplay(liveDetail.status, liveDetail.waitMinutes);
  const upcoming = upcomingForecast(liveDetail.forecast, now);
  const lowest = lowestWaitEntry(upcoming);

  return (
    <Card style={styles.section} testID="ride-live-section">
      <SectionLabel>Wait &amp; Status</SectionLabel>

      <View style={styles.statusRow}>
        <StatusBadge status={liveDetail.status} />
      </View>
      {stale ? <StaleIndicator /> : null}

      {/* Standby wait (R4.2) / no-wait-posted indicator (R4.4). A non-Operating
          status shows no wait value at all (R4.3 → kind 'none'). */}
      {wait.kind === 'standby' ? (
        <DetailRow
          label="Standby wait"
          value={`${wait.waitMinutes} min`}
          testID="standby-wait"
        />
      ) : null}
      {wait.kind === 'no_wait' ? (
        <Text style={styles.muted} testID="no-standby-wait">
          No standby wait time currently posted.
        </Text>
      ) : null}

      {/* Single_Rider_Wait, distinct from standby (R4.7). Only meaningful while
          Operating, matching the standby gating. */}
      {liveDetail.status === 'Operating' &&
      liveDetail.singleRiderWaitMinutes !== undefined ? (
        <DetailRow
          label="Single rider line"
          value={`${liveDetail.singleRiderWaitMinutes} min`}
          testID="single-rider-wait"
        />
      ) : null}

      {/* Return_Window state + optional park-local window (R4.8). */}
      {liveDetail.returnWindow !== undefined ? (
        <View style={styles.block} testID="return-window">
          <SubLabel>Return window</SubLabel>
          <Badge label={returnStateLabel(liveDetail.returnWindow.state)} />
          {liveDetail.returnWindow.state === 'Available' &&
          liveDetail.returnWindow.start !== undefined &&
          liveDetail.returnWindow.end !== undefined ? (
            <Text style={styles.muted} testID="return-window-times">
              {formatParkTime(liveDetail.returnWindow.start)} –{' '}
              {formatParkTime(liveDetail.returnWindow.end)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Paid_Return_Window — formatted price string verbatim from upstream (R4.9). */}
      {liveDetail.paidReturnWindow !== undefined ? (
        <View style={styles.block} testID="paid-return-window">
          <SubLabel>Lightning Lane</SubLabel>
          <Badge
            label={returnStateLabel(liveDetail.paidReturnWindow.state)}
          />
          <DetailRow
            label="Price"
            value={liveDetail.paidReturnWindow.price.formatted}
            testID="paid-return-price"
          />
          {liveDetail.paidReturnWindow.state === 'Available' &&
          liveDetail.paidReturnWindow.start !== undefined &&
          liveDetail.paidReturnWindow.end !== undefined ? (
            <Text style={styles.muted} testID="paid-return-times">
              {formatParkTime(liveDetail.paidReturnWindow.start)} –{' '}
              {formatParkTime(liveDetail.paidReturnWindow.end)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Boarding_Group_Status allocation + current group range (R4.10). */}
      {liveDetail.boardingGroup !== undefined ? (
        <View style={styles.block} testID="boarding-group">
          <SubLabel>Boarding group</SubLabel>
          <Badge label={liveDetail.boardingGroup.allocation} />
          {liveDetail.boardingGroup.currentGroupStart !== undefined &&
          liveDetail.boardingGroup.currentGroupEnd !== undefined ? (
            <DetailRow
              label="Now boarding"
              value={`${liveDetail.boardingGroup.currentGroupStart}–${liveDetail.boardingGroup.currentGroupEnd}`}
              testID="boarding-group-range"
            />
          ) : null}
          {liveDetail.boardingGroup.nextAllocationTime !== undefined ? (
            <DetailRow
              label="Next allocation"
              value={formatParkTime(liveDetail.boardingGroup.nextAllocationTime)}
              testID="boarding-group-next"
            />
          ) : null}
          {liveDetail.boardingGroup.estimatedWaitMinutes !== undefined ? (
            <DetailRow
              label="Estimated wait"
              value={`${liveDetail.boardingGroup.estimatedWaitMinutes} min`}
              testID="boarding-group-wait"
            />
          ) : null}
        </View>
      ) : null}

      {/* Wait_Time_Forecast: upcoming entries ascending as a bar chart, with
          the lowest entry highlighted (R4.11); empty state when none (R4.12). */}
      <View style={styles.block} testID="forecast">
        <SubLabel>Wait time forecast</SubLabel>
        {upcoming.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="No wait time forecast available"
            testID="forecast-empty"
          />
        ) : (
          <>
            <ForecastChart entries={upcoming} lowest={lowest} />
            {lowest !== undefined ? (
              <Text style={styles.forecastLegend} testID="forecast-legend">
                Lowest predicted wait: {lowest.waitMinutes} min at{' '}
                {formatParkTime(lowest.time)}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <RetrievalFooter
        retrievedAt={retrievedAt}
        upstreamLastUpdated={upstreamLastUpdated}
      />
    </Card>
  );
}

/** Map a return-window state enum to its user-facing label (R4.8). */
function returnStateLabel(state: string): string {
  return state.replace(/_/g, ' ');
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
  muted: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  forecastLegend: {
    ...theme.typography.meta,
    color: theme.color.success,
  },
});
