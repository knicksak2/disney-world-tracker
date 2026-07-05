// Feature: expanded-stats, Property 11: Percentile rank is well-formed and honors ties and edge cases
/**
 * Property-based tests for the live Percentile_Rank primitive
 * (`services/stats/percentile.ts::computePercentileRank`).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6
 *
 * Property 11 (design.md → Correctness Properties):
 *
 *   For any target completion total and any multiset of other trackers'
 *   completion totals (each with at least one completion), the
 *   Percentile_Rank equals
 *     100 * (count strictly less than the target) / (number of other trackers)
 *   in `[0.0, 100.0]` rounded to one decimal using round-half-up, with
 *   trackers tying the target excluded from the numerator but kept in the
 *   denominator; and the result is `0.0` when the target is the only tracker
 *   with a completion (no other trackers) or when the target has zero
 *   completions.
 *
 * Test design
 * -----------
 * `computePercentileRank` is a pure function over a `PercentileInput`
 * (`{ targetTotal, otherTotals }`). The repo guarantees each entry of
 * `otherTotals` is >= 1 (a `GROUP BY user_id` only yields groups with at
 * least one row), so the generators mirror that contract: every "other
 * tracker" total is drawn from `[1, N]`, while the target total may be 0
 * (the zero-completions edge case, R7.6).
 *
 * The reference oracle re-derives the expected value straight from the
 * requirement text — numerator is the count of other totals STRICTLY below
 * the target, denominator is the number of other trackers — then applies
 * round-half-up to one decimal. The properties assert both the exact match to
 * this oracle and the structural guarantees (range, one-decimal granularity,
 * tie handling, and the two edge cases).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computePercentileRank } from '../percentile.js';
import type { PercentileInput } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// The completion-count domain is kept small ([0, 40]) so that ties with the
// target occur frequently. A wide domain would make ties vanishingly rare and
// rob the property of coverage on R7.4 (tie handling). Every OTHER tracker
// total is >= 1 to honor the repo contract (each grouped tracker has at least
// one active completion); only the TARGET may be 0 (R7.6).

const MAX_TOTAL = 40;

/** Target's active-completion total; may be 0 (zero-completions edge, R7.6). */
const targetTotalArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: MAX_TOTAL,
});

/** One other tracker's total, always >= 1 per the repo contract. */
const otherTotalArb: fc.Arbitrary<number> = fc.integer({
  min: 1,
  max: MAX_TOTAL,
});

/** Zero or more other trackers; empty models the "only tracker" edge (R7.5). */
const otherTotalsArb: fc.Arbitrary<number[]> = fc.array(otherTotalArb, {
  minLength: 0,
  maxLength: 30,
});

const inputArb: fc.Arbitrary<PercentileInput> = fc
  .record({
    targetTotal: targetTotalArb,
    otherTotals: otherTotalsArb,
  })
  .map(({ targetTotal, otherTotals }) => ({ targetTotal, otherTotals }));

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/**
 * Round a non-negative number to one decimal using round-half-up (half toward
 * +∞). Percentile values are always non-negative, so `Math.round` — which
 * rounds half toward +∞ — is exactly the round-half-up rule (R7.3).
 */
function roundHalfUp1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Expected Percentile_Rank derived directly from the requirement text:
 *
 *   - denominator = number of other trackers with >= 1 completion (R7.3);
 *   - numerator   = count of other totals STRICTLY below the target (R7.1,
 *     R7.4 — ties with the target are excluded);
 *   - 0.0 when there are no other trackers (R7.5) or the target has zero
 *     completions (R7.6 — no other total, each >= 1, can be strictly below 0).
 */
function computeOracle(input: PercentileInput): number {
  const { targetTotal, otherTotals } = input;
  const denominator = otherTotals.length;
  if (denominator === 0) {
    return 0.0;
  }
  const numerator = otherTotals.filter((t) => t < targetTotal).length;
  return roundHalfUp1((100 * numerator) / denominator);
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('percentile — Property 11: well-formed, ties honored, edge cases', () => {
  it('equals the strictly-less / denominator oracle for any input (R7.1, R7.3, R7.4)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(computePercentileRank(input)).toBe(computeOracle(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result is always in [0.0, 100.0] and rounded to one decimal (R7.3)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const rank = computePercentileRank(input);
        expect(rank).toBeGreaterThanOrEqual(0.0);
        expect(rank).toBeLessThanOrEqual(100.0);
        // One-decimal granularity: rank * 10 is (near-)integral.
        const scaled = Math.round(rank * 10);
        expect(Math.abs(rank * 10 - scaled)).toBeLessThan(1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('excludes trackers tied with the target from the numerator but keeps them in the denominator (R7.4)', () => {
    // Build an input with a controlled number of strictly-below, tied, and
    // strictly-above other trackers, then assert the reported rank ignores the
    // ties in the numerator while the denominator still counts them.
    const scenarioArb = fc
      .record({
        target: fc.integer({ min: 1, max: MAX_TOTAL }),
        below: fc.nat({ max: 10 }),
        tied: fc.nat({ max: 10 }),
        // "above" delta keeps above-totals strictly greater than target.
        aboveDeltas: fc.array(fc.integer({ min: 1, max: MAX_TOTAL }), {
          maxLength: 10,
        }),
      })
      .map(({ target, below, tied, aboveDeltas }) => {
        const otherTotals: number[] = [];
        // `below` trackers strictly under the target (target >= 1 ⇒ 0 works).
        for (let i = 0; i < below; i++) {
          otherTotals.push(target - 1);
        }
        // `tied` trackers exactly equal to the target.
        for (let i = 0; i < tied; i++) {
          otherTotals.push(target);
        }
        // Trackers strictly above the target.
        for (const delta of aboveDeltas) {
          otherTotals.push(target + delta);
        }
        return { target, below, tied, aboveDeltas, otherTotals };
      });

    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { target, below, tied, aboveDeltas, otherTotals } = scenario;
        const denominator = below + tied + aboveDeltas.length;
        fc.pre(denominator > 0); // skip the empty case (covered elsewhere)

        const rank = computePercentileRank({
          targetTotal: target,
          otherTotals,
        });

        // Numerator is `below` only — tied and above are excluded.
        const expected = roundHalfUp1((100 * below) / denominator);
        expect(rank).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is 0.0 when the target is the only tracker with a completion (R7.5)', () => {
    fc.assert(
      fc.property(targetTotalArb, (targetTotal) => {
        expect(
          computePercentileRank({ targetTotal, otherTotals: [] }),
        ).toBe(0.0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is 0.0 when the target has zero completions, regardless of other trackers (R7.6)', () => {
    fc.assert(
      fc.property(otherTotalsArb, (otherTotals) => {
        // Every other total is >= 1, so none can be strictly below 0.
        expect(
          computePercentileRank({ targetTotal: 0, otherTotals }),
        ).toBe(0.0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports 100.0 when the target is strictly ahead of every other tracker (R7.1)', () => {
    // Draw a non-empty set of other trackers all strictly below the target.
    const scenarioArb = fc
      .record({
        others: fc.array(fc.integer({ min: 1, max: MAX_TOTAL }), {
          minLength: 1,
          maxLength: 20,
        }),
      })
      .map(({ others }) => {
        const target = Math.max(...others) + 1;
        return { target, others };
      });

    fc.assert(
      fc.property(scenarioArb, ({ target, others }) => {
        expect(
          computePercentileRank({ targetTotal: target, otherTotals: others }),
        ).toBe(100.0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
