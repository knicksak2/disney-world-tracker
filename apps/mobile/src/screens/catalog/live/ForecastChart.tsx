// Feature: experience-live-details, Task 11.1 (enhancement) — wait-time forecast chart
//
// Validates: Requirements 4.11, 4.12
//
// A lightweight, dependency-free bar chart for the upcoming Wait_Time_Forecast.
// Each upcoming entry is a vertical bar whose height is proportional to its
// predicted standby wait relative to the tallest upcoming bar; the single
// lowest-wait entry is highlighted (R4.11). Built from plain themed `View`s
// (no native charting dependency) so it renders under Expo and jest without
// extra setup. All ordering/selection comes from the pure `liveView` helpers;
// this component is presentation only.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ForecastEntry } from '@dwt/shared';

import { theme } from '../../../theme/theme';
import { forecastChartBars } from './liveView';
import { formatParkHour } from './parkTime';

/** Pixel height of the plotting area the tallest bar fills. */
const CHART_HEIGHT = 120;
/** Minimum visible bar height so a near-zero wait still reads as a bar. */
const MIN_BAR_HEIGHT = 6;
/** Fixed column width; the chart scrolls horizontally when entries overflow. */
const COLUMN_WIDTH = 52;

export default function ForecastChart({
  entries,
  lowest,
}: {
  readonly entries: readonly ForecastEntry[];
  readonly lowest: ForecastEntry | undefined;
}): JSX.Element {
  const bars = forecastChartBars(entries, lowest);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.plot}
      testID="forecast-chart"
    >
      {bars.map((bar, index) => {
        const height = Math.max(
          MIN_BAR_HEIGHT,
          Math.round(bar.heightFraction * CHART_HEIGHT),
        );
        return (
          <View
            key={`${bar.entry.time}-${index}`}
            style={styles.column}
            testID={bar.isLowest ? 'forecast-bar-lowest' : 'forecast-bar'}
            accessibilityRole="text"
            accessibilityLabel={`${formatParkHour(bar.entry.time)}: ${bar.entry.waitMinutes} minute wait${
              bar.isLowest ? ', lowest predicted wait' : ''
            }`}
          >
            <Text
              style={[styles.value, bar.isLowest && styles.valueBest]}
              numberOfLines={1}
            >
              {bar.entry.waitMinutes} min
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  { height },
                  bar.isLowest ? styles.barBest : styles.barDefault,
                ]}
              />
            </View>
            <Text
              style={[styles.hour, bar.isLowest && styles.hourBest]}
              numberOfLines={1}
            >
              {formatParkHour(bar.entry.time)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  column: {
    width: COLUMN_WIDTH,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  track: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 24,
    borderTopLeftRadius: theme.radius.sm,
    borderTopRightRadius: theme.radius.sm,
  },
  barDefault: {
    backgroundColor: theme.color.primaryLight,
  },
  barBest: {
    backgroundColor: theme.color.success,
  },
  value: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  valueBest: {
    color: theme.color.success,
  },
  hour: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  hourBest: {
    color: theme.color.success,
    fontWeight: '700',
  },
});
