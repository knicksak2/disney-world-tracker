// Feature: hidden-mickeys, Property 13: Report auto-hide policy

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shouldAutoHide } from '../reportPolicy.js';
import { MICKEY_STATUSES, type MickeyStatus } from '@dwt/shared';

describe('reportPolicy domain module', () => {
  // Feature: hidden-mickeys, Property 13: Report auto-hide policy
  it('Property 13: shouldAutoHide hides only approved Community entries at or above threshold; Official never auto-hides', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MickeyStatus>(...MICKEY_STATUSES),
        fc.boolean(),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (status, official, countedReporters, threshold) => {
          const autoHide = shouldAutoHide({ status, official, countedReporters }, threshold);

          // Official entries NEVER auto-hide, even at 100x threshold
          if (official) {
            expect(autoHide).toBe(false);
            return;
          }

          // Non-approved entries never auto-hide
          if (status !== 'approved') {
            expect(autoHide).toBe(false);
            return;
          }

          // Approved Community entries auto-hide iff countedReporters >= threshold
          expect(autoHide).toBe(countedReporters >= threshold);
        },
      ),
      { numRuns: 100 },
    );
  });
});
