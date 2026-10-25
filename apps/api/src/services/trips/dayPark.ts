/**
 * Pure functions for per-day park assignment (Day_Park, R24).
 *
 * Persists the assigned park as `startingPark` in `trips.day_touring_hours` (keyed `YYYY-MM-DD`).
 * Setting merges `startingPark` into the date's entry. Clearing drops `startingPark`,
 * and drops the date key iff the resulting entry is empty.
 *
 * Validates: Requirements 24.2, 24.3, 24.4, 24.7
 */

import type { DayTouringHoursDTO, Park } from '@dwt/shared';

/**
 * Applies a Day_Park assignment (or clearing) to a `day_touring_hours` map.
 * Returns a new map; never mutates the input.
 */
export function applyDayPark(
  map: Readonly<Record<string, DayTouringHoursDTO>> | null | undefined,
  date: string,
  park: Park | null,
): Record<string, DayTouringHoursDTO> {
  const currentMap = map ?? {};
  const result: Record<string, DayTouringHoursDTO> = {};

  for (const [key, val] of Object.entries(currentMap)) {
    result[key] = { ...val };
  }

  if (park !== null) {
    result[date] = {
      ...(result[date] ?? {}),
      startingPark: park,
    };
  } else {
    if (date in result) {
      const entry = { ...result[date] };
      delete entry.startingPark;
      if (Object.keys(entry).length === 0) {
        delete result[date];
      } else {
        result[date] = entry;
      }
    }
  }

  return result;
}

