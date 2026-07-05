/**
 * Component tests for the ratings section building blocks
 * (stats-experience-redesign spec, Task 6.4).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 *
 * `RatingsSection` gates internally on `ratings.sufficient` and is shared by
 * `RatingsDetailScreen` (Own_Surface) and `FriendProfileScreen`
 * (Friend_Surface). These React Native Testing Library tests pin the two
 * branches:
 *
 *   - **Sufficient (R8.1).** The rich view renders the `RatingDial` (average
 *     out of 10), the `RatingHistogram` of the 1–10 distribution, the
 *     highest/lowest hero cards, and the per-park / per-category averages —
 *     each as a single accessible element carrying its spoken label (R15.1).
 *     `ratedCompletionsCount` is read in this state (R8.4).
 *   - **Insufficient (R8.2, R8.3, R8.4).** The unlock/neutral empty state is
 *     shown (self-directed CTA by default, neutral copy for the Friend
 *     surface), the rich visuals are absent, `ratedCompletionsCount` is read
 *     and rendered as progress toward the threshold, and the gated fields
 *     (`average`, `distribution`, `highest`, `lowest`, `averageByPark`,
 *     `averageByCategory`) are NEVER read.
 *
 * The gated-field discipline (R8.3) is asserted directly with a spy
 * `RatingStatistics` whose gated properties record any access: after rendering
 * the insufficient branch, none of them may have been touched.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { MINIMUM_RATINGS_THRESHOLD } from '../../../../api/statsTypes';
import type { RatingStatistics } from '../../../../api/statsTypes';
import {
  makeInsufficientRatings,
  makeSufficientRatings,
} from '../../__testSupport__/statsFixture';
import { RatingsSection } from '../RatingsSection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The six fields the section must NOT read while `!sufficient` (R8.3). */
const GATED_FIELDS = [
  'average',
  'distribution',
  'highest',
  'lowest',
  'averageByPark',
  'averageByCategory',
] as const;

/**
 * Build an insufficient `RatingStatistics` whose gated fields each record any
 * access. Reading `ratedCompletionsCount` is allowed (R8.4). Returns the object
 * plus the array of gated fields that were read during a render.
 */
function makeGatedSpyRatings(ratedCompletionsCount: number): {
  ratings: RatingStatistics;
  reads: string[];
} {
  const reads: string[] = [];
  const base: Record<string, unknown> = {
    sufficient: false,
    ratedCompletionsCount,
  };
  for (const field of GATED_FIELDS) {
    Object.defineProperty(base, field, {
      enumerable: false,
      configurable: true,
      get() {
        reads.push(field);
        return undefined;
      },
    });
  }
  return { ratings: base as unknown as RatingStatistics, reads };
}

// ---------------------------------------------------------------------------
// Sufficient (rich) view — R8.1, R8.4
// ---------------------------------------------------------------------------

describe('RatingsSection — sufficient (Requirements 8.1, 8.4)', () => {
  it('renders the dial, histogram, high/low, and per-park/category averages', () => {
    const ratings = makeSufficientRatings();
    render(<RatingsSection ratings={ratings} testID="ratings" />);

    // Average dial (out of 10) — one accessible element (R8.1, R15.1).
    expect(
      screen.getByLabelText(
        `Average rating ${ratings.average!.toFixed(1)} out of 10`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Average rating')).toBeTruthy();

    // 1–10 distribution histogram. The default distribution sums to
    // ratedCompletionsCount, so the spoken label names that total.
    expect(
      screen.getByLabelText(
        `Distribution of your ${ratings.ratedCompletionsCount} ratings across values 1 through 10`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Rating distribution')).toBeTruthy();

    // Highest / lowest hero cards (R8.1).
    expect(
      screen.getByLabelText(
        `Highest rated: ${ratings.highest!.name}, rated ${ratings.highest!.value} out of 10`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Lowest rated: ${ratings.lowest!.name}, rated ${ratings.lowest!.value} out of 10`,
      ),
    ).toBeTruthy();

    // Per-park and per-category averages (R8.1).
    expect(screen.getByText('By park')).toBeTruthy();
    expect(screen.getByText('By category')).toBeTruthy();
    expect(
      screen.getByLabelText('Magic Kingdom: average 7.2 out of 10'),
    ).toBeTruthy();
    expect(screen.getByLabelText('EPCOT: average 6.5 out of 10')).toBeTruthy();
  });

  it('reads and displays ratedCompletionsCount in the rich state (R8.4)', () => {
    const ratings = makeSufficientRatings({ ratedCompletionsCount: 12 });
    render(<RatingsSection ratings={ratings} />);

    expect(screen.getByText('12 rated experiences')).toBeTruthy();
  });

  it('does not render the unlock empty state when sufficient', () => {
    render(<RatingsSection ratings={makeSufficientRatings()} />);

    expect(screen.queryByText('Unlock your ratings')).toBeNull();
    expect(screen.queryByText('Not enough ratings yet')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Insufficient (unlock / neutral) view — R8.2, R8.3, R8.4
// ---------------------------------------------------------------------------

describe('RatingsSection — insufficient (Requirements 8.2, 8.3, 8.4)', () => {
  it('renders the self-directed unlock copy with N of threshold progress', () => {
    render(<RatingsSection ratings={makeInsufficientRatings(2)} />);

    // Unlock title + remaining-to-threshold CTA (R8.2). 2 of 3 → 1 more.
    expect(screen.getByText('Unlock your ratings')).toBeTruthy();
    expect(
      screen.getByText(
        `Rate 1 more experience to unlock your ratings (2/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();
  });

  it('pluralizes the remaining count in the unlock copy', () => {
    render(<RatingsSection ratings={makeInsufficientRatings(0)} />);

    // 0 of 3 → 3 more experiences.
    expect(
      screen.getByText(
        `Rate 3 more experiences to unlock your ratings (0/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();
  });

  it('renders the neutral friend-safe copy for the neutral variant (R11.3)', () => {
    render(
      <RatingsSection
        ratings={makeInsufficientRatings(1)}
        emptyVariant="neutral"
      />,
    );

    expect(screen.getByText('Not enough ratings yet')).toBeTruthy();
    expect(screen.queryByText('Unlock your ratings')).toBeNull();
    // ratedCompletionsCount is still surfaced as progress (R8.4).
    expect(
      screen.getByText(
        `Ratings appear once ${MINIMUM_RATINGS_THRESHOLD} experiences are rated (1/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();
  });

  it('does not render any rich visual while insufficient (R8.1 gate)', () => {
    render(<RatingsSection ratings={makeInsufficientRatings(2)} />);

    expect(screen.queryByText('Average rating')).toBeNull();
    expect(screen.queryByText('Rating distribution')).toBeNull();
    expect(screen.queryByText('By park')).toBeNull();
    expect(screen.queryByText('By category')).toBeNull();
  });

  it('never reads a gated field while insufficient (R8.3)', () => {
    const { ratings, reads } = makeGatedSpyRatings(2);
    render(<RatingsSection ratings={ratings} />);

    // The unlock branch reads ONLY ratedCompletionsCount; the gated fields
    // stay untouched.
    expect(reads).toEqual([]);
    // And it still rendered the unlock progress from ratedCompletionsCount.
    expect(
      screen.getByText(
        `Rate 1 more experience to unlock your ratings (2/${MINIMUM_RATINGS_THRESHOLD}).`,
      ),
    ).toBeTruthy();
  });
});
