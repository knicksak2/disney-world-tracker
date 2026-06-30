/**
 * Unit tests for the park-time helpers (task 3.2).
 *
 * Covers:
 *   - `WDW_TIME_ZONE` is the single US-Eastern zone every WDW Park observes.
 *   - `isCurrentParkDay` decides same-day/different-day correctly across the
 *     park-local midnight boundary, including the case where two instants share
 *     a UTC calendar day but fall on different park-local days and vice versa
 *     (R1.7, R1.19).
 *   - `upcomingForecast` filters to entries at or after `now` and returns them
 *     sorted ascending by time, without mutating the input and with a stable
 *     tie-break for equal times (R4.11).
 *
 * No I/O is involved; the helpers are pure and resolve zones via Intl.
 */

import { describe, expect, it } from 'vitest';
import type { ForecastEntry } from '@dwt/shared';

import {
  WDW_TIME_ZONE,
  isCurrentParkDay,
  upcomingForecast,
} from '../parkTime.js';

describe('WDW_TIME_ZONE', () => {
  it('is the single US Eastern zone shared by every WDW Park', () => {
    expect(WDW_TIME_ZONE).toBe('America/New_York');
  });
});

describe('isCurrentParkDay', () => {
  it('returns true for two instants on the same park-local calendar day', () => {
    // Both are 2024-06-15 in America/New_York (EDT, UTC-4).
    const morning = new Date('2024-06-15T12:00:00Z'); // 08:00 EDT
    const evening = new Date('2024-06-15T23:30:00Z'); // 19:30 EDT
    expect(isCurrentParkDay(morning, evening)).toBe(true);
  });

  it('returns false for two instants on different park-local calendar days', () => {
    const day1 = new Date('2024-06-15T12:00:00Z'); // 2024-06-15 EDT
    const day2 = new Date('2024-06-16T12:00:00Z'); // 2024-06-16 EDT
    expect(isCurrentParkDay(day1, day2)).toBe(false);
  });

  it('treats an instant just before park-local midnight as the prior day', () => {
    // 2024-06-16T03:30:00Z = 2024-06-15 23:30 EDT (still the 15th park-local).
    const lateNight = new Date('2024-06-16T03:30:00Z');
    // 2024-06-16T05:00:00Z = 2024-06-16 01:00 EDT (now the 16th park-local).
    const afterMidnight = new Date('2024-06-16T05:00:00Z');
    expect(isCurrentParkDay(lateNight, afterMidnight)).toBe(false);
  });

  it('treats two instants straddling the same UTC midnight but the same park-local day as same day', () => {
    // Both fall on 2024-06-15 park-local even though they straddle UTC midnight.
    // 2024-06-15T22:00:00Z = 2024-06-15 18:00 EDT
    const beforeUtcMidnight = new Date('2024-06-15T22:00:00Z');
    // 2024-06-16T01:00:00Z = 2024-06-15 21:00 EDT
    const afterUtcMidnight = new Date('2024-06-16T01:00:00Z');
    expect(isCurrentParkDay(beforeUtcMidnight, afterUtcMidnight)).toBe(true);
  });

  it('distinguishes park-local days for instants that share a UTC calendar day', () => {
    // Both are on 2024-06-15 in UTC, but park-local they are the 14th and 15th.
    // 2024-06-15T02:00:00Z = 2024-06-14 22:00 EDT
    const parkPrevDay = new Date('2024-06-15T02:00:00Z');
    // 2024-06-15T16:00:00Z = 2024-06-15 12:00 EDT
    const parkSameDay = new Date('2024-06-15T16:00:00Z');
    expect(isCurrentParkDay(parkPrevDay, parkSameDay)).toBe(false);
  });

  it('honours an explicitly supplied time zone', () => {
    // 2024-06-15T23:30:00Z is 2024-06-16 in Sydney (UTC+10) but 2024-06-15 in NY.
    const instant = new Date('2024-06-15T23:30:00Z');
    const now = new Date('2024-06-15T12:00:00Z');
    expect(isCurrentParkDay(instant, now, WDW_TIME_ZONE)).toBe(true);
    expect(isCurrentParkDay(instant, now, 'Australia/Sydney')).toBe(false);
  });
});

describe('upcomingForecast', () => {
  function entry(time: string, waitMinutes = 10, percentage = 50): ForecastEntry {
    return { time, waitMinutes, percentage };
  }

  it('filters out entries strictly before now and keeps the entry exactly at now', () => {
    const now = new Date('2024-06-15T12:00:00Z');
    const entries = [
      entry('2024-06-15T11:00:00Z'),
      entry('2024-06-15T12:00:00Z'),
      entry('2024-06-15T13:00:00Z'),
    ];
    const result = upcomingForecast(entries, now);
    expect(result.map((e) => e.time)).toEqual([
      '2024-06-15T12:00:00Z',
      '2024-06-15T13:00:00Z',
    ]);
  });

  it('returns the upcoming entries sorted ascending by time', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const entries = [
      entry('2024-06-15T15:00:00Z'),
      entry('2024-06-15T09:00:00Z'),
      entry('2024-06-15T12:00:00Z'),
    ];
    const result = upcomingForecast(entries, now);
    expect(result.map((e) => e.time)).toEqual([
      '2024-06-15T09:00:00Z',
      '2024-06-15T12:00:00Z',
      '2024-06-15T15:00:00Z',
    ]);
  });

  it('returns an empty series when every entry is in the past', () => {
    const now = new Date('2024-06-15T20:00:00Z');
    const entries = [
      entry('2024-06-15T10:00:00Z'),
      entry('2024-06-15T12:00:00Z'),
    ];
    expect(upcomingForecast(entries, now)).toEqual([]);
  });

  it('returns an empty series for empty input', () => {
    expect(upcomingForecast([], new Date('2024-06-15T12:00:00Z'))).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const entries = [
      entry('2024-06-15T15:00:00Z'),
      entry('2024-06-15T09:00:00Z'),
    ];
    const snapshot = entries.map((e) => e.time);
    upcomingForecast(entries, now);
    expect(entries.map((e) => e.time)).toEqual(snapshot);
  });

  it('preserves input order for entries with equal times (stable sort)', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const first = entry('2024-06-15T12:00:00Z', 20);
    const second = entry('2024-06-15T12:00:00Z', 35);
    const result = upcomingForecast([first, second], now);
    expect(result.map((e) => e.waitMinutes)).toEqual([20, 35]);
  });
});
