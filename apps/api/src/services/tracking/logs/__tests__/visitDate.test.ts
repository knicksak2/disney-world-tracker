import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import { validateNotFutureVisitDate } from '../visitDate.js';

describe('validateNotFutureVisitDate', () => {
  const FIXED_NOW = new Date('2026-05-15T12:00:00Z');
  const USER_TZ = 'America/New_York'; // On 2026-05-15 12:00 UTC, it is 08:00 in NY -> 2026-05-15

  it('allows visit date equal to today in the user time zone (R6.4)', () => {
    expect(() => {
      validateNotFutureVisitDate('2026-05-15', USER_TZ, FIXED_NOW);
    }).not.toThrow();
  });

  it('allows visit date earlier than today in the user time zone', () => {
    expect(() => {
      validateNotFutureVisitDate('2026-05-14', USER_TZ, FIXED_NOW);
    }).not.toThrow();
  });

  it('rejects visit date on the next day with log_future_date (R6.4)', () => {
    try {
      validateNotFutureVisitDate('2026-05-16', USER_TZ, FIXED_NOW);
      expect.unreachable('expected validateNotFutureVisitDate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('log_future_date');
      expect(appErr.field).toBe('visitedOn');
    }
  });

  it('rejects an unknown time zone with validation_failed (R6.4)', () => {
    try {
      validateNotFutureVisitDate('2026-05-15', 'Not/A_Real_Zone', FIXED_NOW);
      expect.unreachable('expected validateNotFutureVisitDate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('validation_failed');
      expect(appErr.field).toBe('userTz');
    }
  });
});

