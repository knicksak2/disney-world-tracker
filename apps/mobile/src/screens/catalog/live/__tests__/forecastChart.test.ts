// Feature: experience-live-details — unit tests for the forecast chart bar model
//
// Validates: Requirements 4.11
//
// `forecastChartBars` is the pure normalization helper behind the wait-time
// forecast bar chart. These example-based tests pin its height normalization,
// the lowest-entry flag, order/identity preservation, and the all-zero edge.

import type { ForecastEntry } from '@dwt/shared';

import { forecastChartBars, lowestWaitEntry } from '../liveView';

function entry(time: string, waitMinutes: number): ForecastEntry {
  return { time, waitMinutes, percentage: 50 };
}

describe('forecastChartBars', () => {
  it('normalizes bar heights against the largest wait and flags the lowest', () => {
    const entries = [
      entry('2024-05-01T20:00:00Z', 40), // tallest → fraction 1
      entry('2024-05-01T21:00:00Z', 10), // lowest → flagged
      entry('2024-05-01T22:00:00Z', 20),
    ];
    const lowest = lowestWaitEntry(entries);

    const bars = forecastChartBars(entries, lowest);

    expect(bars).toHaveLength(3);
    // Heights are proportional to the max (40).
    expect(bars[0]!.heightFraction).toBeCloseTo(1);
    expect(bars[1]!.heightFraction).toBeCloseTo(10 / 40);
    expect(bars[2]!.heightFraction).toBeCloseTo(20 / 40);
    // Every fraction is within [0, 1].
    for (const bar of bars) {
      expect(bar.heightFraction).toBeGreaterThanOrEqual(0);
      expect(bar.heightFraction).toBeLessThanOrEqual(1);
    }
    // Exactly the lowest entry is flagged.
    expect(bars.filter((b) => b.isLowest)).toHaveLength(1);
    expect(bars[1]!.isLowest).toBe(true);
  });

  it('preserves input order and entry identity', () => {
    const entries = [
      entry('2024-05-01T20:00:00Z', 30),
      entry('2024-05-01T21:00:00Z', 15),
    ];
    const bars = forecastChartBars(entries, undefined);
    expect(bars.map((b) => b.entry)).toEqual(entries);
  });

  it('yields zero-height bars when every wait is zero (no division by zero)', () => {
    const entries = [
      entry('2024-05-01T20:00:00Z', 0),
      entry('2024-05-01T21:00:00Z', 0),
    ];
    const bars = forecastChartBars(entries, undefined);
    expect(bars.every((b) => b.heightFraction === 0)).toBe(true);
  });

  it('returns an empty model for an empty forecast', () => {
    expect(forecastChartBars([], undefined)).toEqual([]);
  });
});
