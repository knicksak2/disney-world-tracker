import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  addCalendarDays,
  diffCalendarDays,
  formatDateRange,
  formatMonthDay,
  isCheckInOverrideValid,
  listCalendarDates,
} from '../index.js';

const NUM_RUNS = 100;

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const fmtDate = (y: number, m: number, d: number) =>
  `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** Generates a valid YYYY-MM-DD calendar date */
const validDateArb = fc
  .integer({ min: 1970, max: 2099 })
  .chain((year) =>
    fc.integer({ min: 1, max: 12 }).chain((month) => {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return fc
        .integer({ min: 1, max: daysInMonth })
        .map((day) => fmtDate(year, month, day));
    }),
  );

/** DST transition dates for 2025 (EDT/EST) and their neighbouring dates */
const dstDates = [
  '2025-03-07',
  '2025-03-08',
  '2025-03-09',
  '2025-03-10',
  '2025-03-11',
  '2025-10-31',
  '2025-11-01',
  '2025-11-02',
  '2025-11-03',
  '2025-11-04',
];

/** Date generator biased to DST transitions and their neighbours */
const dstBiasedDateArb = fc.oneof(
  { arbitrary: fc.constantFrom(...dstDates), weight: 3 },
  { arbitrary: validDateArb, weight: 2 },
);

describe('tripBooking calendar-date helpers (R1.2, R2.2, R2.3, R6.14)', () => {
  // Feature: trip-booking-timeline, Property 3: Calendar arithmetic is DST-immune
  it('// Feature: trip-booking-timeline, Property 3: Calendar arithmetic is DST-immune', () => {
    fc.assert(
      fc.property(
        dstBiasedDateArb,
        fc.integer({ min: -400, max: 400 }),
        (d, k) => {
          const shifted = addCalendarDays(d, k);
          const roundtrip = addCalendarDays(shifted, -k);
          expect(roundtrip).toBe(d);
          expect(diffCalendarDays(shifted, d)).toBe(k);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: trip-booking-timeline, Property 6: Override range is exactly [start - 30, start]
  it('// Feature: trip-booking-timeline, Property 6: Override range is exactly [start - 30, start]', () => {
    fc.assert(
      fc.property(
        validDateArb,
        fc.integer({ min: -60, max: 30 }),
        (start, offset) => {
          const candidate = addCalendarDays(start, offset);
          const valid = isCheckInOverrideValid(candidate, start);
          const expected = offset >= -30 && offset <= 0;
          expect(valid).toBe(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('validates explicit boundary examples for isCheckInOverrideValid', () => {
    const start = '2025-06-15';
    expect(isCheckInOverrideValid(addCalendarDays(start, -31), start)).toBe(false);
    expect(isCheckInOverrideValid(addCalendarDays(start, -30), start)).toBe(true);
    expect(isCheckInOverrideValid(start, start)).toBe(true);
    expect(isCheckInOverrideValid(addCalendarDays(start, 1), start)).toBe(false);
  });

  it('handles listCalendarDates unit cases', () => {
    expect(listCalendarDates('2025-06-05', '2025-06-01')).toEqual([]);
    expect(listCalendarDates('2025-06-01', '2025-06-03')).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
    ]);
    expect(listCalendarDates('2025-06-01', '2025-06-01')).toEqual(['2025-06-01']);
  });

  it('handles formatMonthDay and formatDateRange unit cases', () => {
    expect(formatMonthDay('2025-06-01')).toBe('Jun 1');
    expect(formatMonthDay('2025-04-15')).toBe('Apr 15');
    expect(formatDateRange('2025-06-01', '2025-06-01')).toBe('Jun 1');
    expect(formatDateRange('2025-06-01', '2025-06-05')).toBe('Jun 1 \u2013 Jun 5');
  });
});
