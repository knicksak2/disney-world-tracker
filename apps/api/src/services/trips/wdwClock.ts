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

// ---------------------------------------------------------------------------
// Eastern-Time offset and minutes-from-midnight conversions
// ---------------------------------------------------------------------------
//
// These are the single source of truth for converting between an instant and
// "minutes from midnight at Walt Disney World", which the Day Planning
// optimizer and the Crowd Calendar showtime-pattern derivation both need.
// They previously existed as three separate private copies (optimizer.ts,
// showtimePatterns.ts, and here); DST handling had already caused two real
// defects, so the logic lives in exactly one place.
//
// The offset is derived from the platform time-zone database via
// `Intl.DateTimeFormat` — never from hardcoded -240/-300 constants — so a
// future change to US daylight-saving rules is picked up automatically.

/** Formatter used to read an instant's wall-clock parts in the WDW time zone. */
const wdwPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WDW_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

/** Formatter used to read an instant's weekday in the WDW time zone. */
const wdwWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WDW_TIME_ZONE,
  weekday: 'short',
});

/** Offsets are stable per calendar date, so plain `YYYY-MM-DD` lookups are cached. */
const offsetCache = new Map<string, number>();

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolve an input to the instant whose WDW offset we want. A plain
 * `YYYY-MM-DD` is anchored at noon UTC, which lands on the same WDW calendar
 * day in both EST and EDT and avoids the ambiguous hour around a transition.
 */
function toInstant(dateOrInstant: string | Date): Date {
  if (dateOrInstant instanceof Date) return dateOrInstant;
  return dateOrInstant.includes('T')
    ? new Date(dateOrInstant)
    : new Date(`${dateOrInstant}T12:00:00Z`);
}

/**
 * The WDW offset from UTC in minutes for a given date or instant: `-240`
 * during EDT, `-300` during EST. Derived from the platform time-zone data.
 */
export function wdwOffsetMinutes(dateOrInstant: string | Date): number {
  const cacheable = typeof dateOrInstant === 'string' && !dateOrInstant.includes('T');
  if (cacheable) {
    const hit = offsetCache.get(dateOrInstant);
    if (hit !== undefined) return hit;
  }

  const instant = toInstant(dateOrInstant);
  const parts = wdwPartsFormatter.formatToParts(instant);
  let y = 0;
  let mo = 0;
  let day = 0;
  let h = 0;
  let m = 0;
  let s = 0;
  for (const part of parts) {
    if (part.type === 'year') y = parseInt(part.value, 10);
    else if (part.type === 'month') mo = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'hour') h = parseInt(part.value, 10);
    else if (part.type === 'minute') m = parseInt(part.value, 10);
    else if (part.type === 'second') s = parseInt(part.value, 10);
  }
  if (h === 24) h = 0;

  const localAsUTC = Date.UTC(y, mo - 1, day, h, m, s);
  const offset = Math.round((localAsUTC - instant.getTime()) / 60_000);

  if (cacheable) offsetCache.set(dateOrInstant, offset);
  return offset;
}

/**
 * Minutes from midnight WDW-local on `dateString` for a canonical ISO instant.
 * A 10:00 AM show yields `600` whether the date falls in EST or EDT.
 */
export function wdwMinutesFromMidnight(dateString: string, isoInstant: string): number {
  const target = new Date(isoInstant).getTime();
  const midnightUTC =
    new Date(`${dateString}T00:00:00Z`).getTime() - wdwOffsetMinutes(dateString) * 60_000;
  return Math.round((target - midnightUTC) / 60_000);
}

/**
 * The inverse of {@link wdwMinutesFromMidnight}: the canonical ISO instant for
 * `minutesFromMidnight` WDW-local on `dateString`.
 */
export function wdwIsoAtMinutes(dateString: string, minutesFromMidnight: number): string {
  const midnightUTC =
    new Date(`${dateString}T00:00:00Z`).getTime() - wdwOffsetMinutes(dateString) * 60_000;
  return new Date(midnightUTC + minutesFromMidnight * 60_000).toISOString();
}

/**
 * WDW-local day of week for `YYYY-MM-DD`, `0` = Sunday through `6` = Saturday.
 *
 * This matches the convention `ride_shapes.day_of_week` and
 * `predictionService.getDaySnapshot` already use. Deriving it in the WDW zone
 * (rather than from a UTC `getDay()`) is what keeps the two aligned.
 */
export function wdwDayOfWeek(dateString: string): number {
  const label = wdwWeekdayFormatter.format(toInstant(dateString));
  return WEEKDAY_INDEX[label] ?? 0;
}
