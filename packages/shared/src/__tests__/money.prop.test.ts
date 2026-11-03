import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bpsOf, splitCentsEvenly } from '../index.js';

const NUM_RUNS = 100;

describe('Trip Budget Money Properties', () => {
  // Feature: trip-budget, Property 28: Split cents evenly conservation
  it('// Feature: trip-budget, Property 28: Split cents evenly conservation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        (totalCents, count) => {
          const shares = splitCentsEvenly(totalCents, count);

          // Array length matches count
          expect(shares).toHaveLength(count);

          // Sum of shares strictly equals totalCents
          const sum = shares.reduce((acc, v) => acc + v, 0);
          expect(sum).toBe(totalCents);

          // Difference between max and min is at most 1
          const max = Math.max(...shares);
          const min = Math.min(...shares);
          expect(max - min).toBeLessThanOrEqual(1);

          // Larger values strictly at lower indices
          const remainder = totalCents % count;
          const ceilVal = Math.ceil(totalCents / count);
          const floorVal = Math.floor(totalCents / count);

          for (let i = 0; i < count; i++) {
            if (i < remainder) {
              expect(shares[i]).toBe(ceilVal);
            } else {
              expect(shares[i]).toBe(floorVal);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: trip-budget, Property 42: Basis-point arithmetic symmetry and edge bounds
  it('// Feature: trip-budget, Property 42: Basis-point arithmetic symmetry and edge bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (cents, bps) => {
          const result = bpsOf(cents, bps);

          // Edge cases
          expect(bpsOf(cents, 0)).toBe(0);
          expect(bpsOf(cents, 10000)).toBe(cents);

          // Distance from exact mathematical division is at most 0.5
          const exact = (cents * bps) / 10000;
          expect(Math.abs(result - exact)).toBeLessThanOrEqual(0.5);

          // Monotonically non-decreasing in cents
          if (cents > 0) {
            expect(result).toBeGreaterThanOrEqual(bpsOf(cents - 1, bps));
          }

          // Monotonically non-decreasing in bps
          if (bps > 0) {
            expect(result).toBeGreaterThanOrEqual(bpsOf(cents, bps - 1));
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

