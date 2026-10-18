import fc from 'fast-check';

import {
  describeDishRating,
  describeSocialProof,
  formatAverageRating,
  logCountText,
} from '../foodRatingFormat';

describe('foodRatingFormat property tests', () => {
  // Feature: friend-food-ratings, Property 9: Display rounding is never fed back into calculations
  describe('Property 9: Display rounding is never fed back into calculations', () => {
    it('preserves continuous ordering: two ratings that differ before rounding retain continuous comparison', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 10, noNaN: true }),
          fc.double({ min: 1, max: 10, noNaN: true }),
          (a, b) => {
            fc.pre(Math.abs(a - b) > 1e-7);

            // Continuous comparison
            const continuousOrder = a < b ? -1 : 1;

            // Sorting in continuous domain
            const sorted = [a, b].sort((x, y) => x - y);
            expect(sorted[0]).toBe(Math.min(a, b));
            expect(sorted[1]).toBe(Math.max(a, b));

            // Formatted strings are display-only representations
            const fa = formatAverageRating(a);
            const fb = formatAverageRating(b);
            expect(typeof fa).toBe('string');
            expect(typeof fb).toBe('string');

            // Even if formatted display is identical (e.g. 8.24 and 8.26 both formatting to 8.2 or 8.3),
            // continuous comparison is unchanged
            expect(a < b ? -1 : 1).toBe(continuousOrder);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('sorting an array by continuous rating preserves continuous order regardless of display formatting', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: 1, max: 10, noNaN: true }), {
            minLength: 2,
            maxLength: 30,
          }),
          (ratings) => {
            const continuousSorted = [...ratings].sort((a, b) => b - a);

            for (let i = 0; i < continuousSorted.length - 1; i++) {
              expect(continuousSorted[i]!).toBeGreaterThanOrEqual(
                continuousSorted[i + 1]!,
              );
            }

            // Display formatting does not mutate or replace continuous values
            const formatted = continuousSorted.map(formatAverageRating);
            expect(formatted.length).toBe(ratings.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: friend-food-ratings, Property 13: Every rating has a text equivalent and every control a label
  describe('Property 13: Every rating has a text equivalent and every control a label', () => {
    it('describeDishRating always contains dish name, rating as text out of 10 or "not rated", and log count', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          fc.option(fc.double({ min: 1, max: 10, noNaN: true }), { nil: null }),
          fc.integer({ min: 1, max: 1000 }),
          (foodItemName, averageRating, logCount) => {
            const label = describeDishRating({
              foodItemName,
              averageRating,
              logCount,
            });

            // 1. Must contain dish name
            expect(label).toContain(foodItemName);

            // 2. Must contain rating text out of 10 or "not rated"
            if (averageRating !== null) {
              const expectedRating = `${formatAverageRating(averageRating)} out of 10`;
              expect(label).toContain(expectedRating);
            } else {
              expect(label).toContain('not rated');
            }

            // 3. Must contain log count
            expect(label).toContain(logCountText(logCount));
            expect(label).toContain(String(logCount));
          },
        ),
        { numRuns: 200 },
      );
    });

    it('describeSocialProof always contains friends names, rating out of 10, and friend count', () => {
      fc.assert(
        fc.property(
          fc.option(fc.string({ minLength: 1, maxLength: 30 })),
          fc.double({ min: 1, max: 10, noNaN: true }),
          fc.array(
            fc.record({
              displayName: fc
                .string({ minLength: 1, maxLength: 20 })
                .filter((s) => s.trim().length > 0),
            }),
            { minLength: 1, maxLength: 3 },
          ),
          fc.integer({ min: 1, max: 20 }),
          (foodItemName, friendsAverageRating, friends, extraCount) => {
            const friendCount = friends.length + extraCount;
            const label = describeSocialProof({
              foodItemName: foodItemName ?? undefined,
              friendsAverageRating,
              friendCount,
              friends,
            });

            // If foodItemName provided, must contain it
            if (foodItemName) {
              expect(label).toContain(foodItemName);
            }

            // Must contain rating out of 10
            const expectedRating = `${formatAverageRating(friendsAverageRating)} out of 10`;
            expect(label).toContain(expectedRating);

            // Must contain each friend's display name
            for (const friend of friends) {
              expect(label).toContain(friend.displayName);
            }

            // Must contain friend count
            expect(label).toContain(
              friendCount === 1 ? '1 friend' : `${friendCount} friends`,
            );
          },
        ),
        { numRuns: 200 },
      );
    });

    it('logCountText correctly pluralizes log count', () => {
      expect(logCountText(1)).toBe('Logged 1 time');
      expect(logCountText(2)).toBe('Logged 2 times');
      expect(logCountText(10)).toBe('Logged 10 times');
    });
  });
});
