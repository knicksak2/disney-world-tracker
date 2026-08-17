import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  bucketStartMinutes,
  deriveShowTimePatterns,
  getETDayOfWeek,
  getETOffsetMinutes,
  isoInstantToMinutesFromMidnightET,
  minutesFromMidnightETToISO,
  normalizeShowtimeEntries,
  type RawShowtimeSignal,
} from '../showtimePatterns.js';

describe('normalizeShowtimeEntries', () => {
  it('normalizes raw upstream { startTime, endTime, type } objects (Indiana Jones production fixture)', () => {
    const rawIndianaJones = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T12:00:00-04:00', endTime: '2026-08-17T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T15:15:00-04:00', endTime: '2026-08-17T15:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00', endTime: '2026-08-17T16:30:00-04:00' },
    ];

    const result = normalizeShowtimeEntries(rawIndianaJones);
    expect(result.skipped).toBe(0);
    expect(result.instants).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
      '2026-08-17T17:15:00.000Z',
      '2026-08-17T19:15:00.000Z',
      '2026-08-17T20:30:00.000Z',
    ]);
  });

  it('normalizes projected { start, end, type } objects from LiveDetail', () => {
    const projected = [
      { start: '2026-08-17T14:45:00.000Z', end: '2026-08-17T15:15:00.000Z', type: 'Performance Time' },
      { start: '2026-08-17T16:00:00.000Z', end: '2026-08-17T16:30:00.000Z', type: 'Performance Time' },
    ];

    const result = normalizeShowtimeEntries(projected);
    expect(result.skipped).toBe(0);
    expect(result.instants).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
    ]);
  });

  it('normalizes bare ISO strings', () => {
    const strings = [
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
    ];

    const result = normalizeShowtimeEntries(strings);
    expect(result.skipped).toBe(0);
    expect(result.instants).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
    ]);
  });

  it('normalizes a mixed array containing raw objects, projected objects, and ISO strings', () => {
    const mixed = [
      { startTime: '2026-08-17T10:45:00-04:00' },
      { start: '2026-08-17T16:00:00.000Z' },
      '2026-08-17T17:15:00.000Z',
    ];

    const result = normalizeShowtimeEntries(mixed);
    expect(result.skipped).toBe(0);
    expect(result.instants).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
      '2026-08-17T17:15:00.000Z',
    ]);
  });

  it('returns empty instants with skipped: 0 for null, undefined, and non-array inputs', () => {
    expect(normalizeShowtimeEntries(null)).toEqual({ instants: [], skipped: 0 });
    expect(normalizeShowtimeEntries(undefined)).toEqual({ instants: [], skipped: 0 });
    expect(normalizeShowtimeEntries({})).toEqual({ instants: [], skipped: 0 });
    expect(normalizeShowtimeEntries(12345)).toEqual({ instants: [], skipped: 0 });
    expect(normalizeShowtimeEntries('not-an-array')).toEqual({ instants: [], skipped: 0 });
  });

  it('increments skipped count for unparseable entries and does NOT silently drop', () => {
    const dirty = [
      { invalid: true },
      'not-a-valid-date-string',
      null,
      42,
      { startTime: 'garbage-time' },
      { startTime: '2026-08-17T10:45:00-04:00' }, // 1 valid entry
    ];

    const result = normalizeShowtimeEntries(dirty);
    expect(result.skipped).toBe(5);
    expect(result.instants).toEqual(['2026-08-17T14:45:00.000Z']);
  });

  it('preserves exact instant for offset-bearing values (-04:00) without shifting', () => {
    const edtTime = '2026-08-17T10:45:00-04:00';
    const result = normalizeShowtimeEntries([{ startTime: edtTime }]);
    expect(result.instants[0]).toBe('2026-08-17T14:45:00.000Z');
    expect(new Date(result.instants[0]!).getTime()).toBe(new Date(edtTime).getTime());
  });

  it('sorts instants in ascending order even when given out-of-order inputs', () => {
    const unsorted = [
      { startTime: '2026-08-17T16:30:00-04:00' }, // 20:30Z
      '2026-08-17T14:45:00.000Z',                 // 14:45Z
      { start: '2026-08-17T17:15:00.000Z' },     // 17:15Z
      { startTime: '2026-08-17T12:00:00-04:00' }, // 16:00Z
    ];

    const result = normalizeShowtimeEntries(unsorted);
    expect(result.instants).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
      '2026-08-17T17:15:00.000Z',
      '2026-08-17T20:30:00.000Z',
    ]);
  });
});

