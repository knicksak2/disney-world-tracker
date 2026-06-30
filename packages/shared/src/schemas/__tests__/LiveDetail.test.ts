/**
 * Unit tests for the shared `liveDetailSchema`.
 *
 * These cover the example/edge-case portion of the projected Live_Detail
 * contract:
 *   - the minimal projected shape is accepted (status present; the three
 *     collections present as empty arrays) (R1.2, R1.21)
 *   - minute-valued fields outside the whole-number `[0, 1440]` range are
 *     rejected (R1.5, R1.6, R1.10, R1.11, R1.12)
 *   - forecast percentages outside `[0, 100]` are rejected (R1.17)
 *
 * Validates: Requirements 1.2, 1.10, 1.21
 */

import { describe, expect, it } from 'vitest';

import { liveDetailSchema } from '../LiveDetail.js';

const MINIMAL = {
  status: 'Unknown',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
} as const;

describe('liveDetailSchema — minimal accepted shape', () => {
  it('accepts the minimal projected shape (Unknown status, empty collections)', () => {
    const result = liveDetailSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
  });

  it('accepts each Operating_Status value with the empty collections', () => {
    for (const status of ['Operating', 'Closed', 'Down', 'Refurbishment', 'Unknown']) {
      expect(liveDetailSchema.safeParse({ ...MINIMAL, status }).success).toBe(true);
    }
  });

  it('accepts boundary minute values (0 and 1440)', () => {
    expect(
      liveDetailSchema.safeParse({ ...MINIMAL, waitMinutes: 0 }).success,
    ).toBe(true);
    expect(
      liveDetailSchema.safeParse({ ...MINIMAL, waitMinutes: 1440 }).success,
    ).toBe(true);
  });

  it('rejects an unknown Operating_Status value', () => {
    expect(
      liveDetailSchema.safeParse({ ...MINIMAL, status: 'Operatng' }).success,
    ).toBe(false);
  });

  it('rejects a missing required collection', () => {
    const { diningAvailability: _omitted, ...withoutDining } = MINIMAL;
    expect(liveDetailSchema.safeParse(withoutDining).success).toBe(false);
  });
});

describe('liveDetailSchema — out-of-range minute values', () => {
  it.each([
    ['waitMinutes above max', { waitMinutes: 1441 }],
    ['waitMinutes below min', { waitMinutes: -1 }],
    ['waitMinutes non-integer', { waitMinutes: 5.5 }],
    ['singleRiderWaitMinutes above max', { singleRiderWaitMinutes: 1441 }],
    ['singleRiderWaitMinutes below min', { singleRiderWaitMinutes: -5 }],
  ])('rejects %s', (_label, overrides) => {
    expect(liveDetailSchema.safeParse({ ...MINIMAL, ...overrides }).success).toBe(false);
  });

  it('rejects an out-of-range dining estimatedWaitMinutes', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      diningAvailability: [{ partySize: 4, estimatedWaitMinutes: 1441 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range boarding-group estimatedWaitMinutes', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      boardingGroup: { allocation: 'Available', estimatedWaitMinutes: -1 },
    });
    expect(result.success).toBe(false);
  });
});

describe('liveDetailSchema — out-of-range forecast values', () => {
  const time = '2024-05-01T13:00:00Z';

  it('rejects a forecast percentage above 100', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      forecast: [{ time, waitMinutes: 30, percentage: 101 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a forecast percentage below 0', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      forecast: [{ time, waitMinutes: 30, percentage: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a forecast waitMinutes above the 1440 cap', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      forecast: [{ time, waitMinutes: 1441, percentage: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts an in-range forecast entry', () => {
    const result = liveDetailSchema.safeParse({
      ...MINIMAL,
      forecast: [{ time, waitMinutes: 30, percentage: 50 }],
    });
    expect(result.success).toBe(true);
  });
});
