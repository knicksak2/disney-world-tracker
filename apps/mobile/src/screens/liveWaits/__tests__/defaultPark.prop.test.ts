// Feature: navigation-redesign, Property 5: Always resolves to a valid tracked Park
/**
 * Property-based tests for resolveDefaultLiveWaitsPark (Task 5.4).
 *
 * Validates: Requirements 4.3, 10.1
 */

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { PARKS, type Park } from '@dwt/shared';

import { resolveDefaultLiveWaitsPark } from '../defaultPark';

const NUM_RUNS = 100;

const parkOrNullArb: fc.Arbitrary<Park | null | undefined> = fc.oneof(
  fc.constantFrom(...PARKS),
  fc.constant(null),
  fc.constant(undefined),
  fc.string() as unknown as fc.Arbitrary<Park>, // garbage strings
);

describe('resolveDefaultLiveWaitsPark property tests', () => {
  it('Property 5: Always resolves to a valid tracked Park following fallback chain', () => {
    fc.assert(
      fc.property(parkOrNullArb, parkOrNullArb, (activeTripPark, lastViewedPark) => {
        const resolved = resolveDefaultLiveWaitsPark(activeTripPark, lastViewedPark);

        // 1. Result is ALWAYS a member of canonical PARKS
        expect((PARKS as readonly string[]).includes(resolved)).toBe(true);

        // 2. If activeTripPark is valid, it wins
        if (activeTripPark && (PARKS as readonly string[]).includes(activeTripPark)) {
          expect(resolved).toBe(activeTripPark);
          return;
        }

        // 3. Otherwise, if lastViewedPark is valid, it wins
        if (lastViewedPark && (PARKS as readonly string[]).includes(lastViewedPark)) {
          expect(resolved).toBe(lastViewedPark);
          return;
        }

        // 4. Otherwise, falls back to the first canonical park (Magic Kingdom)
        expect(resolved).toBe(PARKS[0]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
