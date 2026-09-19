// Feature: navigation-redesign, Property 4: Total, order-preserving projection of the claimable count
/**
 * Property-based tests for buildQuickActions (Task 8.4).
 *
 * Validates: Requirements 4.2, 4.7
 */

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { buildQuickActions } from '../quickActions';

const NUM_RUNS = 100;

describe('buildQuickActions property tests', () => {
  it('Property 4: Total, order-preserving projection of the claimable count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (claimablePinCount) => {
          const actions = buildQuickActions(claimablePinCount);

          // 1. No duplicate keys
          const keys = actions.map((a) => a.key);
          expect(new Set(keys).size).toBe(keys.length);

          // 2. Inclusion rule for claimPins
          const hasClaimPins = keys.includes('claimPins');
          expect(hasClaimPins).toBe(claimablePinCount > 0);

          if (claimablePinCount > 0) {
            // 3. When count > 0, exactly 5 actions in fixed R4.2 order
            expect(keys).toEqual([
              'liveWaits',
              'logRide',
              'logSnack',
              'claimPins',
              'todaySchedule',
            ]);
          } else {
            // 4. When count === 0, exactly 4 actions in fixed R4.2 order without claimPins
            expect(keys).toEqual([
              'liveWaits',
              'logRide',
              'logSnack',
              'todaySchedule',
            ]);
          }

          // 5. Relative order of the common 4 actions is always strictly preserved
          const commonKeys = keys.filter((k) => k !== 'claimPins');
          expect(commonKeys).toEqual([
            'liveWaits',
            'logRide',
            'logSnack',
            'todaySchedule',
          ]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
