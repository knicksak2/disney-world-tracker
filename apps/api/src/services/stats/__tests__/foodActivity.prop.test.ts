// Feature: stats-experience-redesign, Property 19: Food activity volume and repeat multiplier bounds (Amendment: Food Stats)
// Feature: stats-experience-redesign, Property 20: Most-logged-dishes podium ordering & determinism (Amendment: Food Stats)
// Feature: stats-experience-redesign, Property 21: Highest-rated-dishes minimum-count gate & ordering (Amendment: Food Stats)
// Feature: stats-experience-redesign, Property 22: Food personal records derivation & tie-breaking (Amendment: Food Stats)

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FOOD_STATS_MIN_RATED_LOGS } from '@dwt/shared';

import {
  rollUpFoodActivity,
  type RawFoodActivityMaterial,
  type RawMostLoggedFoodItemRow,
  type RawHighestRatedFoodItemRow,
  type RawMostAdventurousDayRow,
  type RawDishMarathonRecordRow,
} from '../foodActivity.js';

const NUM_RUNS = 100;

describe('rollUpFoodActivity Property Tests', () => {
  it('Property 19: Food activity volume and repeat multiplier bounds (Amendment: Food Stats)', () => {
    // Validates: Requirements 24.2, 24.3, 24.4, 24.5, 24.6
    fc.assert(
      fc.property(
        fc.record({
          totalDishesLogged: fc.integer({ min: 0, max: 10_000 }),
          distinctRestaurantsVisited: fc.integer({ min: 0, max: 500 }),
          uniqueLoggedFoodItems: fc.integer({ min: 0, max: 500 }),
        }),
        (volume) => {
          const raw: RawFoodActivityMaterial = {
            volume,
            mostLogged: [],
            highestRated: [],
            mostAdventurousDay: null,
            dishMarathonRecord: null,
          };

          const stats = rollUpFoodActivity(raw);

          // Invariant: repeatMultiplier is always >= 1.0
          expect(stats.repeatMultiplier).toBeGreaterThanOrEqual(1.0);

          if (volume.totalDishesLogged === 0) {
            expect(stats.totalDishesLogged).toBe(0);
            expect(stats.distinctRestaurantsVisited).toBe(0);
            expect(stats.repeatMultiplier).toBe(1.0);
            expect(stats.mostLogged).toEqual([]);
            expect(stats.highestRated).toEqual([]);
            expect(stats.personalRecords).toEqual({});
          } else {
            expect(stats.totalDishesLogged).toBe(volume.totalDishesLogged);
            expect(stats.distinctRestaurantsVisited).toBe(
              volume.distinctRestaurantsVisited,
            );

            if (volume.uniqueLoggedFoodItems === 0) {
              expect(stats.repeatMultiplier).toBe(1.0);
            } else {
              const expectedMultiplier = Math.max(
                1.0,
                Number(
                  (
                    volume.totalDishesLogged / volume.uniqueLoggedFoodItems
                  ).toFixed(1),
                ),
              );
              expect(stats.repeatMultiplier).toBe(expectedMultiplier);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 20: Most-logged-dishes podium ordering & determinism (Amendment: Food Stats)', () => {
    // Validates: Requirements 25.1, 25.2, 25.3
    const mostLoggedRowArb: fc.Arbitrary<RawMostLoggedFoodItemRow> = fc.record({
      foodItemId: fc.uuid(),
      foodItemName: fc.string({ minLength: 1, maxLength: 50 }),
      count: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(mostLoggedRowArb, { minLength: 0, maxLength: 10 }),
        (totalDishesLogged, mostLoggedRows) => {
          const raw: RawFoodActivityMaterial = {
            volume: {
              totalDishesLogged,
              distinctRestaurantsVisited: 3,
              uniqueLoggedFoodItems: 5,
            },
            mostLogged: mostLoggedRows,
            highestRated: [],
            mostAdventurousDay: null,
            dishMarathonRecord: null,
          };

          const stats = rollUpFoodActivity(raw);

          // Most logged array has at most 5 elements
          expect(stats.mostLogged.length).toBeLessThanOrEqual(5);
          expect(stats.mostLogged.length).toBe(
            Math.min(5, mostLoggedRows.length),
          );

          // Each item preserves position and fields from input slice [0..5]
          for (let i = 0; i < stats.mostLogged.length; i++) {
            expect(stats.mostLogged[i]).toEqual(mostLoggedRows[i]);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // Deterministic tie-break sorting simulation matching SQL: count DESC, lower(name) ASC, id ASC
    fc.assert(
      fc.property(
        fc.array(mostLoggedRowArb, { minLength: 2, maxLength: 20 }),
        (items) => {
          const sorted = [...items].sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            const nameCmp = a.foodItemName
              .toLowerCase()
              .localeCompare(b.foodItemName.toLowerCase());
            if (nameCmp !== 0) return nameCmp;
            return a.foodItemId.localeCompare(b.foodItemId);
          });

          // Top 5 slice fed to rollUpFoodActivity
          const raw: RawFoodActivityMaterial = {
            volume: {
              totalDishesLogged: 100,
              distinctRestaurantsVisited: 5,
              uniqueLoggedFoodItems: items.length,
            },
            mostLogged: sorted.slice(0, 5),
            highestRated: [],
            mostAdventurousDay: null,
            dishMarathonRecord: null,
          };

          const stats = rollUpFoodActivity(raw);
          for (let i = 1; i < stats.mostLogged.length; i++) {
            const prev = stats.mostLogged[i - 1];
            const curr = stats.mostLogged[i];
            if (prev && curr) {
              expect(prev.count).toBeGreaterThanOrEqual(curr.count);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 21: Highest-rated-dishes minimum-count gate & ordering (Amendment: Food Stats)', () => {
    // Validates: Requirements 26.1, 26.2, 26.3, 26.4, 26.5
    // Generates raw logs and simulates the SQL query filter HAVING count >= FOOD_STATS_MIN_RATED_LOGS (2)
    const ratedLogArb = fc.record({
      foodItemId: fc.uuid(),
      foodItemName: fc.string({ minLength: 1, maxLength: 30 }),
      rating: fc.integer({ min: 1, max: 10 }),
    });

    fc.assert(
      fc.property(
        fc.array(ratedLogArb, { minLength: 1, maxLength: 30 }),
        (logs) => {
          // Group by foodItemId
          const grouped = new Map<
            string,
            { name: string; ratings: number[] }
          >();
          for (const log of logs) {
            const existing = grouped.get(log.foodItemId);
            if (existing) {
              existing.ratings.push(log.rating);
            } else {
              grouped.set(log.foodItemId, {
                name: log.foodItemName,
                ratings: [log.rating],
              });
            }
          }

          // Simulate SQL HAVING COUNT(*) >= FOOD_STATS_MIN_RATED_LOGS
          const qualifyingRows: RawHighestRatedFoodItemRow[] = [];
          const excludedRows: { foodItemId: string; ratedCount: number }[] = [];

          for (const [id, data] of grouped.entries()) {
            const ratedLogCount = data.ratings.length;
            if (ratedLogCount >= FOOD_STATS_MIN_RATED_LOGS) {
              const avg =
                data.ratings.reduce((a, b) => a + b, 0) / ratedLogCount;
              qualifyingRows.push({
                foodItemId: id,
                foodItemName: data.name,
                averageRating: Number(avg.toFixed(1)),
                ratedLogCount,
              });
            } else {
              excludedRows.push({ foodItemId: id, ratedCount: ratedLogCount });
            }
          }

          // Sort qualifying rows matching SQL: averageRating DESC, ratedLogCount DESC, lower(name) ASC, id ASC
          qualifyingRows.sort((a, b) => {
            if (b.averageRating !== a.averageRating) {
              return b.averageRating - a.averageRating;
            }
            if (b.ratedLogCount !== a.ratedLogCount) {
              return b.ratedLogCount - a.ratedLogCount;
            }
            const nameCmp = a.foodItemName
              .toLowerCase()
              .localeCompare(b.foodItemName.toLowerCase());
            if (nameCmp !== 0) return nameCmp;
            return a.foodItemId.localeCompare(b.foodItemId);
          });

          const raw: RawFoodActivityMaterial = {
            volume: {
              totalDishesLogged: logs.length,
              distinctRestaurantsVisited: 3,
              uniqueLoggedFoodItems: grouped.size,
            },
            mostLogged: [],
            highestRated: qualifyingRows.slice(0, 5),
            mostAdventurousDay: null,
            dishMarathonRecord: null,
          };

          const stats = rollUpFoodActivity(raw);

          // Invariant: Length <= 5
          expect(stats.highestRated.length).toBeLessThanOrEqual(5);

          // Invariant: Every item in stats.highestRated has ratedLogCount >= FOOD_STATS_MIN_RATED_LOGS
          for (const item of stats.highestRated) {
            expect(item.ratedLogCount).toBeGreaterThanOrEqual(
              FOOD_STATS_MIN_RATED_LOGS,
            );
          }

          // Invariant: No excluded food item appears in highestRated
          for (const excluded of excludedRows) {
            expect(
              stats.highestRated.some((h) => h.foodItemId === excluded.foodItemId),
            ).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // Boundary check: exactly FOOD_STATS_MIN_RATED_LOGS - 1 (1 log) is excluded,
    // and exactly FOOD_STATS_MIN_RATED_LOGS (2 logs) is included
    const subThresholdItem: RawHighestRatedFoodItemRow = {
      foodItemId: 'sub-threshold-id',
      foodItemName: 'Sub Threshold Dish',
      averageRating: 10.0,
      ratedLogCount: FOOD_STATS_MIN_RATED_LOGS - 1,
    };
    const atThresholdItem: RawHighestRatedFoodItemRow = {
      foodItemId: 'at-threshold-id',
      foodItemName: 'At Threshold Dish',
      averageRating: 9.0,
      ratedLogCount: FOOD_STATS_MIN_RATED_LOGS,
    };

    // In SQL, subThresholdItem is filtered out by HAVING COUNT(*) >= 2.
    // Confirm that only the qualifying item is sent and received.
    const rawWithThreshold: RawFoodActivityMaterial = {
      volume: {
        totalDishesLogged: 10,
        distinctRestaurantsVisited: 2,
        uniqueLoggedFoodItems: 2,
      },
      mostLogged: [],
      highestRated: [atThresholdItem], // only the at-threshold item qualifies from SQL
      mostAdventurousDay: null,
      dishMarathonRecord: null,
    };

    const statsThreshold = rollUpFoodActivity(rawWithThreshold);
    expect(statsThreshold.highestRated).toHaveLength(1);
    const firstHighestRated = statsThreshold.highestRated[0];
    expect(firstHighestRated?.foodItemId).toBe('at-threshold-id');
    expect(firstHighestRated?.ratedLogCount).toBe(2);
    expect(
      statsThreshold.highestRated.find((h) => h.foodItemId === subThresholdItem.foodItemId),
    ).toBeUndefined();
  });

  it('Property 22: Food personal records derivation & tie-breaking (Amendment: Food Stats)', () => {
    // Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5
    const adventurousDayArb: fc.Arbitrary<RawMostAdventurousDayRow> = fc.record({
      date: fc.date().map((d) => d.toISOString().slice(0, 10)),
      dishCount: fc.integer({ min: 1, max: 50 }),
      restaurantNames: fc.array(fc.string({ minLength: 0, maxLength: 50 }), {
        minLength: 0,
        maxLength: 5,
      }),
    });

    const dishMarathonArb: fc.Arbitrary<RawDishMarathonRecordRow> = fc.record({
      foodItemId: fc.uuid(),
      foodItemName: fc.string({ minLength: 1, maxLength: 50 }),
      date: fc.date().map((d) => d.toISOString().slice(0, 10)),
      count: fc.integer({ min: 1, max: 20 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.option(adventurousDayArb, { nil: null }),
        fc.option(dishMarathonArb, { nil: null }),
        (totalDishesLogged, adventurousDay, dishMarathon) => {
          const raw: RawFoodActivityMaterial = {
            volume: {
              totalDishesLogged,
              distinctRestaurantsVisited: totalDishesLogged > 0 ? 3 : 0,
              uniqueLoggedFoodItems: totalDishesLogged > 0 ? 5 : 0,
            },
            mostLogged: [],
            highestRated: [],
            mostAdventurousDay: adventurousDay,
            dishMarathonRecord: dishMarathon,
          };

          const stats = rollUpFoodActivity(raw);

          if (totalDishesLogged === 0) {
            // Absent (not null) when totalDishesLogged === 0
            expect(stats.personalRecords).toEqual({});
            expect(stats.personalRecords.mostAdventurousDay).toBeUndefined();
            expect(stats.personalRecords.dishMarathonRecord).toBeUndefined();
          } else {
            if (adventurousDay) {
              expect(stats.personalRecords.mostAdventurousDay).toBeDefined();
              expect(stats.personalRecords.mostAdventurousDay?.date).toBe(
                adventurousDay.date,
              );
              expect(stats.personalRecords.mostAdventurousDay?.dishCount).toBe(
                adventurousDay.dishCount,
              );
              // Defensively filters out empty restaurant names
              expect(
                stats.personalRecords.mostAdventurousDay?.restaurantNames.every(
                  (name) => typeof name === 'string' && name.trim().length > 0,
                ),
              ).toBe(true);
            } else {
              expect(stats.personalRecords.mostAdventurousDay).toBeUndefined();
            }

            if (dishMarathon) {
              expect(stats.personalRecords.dishMarathonRecord).toEqual(
                dishMarathon,
              );
            } else {
              expect(stats.personalRecords.dishMarathonRecord).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
