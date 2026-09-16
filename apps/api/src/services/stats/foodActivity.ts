/**
 * Stats_Service — Food Activity Statistics pure roll-up.
 *
 * Implements pure roll-up of food volume, podium (most logged), highest rated
 * dishes, and personal records for the Stats_Service.
 * Free of I/O, database dependencies, or side effects.
 *
 * Validates: Requirements 24.1–24.7, 25.1–25.3, 26.1–26.5, 27.1–27.5
 */

import type {
  FoodActivityStatistics,
  MostLoggedFoodItem,
  HighestRatedFoodItem,
  FoodPersonalRecords,
} from '@dwt/shared';

export interface RawFoodActivityVolumeRow {
  readonly totalDishesLogged: number;
  readonly distinctRestaurantsVisited: number;
  readonly uniqueLoggedFoodItems: number;
}

export interface RawMostLoggedFoodItemRow {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly count: number;
}

export interface RawHighestRatedFoodItemRow {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly averageRating: number;
  readonly ratedLogCount: number;
}

export interface RawMostAdventurousDayRow {
  readonly date: string;
  readonly dishCount: number;
  readonly restaurantNames: readonly string[];
}

export interface RawDishMarathonRecordRow {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly date: string;
  readonly count: number;
}

export interface RawFoodActivityMaterial {
  readonly volume: RawFoodActivityVolumeRow;
  readonly mostLogged: readonly RawMostLoggedFoodItemRow[];
  readonly highestRated: readonly RawHighestRatedFoodItemRow[];
  readonly mostAdventurousDay: RawMostAdventurousDayRow | null;
  readonly dishMarathonRecord: RawDishMarathonRecordRow | null;
}

export const EMPTY_FOOD_ACTIVITY_MATERIAL: RawFoodActivityMaterial = {
  volume: {
    totalDishesLogged: 0,
    distinctRestaurantsVisited: 0,
    uniqueLoggedFoodItems: 0,
  },
  mostLogged: [],
  highestRated: [],
  mostAdventurousDay: null,
  dishMarathonRecord: null,
};

/**
 * Pure roll-up of food activity volume, repeat multiplier, podium, and records.
 */
export function rollUpFoodActivity(
  raw: RawFoodActivityMaterial,
): FoodActivityStatistics {
  const { totalDishesLogged, distinctRestaurantsVisited, uniqueLoggedFoodItems } =
    raw.volume;

  const repeatMultiplier =
    uniqueLoggedFoodItems > 0
      ? Math.max(1.0, Number((totalDishesLogged / uniqueLoggedFoodItems).toFixed(1)))
      : 1.0;

  if (totalDishesLogged === 0) {
    return {
      totalDishesLogged: 0,
      distinctRestaurantsVisited: 0,
      repeatMultiplier: 1.0,
      mostLogged: [],
      highestRated: [],
      personalRecords: {},
    };
  }

  const mostLogged: MostLoggedFoodItem[] = raw.mostLogged.slice(0, 5).map((row) => ({
    foodItemId: row.foodItemId,
    foodItemName: row.foodItemName,
    count: row.count,
  }));

  const highestRated: HighestRatedFoodItem[] = raw.highestRated
    .slice(0, 5)
    .map((row) => ({
      foodItemId: row.foodItemId,
      foodItemName: row.foodItemName,
      averageRating: row.averageRating,
      ratedLogCount: row.ratedLogCount,
    }));

  const personalRecords: FoodPersonalRecords = {
    ...(raw.mostAdventurousDay
      ? {
          mostAdventurousDay: {
            date: raw.mostAdventurousDay.date,
            dishCount: raw.mostAdventurousDay.dishCount,
            restaurantNames: raw.mostAdventurousDay.restaurantNames.filter(
              (name): name is string =>
                typeof name === 'string' && name.trim().length > 0,
            ),
          },
        }
      : {}),
    ...(raw.dishMarathonRecord
      ? {
          dishMarathonRecord: {
            foodItemId: raw.dishMarathonRecord.foodItemId,
            foodItemName: raw.dishMarathonRecord.foodItemName,
            date: raw.dishMarathonRecord.date,
            count: raw.dishMarathonRecord.count,
          },
        }
      : {}),
  };

  return {
    totalDishesLogged,
    distinctRestaurantsVisited,
    repeatMultiplier,
    mostLogged,
    highestRated,
    personalRecords,
  };
}
