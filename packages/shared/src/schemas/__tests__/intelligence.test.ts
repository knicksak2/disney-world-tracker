/**
 * Feature: crowd-calendar — contract tests for the R7.5 accuracy fields added to
 * `crowdCalendarDaySchema`. Both apps read this contract, so a valid and an
 * invalid case for each new field is what stops the two drifting apart.
 */
import { describe, expect, it } from 'vitest';
import { crowdCalendarDaySchema } from '../Intelligence.js';

function baseDay(extra: Record<string, unknown> = {}) {
  return {
    date: '2026-08-20',
    park: 'Magic Kingdom',
    forecastIndex: 5,
    parkHours: { openTime: '2026-08-20T13:00:00.000Z', closeTime: '2026-08-21T02:00:00.000Z' },
    earlyEntry: false,
    extendedEvening: false,
    ticketedEvent: false,
    ...extra,
  };
}

describe('crowdCalendarDaySchema', () => {
  it('accepts a day with no accuracy fields at all (a future date)', () => {
    const parsed = crowdCalendarDaySchema.parse(baseDay());
    expect(parsed.observedIndex).toBeUndefined();
    expect(parsed.capturedForecast).toBeUndefined();
    expect(parsed.forecastAccuracy).toBeUndefined();
  });

  it('accepts a fully populated predicted-versus-actual day', () => {
    const parsed = crowdCalendarDaySchema.parse(
      baseDay({
        observedIndex: 5,
        capturedForecast: { index: 6, leadDays: 7, capturedAt: '2026-08-13T11:10:00.000Z' },
        forecastAccuracy: { meanAbsoluteErrorLevels: 1.2, leadDays: 7, sampleCount: 8 },
      }),
    );
    expect(parsed.capturedForecast).toEqual({
      index: 6,
      leadDays: 7,
      capturedAt: '2026-08-13T11:10:00.000Z',
    });
    expect(parsed.forecastAccuracy?.meanAbsoluteErrorLevels).toBeCloseTo(1.2, 6);
  });

  it('rejects a capturedForecast missing its lead time', () => {
    // Without leadDays the UI cannot say how far ahead the claim was made, which
    // is the part that makes the comparison meaningful.
    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          capturedForecast: { index: 6, capturedAt: '2026-08-13T11:10:00.000Z' },
        }),
      ),
    ).toThrow();
  });

  it('rejects a fractional or negative lead time', () => {
    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          capturedForecast: { index: 6, leadDays: 7.5, capturedAt: '2026-08-13T11:10:00.000Z' },
        }),
      ),
    ).toThrow();

    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          capturedForecast: { index: 6, leadDays: -1, capturedAt: '2026-08-13T11:10:00.000Z' },
        }),
      ),
    ).toThrow();
  });

  it('rejects a negative mean absolute error', () => {
    // An absolute error cannot be negative; accepting one would let a sign bug
    // through into the surface that is meant to keep us honest.
    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          forecastAccuracy: { meanAbsoluteErrorLevels: -0.5, leadDays: 7, sampleCount: 8 },
        }),
      ),
    ).toThrow();
  });

  it('rejects a negative or fractional sample count', () => {
    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          forecastAccuracy: { meanAbsoluteErrorLevels: 1.2, leadDays: 7, sampleCount: -1 },
        }),
      ),
    ).toThrow();

    expect(() =>
      crowdCalendarDaySchema.parse(
        baseDay({
          forecastAccuracy: { meanAbsoluteErrorLevels: 1.2, leadDays: 7, sampleCount: 2.5 },
        }),
      ),
    ).toThrow();
  });
});
