import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bpsOf, splitCentsEvenly } from '@dwt/shared';

const NUM_RUNS = 100;

describe('API sharedMoney cross-check (Properties 28 and 42)', () => {
  // Feature: trip-budget, Property 28: Split cents evenly conservation
  it('// Feature: trip-budget, Property 28: Split cents evenly conservation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (totalCents, count) => {
          const shares = splitCentsEvenly(totalCents, count);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(totalCents);
          expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: trip-budget, Property 42: Basis-point arithmetic symmetry and edge bounds
  it('// Feature: trip-budget, Property 42: Basis-point arithmetic symmetry and edge bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (cents, bps) => {
          const val = bpsOf(cents, bps);
          expect(val).toBe(Math.floor((cents * bps + 5000) / 10000));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

