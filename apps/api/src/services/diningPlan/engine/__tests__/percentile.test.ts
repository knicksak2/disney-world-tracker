import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { pickPercentile } from '../percentile.js';

describe('pickPercentile', () => {
  it('returns null for an empty list', () => {
    expect(pickPercentile([], 50)).toBeNull();
  });

  it.each([
    // [list, p, expected] with i = clamp(ceil(p/100 * n) - 1, 0, n - 1)
    [[1500], 25, 1500],
    [[1500], 50, 1500],
    [[1500], 85, 1500],
    [[1500], 100, 1500],
    [[1000, 2000], 25, 1000], // ceil(0.5) - 1 = 0
    [[1000, 2000], 50, 1000], // ceil(1) - 1 = 0
    [[1000, 2000], 85, 2000], // ceil(1.7) - 1 = 1
    [[1000, 2000], 100, 2000],
    [[1000, 2000, 3000], 25, 1000], // ceil(0.75) - 1 = 0
    [[1000, 2000, 3000], 50, 2000], // ceil(1.5) - 1 = 1
    [[1000, 2000, 3000], 85, 3000], // ceil(2.55) - 1 = 2
    [[1000, 2000, 3000], 100, 3000],
    [[1000, 2000, 3000, 4000], 25, 1000], // ceil(1) - 1 = 0
    [[1000, 2000, 3000, 4000], 50, 2000], // ceil(2) - 1 = 1
    [[1000, 2000, 3000, 4000], 85, 4000], // ceil(3.4) - 1 = 3
    [[1000, 2000, 3000, 4000], 100, 4000],
    [[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 25, 300], // ceil(2.5) - 1 = 2
    [[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 50, 500], // ceil(5) - 1 = 4
    [[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 85, 900], // ceil(8.5) - 1 = 8
    [[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 100, 1000],
  ])('pickPercentile(%j, %i) is %i', (list, p, expected) => {
    expect(pickPercentile(list, p)).toBe(expected);
  });

  it('has no floating-point drift at an exact rank (p = 7 of 100 items is the 7th item, not the 8th)', () => {
    const list = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
    expect(pickPercentile(list, 7)).toBe(700);
  });

  it('clamps p = 0 to the minimum', () => {
    expect(pickPercentile([1000, 2000, 3000], 0)).toBe(1000);
  });

  // Feature: dining-plan-calculator, Property 12: Percentile selection returns a real price
  // Validates: Requirements 7.2
  it('Property 12: returns a member of the list, is monotone in p, and matches the nearest-rank definition', () => {
    const listArb = fc
      .array(fc.integer({ min: 1, max: 20_000 }), { minLength: 1, maxLength: 30 })
      .map((xs) => [...xs].sort((a, b) => a - b));
    fc.assert(
      fc.property(listArb, fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), (list, p1, p2) => {
        const n = list.length;
        const r1 = pickPercentile(list, p1)!;
        expect(list).toContain(r1);
        // Nearest rank: the smallest value whose share of items at or below it reaches p (integer arithmetic).
        const oracle = list.find((_, i) => (i + 1) * 100 >= p1 * n)!;
        expect(r1).toBe(oracle);
        const [lo, hi] = p1 <= p2 ? [p1, p2] : [p2, p1];
        expect(pickPercentile(list, lo)!).toBeLessThanOrEqual(pickPercentile(list, hi)!);
        if (p1 * n <= 100) expect(r1).toBe(list[0]);
        expect(pickPercentile(list, 100)).toBe(list[n - 1]);
      }),
      { numRuns: 300 },
    );
  });
});
