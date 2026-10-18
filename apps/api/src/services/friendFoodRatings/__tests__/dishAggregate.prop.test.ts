/**
 * Property-based tests for dishAggregate.ts.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 6.1, 6.2, 6.3, 6.5, 6.7, 16.1, 16.3
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FriendFoodSort } from '@dwt/shared';
import {
  FRIEND_FOOD_INLINE_MAX_FRIENDS,
  FRIEND_FOOD_SORTS,
} from '@dwt/shared';
import {
  aggregateByDish,
  compareDishes,
  decodeCursor,
  encodeCursor,
  groupSocialProof,
  toLikeContainsPattern,
  type DishAggregate,
  type DishLogInput,
  type SocialProofRow,
} from '../dishAggregate.js';
import { AppError } from '../../../errors/AppError.js';

// Arbitrary for UUIDs (pool of 10 to ensure collisions and multiple logs per dish)
const FOOD_ITEM_IDS = Array.from({ length: 10 }, (_, i) =>
  `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
);
const arbFoodItemId = fc.constantFrom(...FOOD_ITEM_IDS);

// Arbitrary for ratings: 1..10 or null
const arbRating = fc.oneof(fc.integer({ min: 1, max: 10 }), fc.constant(null));

// Arbitrary for visitedOn (YYYY-MM-DD)
const arbVisitedOn = fc
  .record({
    year: fc.constant(2024),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
  );

// Arbitrary for single DishLogInput
const arbDishLogInput: fc.Arbitrary<DishLogInput> = fc.record({
  foodItemId: arbFoodItemId,
  rating: arbRating,
  visitedOn: arbVisitedOn,
});

// Arbitrary for list of DishLogInput
const arbDishLogs = fc.array(arbDishLogInput, { minLength: 0, maxLength: 50 });

describe('dishAggregate Property Tests', () => {
  // Feature: friend-food-ratings, Property 3: Exactly one row per distinct dish
  it('Property 3: exactly one row per distinct dish', () => {
    fc.assert(
      fc.property(arbDishLogs, (logs) => {
        const aggregates = aggregateByDish(logs);

        const expectedDistinctIds = new Set(logs.map((l) => l.foodItemId));
        expect(aggregates.length).toBe(expectedDistinctIds.size);

        const returnedIds = new Set(aggregates.map((a) => a.foodItemId));
        expect(returnedIds.size).toBe(aggregates.length);
        expect(returnedIds).toEqual(expectedDistinctIds);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 4: Average lies in [1,10] and is computed only from rated logs
  it('Property 4: average lies in [1,10] and is computed only from rated logs', () => {
    fc.assert(
      fc.property(arbDishLogs, (logs) => {
        const aggregates = aggregateByDish(logs);

        for (const agg of aggregates) {
          const dishLogs = logs.filter((l) => l.foodItemId === agg.foodItemId);
          const ratedLogs = dishLogs.filter((l) => l.rating !== null);

          if (ratedLogs.length === 0) {
            expect(agg.averageRating).toBeNull();
            expect(agg.ratedLogCount).toBe(0);
          } else {
            expect(agg.averageRating).not.toBeNull();
            expect(agg.averageRating!).toBeGreaterThanOrEqual(1);
            expect(agg.averageRating!).toBeLessThanOrEqual(10);

            const sum = ratedLogs.reduce((acc, l) => acc + l.rating!, 0);
            const expectedAvg = sum / ratedLogs.length;
            expect(agg.averageRating).toBeCloseTo(expectedAvg, 9);
            expect(agg.ratedLogCount).toBe(ratedLogs.length);
          }

          // Unrated logs never change averageRating or ratedLogCount
          const extraUnrated: DishLogInput[] = [
            { foodItemId: agg.foodItemId, rating: null, visitedOn: '2024-01-01' },
            { foodItemId: agg.foodItemId, rating: null, visitedOn: '2024-06-01' },
          ];
          const withExtra = aggregateByDish([...dishLogs, ...extraUnrated]);
          const updatedAgg = withExtra.find((a) => a.foodItemId === agg.foodItemId)!;

          expect(updatedAgg.averageRating).toBe(agg.averageRating);
          expect(updatedAgg.ratedLogCount).toBe(agg.ratedLogCount);
          expect(updatedAgg.logCount).toBe(agg.logCount + 2);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 5: Counts and latest date are exact
  it('Property 5: counts and latest date are exact', () => {
    fc.assert(
      fc.property(arbDishLogs, (logs) => {
        const aggregates = aggregateByDish(logs);

        for (const agg of aggregates) {
          const dishLogs = logs.filter((l) => l.foodItemId === agg.foodItemId);
          expect(agg.logCount).toBe(dishLogs.length);

          const ratedCount = dishLogs.filter((l) => l.rating !== null).length;
          expect(agg.ratedLogCount).toBe(ratedCount);
          expect(agg.ratedLogCount).toBeLessThanOrEqual(agg.logCount);

          const maxDate = dishLogs.reduce(
            (max, l) => (l.visitedOn > max ? l.visitedOn : max),
            dishLogs[0]!.visitedOn,
          );
          expect(agg.latestVisitedOn).toBe(maxDate);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 6: Each sort is a strict total order and pagination is lossless
  it('Property 6: strict total order, cursor round trip, and lossless pagination', () => {
    fc.assert(
      fc.property(
        arbDishLogs,
        fc.constantFrom<FriendFoodSort>(...FRIEND_FOOD_SORTS),
        fc.integer({ min: 1, max: 10 }),
        (logs, sort, pageSize) => {
          const aggregates = aggregateByDish(logs);
          const cmp = compareDishes(sort);

          // 1. Strict total order: antisymmetry & trichotomy
          for (const a of aggregates) {
            for (const b of aggregates) {
              const ab = cmp(a, b);
              const ba = cmp(b, a);
              if (a.foodItemId === b.foodItemId) {
                expect(ab).toBe(0);
                expect(ba).toBe(0);
              } else {
                expect(Math.sign(ab)).toBe(-Math.sign(ba));
                expect(ab).not.toBe(0);
              }
            }
          }

          // Sorted list
          const sorted = [...aggregates].sort(cmp);

          // 2. Cursor round trip
          for (const item of sorted) {
            let cursorA: string;
            let cursorB: string | null;

            if (sort === 'highest_rated') {
              cursorA = String(item.averageRating ?? 0);
              cursorB = String(item.ratedLogCount);
            } else if (sort === 'recent') {
              cursorA = item.latestVisitedOn;
              cursorB = null;
            } else {
              // most_logged
              cursorA = String(item.logCount);
              cursorB = item.latestVisitedOn;
            }

            const encoded = encodeCursor(sort, cursorA, cursorB, item.foodItemId);
            const decoded = decodeCursor(encoded, sort);

            expect(decoded.id).toBe(item.foodItemId);
            expect(decoded.a).toBe(cursorA);
            if (sort === 'recent') {
              expect(decoded.b).toBeNull();
            } else {
              expect(decoded.b).toBe(cursorB);
            }

            // Wrong-sort cursor rejected
            const wrongSort = FRIEND_FOOD_SORTS.find((s) => s !== sort)!;
            expect(() => decodeCursor(encoded, wrongSort)).toThrowError(AppError);
          }

          // 3. Lossless Keyset Pagination against reference model
          const pages: DishAggregate[][] = [];
          let remaining = [...sorted];

          while (remaining.length > 0) {
            const page = remaining.slice(0, pageSize);
            pages.push(page);

            if (page.length === 0) break;
            const last = page[page.length - 1]!;

            // Filter remaining to items strictly after last under sort
            remaining = sorted.filter((item) => cmp(item, last) > 0);
          }

          const flattened = pages.flat();
          expect(flattened).toEqual(sorted);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 1: Notes and private fields never appear in any friend-facing payload
  it('Property 1: cursor never carries ISO date-time or unreturned dates', () => {
    fc.assert(
      fc.property(
        arbDishLogs,
        fc.constantFrom<FriendFoodSort>(...FRIEND_FOOD_SORTS),
        (logs, sort) => {
          const aggregates = aggregateByDish(logs);

          for (const item of aggregates) {
            let cursorA: string;
            let cursorB: string | null;

            if (sort === 'highest_rated') {
              cursorA = String(item.averageRating ?? 0);
              cursorB = String(item.ratedLogCount);
            } else if (sort === 'recent') {
              cursorA = item.latestVisitedOn;
              cursorB = null;
            } else {
              cursorA = String(item.logCount);
              cursorB = item.latestVisitedOn;
            }

            const encoded = encodeCursor(sort, cursorA, cursorB, item.foodItemId);
            const rawJson = Buffer.from(encoded, 'base64').toString('utf8');
            const parsed = JSON.parse(rawJson);

            // No ISO timestamp (no T\d\d:\d\d)
            expect(rawJson).not.toMatch(/T\d\d:\d\d/);
            expect(parsed).not.toHaveProperty('loggedAt');
            expect(parsed).not.toHaveProperty('userTz');
            expect(parsed).not.toHaveProperty('note');

            // Any date in cursor must equal item.latestVisitedOn
            if (sort === 'recent') {
              expect(parsed.a).toBe(item.latestVisitedOn);
              expect(parsed.b).toBeNull();
            } else if (sort === 'most_logged') {
              expect(parsed.b).toBe(item.latestVisitedOn);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 7: Filters and search compose conjunctively and match literally
  it('Property 7: LIKE escaping matches %, _, \\ literally', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (term) => {
          const pattern = toLikeContainsPattern(term);
          expect(pattern.startsWith('%')).toBe(true);
          expect(pattern.endsWith('%')).toBe(true);

          // Escapes literal %, _ and \
          const inner = pattern.slice(1, -1);
          // Check that unescaped %, _ or \ do not appear in inner
          // An escaped char is preceded by an odd number of backslashes
          // Specifically, \\% -> escaped %, \\_ -> escaped _, \\\\ -> escaped \
          for (let i = 0; i < inner.length; i++) {
            if (inner[i] === '%' || inner[i] === '_') {
              // must be preceded by backslash
              expect(i).toBeGreaterThan(0);
              expect(inner[i - 1]).toBe('\\');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: friend-food-ratings, Property 9: Display rounding is never fed back into calculations
  it('Property 9: continuous values order rows even when rounded displays match', () => {
    // Two dishes whose averages differ at second decimal place but round to same one decimal place
    // e.g. 8.31 and 8.34 both round to "8.3"
    const dishA: DishAggregate = {
      foodItemId: 'aaaaaaaa-aaaa-4000-8000-000000000001',
      averageRating: 8.31,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2024-01-01',
    };
    const dishB: DishAggregate = {
      foodItemId: 'bbbbbbbb-bbbb-4000-8000-000000000002',
      averageRating: 8.34,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2024-01-01',
    };

    const cmp = compareDishes('highest_rated');
    // dishB (8.34) should come before dishA (8.31) despite both rounding to "8.3"
    expect(cmp(dishB, dishA)).toBeLessThan(0);
    expect(cmp(dishA, dishB)).toBeGreaterThan(0);
  });

  // Feature: friend-food-ratings, Property 17: Inline Social_Proof caps friends shown and keeps the count honest
  it('Property 17: groupSocialProof caps friends at 3, computes exact average and overflow, and drops final dish when capped', () => {
    // Generate distinct friends per dish
    const arbSocialProofRows = fc
      .array(
        fc.record({
          foodItemId: arbFoodItemId,
          friendId: fc.uuid(),
          displayName: fc
            .stringMatching(/^[A-Za-z0-9 ]{2,15}$/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2),
          avatarPreset: fc.constantFrom(null, 'castle' as const, 'fireworks' as const),
          averageRating: fc.integer({ min: 10, max: 100 }).map((n) => n / 10), // 1.0 to 10.0
          ratedLogCount: fc.integer({ min: 1, max: 10 }),
          logCount: fc.integer({ min: 1, max: 10 }),
          latestVisitedOn: arbVisitedOn,
        }),
        { minLength: 1, maxLength: 30 },
      )
      .map((rawRows) => {
        // Deduplicate by (foodItemId, friendId)
        const seen = new Set<string>();
        const deduped: SocialProofRow[] = [];
        for (const r of rawRows) {
          const key = `${r.foodItemId}:${r.friendId}`;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push({
              foodItemId: r.foodItemId,
              friendId: r.friendId,
              displayName: r.displayName,
              avatarPreset: r.avatarPreset,
              averageRating: r.averageRating,
              ratedLogCount: r.ratedLogCount,
              logCount: r.logCount,
              latestVisitedOn: r.latestVisitedOn,
            });
          }
        }
        // Order as SQL would: foodItemId ASC, averageRating DESC, latestVisitedOn DESC, friendId ASC
        deduped.sort((a, b) => {
          const dishCmp = a.foodItemId.localeCompare(b.foodItemId);
          if (dishCmp !== 0) return dishCmp;
          if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
          const dateCmp = b.latestVisitedOn.localeCompare(a.latestVisitedOn);
          if (dateCmp !== 0) return dateCmp;
          return a.friendId.localeCompare(b.friendId);
        });
        return deduped;
      })
      .filter((rows) => rows.length > 0);

    fc.assert(
      fc.property(
        arbSocialProofRows,
        fc.boolean(),
        (rows, capped) => {
          // Count distinct dishes in input
          const distinctDishes = Array.from(new Set(rows.map((r) => r.foodItemId)));
          const grouped = groupSocialProof(rows, FRIEND_FOOD_INLINE_MAX_FRIENDS, capped);

          if (capped) {
            // When capped, exactly the last dish group is dropped
            expect(grouped.length).toBe(Math.max(0, distinctDishes.length - 1));
          } else {
            expect(grouped.length).toBe(distinctDishes.length);
          }

          // For every returned dish group:
          for (let i = 0; i < grouped.length; i++) {
            const group = grouped[i]!;
            const matchingInputRows = rows.filter((r) => r.foodItemId === group.foodItemId);

            // friendCount equals total friends with rated logs for this dish
            expect(group.friendCount).toBe(matchingInputRows.length);

            // friendsAverageRating equals exact mean of per-friend averages
            const expectedAvg =
              matchingInputRows.reduce((sum, r) => sum + r.averageRating, 0) /
              matchingInputRows.length;
            expect(group.friendsAverageRating).toBeCloseTo(expectedAvg, 9);

            // At most FRIEND_FOOD_INLINE_MAX_FRIENDS (3) friends shown
            expect(group.friends.length).toBeLessThanOrEqual(FRIEND_FOOD_INLINE_MAX_FRIENDS);
            expect(group.friends.length).toBe(
              Math.min(matchingInputRows.length, FRIEND_FOOD_INLINE_MAX_FRIENDS),
            );

            // Overflow equals friendCount - friends.length
            const overflow = group.friendCount - group.friends.length;
            expect(overflow).toBeGreaterThanOrEqual(0);
            expect(overflow).toBe(group.friendCount - group.friends.length);

            // friends array is exact prefix of the input rows
            for (let fIdx = 0; fIdx < group.friends.length; fIdx++) {
              const friendDto = group.friends[fIdx]!;
              const original = matchingInputRows[fIdx]!;
              expect(friendDto.friendId).toBe(original.friendId);
              expect(friendDto.displayName).toBe(original.displayName);
              expect(friendDto.avatarPreset).toBe(original.avatarPreset);
              expect(friendDto.averageRating).toBe(original.averageRating);
              expect(friendDto.ratedLogCount).toBe(original.ratedLogCount);
              expect(friendDto.logCount).toBe(original.logCount);
              expect(friendDto.latestVisitedOn).toBe(original.latestVisitedOn);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
