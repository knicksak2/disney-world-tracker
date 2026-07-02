// Feature: friend-stats-viewing, Property 2: Completion-percentage formula is
// bounded, rounded, and zero-safe.
/**
 * Property-based test for the completion-percentage formula reused by the
 * Friend Stats Viewing reads (Profile overall percent and the per-Park /
 * per-Category stats breakdowns). The formula lives in `computePercent`.
 *
 * Validates: Requirements 2.2, 2.3, 3.2, 3.4
 *
 * Design Property 2:
 *   For any non-negative integer `completed` and `total`, the reported
 *   percentage equals
 *       total == 0 ? 0.0 : min(100.0, round1(completed * 100 / total))
 *   is always within [0.0, 100.0], is rounded to exactly one decimal place,
 *   and reports 0.0 when total == 0 (even when completed > total).
 *
 * This test is implemented as a single property (Property 2) checking the full
 * formula equality across the generated `(completed, total)` space — including
 * `total == 0` and `completed > total` — which subsumes the individual bound,
 * rounding, and zero-safety guarantees.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { computePercent, round1 } from '../computePercent.js';

const NUM_RUNS = 100;

/**
 * Non-negative integer counts. Real callers pass `COUNT(*)` results from the
 * Experiences and Completions tables, so values are guaranteed non-negative
 * integers.
 */
const count = fc.nat();

/** The formula exactly as stated by design Property 2. */
function expectedPercent(completed: number, total: number): number {
  return total === 0 ? 0.0 : Math.min(100.0, round1((completed * 100) / total));
}

/** True when `value` is a one-decimal multiple, allowing for float drift. */
function isOneDecimal(value: number): boolean {
  const scaled = value * 10;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

describe('friend-stats-viewing Property 2: completion-percentage formula is bounded, rounded, and zero-safe', () => {
  it('reports the exact formula, stays in [0.0, 100.0], rounds to one decimal, and is zero-safe', () => {
    // Generate (completed, total) freely so the space includes total == 0 and
    // completed > total without filtering away generation budget.
    fc.assert(
      fc.property(count, count, (completed, total) => {
        const result = computePercent(completed, total);

        // Exact formula equality (subsumes bound/round/zero-safe).
        if (result !== expectedPercent(completed, total)) {
          return false;
        }
        // Bounded within [0.0, 100.0].
        if (result < 0.0 || result > 100.0) {
          return false;
        }
        // Rounded to exactly one decimal place.
        if (!isOneDecimal(result)) {
          return false;
        }
        // Zero-safe: total == 0 reports 0.0, even when completed > total.
        if (total === 0 && result !== 0.0) {
          return false;
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
