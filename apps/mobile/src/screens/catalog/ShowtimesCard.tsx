// Feature: experience-detail-redesign, Task 18.2 — ShowtimesCard
//
// Validates: Requirements 14.2
//
// Today_In_Park_Lens card for Show / Character_Meet experiences where liveSectionFor()
// resolves to showtimes, listing today's showtimes and indicating the next upcoming one.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Showtime } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { EmptyState } from '../../theme/components';
import { sortedShowtimes } from './live/liveView';
import { formatParkTime } from './live/parkTime';

export interface ShowtimesCardProps {
  readonly showtimes?: readonly Showtime[] | undefined;
  readonly now?: Date;
}

export default function ShowtimesCard({
  showtimes = [],
  now = new Date(),
}: ShowtimesCardProps): JSX.Element {
  const sorted = sortedShowtimes(showtimes);
  const nowMs = now.getTime();

  const nextUpcomingIndex = sorted.findIndex(
    (s) => new Date(s.start).getTime() >= nowMs,
  );
  const nextShowtime = nextUpcomingIndex !== -1 ? sorted[nextUpcomingIndex] : undefined;

  const nonStandardTypes = Array.from(
    new Set(
      sorted
        .map((s) => s.type)
        .filter(
          (t): t is string =>
            typeof t === 'string' &&
            t.trim().length > 0 &&
            !/^(standard|regular)$/i.test(t.trim()),
        ),
    ),
  );

  return (
    <View style={styles.card} testID="showtimes-card">
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <Text style={styles.titleIcon}>🎭</Text>
          <Text style={styles.title}>Today&apos;s Showtimes</Text>
        </View>
        {nextShowtime ? (
          <View style={styles.pulseBadge} testID="next-showtime-indicator">
            <View style={styles.pulseDotWrapper}>
              <View style={styles.pulseDot} />
            </View>
            <Text style={styles.pulseText}>
              Next at {formatParkTime(nextShowtime.start)}
            </Text>
          </View>
        ) : null}
      </View>

      {sorted.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No performance times scheduled"
          body="Check back later for today's showtimes."
          testID="showtimes-empty"
        />
      ) : (
        <View style={styles.contentWrap}>
          {nonStandardTypes.length > 0 ? (
            <View style={styles.typeNotice} testID="showtime-type">
              <Ionicons name="ticket-outline" size={13} color="#7e22ce" />
              <Text style={styles.typeNoticeText}>
                {nonStandardTypes.join(' • ')}
              </Text>
            </View>
          ) : null}

          <View style={styles.pillsRow} testID="showtimes-list">
            {sorted.map((showtime, index) => {
              const isNext = index === nextUpcomingIndex;
              const isPast = nextUpcomingIndex === -1 || index < nextUpcomingIndex;
              const startFormatted = formatParkTime(showtime.start);
              const endFormatted = showtime.end ? formatParkTime(showtime.end) : null;
              const timeText =
                endFormatted && endFormatted !== startFormatted
                  ? `${startFormatted} \u2013 ${endFormatted}`
                  : startFormatted;

              return (
                <View
                  key={`${showtime.start}-${index}`}
                  style={[
                    styles.pill,
                    isNext ? styles.pillNext : isPast ? styles.pillPast : styles.pillFuture,
                  ]}
                  testID="showtime-row"
                >
                  <Text
                    style={[
                      styles.pillText,
                      isNext
                        ? styles.pillTextNext
                        : isPast
                        ? styles.pillTextPast
                        : styles.pillTextFuture,
                    ]}
                    testID="showtime-time"
                  >
                    {isNext ? `${timeText} (Next)` : timeText}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    marginBottom: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    borderRadius: 22,
    padding: 16,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  titleIcon: {
    fontSize: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
    letterSpacing: -0.2,
  },
  pulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(22, 163, 74, 0.25)',
  },
  pulseDotWrapper: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: 'rgba(22, 163, 74, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16a34a',
  },
  pulseText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16a34a',
  },
  contentWrap: {
    gap: 8,
  },
  typeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#f5eeff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  typeNoticeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7e22ce',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPast: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  pillTextPast: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#9ca3af',
  },
  pillNext: {
    backgroundColor: '#16a34a',
    borderWidth: 1,
    borderColor: '#15803d',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  pillTextNext: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  pillFuture: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dcd1ed',
  },
  pillTextFuture: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#190c2d',
  },
  pillText: {
    fontSize: 11.5,
  },
});
