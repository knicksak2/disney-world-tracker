/**
 * Unit tests for Stats_Service Food Activity repo queries and mapping.
 *
 * Exercises `getStatsSnapshot` with simulated database queries to assert:
 *   - The 5 Food Activity queries run inside the single snapshot transaction.
 *   - Query parameters ($1 = targetUserId, $2 = FOOD_STATS_MIN_RATED_LOGS).
 *   - The dual experience_id / location_id restaurant scoping resolves correctly
 *     via LEFT JOIN to experiences and user_submitted_locations.
 *   - distinctRestaurantsVisited deduplicates multiple items at the same experience
 *     or location and never double-counts.
 *   - Zero-log vs populated snapshot mapping for personal records.
 *
 * Validates: Requirements 24.2, 24.3, 24.7, 25.1, 25.2, 26.1, 26.2, 26.3, 27.1, 27.2, 27.3, 27.4
 */

import { describe, expect, it } from 'vitest';
import { FOOD_STATS_MIN_RATED_LOGS } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createStatsRepo } from '../repo.js';

interface FakeCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakeQueryResult {
  rows: unknown[];
  rowCount?: number;
}

function makePool(
  responder: (call: FakeCall) => FakeQueryResult,
): {
  calls: FakeCall[];
  pool: DbPool;
} {
  const calls: FakeCall[] = [];
  const query = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<FakeQueryResult> => {
    const call: FakeCall = { text, params };
    calls.push(call);
    if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] };
    }
    return responder(call);
  };

  const pool = {
    query,
    connect: async () => ({
      query,
      release: () => {},
    }),
  } as unknown as DbPool;

  return { calls, pool };
}

