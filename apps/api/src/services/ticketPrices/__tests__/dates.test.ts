/**
 * Tests for dates.ts: daysBetween, wdwDateOf, addDays, dateToInstant.
 *
 * Validates: Requirements 11.3, 11.4, 11.14, 5.10
 */

import { describe, expect, it } from 'vitest';
import { addDays, dateToInstant, daysBetween, wdwDateOf } from '../dates.js';

describe('dates.ts arithmetic', () => {
  it('daysBetween is signed and DST-safe across 2026-03-08 and 2026-11-01, and handles leap years', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // Leap year 2028
    expect(daysBetween('2026-10-25', '2026-10-25')).toBe(0);
  });

  it('addDays(d, -364) keeps the weekday, round-trips with daysBetween, and crosses year-end and leap days', () => {
    const dates = ['2026-10-25', '2027-01-05', '2028-03-05', '2028-12-31'];
    for (const d of dates) {
      const prior = addDays(d, -364);
      expect(daysBetween(prior, d)).toBe(364);

      // 364 days is exactly 52 weeks, so day of week must match
      const dayOriginal = new Date(`${d}T12:00:00Z`).getUTCDay();
      const dayPrior = new Date(`${prior}T12:00:00Z`).getUTCDay();
      expect(dayPrior).toBe(dayOriginal);
    }
  });

  it('wdwDateOf(dateToInstant(d)) === d for every date of 2026, 2027, and 2028 including DST and leap days', () => {
    const testInstants = [
      '2026-03-08',
      '2026-11-01',
      '2027-03-14',
      '2027-11-07',
      '2028-02-29',
    ];
    for (const d of testInstants) {
      expect(wdwDateOf(dateToInstant(d))).toBe(d);
    }

    // Exhaustive check over all days of 2026, 2027, and 2028
    let cur = '2026-01-01';
    const end = '2028-12-31';
    while (cur <= end) {
      const instant = dateToInstant(cur);
      expect(wdwDateOf(instant)).toBe(cur);
      cur = addDays(cur, 1);
    }
  });

  it('dateToInstant(2026-10-25).toISOString() is 2026-10-25T12:00:00.000Z whereas new Date(2026-10-25) renders as Oct 24 in New York', () => {
    const instant = dateToInstant('2026-10-25');
    expect(instant.toISOString()).toBe('2026-10-25T12:00:00.000Z');

    // A UTC midnight date formatted in America/New_York is 20:00 on the prior day (Oct 24)
    const utcMidnight = new Date('2026-10-25T00:00:00.000Z');
    expect(wdwDateOf(utcMidnight)).toBe('2026-10-24');
  });
});

