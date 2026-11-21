// Feature: first-run-onboarding, Property 7: Trip Summary Banner Copy Matches Trip Status

import fc from 'fast-check';
import type { TripStatus } from '@dwt/shared';

import { deriveTripSummaryBannerCopy } from '../tripSummaryCopy';

const NUM_RUNS = 150;

const STATUS_ARBITRARY: fc.Arbitrary<TripStatus> = fc.constantFrom(
  'upcoming',
  'active',
  'past',
);

describe('Property 7: Trip Summary Banner Copy Matches Trip Status', () => {
  it('never renders "VACATION UNDERWAY" for upcoming trips and preserves active copy rules', () => {
    fc.assert(
      fc.property(
        STATUS_ARBITRARY,
        fc.nat(200),
        fc.nat(200),
        fc.nat(200),
        (status, completedCount, plannedCount, feedCount) => {
          const copy = deriveTripSummaryBannerCopy({
            status,
            completedCount,
            plannedCount,
            feedCount,
          });

          if (status === 'upcoming') {
            expect(copy.eyebrow).not.toBe('VACATION UNDERWAY');
            expect(copy.title).not.toContain('VACATION UNDERWAY');
            expect(copy.subtitle).not.toContain('VACATION UNDERWAY');
            expect(copy.eyebrow).toBe(
              completedCount > 0 ? 'TRIP PROGRESS' : 'UPCOMING TRIP',
            );
          } else if (status === 'active') {
            expect(copy.eyebrow).toBe(
              completedCount > 0 ? 'VACATION MILESTONE' : 'VACATION UNDERWAY',
            );
          } else {
            expect(copy.eyebrow).toBe('TRIP RECAP');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
