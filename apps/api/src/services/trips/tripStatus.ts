/**
 * Derived Trip status.
 *
 * `Trip_Status` is never stored: it is always computed from the two stored
 * calendar dates and the current WDW calendar date, so it can never drift and
 * is never independently editable (R2.5). Changing a Trip's dates therefore
 * changes its status on the next read (R2.6).
 *
 * All three inputs are `YYYY-MM-DD` calendar-date strings in the WDW time zone
 * (see {@link ./wdwClock}). Because that format is lexicographically ordered
 * the same as chronologically, the comparison is a plain string comparison and
 * needs no date parsing.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

/** The three derived states a Trip can be in relative to the WDW calendar. */
export type TripStatus = 'upcoming' | 'active' | 'past';

/**
 * Derive a Trip's status from its dates and the current WDW date.
 *
 * Rules (comparison is by calendar date):
 *   - `past` when `wdwToday > endDate` (R2.4).
 *   - `upcoming` when `wdwToday < startDate` (R2.1).
 *   - otherwise `active`, covering `startDate <= wdwToday <= endDate`
 *     (R2.2), including the single-day case where
 *     `startDate === endDate === wdwToday` (R2.3).
 *
 * @param startDate Trip_Start_Date as `YYYY-MM-DD`.
 * @param endDate Trip_End_Date as `YYYY-MM-DD`; `>= startDate` is enforced on
 *   write, so it is assumed here.
 * @param wdwToday WDW_Current_Date as `YYYY-MM-DD`.
 * @returns The derived `TripStatus`.
 */
export function deriveTripStatus(
  startDate: string,
  endDate: string,
  wdwToday: string,
): TripStatus {
  if (wdwToday > endDate) {
    return 'past';
  }
  if (wdwToday < startDate) {
    return 'upcoming';
  }
  return 'active';
}
