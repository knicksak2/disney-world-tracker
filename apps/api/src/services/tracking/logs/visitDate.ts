/**
 * Visit date validation helpers.
 *
 * Validates that a requested visit date is not later than "today" in the user's
 * IANA time zone. Reusable across `tracking/logs` and `trips/routes`.
 *
 * Validates: Requirements 6.4
 */

import { AppError } from '../../../errors/AppError.js';

/**
 * Reject a `visitedOn` strictly later than today in the caller's `userTz`
 * (R1.5, R6.4). The TZ has passed the shared `ianaTzSchema` structural check;
 * here it is resolved against the live IANA database via `Intl` to derive
 * `today_in_user_tz`, and the two `YYYY-MM-DD` strings are compared
 * lexicographically (zero-padded ISO dates make string order equal calendar
 * order). Mirrors the Completion route's `completion_future_date` guard.
 */
export function validateNotFutureVisitDate(
  visitedOn: string,
  userTz: string,
  now: Date,
): void {
  const todayInUserTz = formatYmdInTimeZone(now, userTz);
  if (visitedOn > todayInUserTz) {
    throw new AppError(
      'log_future_date',
      'Visit date must not be later than today in the user time zone.',
      { field: 'visitedOn' },
    );
  }
}

/**
 * Format a `Date` as `YYYY-MM-DD` in the supplied IANA time zone via
 * `Intl.DateTimeFormat` (no bundled TZ database). An unknown zone raises
 * `RangeError`, which we translate to `validation_failed` on `userTz`; an
 * unexpected Intl shape fails closed the same way rather than letting a future
 * date slip through.
 */
export function formatYmdInTimeZone(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new AppError(
        'validation_failed',
        'Unknown IANA time zone identifier.',
        { field: 'userTz' },
      );
    }
    throw err;
  }

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }

  if (yyyy.length === 0 || mm.length === 0 || dd.length === 0) {
    throw new AppError(
      'validation_failed',
      'Could not resolve current date in the user time zone.',
      { field: 'userTz' },
    );
  }

  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

