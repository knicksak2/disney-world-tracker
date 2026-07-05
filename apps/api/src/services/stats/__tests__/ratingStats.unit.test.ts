// Feature: expanded-stats, Task 4.5: unit tests for rating threshold boundary cases.
/**
 * Example-based unit tests for the pure Personal Rating Statistics roll-up
 * `rollUpRatings` in `services/stats/ratingStats.ts`.
 *
 * These complement the property tests (Properties 8, 9, 10) by pinning down the
 * concrete threshold boundary the design calls out:
 *
 *   - Exactly at the Minimum_Ratings_Threshold (count === 3): `sufficient` is
 *     `true` and every gated field (average, averageByPark, averageByCategory,
 *     distribution, highest, lowest) is present (R4.4 boundary).
 *   - One below the threshold (count === 2): `sufficient` is `false`, every
 *     gated field is omitted, and `ratedCompletionsCount` is still reported
 *     (R4.4, R5.3, R6.4).
 *   - Zero ratings: `sufficient` is `false` and `ratedCompletionsCount` is 0
 *     (R4.6, R5.3).
 *
 * `ratedCompletionsCount` equals the number of active rating rows in this pure
 * module (the active filter is applied upstream by the repository).
 *
 * Validates: Requirements 4.4, 4.6, 5.3, 6.4.
 */

import { describe, it, expect } from 'vitest';

import {
  rollUpRatings,
  MINIMUM_RATINGS_THRESHOLD,
  type RawUserRatingRow,
} from '../ratingStats.js';

/** Build a rating row with sensible defaults for the fields under test. */
function row(overrides: Partial<RawUserRatingRow> = {}): RawUserRatingRow {
  return {
    experienceId: 'exp-1',
    experienceName: 'Space Mountain',
    value: 8,
    park: 'Magic Kingdom',
    category: 'Ride',
    ...overrides,
  };
}

describe('rollUpRatings — threshold boundary cases (task 4.5)', () => {
  it('uses a Minimum_Ratings_Threshold of 3', () => {
    // Pins the boundary the rest of the suite exercises.
    expect(MINIMUM_RATINGS_THRESHOLD).toBe(3);
  });

  describe('exactly at threshold (count === 3)', () => {
    const rows: readonly RawUserRatingRow[] = [
      row({ experienceId: 'a', experienceName: 'Alpha', value: 4, park: 'EPCOT', category: 'Ride' }),
      row({ experienceId: 'b', experienceName: 'Bravo', value: 7, park: 'EPCOT', category: 'Show' }),
      row({ experienceId: 'c', experienceName: 'Charlie', value: 10, park: 'Magic Kingdom', category: 'Ride' }),
    ];

    it('reports sufficient data with all gated fields present', () => {
      const result = rollUpRatings(rows);

      expect(result.sufficient).toBe(true);
      expect(result.ratedCompletionsCount).toBe(3);

      // Every gated field is present at the boundary (R4.4).
      expect(result.average).toBeDefined();
      expect(result.averageByPark).toBeDefined();
      expect(result.averageByCategory).toBeDefined();
      expect(result.distribution).toBeDefined();
      expect(result.highest).toBeDefined();
      expect(result.lowest).toBeDefined();
    });

    it('computes correct gated values at the boundary', () => {
      const result = rollUpRatings(rows);

      // Overall average: (4 + 7 + 10) / 3 = 7.0.
      expect(result.average).toBe(7);

      // Per-Park: EPCOT has (4 + 7) / 2 = 5.5, Magic Kingdom has 10.0.
      expect(result.averageByPark).toEqual({
        EPCOT: 5.5,
        'Magic Kingdom': 10,
      });

      // Per-Category: Ride has (4 + 10) / 2 = 7.0, Show has 7.0.
      expect(result.averageByCategory).toEqual({ Ride: 7, Show: 7 });

      // Distribution: one count per 1..10, sums to 3.
      const dist = result.distribution!;
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(total).toBe(3);
      expect(dist[4]).toBe(1);
      expect(dist[7]).toBe(1);
      expect(dist[10]).toBe(1);

      // Highest is value 10 (Charlie); lowest is value 4 (Alpha).
      expect(result.highest).toEqual({ experienceId: 'c', name: 'Charlie', value: 10 });
      expect(result.lowest).toEqual({ experienceId: 'a', name: 'Alpha', value: 4 });
    });
  });

  describe('one below threshold (count === 2)', () => {
    const rows: readonly RawUserRatingRow[] = [
      row({ experienceId: 'a', experienceName: 'Alpha', value: 5 }),
      row({ experienceId: 'b', experienceName: 'Bravo', value: 9 }),
    ];

    it('flags insufficient data and omits every gated field', () => {
      const result = rollUpRatings(rows);

      expect(result.sufficient).toBe(false);

      // Gated fields omitted below the threshold (R4.4, R6.4).
      expect(result.average).toBeUndefined();
      expect(result.averageByPark).toBeUndefined();
      expect(result.averageByCategory).toBeUndefined();
      expect(result.distribution).toBeUndefined();
      expect(result.highest).toBeUndefined();
      expect(result.lowest).toBeUndefined();
    });

    it('still reports the rated-completions count (R5.3)', () => {
      const result = rollUpRatings(rows);
      expect(result.ratedCompletionsCount).toBe(2);
    });
  });

  describe('zero ratings', () => {
    it('flags insufficient data with a rated-completions count of 0', () => {
      const result = rollUpRatings([]);

      expect(result.sufficient).toBe(false);
      expect(result.ratedCompletionsCount).toBe(0);

      // All gated fields omitted (R4.6, R6.4).
      expect(result.average).toBeUndefined();
      expect(result.averageByPark).toBeUndefined();
      expect(result.averageByCategory).toBeUndefined();
      expect(result.distribution).toBeUndefined();
      expect(result.highest).toBeUndefined();
      expect(result.lowest).toBeUndefined();
    });
  });

  describe('zero ratings with a non-zero rated-completions expectation', () => {
    // The pure module derives ratedCompletionsCount from the active rating
    // rows it is given. With no rows, the count is 0 and data is insufficient,
    // confirming the count tracks the row set rather than any external tally.
    it('reports 0 when there are no active rating rows', () => {
      const result = rollUpRatings([]);
      expect(result.ratedCompletionsCount).toBe(0);
      expect(result.sufficient).toBe(false);
    });
  });
});
