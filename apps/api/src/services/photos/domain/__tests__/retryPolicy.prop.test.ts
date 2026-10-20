import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { nextAttemptAt, shouldEscalate } from '../retryPolicy.js';

describe('retryPolicy properties', () => {
  // Feature: photo-uploads, Property 9: Retry backoff
  it('Property 9: nextAttemptAt is strictly > now, non-decreasing, matches 60s * 4^(attempts-1) up to 6h cap, and never exceeds 6h', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z') }),
        fc.integer({ min: 1, max: 20 }),
        (now, attempts) => {
          const next = nextAttemptAt(now, attempts);

          // Strictly greater than now
          expect(next.getTime()).toBeGreaterThan(now.getTime());

          // Diff is at most 6 hours (21,600,000 ms)
          const diffMs = next.getTime() - now.getTime();
          const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
          expect(diffMs).toBeLessThanOrEqual(SIX_HOURS_MS);

          // Matches formula exactly: min(60s * 4^(attempts - 1), 6h)
          const expectedMs = Math.min(60 * 1000 * Math.pow(4, attempts - 1), SIX_HOURS_MS);
          expect(diffMs).toBe(expectedMs);

          // Non-decreasing: attempts + 1 >= attempts
          const nextPlusOne = nextAttemptAt(now, attempts + 1);
          expect(nextPlusOne.getTime()).toBeGreaterThanOrEqual(next.getTime());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('shouldEscalate returns true iff attempts >= max', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 10 }), (attempts, maxAttempts) => {
        expect(shouldEscalate(attempts, maxAttempts)).toBe(attempts >= maxAttempts);
      }),
      { numRuns: 100 }
    );
  });
});
