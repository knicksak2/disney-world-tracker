import { describe, expect, it } from 'vitest';

import {
  BOOKING_RULES,
  BOOKING_RULES_VERSION,
  PACKING_CATEGORIES,
  STARTER_PACKING_LIST,
} from '../index.js';

describe('BOOKING_RULES constants and table (R1.1, R1.14, R15.1)', () => {
  it('defines dropMinutes as 360 for dining and 420 for lightning lane', () => {
    expect(BOOKING_RULES.dining.dropMinutes).toBe(360);
    expect(BOOKING_RULES.lightning_lane.dropMinutes).toBe(420);
  });

  it('matches design table field-for-field for dining byStayType', () => {
    expect(BOOKING_RULES.dining.byStayType.resort).toEqual({
      headOffsetDays: 60,
      headCoverDays: 10,
      tail: { offsetDays: 60, mode: 'per_date' },
    });
    expect(BOOKING_RULES.dining.byStayType.partner_hotel).toEqual({
      headOffsetDays: 60,
      headCoverDays: 1,
      tail: { offsetDays: 60, mode: 'per_date' },
    });
    expect(BOOKING_RULES.dining.byStayType.offsite).toEqual({
      headOffsetDays: 60,
      headCoverDays: 1,
      tail: { offsetDays: 60, mode: 'per_date' },
    });
  });

  it('matches design table field-for-field for lightning_lane byTiming', () => {
    expect(BOOKING_RULES.lightning_lane.byTiming.seven_day).toEqual({
      headOffsetDays: 7,
      headCoverDays: 14,
      tail: { offsetDays: 3, mode: 'shared' },
    });
    expect(BOOKING_RULES.lightning_lane.byTiming.three_day).toEqual({
      headOffsetDays: 3,
      headCoverDays: null,
      tail: null,
    });
    expect(BOOKING_RULES.lightning_lane.byTiming.three_day_daily).toEqual({
      headOffsetDays: 3,
      headCoverDays: 1,
      tail: { offsetDays: 3, mode: 'per_date' },
    });
  });

  it('defines defaultTimingByStayType correctly for all stay types', () => {
    expect(BOOKING_RULES.lightning_lane.defaultTimingByStayType).toEqual({
      resort: 'seven_day',
      partner_hotel: 'seven_day',
      offsite: 'three_day',
    });
  });

  it('has a positive integer BOOKING_RULES_VERSION', () => {
    expect(Number.isInteger(BOOKING_RULES_VERSION)).toBe(true);
    expect(BOOKING_RULES_VERSION).toBeGreaterThan(0);
  });
});

describe('STARTER_PACKING_LIST constants and schema constraints (R11.2, R11.10, R15.1, R15.2)', () => {
  it('contains exactly 21 entries', () => {
    expect(STARTER_PACKING_LIST.length).toBe(21);
  });

  it('has every entry conforming to name length, category, and quantity 1', () => {
    const validCategories = new Set(PACKING_CATEGORIES);
    for (const entry of STARTER_PACKING_LIST) {
      expect(entry.name.length).toBeGreaterThanOrEqual(1);
      expect(entry.name.length).toBeLessThanOrEqual(80);
      expect(validCategories.has(entry.category)).toBe(true);
      expect(entry.quantity).toBe(1);
    }
  });

  it('has unique names under trim().toLowerCase()', () => {
    const keys = STARTER_PACKING_LIST.map((e) => e.name.trim().toLowerCase());
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(STARTER_PACKING_LIST.length);
  });
});
