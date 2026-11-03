/**
 * Unit test for `toCents` string-typed numeric driver parser (round 3 M2).
 *
 * Validates: Requirements 17.2, 20.6
 */

import { describe, expect, it } from 'vitest';
import { toCents, toDateString, toNullableDateString } from '../repo.js';

describe('toCents parser', () => {
  it('converts string integers from node-pg to numbers', () => {
    const res = toCents('2500');
    expect(res).toBe(2500);
    expect(typeof res).toBe('number');
  });

  it('keeps number integers as numbers', () => {
    const res = toCents(2500);
    expect(res).toBe(2500);
    expect(typeof res).toBe('number');
  });

  it('converts null and undefined to 0', () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });

  it('handles negative integers', () => {
    expect(toCents('-500')).toBe(-500);
    expect(toCents(-500)).toBe(-500);
  });

  it('throws on non-integer string numbers like "12.5"', () => {
    expect(() => toCents('12.5')).toThrowError('non_integer_cents');
  });

  it('throws on non-numeric strings like "abc"', () => {
    expect(() => toCents('abc')).toThrowError('non_integer_cents');
  });

  it('throws on non-integer numbers like 12.5', () => {
    expect(() => toCents(12.5)).toThrowError('non_integer_cents');
  });

  it('throws on non-finite numbers', () => {
    expect(() => toCents(NaN)).toThrowError('non_integer_cents');
    expect(() => toCents(Infinity)).toThrowError('non_integer_cents');
  });
});

describe('toDateString & toNullableDateString date formatters', () => {
  it('converts native JS Date objects to YYYY-MM-DD format (not "Tue Dec 15")', () => {
    // Regression test for "Save $0.00 per week" NaN bug:
    // Postgres Date object formatted via String().slice(0, 10) produced "Tue Dec 15",
    // breaking daysBetween and yielding NaN weeksRemaining.
    const date = new Date('2026-12-15T00:00:00.000Z');
    expect(toDateString(date)).toBe('2026-12-15');
    expect(toNullableDateString(date)).toBe('2026-12-15');
  });

  it('keeps string YYYY-MM-DD intact', () => {
    expect(toDateString('2026-12-15')).toBe('2026-12-15');
    expect(toNullableDateString('2026-12-15')).toBe('2026-12-15');
  });

  it('handles null, undefined, and empty string safely', () => {
    expect(toDateString(null)).toBe('');
    expect(toDateString(undefined)).toBe('');
    expect(toNullableDateString(null)).toBeNull();
    expect(toNullableDateString(undefined)).toBeNull();
    expect(toNullableDateString('')).toBeNull();
  });
});

