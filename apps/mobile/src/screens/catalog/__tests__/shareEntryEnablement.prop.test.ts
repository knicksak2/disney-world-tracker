// Feature: experience-detail-redesign, Property 11: For any combination of the
// detail, rating, and note loading flags, `isExperienceShareEntryEnabled`
// reports the entry point as enabled if and only if none of the three are
// loading.
//
// Validates: Requirements 8.1
//
// Test strategy:
//   Generate every combination of the three independent boolean load flags
//   (detailLoading, ratingLoading, noteLoading) via fast-check and assert
//   `isExperienceShareEntryEnabled` agrees with an independent oracle that
//   is enabled exactly when none of the three flags is set. Because the input
//   space is only 2^3 = 8 tuples, the property both covers the full space and
//   exercises the biconditional (enabled ⟺ no flag loading) on each draw.

import fc from 'fast-check';

import {
  isExperienceShareEntryEnabled,
  type ShareEntryLoadState,
} from '../shareEntryPoint';

const NUM_RUNS = 100;

const loadStateArb: fc.Arbitrary<ShareEntryLoadState> = fc.record({
  detailLoading: fc.boolean(),
  ratingLoading: fc.boolean(),
  noteLoading: fc.boolean(),
});

describe('isExperienceShareEntryEnabled — Property 11: share entry enablement', () => {
  it('is enabled if and only if none of the three flags are loading', () => {
    fc.assert(
      fc.property(loadStateArb, (flags) => {
        const expectedEnabled =
          !flags.detailLoading && !flags.ratingLoading && !flags.noteLoading;

        expect(isExperienceShareEntryEnabled(flags)).toBe(expectedEnabled);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
