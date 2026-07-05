// Feature: stats-experience-redesign, Property 6: Distribution normalization
//
// Property test for the pure `normalizeDistribution` transform in
// `screens/stats/statsView.ts` (tasks.md → 4.4). It exercises the histogram
// normalization guarantee (R8.6): every bar fraction lies in `[0,1]`, the
// tallest non-zero bin maps to fraction `1`, the all-zero distribution is safe
// (no `NaN`, every fraction `0`), and — when the ratings are `sufficient` — the
// bar counts sum to `ratedCompletionsCount`. Runs with `fast-check` at
// `numRuns: 100`.
//
//   - Property 6 — Distribution normalization (normalizeDistribution).
//       Validates: Requirements 8.6

import fc from 'fast-check';

import type {
  RatingDistribution,
  RatingStatistics,
} from '../../../api/statsTypes';
import { normalizeDistribution } from '../statsView';

const NUM_RUNS = 100;

// The ten 1–10 histogram values, in ascending order.
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

// A per-bin count: a non-negative integer. The upper bound is generous so the
// tallest-bin / sum relationships are exercised across a wide range of shapes.
const countArb = fc.nat({ max: 100_000 });

// An arbitrary `RatingDistribution`: exactly one non-negative count per value
// 1..10 (the wire shape). Includes the all-zero map as a reachable case.
const distributionArb: fc.Arbitrary<RatingDistribution> = fc.record({
  1: countArb,
  2: countArb,
  3: countArb,
  4: countArb,
  5: countArb,
  6: countArb,
  7: countArb,
  8: countArb,
  9: countArb,
  10: countArb,
});

// A distribution guaranteed to have at least one non-zero bin, so the
// "tallest non-zero bin maps to fraction 1" law has a defined tallest bin.
const nonZeroDistributionArb: fc.Arbitrary<RatingDistribution> = fc
  .tuple(distributionArb, fc.constantFrom(...VALUES), fc.integer({ min: 1, max: 100_000 }))
  .map(([dist, boostValue, boostCount]) => ({ ...dist, [boostValue]: boostCount }));

// The all-zero distribution: the degenerate "no ratings yet" shape.
const ZERO_DISTRIBUTION: RatingDistribution = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
  9: 0,
  10: 0,
};

function sumCounts(distribution: RatingDistribution): number {
  return VALUES.reduce((sum, v) => sum + distribution[v], 0);
}

// ---------------------------------------------------------------------------
// Property 6 — Distribution normalization
// ---------------------------------------------------------------------------
//
// Validates: Requirements 8.6

describe('Property 6: Distribution normalization (normalizeDistribution)', () => {
  it('produces one bar per value 1..10 that echoes the raw count (R8.6)', () => {
    fc.assert(
      fc.property(distributionArb, (distribution) => {
        const bars = normalizeDistribution(distribution);

        // Exactly ten bars, one per value in ascending 1..10 order.
        expect(bars).toHaveLength(VALUES.length);
        expect(bars.map((bar) => bar.value)).toEqual([...VALUES]);

        // Each bar carries the untouched raw count for its value.
        for (const bar of bars) {
          expect(bar.count).toBe(
            distribution[bar.value as keyof RatingDistribution],
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('normalizes every bar fraction into [0,1] with no NaN (R8.6)', () => {
    fc.assert(
      fc.property(distributionArb, (distribution) => {
        const bars = normalizeDistribution(distribution);

        for (const bar of bars) {
          // Every fraction is a real number (never NaN / Infinity)...
          expect(Number.isFinite(bar.fraction)).toBe(true);
          // ...and lies within the [0,1] envelope.
          expect(bar.fraction).toBeGreaterThanOrEqual(0);
          expect(bar.fraction).toBeLessThanOrEqual(1);
          // A zero-count bin is a baseline (fraction 0) bar.
          if (bar.count === 0) {
            expect(bar.fraction).toBe(0);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps the tallest non-zero bin to fraction exactly 1 (R8.6)', () => {
    fc.assert(
      fc.property(nonZeroDistributionArb, (distribution) => {
        const bars = normalizeDistribution(distribution);
        const maxCount = Math.max(...bars.map((bar) => bar.count));

        // At least one bin is non-zero by construction, so a tallest bin exists.
        expect(maxCount).toBeGreaterThan(0);

        // Every bar at the tallest count maps to fraction 1; and each fraction
        // is exactly its share of the tallest bin.
        for (const bar of bars) {
          if (bar.count === maxCount) {
            expect(bar.fraction).toBe(1);
          }
          expect(bar.fraction).toBeCloseTo(bar.count / maxCount, 10);
        }

        // The tallest bin(s) really do reach fraction 1.
        expect(Math.max(...bars.map((bar) => bar.fraction))).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps the all-zero distribution safe: every fraction is 0, never NaN (R8.6)', () => {
    const bars = normalizeDistribution(ZERO_DISTRIBUTION);

    expect(bars).toHaveLength(VALUES.length);
    for (const bar of bars) {
      expect(bar.count).toBe(0);
      expect(Number.isFinite(bar.fraction)).toBe(true);
      expect(bar.fraction).toBe(0);
    }
  });

  it('yields bar counts that sum to ratedCompletionsCount when ratings are sufficient (R8.6)', () => {
    fc.assert(
      fc.property(distributionArb, (distribution) => {
        // Construct a sufficient RatingStatistics/distribution pair whose
        // reported count is the sum of the ten bins (the wire invariant).
        const ratedCompletionsCount = sumCounts(distribution);
        const ratings: RatingStatistics = {
          sufficient: true,
          ratedCompletionsCount,
          distribution,
        };

        const bars = normalizeDistribution(ratings.distribution!);
        const total = bars.reduce((sum, bar) => sum + bar.count, 0);

        expect(total).toBe(ratings.ratedCompletionsCount);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
