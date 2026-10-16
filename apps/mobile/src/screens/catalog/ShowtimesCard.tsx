// Feature: experience-detail-redesign, Task 18.2 — ShowtimesCard
//
// Validates: Requirements 14.2
//
// Today_In_Park_Lens card for Show / Character_Meet experiences where liveSectionFor()
// resolves to showtimes, listing today's showtimes and indicating the next upcoming one.

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Showtime } from '@dwt/shared';

import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { EmptyState } from '../../theme/components';
import { SHOWTIMES } from './ShowtimesCard.palette';
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
  const styles = useStyles();
  const pal = usePalette(SHOWTIMES);
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
              <Ionicons name="ticket-outline" size={13} color={pal.typeIcon} />
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

const useStyles = makeStyles((t) => ({
  card: {
    marginHorizontal: t.spacing.lg,
    marginTop: t.spacing.md,
    marginBottom: 4,
    backgroundColor: t.color.surface,
    borderWidth: 1.5,
    borderColor: SHOWTIMES[t.scheme].cardBorder,
    borderRadius: 22,
    padding: 16,
    shadowColor: SHOWTIMES[t.scheme].cardShadow,
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
    ...t.textDefault,
    fontSize: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: SHOWTIMES[t.scheme].title,
    letterSpacing: -0.2,
  },
  pulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SHOWTIMES[t.scheme].pulseBg,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: SHOWTIMES[t.scheme].pulseBorder,
  },
  pulseDotWrapper: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: SHOWTIMES[t.scheme].pulseDotRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SHOWTIMES[t.scheme].pulseDot,
  },
  pulseText: {
    fontSize: 11,
    fontWeight: '800',
    color: SHOWTIMES[t.scheme].pulseText,
  },
  contentWrap: {
    gap: 8,
  },
  typeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: SHOWTIMES[t.scheme].typeBg,
    borderWidth: 1,
    borderColor: SHOWTIMES[t.scheme].typeBorder,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  typeNoticeText: {
    fontSize: 11,
    fontWeight: '700',
    color: SHOWTIMES[t.scheme].typeText,
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
    backgroundColor: SHOWTIMES[t.scheme].pastBg,
    borderWidth: 1,
    borderColor: SHOWTIMES[t.scheme].pastBorder,
  },
  pillTextPast: {
    fontSize: 11.5,
    fontWeight: '600',
    color: SHOWTIMES[t.scheme].pastText,
  },
  pillNext: {
    backgroundColor: SHOWTIMES[t.scheme].nextBg,
    borderWidth: 1,
    borderColor: SHOWTIMES[t.scheme].nextBorder,
    shadowColor: SHOWTIMES[t.scheme].nextShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  pillTextNext: {
    fontSize: 11.5,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  pillFuture: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: SHOWTIMES[t.scheme].futureBorder,
  },
  pillTextFuture: {
    fontSize: 11.5,
    fontWeight: '700',
    color: SHOWTIMES[t.scheme].futureText,
  },
  pillText: {
    fontSize: 11.5,
  },
}));
