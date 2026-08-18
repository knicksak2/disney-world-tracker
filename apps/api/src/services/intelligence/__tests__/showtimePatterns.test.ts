import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  bucketStartMinutes,
  deriveShowTimePatterns,
  getETDayOfWeek,
  getETOffsetMinutes,
  isoInstantToMinutesFromMidnightET,
  mergeShowtimeEntries,
  minutesFromMidnightETToISO,
  normalizeShowtimeEntries,
  SHOWTIME_PATTERN_MIN_FREQUENCY,
  SHOWTIME_PATTERN_MIN_SAMPLES,
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

describe('mergeShowtimeEntries', () => {
  it('merges overlapping sets and preserves all entries sorted chronologically without duplicates', () => {
    const existing = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T12:00:00-04:00', endTime: '2026-08-17T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
    ];
    const incoming = [
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T15:15:00-04:00', endTime: '2026-08-17T15:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00', endTime: '2026-08-17T16:30:00-04:00' },
    ];

    const result = mergeShowtimeEntries(existing, incoming);
    expect(result).toHaveLength(5);
    expect(result).toEqual([
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T12:00:00-04:00', endTime: '2026-08-17T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T15:15:00-04:00', endTime: '2026-08-17T15:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00', endTime: '2026-08-17T16:30:00-04:00' },
    ]);
  });

  it('merges disjoint sets sorted ascending by start time', () => {
    const existing = [
      { startTime: '2026-08-17T10:45:00-04:00' },
      { startTime: '2026-08-17T12:00:00-04:00' },
    ];
    const incoming = [
      { startTime: '2026-08-17T15:15:00-04:00' },
      { startTime: '2026-08-17T16:30:00-04:00' },
    ];

    const result = mergeShowtimeEntries(existing, incoming);
    expect(result).toEqual([
      { startTime: '2026-08-17T10:45:00-04:00' },
      { startTime: '2026-08-17T12:00:00-04:00' },
      { startTime: '2026-08-17T15:15:00-04:00' },
      { startTime: '2026-08-17T16:30:00-04:00' },
    ]);
  });

  it('returns existing entries when incoming is empty or null/undefined', () => {
    const existing = [
      { startTime: '2026-08-17T10:45:00-04:00' },
      { startTime: '2026-08-17T12:00:00-04:00' },
    ];
    expect(mergeShowtimeEntries(existing, null)).toEqual(existing);
    expect(mergeShowtimeEntries(existing, undefined)).toEqual(existing);
    expect(mergeShowtimeEntries(existing, [])).toEqual(existing);
  });

  it('returns incoming entries when existing is empty or null/undefined', () => {
    const incoming = [
      { startTime: '2026-08-17T10:45:00-04:00' },
      { startTime: '2026-08-17T12:00:00-04:00' },
    ];
    expect(mergeShowtimeEntries(null, incoming)).toEqual(incoming);
    expect(mergeShowtimeEntries(undefined, incoming)).toEqual(incoming);
    expect(mergeShowtimeEntries([], incoming)).toEqual(incoming);
  });

  it('returns null when both existing and incoming are null or empty', () => {
    expect(mergeShowtimeEntries(null, null)).toBeNull();
    expect(mergeShowtimeEntries(undefined, undefined)).toBeNull();
    expect(mergeShowtimeEntries([], [])).toBeNull();
    expect(mergeShowtimeEntries(null, [])).toBeNull();
  });

  it('deduplicates duplicate startTime entries within incoming or across existing and incoming', () => {
    const existing = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00' },
    ];
    const incoming = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00' },
    ];

    const result = mergeShowtimeEntries(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result).toEqual([
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00' },
    ]);
  });

  it('handles mixed shapes (raw object, projected object, ISO string) preserving shapes and sorting by time', () => {
    const existing = [
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00' },
      '2026-08-17T14:45:00.000Z',
    ];
    const incoming = [
      { start: '2026-08-17T16:00:00.000Z' },
    ];

    const result = mergeShowtimeEntries(existing, incoming);
    expect(result).toEqual([
      '2026-08-17T14:45:00.000Z',
      { start: '2026-08-17T16:00:00.000Z' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00' },
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

  it('excludes a slot appearing on 2 of 5 same-weekday dates (frequency 0.4 < 0.5) and includes 3 of 5 (frequency 0.6 >= 0.5) with MIN_SAMPLES = 2', () => {
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

    // 600m slot appears on 3 of 5 dates (Oct 4, Oct 11, Oct 18):
    //   sample_count = 3 (>= MIN_SAMPLES = 2), frequency = 3/5 = 0.6 (>= MIN_FREQ = 0.5) -> INCLUDED
    // 780m slot appears on 2 of 5 dates (Oct 25, Nov 1):
    //   sample_count = 2 (>= MIN_SAMPLES = 2), but frequency = 2/5 = 0.4 (< MIN_FREQ = 0.5) -> EXCLUDED by frequency gate
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!).toEqual({
      experience_id: expId,
      day_of_week: 0, // Sunday
      start_minutes: 600,
      frequency: 0.6,
      sample_count: 3,
    });
  });

  it('two-gate division: group gate requires >= 2 observed dates; slot gate includes slots with frequency >= 0.5 (even when sample_count is 1 of 2)', () => {
    const expId = 'exp-indiana-jones';
    const signals: RawShowtimeSignal[] = [
      {
        experience_id: expId,
        date: '2026-08-10', // Monday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-10T10:45:00-04:00', endTime: '2026-08-10T10:45:00-04:00' }, // 10:45 AM EDT (645m)
          { type: 'Performance Time', startTime: '2026-08-10T12:00:00-04:00', endTime: '2026-08-10T12:00:00-04:00' }, // 12:00 PM EDT (720m)
        ],
      },
      {
        experience_id: expId,
        date: '2026-08-17', // Monday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' }, // 10:45 AM EDT (645m)
          { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' }, // 1:15 PM EDT (795m)
        ],
      },
    ];

    const patterns = deriveShowTimePatterns(signals);

    // Group gate: total observed Mondays = 2 (>= MIN_SAMPLES = 2) -> passes group threshold
    // Slot gate (frequency >= 0.5):
    //   645m (10:45 AM): appears on 2 of 2 dates -> frequency = 2/2 = 1.0 (>= 0.5), sample_count = 2 -> INCLUDED
    //   720m (12:00 PM): appears on 1 of 2 dates -> frequency = 1/2 = 0.5 (>= 0.5), sample_count = 1 -> INCLUDED
    //   795m (1:15 PM): appears on 1 of 2 dates -> frequency = 1/2 = 0.5 (>= 0.5), sample_count = 1 -> INCLUDED
    expect(patterns).toHaveLength(3);
    expect(patterns).toEqual([
      {
        experience_id: expId,
        day_of_week: 1, // Monday
        start_minutes: 645,
        frequency: 1.0,
        sample_count: 2,
      },
      {
        experience_id: expId,
        day_of_week: 1, // Monday
        start_minutes: 720,
        frequency: 0.5,
        sample_count: 1,
      },
      {
        experience_id: expId,
        day_of_week: 1, // Monday
        start_minutes: 795,
        frequency: 0.5,
        sample_count: 1,
      },
    ]);
  });

  it('Thursday case: two observed dates with 2 showtimes and 4 showtimes emit all 4 slots with frequencies 1.0 and 0.5', () => {
    const expId = '4ac8c59c-15e5-593e-ae4a-5bb3fbaa0ff9';
    const signals: RawShowtimeSignal[] = [
      {
        experience_id: expId,
        date: '2026-08-06', // Thursday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-06T10:45:00-04:00', endTime: '2026-08-06T10:45:00-04:00' }, // 645m
          { type: 'Performance Time', startTime: '2026-08-06T12:00:00-04:00', endTime: '2026-08-06T12:00:00-04:00' }, // 720m
        ],
      },
      {
        experience_id: expId,
        date: '2026-08-13', // Thursday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-13T10:45:00-04:00', endTime: '2026-08-13T10:45:00-04:00' }, // 645m
          { type: 'Performance Time', startTime: '2026-08-13T12:00:00-04:00', endTime: '2026-08-13T12:00:00-04:00' }, // 720m
          { type: 'Performance Time', startTime: '2026-08-13T13:15:00-04:00', endTime: '2026-08-13T13:15:00-04:00' }, // 795m
          { type: 'Performance Time', startTime: '2026-08-13T15:15:00-04:00', endTime: '2026-08-13T15:15:00-04:00' }, // 915m
        ],
      },
    ];

    const patterns = deriveShowTimePatterns(signals);

    // Group has 2 observed Thursdays (passes group gate).
    // All 4 distinct slots satisfy frequency >= 0.5 and must be emitted.
    expect(patterns).toHaveLength(4);
    expect(patterns).toEqual([
      {
        experience_id: expId,
        day_of_week: 4, // Thursday
        start_minutes: 645,
        frequency: 1.0,
        sample_count: 2,
      },
      {
        experience_id: expId,
        day_of_week: 4, // Thursday
        start_minutes: 720,
        frequency: 1.0,
        sample_count: 2,
      },
      {
        experience_id: expId,
        day_of_week: 4, // Thursday
        start_minutes: 795,
        frequency: 0.5,
        sample_count: 1,
      },
      {
        experience_id: expId,
        day_of_week: 4, // Thursday
        start_minutes: 915,
        frequency: 0.5,
        sample_count: 1,
      },
    ]);
  });

  it('frequency gate: with 4 observed dates, excludes frequency 0.25 (1 of 4) and includes frequency 0.5 (2 of 4)', () => {
    const expId = 'exp-show';
    const signals: RawShowtimeSignal[] = [
      {
        experience_id: expId,
        date: '2026-08-04', // Tuesday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-04T10:45:00-04:00', endTime: '2026-08-04T10:45:00-04:00' }, // 645m
          { type: 'Performance Time', startTime: '2026-08-04T12:00:00-04:00', endTime: '2026-08-04T12:00:00-04:00' }, // 720m (only on this date -> 1/4 = 0.25)
          { type: 'Performance Time', startTime: '2026-08-04T13:15:00-04:00', endTime: '2026-08-04T13:15:00-04:00' }, // 795m
        ],
      },
      {
        experience_id: expId,
        date: '2026-08-11', // Tuesday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-11T10:45:00-04:00', endTime: '2026-08-11T10:45:00-04:00' }, // 645m
          { type: 'Performance Time', startTime: '2026-08-11T13:15:00-04:00', endTime: '2026-08-11T13:15:00-04:00' }, // 795m
        ],
      },
      {
        experience_id: expId,
        date: '2026-08-18', // Tuesday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-18T10:45:00-04:00', endTime: '2026-08-18T10:45:00-04:00' }, // 645m
          { type: 'Performance Time', startTime: '2026-08-18T13:15:00-04:00', endTime: '2026-08-18T13:15:00-04:00' }, // 795m
        ],
      },
      {
        experience_id: expId,
        date: '2026-08-25', // Tuesday
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-25T10:45:00-04:00', endTime: '2026-08-25T10:45:00-04:00' }, // 645m (seen on 4/4 = 1.0)
        ],
      },
    ];

    const patterns = deriveShowTimePatterns(signals);

    // Total observed Tuesdays = 4
    // 645m: 4 of 4 dates -> freq = 1.0 (>= 0.5) -> INCLUDED, sample_count = 4
    // 720m: 1 of 4 dates -> freq = 0.25 (< 0.5) -> EXCLUDED by frequency gate, sample_count = 1
    // 795m: 3 of 4 dates -> freq = 0.75 (>= 0.5) -> INCLUDED, sample_count = 3
    expect(patterns).toHaveLength(2);
    expect(patterns).toEqual([
      {
        experience_id: expId,
        day_of_week: 2, // Tuesday
        start_minutes: 645,
        frequency: 1.0,
        sample_count: 4,
      },
      {
        experience_id: expId,
        day_of_week: 2, // Tuesday
        start_minutes: 795,
        frequency: 0.75,
        sample_count: 3,
      },
    ]);
  });

  it('group gate: does not emit patterns for a weekday with fewer than SHOWTIME_PATTERN_MIN_SAMPLES (2) observed dates', () => {
    const expId = 'exp-single-date';
    const signals: RawShowtimeSignal[] = [
      {
        experience_id: expId,
        date: '2026-08-05', // Wednesday (only 1 date observed)
        showtimes: [
          { type: 'Performance Time', startTime: '2026-08-05T10:45:00-04:00', endTime: '2026-08-05T10:45:00-04:00' },
          { type: 'Performance Time', startTime: '2026-08-05T12:00:00-04:00', endTime: '2026-08-05T12:00:00-04:00' },
          { type: 'Performance Time', startTime: '2026-08-05T13:15:00-04:00', endTime: '2026-08-05T13:15:00-04:00' },
          { type: 'Performance Time', startTime: '2026-08-05T15:15:00-04:00', endTime: '2026-08-05T15:15:00-04:00' },
          { type: 'Performance Time', startTime: '2026-08-05T16:30:00-04:00', endTime: '2026-08-05T16:30:00-04:00' },
        ],
      },
    ];

    const patterns = deriveShowTimePatterns(signals);
    // Group gate (totalObservedDates = 1 < 2) drops the entire group
    expect(patterns).toHaveLength(0);
  });

  // Feature: crowd-calendar, Property 12: Historical showtime patterns derivation thresholds and bucketing
  it('Property 12: all derived patterns satisfy group gate (observed dates >= 2), slot gate (frequency >= 0.5), sample_count >= 1, and 5m bucketing', () => {
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

          // Compute observed dates and bucket frequencies per (experience_id, day_of_week) group
          const groupDates = new Map<string, Set<string>>();
          const groupBuckets = new Map<string, Map<number, Set<string>>>();

          for (const s of signals) {
            const { instants } = normalizeShowtimeEntries(s.showtimes);
            if (instants.length === 0) continue;

            const dow = getETDayOfWeek(s.date);
            const groupKey = `${s.experience_id}:${dow}`;
            if (!groupDates.has(groupKey)) {
              groupDates.set(groupKey, new Set());
              groupBuckets.set(groupKey, new Map());
            }
            groupDates.get(groupKey)!.add(s.date);

            for (const iso of instants) {
              const rawMins = isoInstantToMinutesFromMidnightET(s.date, iso);
              if (Number.isNaN(rawMins) || rawMins < 0 || rawMins > 1440) continue;
              const b = bucketStartMinutes(rawMins);
              const bucketMap = groupBuckets.get(groupKey)!;
              if (!bucketMap.has(b)) {
                bucketMap.set(b, new Set());
              }
              bucketMap.get(b)!.add(s.date);
            }
          }

          const patterns = deriveShowTimePatterns(signals);

          // 1. Soundness: Every emitted pattern must satisfy the group gate and slot gate
          for (const pattern of patterns) {
            const key = `${pattern.experience_id}:${pattern.day_of_week}`;
            const totalObserved = groupDates.get(key)?.size ?? 0;

            // Group gate: must have at least SHOWTIME_PATTERN_MIN_SAMPLES (2) observed dates
            expect(totalObserved).toBeGreaterThanOrEqual(SHOWTIME_PATTERN_MIN_SAMPLES);

            // Slot gate: frequency must be >= SHOWTIME_PATTERN_MIN_FREQUENCY (0.5)
            expect(pattern.frequency).toBeGreaterThanOrEqual(SHOWTIME_PATTERN_MIN_FREQUENCY);
            expect(pattern.frequency).toBeLessThanOrEqual(1.0);

            // sample_count must be at least 1 and match frequency * totalObserved
            expect(pattern.sample_count).toBeGreaterThanOrEqual(1);
            expect(pattern.frequency).toBeCloseTo(pattern.sample_count / totalObserved, 5);

            expect(pattern.day_of_week).toBeGreaterThanOrEqual(0);
            expect(pattern.day_of_week).toBeLessThanOrEqual(6);
            expect(pattern.start_minutes).toBeGreaterThanOrEqual(0);
            expect(pattern.start_minutes).toBeLessThanOrEqual(1440);
            expect(pattern.start_minutes % 5).toBe(0);
          }

          // 2. Completeness: Every qualifying slot across qualifying groups MUST be emitted
          for (const [groupKey, datesSet] of groupDates.entries()) {
            if (datesSet.size >= SHOWTIME_PATTERN_MIN_SAMPLES) {
              const [expId, dowStr] = groupKey.split(':');
              const dow = Number(dowStr);
              const bucketMap = groupBuckets.get(groupKey) ?? new Map();

              for (const [bucket, dateOccurrences] of bucketMap.entries()) {
                const freq = dateOccurrences.size / datesSet.size;
                if (freq >= SHOWTIME_PATTERN_MIN_FREQUENCY) {
                  const found = patterns.some(
                    (p) =>
                      p.experience_id === expId &&
                      p.day_of_week === dow &&
                      p.start_minutes === bucket &&
                      p.sample_count === dateOccurrences.size,
                  );
                  expect(found).toBe(true);
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});



