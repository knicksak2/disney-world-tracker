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
import { ScrollView, Text, View } from 'react-native';

import type { ForecastEntry } from '@dwt/shared';

import { makeStyles } from '../../../theme/makeStyles';
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
  const styles = useStyles();
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

const useStyles = makeStyles((t) => ({
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  column: {
    width: COLUMN_WIDTH,
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  track: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 24,
    borderTopLeftRadius: t.radius.sm,
    borderTopRightRadius: t.radius.sm,
  },
  barDefault: {
    // Data mark on a surface. Stays `primaryLight` (light `#7e57c2`
    // byte-identical; dark `#b28dff` is 6.80:1 on the card, above the 3:1
    // non-text floor) — `primaryFg` would change the light value.
    backgroundColor: t.color.primaryLight,
  },
  barBest: {
    backgroundColor: t.color.success,
  },
  value: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  valueBest: {
    color: t.color.success,
  },
  hour: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  hourBest: {
    color: t.color.success,
    fontWeight: '700',
  },
}));
