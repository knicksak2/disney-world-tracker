// Feature: experience-detail-redesign, Task 16.1 — LiveStatusStrip
//
// Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
//
// Compact status strip rendered above the LensSwitcher, visible across both Lenses.
// Surfaces the category-appropriate headline value:
//   - Ride / Character_Meet: standby wait minutes (or closed/down) + Lightning Lane state
//   - Restaurant: reservation availability state + next available time
//   - Show / Parade: countdown in minutes to next showtime + that showtime's clock time
//   - None: omitted when liveSectionFor() returns 'none'
//   - Live error: renders live-unavailable indicator

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  ExperienceCategory,
  LiveDetailResponseDTO,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { liveSectionFor, NO_LIVE_SHAPE, type LiveShape } from './gating';
import { formatParkTime } from './live/parkTime';
import { sortedShowtimes } from './live/liveView';

export interface LiveStatusStripProps {
  readonly category: ExperienceCategory;
  readonly liveQuery: {
    readonly data?: LiveDetailResponseDTO | undefined;
    readonly isLoading?: boolean;
    readonly isError?: boolean;
  };
  readonly now?: Date;
}

export default function LiveStatusStrip({
  category,
  liveQuery,
  now = new Date(),
}: LiveStatusStripProps): JSX.Element | null {
  const detail = liveQuery.data?.liveDetail;
  const liveShape: LiveShape = detail
    ? {
        hasStandbyWait:
          typeof detail.waitMinutes === 'number' && !Number.isNaN(detail.waitMinutes),
        hasShowtimes:
          Array.isArray(detail.showtimes) && detail.showtimes.length > 0,
      }
    : NO_LIVE_SHAPE;

  const section = liveSectionFor(category, liveShape);

  // Requirement 12.5: omit when category has no live operational section
  if (section === 'none') {
    return null;
  }

  // Requirement 12.6: live failure renders live-unavailable indication
  if (liveQuery.isError || (liveQuery.data === undefined && !liveQuery.isLoading)) {
    return (
      <View
        style={[styles.container, styles.unavailableContainer]}
        testID="live-status-strip-unavailable"
        accessibilityLabel="Live information currently unavailable"
      >
        <Ionicons name="cloud-offline-outline" size={16} color={theme.color.danger} />
        <Text style={styles.unavailableText} testID="live-unavailable">
          Live information unavailable
        </Text>
      </View>
    );
  }

  // Loading state
  if (liveQuery.isLoading || !detail) {
    return (
      <View
        style={styles.container}
        testID="live-status-strip"
        accessibilityLabel="Loading live status"
      >
        <Text style={styles.mutedText}>Loading live status...</Text>
      </View>
    );
  }

  // Requirement 12.2: Ride / Character_Meet
  if (section === 'wait_status') {
    const isOperating = detail.status === 'Operating';
    const waitText = isOperating
      ? typeof detail.waitMinutes === 'number'
        ? `${detail.waitMinutes} min wait`
        : 'No wait posted'
      : detail.status;

    let llText: string | null = null;
    if (detail.lightningLane) {
      if (detail.lightningLane.returnStart && detail.lightningLane.returnEnd) {
        llText = `LL: ${formatParkTime(detail.lightningLane.returnStart)} \u2013 ${formatParkTime(detail.lightningLane.returnEnd)}`;
      } else if (detail.lightningLane.state) {
        llText = `LL: ${detail.lightningLane.state}`;
      } else if (detail.lightningLane.available !== undefined) {
        llText = detail.lightningLane.available ? 'LL Available' : 'LL Unavailable';
      }
    }

    return (
      <View
        style={styles.container}
        testID="live-status-strip"
        accessibilityLabel={`Live status: ${waitText}${llText ? `, ${llText}` : ''}`}
      >
        <View style={styles.headlineGroup}>
          <Ionicons
            name={isOperating ? 'time' : 'alert-circle'}
            size={18}
            color={isOperating ? theme.color.primary : theme.color.danger}
          />
          <Text style={styles.headlineText} testID="live-status-headline">
            {waitText}
          </Text>
        </View>

        {llText ? (
          <View style={styles.llBadge} testID="live-status-ll">
            <Ionicons name="flash" size={13} color="#92400e" />
            <Text style={styles.llBadgeText}>{llText}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Requirement 12.3: Restaurant
  if (section === 'dining') {
    let availState = 'Reservations Available';
    let nextTime: string | null = null;

    if (detail.diningAvailability && detail.diningAvailability.length > 0) {
      const first = detail.diningAvailability[0];
      if (first?.status) {
        availState = first.status;
      }
      if (first?.estimatedWaitMinutes !== undefined) {
        nextTime = `~${first.estimatedWaitMinutes} min wait`;
      }
    } else if (detail.operatingHours && detail.operatingHours.length > 0) {
      const firstHour = detail.operatingHours[0];
      if (firstHour) {
        nextTime = formatParkTime(firstHour.open);
      }
    }

    const displayText = nextTime ? `${availState} \u2022 ${nextTime}` : availState;

    return (
      <View
        style={styles.container}
        testID="live-status-strip"
        accessibilityLabel={`Dining status: ${displayText}`}
      >
        <View style={styles.headlineGroup}>
          <Ionicons name="restaurant" size={17} color={theme.color.primary} />
          <Text style={styles.headlineText} testID="live-status-headline">
            {displayText}
          </Text>
        </View>
      </View>
    );
  }

  // Requirement 12.4: Show / Parade
  if (section === 'showtimes') {
    const sorted = sortedShowtimes(detail.showtimes);
    const nowMs = now.getTime();
    const upcoming = sorted.filter((s) => new Date(s.start).getTime() >= nowMs);
    const nextShow = upcoming[0] ?? sorted[0];

    let headline = 'No showtimes scheduled';
    if (nextShow) {
      const showMs = new Date(nextShow.start).getTime();
      const diffMin = Math.max(0, Math.round((showMs - nowMs) / 60000));
      const clockTime = formatParkTime(nextShow.start);
      headline = `Next in ${diffMin} min \u2022 ${clockTime}`;
    }

    return (
      <View
        style={styles.container}
        testID="live-status-strip"
        accessibilityLabel={`Showtime status: ${headline}`}
      >
        <View style={styles.headlineGroup}>
          <Ionicons name="musical-notes" size={17} color={theme.color.primary} />
          <Text style={styles.headlineText} testID="live-status-headline">
            {headline}
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: 0,
    marginTop: 2,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: '#e6def2',
    shadowColor: '#190c2d',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  unavailableContainer: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    justifyContent: 'flex-start',
    gap: 8,
  },
  unavailableText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.danger,
  },
  mutedText: {
    fontSize: 12,
    color: theme.color.textSecondary,
  },
  headlineGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headlineText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  llBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  llBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#92400e',
  },
});
