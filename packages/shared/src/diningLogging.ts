/**
 * Pure helpers for Unified Dining & Dish Logging (Feature: unified-dining-logging).
 *
 * Validates: Requirements 2.1, 4.2, 4.3
 */

import type { ExperienceLogDTO } from './dto/ExperienceLog.js';
import type { FoodItemLogWithContextDTO } from './dto/FoodItemLog.js';

export interface InlineDishDraft {
  readonly foodItemId: string;
  readonly name: string;
  readonly rating: number | null; // 1..10 or null
  readonly note: string;
}

/**
 * Returns true if `logs` already contains at least one Experience_Log on `visitedOn`.
 */
export function hasVisitOnDate(
  logs: readonly Pick<ExperienceLogDTO, 'visitedOn'>[],
  visitedOn: string,
): boolean {
  for (const log of logs) {
    if (log.visitedOn === visitedOn) {
      return true;
    }
  }
  return false;
}

/**
 * Groups restaurant-scoped food item logs by `visitedOn` (`YYYY-MM-DD`),
 * preserving input order within each date.
 */
export function groupDishesByVisitDate<
  T extends Pick<FoodItemLogWithContextDTO, 'id' | 'foodItemName' | 'visitedOn' | 'rating'>,
>(dishes: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const byDate = new Map<string, T[]>();
  for (const dish of dishes) {
    const existing = byDate.get(dish.visitedOn);
    if (existing) {
      existing.push(dish);
    } else {
      byDate.set(dish.visitedOn, [dish]);
    }
  }
  return byDate;
}

