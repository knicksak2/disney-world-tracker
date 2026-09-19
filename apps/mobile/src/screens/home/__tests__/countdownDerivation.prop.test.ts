/**
 * Property tests for vacation countdown calculation.
 *
 * Validates: Requirements 2.1; design.md Property 8
 */

import fc from 'fast-check';
import { calculateCountdownDays } from '../countdown';

describe('Feature: navigation-redesign, Property 8: Upcoming vacation countdown day derivation', () => {
  it('derives countdown days monotonically and never returns a negative number', () => {
    // Feature: navigation-redesign, Property 8: Upcoming vacation countdown day derivation
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),
        fc.date({ min: new Date('2026-01-01'), max: new Date('2028-12-31') }),
        (dayOffset, baseDate) => {
          const futureDate = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const daysLeft = calculateCountdownDays(futureDate, baseDate);

          expect(daysLeft).toBeGreaterThanOrEqual(0);
          expect(daysLeft).toBeLessThanOrEqual(dayOffset + 1);

          // Test monotonicity: an earlier reference date has greater or equal days remaining
          const earlierDate = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
          const daysLeftFromEarlier = calculateCountdownDays(futureDate, earlierDate);
          expect(daysLeftFromEarlier).toBeGreaterThanOrEqual(daysLeft);

          // Past date produces 0
          const pastDate = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
          expect(calculateCountdownDays(pastDate, baseDate)).toBe(0);
        },
      ),
      { numRuns: 150 },
    );
  });
});
