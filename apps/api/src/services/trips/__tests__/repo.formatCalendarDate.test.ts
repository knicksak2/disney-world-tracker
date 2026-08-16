import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from '../repo.js';

describe('formatCalendarDate (R3.1, R9.9)', () => {
  it('correctly inverts local-midnight Date objects produced by postgres-date on non-UTC hosts', () => {
    // postgres-date constructs `new Date(year, month, day)` in local host time.
    const localMidnight = new Date(2026, 9, 1); // Month 9 is October (0-indexed)
    expect(formatCalendarDate(localMidnight)).toBe('2026-10-01');

    const endOfYear = new Date(2026, 11, 31); // Dec 31
    expect(formatCalendarDate(endOfYear)).toBe('2026-12-31');

    const leapDay = new Date(2028, 1, 29); // Feb 29
    expect(formatCalendarDate(leapDay)).toBe('2028-02-29');
  });

  it('correctly inverts UTC-midnight Date objects produced by in-memory databases (pg-mem)', () => {
    // pg-mem and UTC engines store dates as UTC midnight timestamps:
    const utcMidnight = new Date('2026-10-01T00:00:00.000Z');
    expect(formatCalendarDate(utcMidnight)).toBe('2026-10-01');

    const utcEndOfYear = new Date('2026-12-31T00:00:00.000Z');
    expect(formatCalendarDate(utcEndOfYear)).toBe('2026-12-31');
  });

  it('handles raw YYYY-MM-DD strings and ISO timestamps', () => {
    expect(formatCalendarDate('2026-10-01')).toBe('2026-10-01');
    expect(formatCalendarDate('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(formatCalendarDate('2026-10-01T14:30:00.000Z')).toBe('2026-10-01');
  });

  it('returns null for null or undefined input', () => {
    expect(formatCalendarDate(null)).toBeNull();
    expect(formatCalendarDate(undefined)).toBeNull();
  });
});