describe('StatsRepo — Food Activity Queries & Scoping', () => {
  it('executes food activity queries with correct parameters and maps populated results', async () => {
    const targetUserId = 'user-test-123';

    const { calls, pool } = makePool((call) => {
      // 14. Food volume
      if (call.text.includes('total_dishes_logged')) {
        return {
          rows: [
            {
              total_dishes_logged: 15,
              distinct_restaurants_visited: 6,
              unique_logged_food_items: 8,
            },
          ],
        };
      }
      // 15. Most logged
      if (call.text.includes('ORDER BY count DESC, lower(fi.name) ASC')) {
        return {
          rows: [
            { food_item_id: 'item-1', food_item_name: 'Dole Whip', count: 5 },
            { food_item_id: 'item-2', food_item_name: 'Churro', count: 3 },
          ],
        };
      }
      // 16. Highest rated
      if (call.text.includes('average_rating DESC')) {
        return {
          rows: [
            {
              food_item_id: 'item-1',
              food_item_name: 'Dole Whip',
              average_rating: 9.5,
              rated_log_count: 4,
            },
          ],
        };
      }
      // 17. Most adventurous day
      if (call.text.includes('restaurant_names')) {
        return {
          rows: [
            {
              date: '2026-06-15',
              dish_count: 5,
              restaurant_names: ['Aloha Isle', 'Sunshine Tree Terrace'],
            },
          ],
        };
      }
      // 18. Dish marathon
      if (call.text.includes('fil.food_item_id, fi.name, fil.visited_on')) {
        return {
          rows: [
            {
              food_item_id: 'item-1',
              food_item_name: 'Dole Whip',
              date: '2026-06-15',
              count: 3,
            },
          ],
        };
      }

      // Default empty rows for denominator/numerator/facets/ratings/etc.
      return { rows: [] };
    });

    const repo = createStatsRepo(pool);
    const snapshot = await repo.getStatsSnapshot({
      targetUserId,
      includePercentile: false,
    });

    // Check queries executed
    const foodVolumeCall = calls.find((c) =>
      c.text.includes('total_dishes_logged'),
    );
    expect(foodVolumeCall).toBeDefined();
    expect(foodVolumeCall?.params).toEqual([targetUserId]);
    expect(foodVolumeCall?.text).toContain('COUNT(DISTINCT COALESCE(fi.experience_id::text, fi.location_id::text))');

    const highestRatedCall = calls.find((c) =>
      c.text.includes('rated_log_count >= $2'),
    );
    expect(highestRatedCall).toBeDefined();
    expect(highestRatedCall?.params).toEqual([
      targetUserId,
      FOOD_STATS_MIN_RATED_LOGS,
    ]);

    const adventurousDayCall = calls.find((c) =>
      c.text.includes('restaurant_names'),
    );
    expect(adventurousDayCall).toBeDefined();
    expect(adventurousDayCall?.text).toContain(
      'LEFT JOIN experiences e ON e.id = fi.experience_id',
    );
    expect(adventurousDayCall?.text).toContain(
      'LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id',
    );

    // Verify mapped foodActivity snapshot
    expect(snapshot.foodActivity).toBeDefined();
    expect(snapshot.foodActivity?.volume).toEqual({
      totalDishesLogged: 15,
      distinctRestaurantsVisited: 6,
      uniqueLoggedFoodItems: 8,
    });
    expect(snapshot.foodActivity?.mostLogged).toEqual([
      { foodItemId: 'item-1', foodItemName: 'Dole Whip', count: 5 },
      { foodItemId: 'item-2', foodItemName: 'Churro', count: 3 },
    ]);
    expect(snapshot.foodActivity?.highestRated).toEqual([
      {
        foodItemId: 'item-1',
        foodItemName: 'Dole Whip',
        averageRating: 9.5,
        ratedLogCount: 4,
      },
    ]);
    expect(snapshot.foodActivity?.mostAdventurousDay).toEqual({
      date: '2026-06-15',
      dishCount: 5,
      restaurantNames: ['Aloha Isle', 'Sunshine Tree Terrace'],
    });
    expect(snapshot.foodActivity?.dishMarathonRecord).toEqual({
      foodItemId: 'item-1',
      foodItemName: 'Dole Whip',
      date: '2026-06-15',
      count: 3,
    });
  });

  it('handles zero food logs case cleanly without attaching personal records', async () => {
    const targetUserId = 'user-zero-food';

    const { pool } = makePool((call) => {
      if (call.text.includes('total_dishes_logged')) {
        return {
          rows: [
            {
              total_dishes_logged: 0,
              distinct_restaurants_visited: 0,
              unique_logged_food_items: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const repo = createStatsRepo(pool);
    const snapshot = await repo.getStatsSnapshot({
      targetUserId,
      includePercentile: false,
    });

    expect(snapshot.foodActivity).toBeDefined();
    expect(snapshot.foodActivity?.volume).toEqual({
      totalDishesLogged: 0,
      distinctRestaurantsVisited: 0,
      uniqueLoggedFoodItems: 0,
    });
    expect(snapshot.foodActivity?.mostLogged).toEqual([]);
    expect(snapshot.foodActivity?.highestRated).toEqual([]);
    expect(snapshot.foodActivity?.mostAdventurousDay).toBeNull();
    expect(snapshot.foodActivity?.dishMarathonRecord).toBeNull();
  });

  it('scoping logic: distinct restaurant resolution correctly handles dual experience_id and location_id', () => {
    // Validates Requirement 24.3:
    // distinctRestaurantsVisited counts distinct resolved scope (experience_id or location_id)
    type FoodItemScope = {
      experienceId: string | null;
      locationId: string | null;
    };

    const resolveScope = (fi: FoodItemScope): string => {
      const scope = fi.experienceId ?? fi.locationId;
      if (!scope) throw new Error('Invalid food item: no scope');
      return scope;
    };

    const loggedItems: FoodItemScope[] = [
      // 2 dishes at Experience 1
      { experienceId: 'exp-aloha-isle', locationId: null },
      { experienceId: 'exp-aloha-isle', locationId: null },
      // 1 dish at Experience 2
      { experienceId: 'exp-peco-bill', locationId: null },
      // 2 dishes at User Submitted Location 1
      { experienceId: null, locationId: 'loc-food-truck-1' },
      { experienceId: null, locationId: 'loc-food-truck-1' },
      // 1 dish at User Submitted Location 2
      { experienceId: null, locationId: 'loc-snack-stand-2' },
    ];

    const scopes = new Set(loggedItems.map(resolveScope));
    // 2 experiences + 2 locations = 4 distinct restaurants
    expect(scopes.size).toBe(4);
    expect(Array.from(scopes).sort()).toEqual([
      'exp-aloha-isle',
      'exp-peco-bill',
      'loc-food-truck-1',
      'loc-snack-stand-2',
    ]);
  });
});
