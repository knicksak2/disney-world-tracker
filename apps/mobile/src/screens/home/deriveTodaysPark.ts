/**
 * Shared derivation of today's park for active trip context.
 * Used by HomeScreen and QuickActionSheet so the two cannot drift.
 * (Requirements 2.6, 4.3)
 */

import type { ExperienceDTO, Park, PlannedItemDTO, TripDTO } from '@dwt/shared';

export interface DeriveTodaysParkOptions {
  readonly activeTrip?: TripDTO | null | undefined;
  readonly plannedItems?: readonly PlannedItemDTO[] | null | undefined;
  readonly todayStr: string;
  readonly experiencesById?: ReadonlyMap<string, ExperienceDTO> | undefined;
}

/**
 * Derives the active park for today from:
 *   1. Today's planned items with a park (or resolved via catalog experiences)
 *   2. The active trip's dayTouringHours startingPark for today
 *   3. Default: 'Magic Kingdom'
 */
export function deriveTodaysPark(options: DeriveTodaysParkOptions): Park {
  const { activeTrip, plannedItems, todayStr, experiencesById } = options;
  const items = plannedItems ?? [];
  const todaysItems = items.filter((i) => i.plannedDate === todayStr);
  const itemWithPark = todaysItems.find(
    (i) => i.park || (i.experienceId && experiencesById?.get(i.experienceId)?.park),
  );
  if (itemWithPark) {
    const park =
      itemWithPark.park ??
      (itemWithPark.experienceId
        ? experiencesById?.get(itemWithPark.experienceId)?.park
        : null);
    if (park) return park;
  }
  if (activeTrip?.dayTouringHours?.[todayStr]?.startingPark) {
    return activeTrip.dayTouringHours[todayStr]!.startingPark as Park;
  }
  return 'Magic Kingdom';
}
