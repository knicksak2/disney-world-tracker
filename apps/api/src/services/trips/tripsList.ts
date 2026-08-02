/**
 * Trips list grouping.
 *
 * Pure, deterministic grouping of a User's Trips by derived Trip_Status for
 * the Trips_List_Screen. Trips are partitioned into an Active group, an
 * Upcoming group, and a Past group — presented in exactly that order — with
 * the Active and Upcoming groups ordered by ascending Trip_Start_Date and the
 * Past group ordered by descending Trip_End_Date. Empty groups are omitted so
 * the screen renders only the sections that contain Trips (R16.2–R16.5).
 *
 * Each Trip's status is derived, never stored, via {@link deriveTripStatus},
 * so the grouping reads only the two calendar dates and the current WDW date.
 * The function performs no I/O and does not mutate its input, which keeps it
 * cheap to property-test across many inputs.
 *
 * Validates: Requirements 16.2, 16.3, 16.4, 16.5
 */

import { deriveTripStatus, type TripStatus } from './tripStatus.js';

/**
 * Minimal shape required to group and order a Trip in the list.
 *
 * `startDate` — Trip_Start_Date as `YYYY-MM-DD`; the ascending sort key for
 *               the Active and Upcoming groups.
 * `endDate`   — Trip_End_Date as `YYYY-MM-DD`; the descending sort key for the
 *               Past group. `endDate >= startDate` is enforced on write.
 *
 * `YYYY-MM-DD` strings order lexicographically the same as chronologically, so
 * ordering is a plain string comparison needing no date parsing.
 */
export interface GroupableTrip {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * One non-empty status group of the Trips list.
 *
 * `status` — the derived Trip_Status shared by every Trip in the group.
 * `trips`  — the group's Trips in display order (ascending Trip_Start_Date for
 *            `active`/`upcoming`, descending Trip_End_Date for `past`).
 */
export interface TripStatusGroup<T extends GroupableTrip> {
  readonly status: TripStatus;
  readonly trips: readonly T[];
}

/**
 * Group a User's Trips by derived status for the Trips_List_Screen.
 *
 * Returns the Active, Upcoming, and Past groups in that fixed order (R16.2),
 * ordering the Active and Upcoming groups by ascending Trip_Start_Date (R16.3)
 * and the Past group by descending Trip_End_Date (R16.4). Any status group
 * that would contain no Trips is omitted from the result (R16.5). The input
 * array is not mutated.
 *
 * @param trips The caller's Trips to group.
 * @param wdwToday WDW_Current_Date as `YYYY-MM-DD`, the anchor for deriving
 *   each Trip's status.
 * @returns The non-empty status groups in presentation order.
 */
export function groupTripsByStatus<T extends GroupableTrip>(
  trips: readonly T[],
  wdwToday: string,
): TripStatusGroup<T>[] {
  const active: T[] = [];
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const trip of trips) {
    const status = deriveTripStatus(trip.startDate, trip.endDate, wdwToday);
    if (status === 'active') {
      active.push(trip);
    } else if (status === 'upcoming') {
      upcoming.push(trip);
    } else {
      past.push(trip);
    }
  }

  // Active/Upcoming ascending by start date; Past descending by end date.
  active.sort(byAscendingStartDate);
  upcoming.sort(byAscendingStartDate);
  past.sort(byDescendingEndDate);

  // Fixed presentation order, omitting empty groups (R16.2, R16.5).
  const ordered: readonly TripStatusGroup<T>[] = [
    { status: 'active', trips: active },
    { status: 'upcoming', trips: upcoming },
    { status: 'past', trips: past },
  ];
  return ordered.filter((group) => group.trips.length > 0);
}

/** Ascending Trip_Start_Date (R16.3). */
function byAscendingStartDate(a: GroupableTrip, b: GroupableTrip): number {
  if (a.startDate < b.startDate) return -1;
  if (a.startDate > b.startDate) return 1;
  return 0;
}

/** Descending Trip_End_Date (R16.4). */
function byDescendingEndDate(a: GroupableTrip, b: GroupableTrip): number {
  if (a.endDate < b.endDate) return 1;
  if (a.endDate > b.endDate) return -1;
  return 0;
}
