import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../../ticketPrices/dates.js';
import { daysInclusive, isInStay, nightsOf } from '../stay.js';

describe('nightsOf', () => {
  it('is checkIn up to but not including checkOut', () => {
    expect(nightsOf('2027-03-01', '2027-03-04')).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
  });

  it('is empty when checkIn equals checkOut, or checkOut is before checkIn', () => {
    expect(nightsOf('2027-03-01', '2027-03-01')).toEqual([]);
    expect(nightsOf('2027-03-04', '2027-03-01')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(nightsOf('2027-01-30', '2027-02-02')).toEqual(['2027-01-30', '2027-01-31', '2027-02-01']);
  });

  it('crosses a year boundary', () => {
    expect(nightsOf('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('includes a leap day and skips the missing one in a common year', () => {
    expect(nightsOf('2028-02-27', '2028-03-01')).toEqual(['2028-02-27', '2028-02-28', '2028-02-29']);
    expect(nightsOf('2027-02-27', '2027-03-01')).toEqual(['2027-02-27', '2027-02-28']);
  });

  it('is unaffected by the DST change inside the stay (2027-03-14 and 2027-11-07 in America/New_York)', () => {
    expect(nightsOf('2027-03-13', '2027-03-16')).toEqual(['2027-03-13', '2027-03-14', '2027-03-15']);
    expect(nightsOf('2027-11-06', '2027-11-09')).toEqual(['2027-11-06', '2027-11-07', '2027-11-08']);
  });
});

describe('daysInclusive', () => {
  it('counts both ends', () => {
    expect(daysInclusive('2027-03-01', '2027-03-04')).toBe(4);
    expect(daysInclusive('2027-03-01', '2027-03-01')).toBe(1);
    expect(daysInclusive('2028-02-28', '2028-03-01')).toBe(3);
  });

  it('is 0 when checkOut is before checkIn', () => {
    expect(daysInclusive('2027-03-04', '2027-03-01')).toBe(0);
  });
});

describe('isInStay', () => {
  const stay = { checkIn: '2027-03-01', checkOut: '2027-03-04' };

  it('includes both the check-in and the check-out date', () => {
    expect(isInStay('2027-03-01', stay)).toBe(true);
    expect(isInStay('2027-03-02', stay)).toBe(true);
    expect(isInStay('2027-03-04', stay)).toBe(true);
  });

  it('excludes the day before check-in and the day after check-out', () => {
    expect(isInStay('2027-02-28', stay)).toBe(false);
    expect(isInStay('2027-03-05', stay)).toBe(false);
    expect(isInStay('2026-03-02', stay)).toBe(false);
  });
});

describe('stay properties', () => {
  const dateArb = fc.integer({ min: 0, max: 3 * 366 }).map((n) => addDays('2026-01-01', n));

  // Feature: dining-plan-calculator, Property 19: Stay and slot handling (nights half)
  // Validates: Requirements 3.4
  it('Property 19: nights are exactly checkIn .. checkOut-1, and every night and both ends are in the stay', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 40 }), (checkIn, length) => {
        const checkOut = addDays(checkIn, length);
        const nights = nightsOf(checkIn, checkOut);
        expect(nights).toHaveLength(length);
        nights.forEach((night, i) => expect(night).toBe(addDays(checkIn, i)));
        expect(nights).not.toContain(checkOut);
        expect(new Set(nights).size).toBe(length);
        expect(daysInclusive(checkIn, checkOut)).toBe(length + 1);
        for (const night of nights) expect(isInStay(night, { checkIn, checkOut })).toBe(true);
        expect(isInStay(checkOut, { checkIn, checkOut })).toBe(true);
        expect(isInStay(addDays(checkIn, -1), { checkIn, checkOut })).toBe(false);
        expect(isInStay(addDays(checkOut, 1), { checkIn, checkOut })).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
