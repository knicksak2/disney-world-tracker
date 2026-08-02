/**
 * Walt Disney World calendar clock.
 *
 * Yields the current calendar date at Walt Disney World (United States Eastern
 * Time) as a `YYYY-MM-DD` string. This is the `WDW_Current_Date` anchor the
 * Trip_Service uses to derive `Trip_Status`, so that status transitions align
 * with the local calendar dates that define a Trip (R2).
 *
 * The date is computed with `Intl.DateTimeFormat` pinned to an explicit
 * `timeZone`, so daylight-saving transitions are handled by the platform's
 * time-zone database rather than by hand. The `now` argument is injectable so
 * tests can pin a specific instant.
 */

/** IANA time-zone identifier for the Walt Disney World local calendar. */
const WDW_TIME_ZONE = 'America/New_York';

/**
 * `Intl.DateTimeFormat` configured to emit the three date parts of a given
 * instant in the WDW time zone. Built once and reused across calls.
 */
const wdwDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WDW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Return the current calendar date at Walt Disney World as `YYYY-MM-DD`.
 *
 * @param now The instant to read the WDW calendar date for. Defaults to the
 *   current time; injectable so tests can pin a specific instant.
 * @returns The WDW-local calendar date formatted as `YYYY-MM-DD`.
 */
export function wdwToday(now: Date = new Date()): string {
  const parts = wdwDateFormatter.formatToParts(now);
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') {
      year = part.value;
    } else if (part.type === 'month') {
      month = part.value;
    } else if (part.type === 'day') {
      day = part.value;
    }
  }
  return `${year}-${month}-${day}`;
}
