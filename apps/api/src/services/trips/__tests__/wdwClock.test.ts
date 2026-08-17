import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  wdwDayOfWeek,
  wdwIsoAtMinutes,
  wdwMinutesFromMidnight,
  wdwOffsetMinutes,
  wdwToday,
} from '../wdwClock.js';

/**
 * `wdwClock` is the single source of truth for Walt Disney World local time
 * conversions, consolidated here from three previously separate private copies
 * (the Day Planning optimizer, the Crowd Calendar showtime-pattern derivation,
 * and this module). DST handling in those copies had already caused two real
 * defects — a `planned_date` that read as the previous day, and show fixtures
 * that only passed because production code had been widened to accept them —
 * so every assertion below deliberately straddles the EST/EDT boundary.
 *
 * 2026 US daylight saving: begins 8 March, ends 1 November.
 */
describe('wdwClock — WDW-local time conversions', () => {
  describe('wdwOffsetMinutes', () => {
    it('reports -240 during EDT and -300 during EST', () => {
      expect(wdwOffsetMinutes('2026-10-01')).toBe(-240); // EDT
      expect(wdwOffsetMinutes('2026-01-15')).toBe(-300); // EST
    });

    it('reports EST on the autumn transition day itself', () => {
      // DST ends at 02:00 local on 1 Nov 2026, so the rest of that day is EST.
      expect(wdwOffsetMinutes('2026-11-01')).toBe(-300);
      expect(wdwOffsetMinutes('2026-10-31')).toBe(-240);
    });

    it('accepts an ISO instant as well as a calendar date', () => {
      expect(wdwOffsetMinutes('2026-10-01T14:00:00.000Z')).toBe(-240);
      expect(wdwOffsetMinutes('2026-01-15T15:00:00.000Z')).toBe(-300);
      expect(wdwOffsetMinutes(new Date('2026-01-15T15:00:00.000Z'))).toBe(-300);
    });

    it('returns a cached value on repeated calendar-date lookups', () => {
      expect(wdwOffsetMinutes('2026-07-04')).toBe(wdwOffsetMinutes('2026-07-04'));
    });
  });

  describe('wdwMinutesFromMidnight', () => {
    it('maps 10:00 AM WDW-local to 600 in both EDT and EST', () => {
      // 10:00 EDT is 14:00Z; 10:00 EST is 15:00Z. Both are 600 minutes local.
      expect(wdwMinutesFromMidnight('2026-10-01', '2026-10-01T14:00:00.000Z')).toBe(600);
      expect(wdwMinutesFromMidnight('2026-01-15', '2026-01-15T15:00:00.000Z')).toBe(600);
    });

    it('maps an evening showtime consistently across the DST boundary', () => {
      // 1:00 PM local = 780 minutes, on a Sunday either side of the change.
      expect(wdwMinutesFromMidnight('2026-10-25', '2026-10-25T17:00:00.000Z')).toBe(780);
      expect(wdwMinutesFromMidnight('2026-11-01', '2026-11-01T18:00:00.000Z')).toBe(780);
    });

    it('returns 0 at WDW-local midnight', () => {
      expect(wdwMinutesFromMidnight('2026-10-01', '2026-10-01T04:00:00.000Z')).toBe(0);
      expect(wdwMinutesFromMidnight('2026-01-15', '2026-01-15T05:00:00.000Z')).toBe(0);
    });
  });

  describe('wdwIsoAtMinutes', () => {
    it('is the inverse of wdwMinutesFromMidnight in both offsets', () => {
      expect(wdwIsoAtMinutes('2026-10-01', 600)).toBe('2026-10-01T14:00:00.000Z');
      expect(wdwIsoAtMinutes('2026-01-15', 600)).toBe('2026-01-15T15:00:00.000Z');
    });

    it('round-trips any time of day on any date (property, 200 runs)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            '2026-01-15', // EST
            '2026-03-08', // spring transition day
            '2026-07-04', // EDT
            '2026-10-25', // EDT, Sunday
            '2026-11-01', // autumn transition day
            '2026-12-31', // EST
          ),
          fc.integer({ min: 0, max: 1439 }),
          (date, minutes) => {
            const iso = wdwIsoAtMinutes(date, minutes);
            expect(wdwMinutesFromMidnight(date, iso)).toBe(minutes);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('wdwDayOfWeek', () => {
    it('uses 0 = Sunday through 6 = Saturday, matching ride_shapes.day_of_week', () => {
      expect(wdwDayOfWeek('2026-10-04')).toBe(0); // Sunday, EDT
      expect(wdwDayOfWeek('2026-11-08')).toBe(0); // Sunday, EST
      expect(wdwDayOfWeek('2026-10-01')).toBe(4); // Thursday
      expect(wdwDayOfWeek('2026-01-17')).toBe(6); // Saturday, EST
    });

    it('does not shift across the DST boundary', () => {
      expect(wdwDayOfWeek('2026-10-31')).toBe(6); // Saturday, EDT
      expect(wdwDayOfWeek('2026-11-01')).toBe(0); // Sunday, EST
    });
  });

  describe('wdwToday', () => {
    it('still reports the WDW calendar date for an instant late in UTC day', () => {
      // 03:30Z on 2 Jan is still 22:30 on 1 Jan at WDW (EST).
      expect(wdwToday(new Date('2026-01-02T03:30:00.000Z'))).toBe('2026-01-01');
    });
  });
});
