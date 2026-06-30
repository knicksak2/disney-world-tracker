/**
 * Park-local time-zone helpers for the `Live_Service`.
 *
 * All Walt Disney World parks observe US Eastern time, so the park-local time
 * zone is the single constant `WDW_TIME_ZONE` (the catalog does not persist a
 * per-Park time zone; using the single WDW zone is correct for every Park in
 * scope and is documented as a design decision — see design.md → Park-time
 * helpers).
 *
 * The two helpers here are the small pieces of date logic the projection and
 * the App-side forecast view depend on:
 *
 *   - `isCurrentParkDay` decides whether an instant falls on the same
 *     park-local calendar day as a reference `now`, which scopes "current day"
 *     showtimes and operating hours (R1.7, R1.19).
 *   - `upcomingForecast` filters a forecast series to the entries at or after
 *     `now`, sorted ascending by time, which drives the upcoming-forecast
 *     display (R1.16, R4.11).
 *
 * Time zones are resolved against the IANA database via `Intl.DateTimeFormat`
 * (the same mechanism the existing completion time-zone logic relies on) so we
 * never have to bundle a time-zone database. Both helpers are pure, total, and
 * deterministic: they depend only on their arguments, perform no I/O, and never
 * throw for a valid IANA zone.
 */

import type { ForecastEntry } from '@dwt/shared';

/**
 * The IANA time zone shared by every Walt Disney World Park in scope. All four
 * theme parks, both water parks, and Disney Springs observe US Eastern time.
 */
export const WDW_TIME_ZONE = 'America/New_York';

/**
 * Format an instant as a `YYYY-MM-DD` string in the supplied IANA time zone.
 *
 * `formatToParts` is used rather than `format` because the default `format`
 * output is locale-dependent; `formatToParts` is the portable way to extract
 * `{ year, month, day }` regardless of locale. The resulting string sorts and
 * compares correctly as a calendar day in the target zone.
 */
function parkLocalYmd(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * True when `instant` falls on the same park-local calendar day as `now`.
 *
 * Both instants are projected into the park-local calendar day (defaulting to
 * `WDW_TIME_ZONE`) and compared as `YYYY-MM-DD` strings, so the comparison is
 * correct across midnight boundaries and daylight-saving transitions in the
 * target zone.
 */
export function isCurrentParkDay(
  instant: Date,
  now: Date,
  tz: string = WDW_TIME_ZONE,
): boolean {
  return parkLocalYmd(instant, tz) === parkLocalYmd(now, tz);
}

/**
 * Filter a forecast series to the entries whose forecast time is at or after
 * `now`, returned sorted ascending by time (R4.11).
 *
 * Entry times are ISO-8601 instants; ordering is by their absolute instant.
 * The input array is never mutated — a new array is returned. Ties on time
 * preserve the relative input order (the sort is stable), so the result is
 * deterministic for equal inputs.
 */
export function upcomingForecast(
  entries: readonly ForecastEntry[],
  now: Date,
): readonly ForecastEntry[] {
  const nowMs = now.getTime();
  return entries
    .filter((entry) => new Date(entry.time).getTime() >= nowMs)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}
