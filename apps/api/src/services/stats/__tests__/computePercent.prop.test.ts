// Feature: disney-world-tracker, Property 9: computePercent is bounded, rounded, and zero-safe
/**
 * Property-based tests for `computePercent(numerator, denominator)`.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.6, 3.7, 3.8
 *
 * The Stats_Service computes overall, per-Park, and per-Experience_Category
 * completion percentages by dividing a non-negative count of completed
 * Experiences by a non-negative total. The design states (Property 9):
 *
 *   For any numerator `c` and denominator `t` with `c >= 0` and `t >= 0`,
 *   `computePercent(c, t)` returns a value in the closed interval
 *   `[0.0, 100.0]`, rounded to one decimal place, equal to `0.0` when
 *   `t == 0`, and equal to `min(100.0, round1(c * 100 / t))` otherwise.
 *
 * Each numbered property below corresponds to one of those guarantees:
 *
 *   1. Result is in `[0.0, 100.0]`.                 (R3.1, R3.2, R3.3, R3.8)
 *   2. Result is rounded to one decimal place.      (R3.1, R3.2, R3.3)
 *   3. `denominator === 0  =>  result === 0.0`.     (R3.6, R3.7)
 *   4. `numerator > denominator => result === 100.0`(R3.8 cap)
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { computePercent } from '../computePercent.js';

const NUM_RUNS = 100;

/**
 * Non-negative integer counts. Real callers pass `COUNT(*)` results from the
 * Experiences and Completions tables, so values are guaranteed non-negative
 * integers. `fc.nat()` is bounded by 2^31 - 1, which more than covers any
 * Disney-park-sized population.
 */
const count = fc.nat();

/**
 * Returns true when `value` is a one-decimal multiple, accounting for the
 * inevitable binary-float drift of dividing by 10. Internally, `round1`
 * computes `Math.round(value * 10) / 10`, so `value * 10` should land on or
 * extremely close to an integer.
 */
function isOneDecimal(value: number): boolean {
  const scaled = value * 10;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

describe('computePercent — Property 9: bounded, rounded, and zero-safe', () => {
  it('1. result is always in the closed interval [0.0, 100.0]', () => {
    fc.assert(
      fc.property(count, count, (numerator, denominator) => {
        const result = computePercent(numerator, denominator);
        return result >= 0 && result <= 100;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('2. result is rounded to one decimal place', () => {
    fc.assert(
      fc.property(count, count, (numerator, denominator) => {
        return isOneDecimal(computePercent(numerator, denominator));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('3. denominator === 0 implies result === 0.0', () => {
    fc.assert(
      fc.property(count, (numerator) => {
        return computePercent(numerator, 0) === 0.0;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('4. numerator > denominator (with denominator > 0) caps result at 100.0', () => {
    // Build (numerator, denominator) pairs satisfying numerator > denominator
    // and denominator >= 1 directly, instead of filtering, so fast-check does
    // not exhaust generation budget skipping uninteresting cases.
    const overflowingPair = fc
      .tuple(fc.integer({ min: 1 }), fc.integer({ min: 1 }))
      .map(([denominator, excess]) => ({
        numerator: denominator + excess,
        denominator,
      }));

    fc.assert(
      fc.property(overflowingPair, ({ numerator, denominator }) => {
        return computePercent(numerator, denominator) === 100.0;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
