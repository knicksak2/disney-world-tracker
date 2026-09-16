/**
 * Pure filter, search, and sort derivation for food history and scoped food logs (Feature: food-item-logging R8, R9).
 *
 * Validates: Requirements 8.6-8.10, 9.7-9.8, Property 12
 */

import type { FoodItemLogWithContextDTO } from '@dwt/shared';

export type FoodHistorySort = 'recent' | 'oldest' | 'ratingDesc' | 'ratingAsc';

export interface SortOption {
  readonly id: FoodHistorySort;
  readonly label: string;
}

export const FOOD_HISTORY_SORT_OPTIONS: readonly SortOption[] = [
  { id: 'recent', label: 'Most Recent' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'ratingDesc', label: 'Highest Rated First' },
  { id: 'ratingAsc', label: 'Lowest Rated First' },
];

export interface DeriveFoodLogsOptions {
  readonly sort?: FoodHistorySort;
  readonly selectedRestaurantNames?: ReadonlySet<string> | readonly string[];
  readonly searchText?: string;
  readonly searchFields?: readonly ('foodItemName' | 'restaurantName' | 'locationName')[];
}

function compareRecent(
  a: FoodItemLogWithContextDTO,
  b: FoodItemLogWithContextDTO,
): number {
  if (a.visitedOn !== b.visitedOn) {
    return b.visitedOn.localeCompare(a.visitedOn);
  }
  if (a.loggedAt !== b.loggedAt) {
    return b.loggedAt.localeCompare(a.loggedAt);
  }
  return a.id.localeCompare(b.id);
}

function compareOldest(
  a: FoodItemLogWithContextDTO,
  b: FoodItemLogWithContextDTO,
): number {
  if (a.visitedOn !== b.visitedOn) {
    return a.visitedOn.localeCompare(b.visitedOn);
  }
  if (a.loggedAt !== b.loggedAt) {
    return a.loggedAt.localeCompare(b.loggedAt);
  }
  return b.id.localeCompare(a.id);
}

export function deriveDisplayedFoodLogs(
  rows: readonly FoodItemLogWithContextDTO[],
  options: DeriveFoodLogsOptions = {},
): FoodItemLogWithContextDTO[] {
  let result = [...rows];

  // 1. Restaurant / location name filter (if any selected)
  if (options.selectedRestaurantNames) {
    const selectedSet =
      options.selectedRestaurantNames instanceof Set
        ? options.selectedRestaurantNames
        : new Set(options.selectedRestaurantNames);

    if (selectedSet.size > 0) {
      result = result.filter((row) => {
        const name = row.restaurantName ?? row.locationName;
        return name !== null && selectedSet.has(name);
      });
    }
  }

  // 2. Free-text search filter
  if (options.searchText) {
    const query = options.searchText.trim().toLowerCase();
    if (query.length > 0) {
      const fields = options.searchFields ?? [
        'foodItemName',
        'restaurantName',
        'locationName',
      ];
      result = result.filter((row) =>
        fields.some((field) => {
          const val = row[field];
          return typeof val === 'string' && val.toLowerCase().includes(query);
        }),
      );
    }
  }

  // 3. Sort
  const sort = options.sort ?? 'recent';
  result.sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return compareOldest(a, b);

      case 'ratingDesc': {
        // null always sorts last in both directions
        if (a.rating === null && b.rating !== null) return 1;
        if (a.rating !== null && b.rating === null) return -1;
        if (a.rating !== null && b.rating !== null && a.rating !== b.rating) {
          return b.rating - a.rating;
        }
        return compareRecent(a, b);
      }

      case 'ratingAsc': {
        // null always sorts last in both directions
        if (a.rating === null && b.rating !== null) return 1;
        if (a.rating !== null && b.rating === null) return -1;
        if (a.rating !== null && b.rating !== null && a.rating !== b.rating) {
          return a.rating - b.rating;
        }
        return compareRecent(a, b);
      }

      case 'recent':
      default:
        return compareRecent(a, b);
    }
  });

  return result;
}
