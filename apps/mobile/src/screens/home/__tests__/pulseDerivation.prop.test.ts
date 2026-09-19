/**
 * Property tests for Park Wait Pulse calculation and crowd trend classification.
 *
 * Validates: Requirements 2.1, 2.5; design.md Property 7
 */

import fc from 'fast-check';
import {
  calculateParkWaitAverage,
  classifyCrowdTrend,
  type PulseEntry,
} from '../pulseCalculations';

describe('Feature: navigation-redesign, Property 7: Park Wait Pulse computation and crowd trend classification', () => {
  it('calculates average wait as the integer mean of non-negative waits and correctly classifies crowd trend', () => {
    // Feature: navigation-redesign, Property 7: Park Wait Pulse computation and crowd trend classification
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            waitMinutes: fc.option(fc.integer({ min: -10, max: 240 }), { nil: null }),
            status: fc.constantFrom('OPERATING', 'CLOSED', 'DOWN', 'REFURBISHMENT'),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (entries: readonly PulseEntry[]) => {
          const avg = calculateParkWaitAverage(entries);
          const validWaits = entries
            .map((e) => e.waitMinutes)
            .filter((w): w is number => w !== null && w >= 0);

          if (validWaits.length === 0) {
            expect(avg).toBeNull();
            expect(classifyCrowdTrend(avg)).toBe('Walk-on');
          } else {
            expect(avg).not.toBeNull();
            const expectedSum = validWaits.reduce((a, b) => a + b, 0);
            const expectedAvg = Math.round(expectedSum / validWaits.length);
            expect(avg).toBe(expectedAvg);

            const trend = classifyCrowdTrend(avg);
            if (avg! < 20) {
              expect(trend).toBe('Walk-on');
            } else if (avg! < 35) {
              expect(trend).toBe('Light lines');
            } else if (avg! < 50) {
              expect(trend).toBe('Moderate');
            } else {
              expect(trend).toBe('Heavy');
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