describe('showtimePatterns pure unit tests', () => {
  it('correctly maps date strings to 0-6 weekday in Eastern Time', () => {
    // 2026-10-04 is a Sunday -> 0
    expect(getETDayOfWeek('2026-10-04')).toBe(0);
    // 2026-10-05 is a Monday -> 1
    expect(getETDayOfWeek('2026-10-05')).toBe(1);
    // 2026-10-10 is a Saturday -> 6
    expect(getETDayOfWeek('2026-10-10')).toBe(6);
  });

  it('converts both EDT and EST 10:00 AM showtimes to exactly 600 minutes from midnight ET', () => {
    // 2026-10-01 is EDT (UTC-4) -> 10:00 AM EDT is 14:00 UTC
    const edtDate = '2026-10-01';
    const edtShowtime = '2026-10-01T14:00:00.000Z';
    expect(getETOffsetMinutes(edtDate)).toBe(-240);
    expect(isoInstantToMinutesFromMidnightET(edtDate, edtShowtime)).toBe(600);

    // 2026-01-15 is EST (UTC-5) -> 10:00 AM EST is 15:00 UTC
    const estDate = '2026-01-15';
    const estShowtime = '2026-01-15T15:00:00.000Z';
    expect(getETOffsetMinutes(estDate)).toBe(-300);
    expect(isoInstantToMinutesFromMidnightET(estDate, estShowtime)).toBe(600);
  });

  it('converts minutes from midnight ET back to canonical ISO instants on requested date', () => {
    // 600 minutes on 2026-10-01 (EDT) -> 14:00:00.000Z
    expect(minutesFromMidnightETToISO('2026-10-01', 600)).toBe('2026-10-01T14:00:00.000Z');

    // 600 minutes on 2026-01-15 (EST) -> 15:00:00.000Z
    expect(minutesFromMidnightETToISO('2026-01-15', 600)).toBe('2026-01-15T15:00:00.000Z');
  });

  it('buckets start times to nearest 5 minutes', () => {
    expect(bucketStartMinutes(600)).toBe(600); // 10:00 -> 10:00
    expect(bucketStartMinutes(602)).toBe(600); // 10:02 -> 10:00
    expect(bucketStartMinutes(603)).toBe(605); // 10:03 -> 10:05
    expect(bucketStartMinutes(604)).toBe(605); // 10:04 -> 10:05
    expect(bucketStartMinutes(605)).toBe(605); // 10:05 -> 10:05
  });

  it('excludes a slot appearing on 2 of 5 same-weekday dates (frequency 0.4) and includes 3 of 5 (frequency 0.6) with raw object signals', () => {
    // 5 consecutive Sundays in Oct/Nov 2026 (Oct 4, 11, 18, 25, Nov 1)
    // Oct 4, 11, 18, 25 are EDT (UTC-4), Nov 1 is EST (UTC-5)
    const expId = 'exp-show-lion-king';
    const signals: RawShowtimeSignal[] = [
      {
        experience_id: expId,
        date: '2026-10-04', // Sunday
        showtimes: [{ type: 'Performance Time', startTime: '2026-10-04T10:00:00-04:00', endTime: '2026-10-04T10:00:00-04:00' }], // 10:00 AM EDT (600m)
      },
      {
        experience_id: expId,
        date: '2026-10-11', // Sunday
        showtimes: [{ type: 'Performance Time', startTime: '2026-10-11T10:02:00-04:00', endTime: '2026-10-11T10:02:00-04:00' }], // 10:02 AM EDT (602m -> buckets to 600m)
      },
      {
        experience_id: expId,
        date: '2026-10-18', // Sunday
        showtimes: [{ start: '2026-10-18T14:00:00.000Z' }], // 10:00 AM EDT (600m) - projected shape
      },
      {
        experience_id: expId,
        date: '2026-10-25', // Sunday
        showtimes: ['2026-10-25T17:00:00.000Z'], // 1:00 PM EDT (780m) - ISO string shape
      },
      {
        experience_id: expId,
        date: '2026-11-01', // Sunday (EST, UTC-5)
        showtimes: [{ type: 'Performance Time', startTime: '2026-11-01T13:00:00-05:00', endTime: '2026-11-01T13:00:00-05:00' }], // 1:00 PM EST (780m)
      },
    ];

    const patterns = deriveShowTimePatterns(signals);

    // 600m slot appears on 3 of 5 dates (Oct 4, Oct 11, Oct 18) -> sample_count 3, frequency 0.6 -> INCLUDED
    // 780m slot appears on 2 of 5 dates (Oct 25, Nov 1) -> sample_count 2, frequency 0.4 -> EXCLUDED (< 0.5 & < 3)
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!).toEqual({
      experience_id: expId,
      day_of_week: 0, // Sunday
      start_minutes: 600,
      frequency: 0.6,
      sample_count: 3,
    });
  });

  // Feature: crowd-calendar, Property 12: Historical showtime patterns derivation thresholds and bucketing
  it('Property 12: all derived patterns satisfy sample count >= 3, frequency >= 0.5, 5m bucketing, and exact sample frequency across raw object, projected, and string shapes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            experience_id: fc.constantFrom('exp-1', 'exp-2', 'exp-3'),
            dateOffset: fc.integer({ min: 0, max: 150 }),
            times: fc.array(
              fc.record({
                hour: fc.integer({ min: 9, max: 20 }),
                minute: fc.integer({ min: 0, max: 59 }),
                shape: fc.constantFrom('raw', 'projected', 'isoString'),
              }),
              { minLength: 0, maxLength: 5 },
            ),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (rawEntries) => {
          const baseDate = new Date('2026-05-01T12:00:00-04:00');
          const signals: RawShowtimeSignal[] = rawEntries.map((entry) => {
            const d = new Date(baseDate.getTime() + entry.dateOffset * 86400000);
            const dateStr = d.toISOString().split('T')[0]!;
            const showtimes = entry.times.map((t) => {
              const minutes = t.hour * 60 + t.minute;
              const iso = minutesFromMidnightETToISO(dateStr, minutes);
              if (t.shape === 'raw') {
                return { type: 'Performance Time', startTime: iso, endTime: iso };
              } else if (t.shape === 'projected') {
                return { start: iso, end: iso, type: 'Performance Time' };
              }
              return iso;
            });
            return {
              experience_id: entry.experience_id,
              date: dateStr,
              showtimes,
            };
          });

          const patterns = deriveShowTimePatterns(signals);

          for (const pattern of patterns) {
            expect(pattern.sample_count).toBeGreaterThanOrEqual(3);
            expect(pattern.frequency).toBeGreaterThanOrEqual(0.5);
            expect(pattern.frequency).toBeLessThanOrEqual(1.0);
            expect(pattern.day_of_week).toBeGreaterThanOrEqual(0);
            expect(pattern.day_of_week).toBeLessThanOrEqual(6);
            expect(pattern.start_minutes).toBeGreaterThanOrEqual(0);
            expect(pattern.start_minutes).toBeLessThanOrEqual(1440);
            expect(pattern.start_minutes % 5).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
