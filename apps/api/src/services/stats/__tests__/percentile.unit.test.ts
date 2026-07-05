// Feature: expanded-stats, Task 5.4: unit tests for percentile edge cases.
/**
 * Example-based unit tests for the pure Percentile_Rank primitive
 * `computePercentileRank` in `services/stats/percentile.ts`.
 *
 * These complement the property test (Property 11) by pinning down the concrete
 * edge cases the design and requirements call out:
 *
 *   - All other trackers tied with the target → the target is strictly ahead of
 *     none, so the numerator is 0 and the rank is `0.0` (R7.4).
 *   - A single tracker (`otherTotals` empty) → no other trackers exist, so the
 *     denominator is 0 and the rank is `0.0` (R7.5).
 *   - Zero completions for the target (`targetTotal === 0`) → no other tracker
 *     (each >= 1) can be strictly below 0, so the rank is `0.0` (R7.6).
 *   - Target strictly ahead of every other tracker → the numerator equals the
 *     denominator and the rank is `100.0` (R7.4 upper bound).
 *
 * `computePercentileRank` is a pure function over a `PercentileInput`
 * (`{ targetTotal, otherTotals }`). The repo guarantees every entry of
 * `otherTotals` is >= 1 (a `GROUP BY user_id` only yields groups with at least
 * one active completion), so these examples honor that contract.
 *
 * Validates: Requirements 7.4, 7.5, 7.6.
 */

import { describe, it, expect } from 'vitest';

import { computePercentileRank } from '../percentile.js';
import type { PercentileInput } from '../repo.js';

describe('computePercentileRank — percentile edge cases (task 5.4)', () => {
  describe('all other trackers tied with the target (R7.4)', () => {
    it('reports 0.0 when every other tracker has the same total as the target', () => {
      // Ties are excluded from the numerator (strictly-less) but retained in
      // the denominator, so the target is strictly ahead of none → 0.0.
      const input: PercentileInput = {
        targetTotal: 7,
        otherTotals: [7, 7, 7, 7],
      };

      expect(computePercentileRank(input)).toBe(0.0);
    });

    it('reports 0.0 for a single tied other tracker', () => {
      const input: PercentileInput = {
        targetTotal: 3,
        otherTotals: [3],
      };

      expect(computePercentileRank(input)).toBe(0.0);
    });
  });

  describe('single tracker — no other trackers (R7.5)', () => {
    it('reports 0.0 when otherTotals is empty and the target has completions', () => {
      const input: PercentileInput = {
        targetTotal: 12,
        otherTotals: [],
      };

      expect(computePercentileRank(input)).toBe(0.0);
    });

    it('reports 0.0 when otherTotals is empty and the target also has zero completions', () => {
      const input: PercentileInput = {
        targetTotal: 0,
        otherTotals: [],
      };

      expect(computePercentileRank(input)).toBe(0.0);
    });
  });

  describe('target has zero completions (R7.6)', () => {
    it('reports 0.0 when targetTotal is 0, regardless of other trackers', () => {
      // Every other total is >= 1, so none can be strictly below 0.
      const input: PercentileInput = {
        targetTotal: 0,
        otherTotals: [1, 2, 3, 40],
      };

      expect(computePercentileRank(input)).toBe(0.0);
    });
  });

  describe('target strictly ahead of every other tracker (R7.4)', () => {
    it('reports 100.0 when the target exceeds all other trackers', () => {
      const input: PercentileInput = {
        targetTotal: 50,
        otherTotals: [1, 10, 25, 49],
      };

      expect(computePercentileRank(input)).toBe(100.0);
    });

    it('reports 100.0 for a single other tracker strictly below the target', () => {
      const input: PercentileInput = {
        targetTotal: 5,
        otherTotals: [4],
      };

      expect(computePercentileRank(input)).toBe(100.0);
    });
  });

  describe('mixed below / tied / above (R7.4 numerator/denominator)', () => {
    it('counts only strictly-below trackers in the numerator while ties stay in the denominator', () => {
      // 2 below, 2 tied, 1 above → numerator 2, denominator 5 → 40.0.
      const input: PercentileInput = {
        targetTotal: 10,
        otherTotals: [5, 9, 10, 10, 20],
      };

      expect(computePercentileRank(input)).toBe(40.0);
    });
  });
});
