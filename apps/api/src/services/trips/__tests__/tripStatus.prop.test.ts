// Feature: trips, Property 1: Trip status is derived solely from its dates and the WDW date
/**
 * Property-based tests for `deriveTripStatus`.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 *
 * `Trip_Status` is never stored. It is a pure function of exactly three
 * `YYYY-MM-DD` calendar-date strings in the WDW zone: the Trip_Start_Date,
 * the Trip_End_Date (enforced `>= start` on write), and the WDW_Current_Date.
 * Design Property 1 says, in essence:
 *
 *   For any Trip dates and any WDW date, `deriveTripStatus` returns
 *     - `upcoming` iff `wdwToday < startDate`               (R2.1)
 *     - `active`   iff `startDate <= wdwToday <= endDate`    (R2.2, R2.3)
 *     - `past`     iff `wdwToday > endDate`                  (R2.4)
 *   and the result depends on nothing but those three inputs, so it is
 *   fully deterministic and never an independently editable field
 *   (R2.5, R2.6).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention. Dates are
 * generated as day offsets from the Unix epoch and rendered to `YYYY-MM-DD`,
 * which keeps every generated string a real calendar date and preserves the
 * property that lexicographic order equals chronological order. A numeric
 * day-offset oracle (independent of the string comparison under test) is used
 * to classify the expected status.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { deriveTripStatus, type TripStatus } from '../tripStatus.js';

const NUM_RUNS = 100;

/** Render a day offset from the Unix epoch to a `YYYY-MM-DD` calendar date. */
function dayToISO(dayOffset: number): string {
  return new Date(dayOffset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Numeric oracle for the expected status, computed from the raw day offsets
 * rather than the rendered strings so it is independent of the string
 * comparison inside `deriveTripStatus`.
 */
function expectedStatus(
  startDay: number,
  endDay: number,
  todayDay: number,
): TripStatus {
  if (todayDay > endDay) return 'past';
  if (todayDay < startDay) return 'upcoming';
  return 'active';
}

/** Day offsets spanning roughly 1990-01-01 .. 2059-ish, ample range for dates. */
const dayArb = fc.integer({ min: 7_305, max: 32_873 });

/**
 * A Trip with a valid `end >= start` date pair plus an arbitrary WDW "today",
 * each carried as both the raw day offset (for the oracle) and the rendered
 * `YYYY-MM-DD` string (the actual input to `deriveTripStatus`).
 */
const tripAndTodayArb = fc
  .tuple(dayArb, fc.nat({ max: 3_650 }), dayArb)
  .map(([startDay, span, todayDay]) => {
    const endDay = startDay + span; // end >= start (R1.8 / R3.6 write invariant).
    return {
      startDay,
      endDay,
      todayDay,
      startDate: dayToISO(startDay),
      endDate: dayToISO(endDay),
      wdwToday: dayToISO(todayDay),
    };
  });

describe('deriveTripStatus — Property 1: status derived solely from dates and WDW date', () => {
  it('classifies upcoming/active/past exactly per the calendar-date rules (R2.1, R2.2, R2.4)', () => {
    fc.assert(
      fc.property(tripAndTodayArb, (t) => {
        const status = deriveTripStatus(t.startDate, t.endDate, t.wdwToday);
        return status === expectedStatus(t.startDay, t.endDay, t.todayDay);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports active on a single-day Trip when today equals that day (R2.3)', () => {
    fc.assert(
      fc.property(dayArb, (day) => {
        const iso = dayToISO(day);
        return deriveTripStatus(iso, iso, iso) === 'active';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is exhaustive: every input yields exactly one of the three statuses', () => {
    fc.assert(
      fc.property(tripAndTodayArb, (t) => {
        const status = deriveTripStatus(t.startDate, t.endDate, t.wdwToday);
        return status === 'upcoming' || status === 'active' || status === 'past';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: identical inputs always produce the identical status (R2.5)', () => {
    fc.assert(
      fc.property(tripAndTodayArb, (t) => {
        const first = deriveTripStatus(t.startDate, t.endDate, t.wdwToday);
        const second = deriveTripStatus(t.startDate, t.endDate, t.wdwToday);
        return first === second;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('follows the dates: shifting the WDW date across the boundaries re-derives status (R2.6)', () => {
    fc.assert(
      fc.property(dayArb, fc.nat({ max: 3_650 }), (startDay, span) => {
        const endDay = startDay + span;
        const startDate = dayToISO(startDay);
        const endDate = dayToISO(endDay);

        // The day before the start is always upcoming; the day after the end
        // is always past; every day within [start, end] is active. Because
        // status changes only as `wdwToday` crosses the stored dates, it is a
        // pure derivation of the dates rather than a stored field.
        const beforeStart = deriveTripStatus(startDate, endDate, dayToISO(startDay - 1));
        const onStart = deriveTripStatus(startDate, endDate, dayToISO(startDay));
        const onEnd = deriveTripStatus(startDate, endDate, dayToISO(endDay));
        const afterEnd = deriveTripStatus(startDate, endDate, dayToISO(endDay + 1));

        return (
          beforeStart === 'upcoming' &&
          onStart === 'active' &&
          onEnd === 'active' &&
          afterEnd === 'past'
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('deriveTripStatus — fixed regression examples', () => {
  it('upcoming when today precedes the start date (R2.1)', () => {
    expect(deriveTripStatus('2025-06-10', '2025-06-15', '2025-06-01')).toBe('upcoming');
  });

  it('active on the start date, an interior date, and the end date (R2.2)', () => {
    expect(deriveTripStatus('2025-06-10', '2025-06-15', '2025-06-10')).toBe('active');
    expect(deriveTripStatus('2025-06-10', '2025-06-15', '2025-06-12')).toBe('active');
    expect(deriveTripStatus('2025-06-10', '2025-06-15', '2025-06-15')).toBe('active');
  });

  it('active on a single-day Trip (R2.3)', () => {
    expect(deriveTripStatus('2025-06-10', '2025-06-10', '2025-06-10')).toBe('active');
  });

  it('past when today follows the end date (R2.4)', () => {
    expect(deriveTripStatus('2025-06-10', '2025-06-15', '2025-06-16')).toBe('past');
  });
});
