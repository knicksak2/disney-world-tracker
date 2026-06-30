// Feature: experience-live-details, Task 11.1 — App-side park-local time formatting
//
// Validates: Requirements 4.5, 4.8, 4.11, 4.13, 5.1, 5.4, 5.5, 5.7, 6.2, 6.4, 6.8
//
// Every live timestamp the App renders — Showtimes, Operating_Hours, return
// windows, forecast entries, Retrieved_At, and Upstream_Last_Updated — is shown
// in the Park's local time zone. All Walt Disney World parks observe US Eastern
// time, so the park-local zone is the single constant `WDW_TIME_ZONE`, mirroring
// the server-side `parkTime.ts`.
//
// The formatters lean on `Intl.DateTimeFormat` with an explicit `timeZone`, the
// same mechanism the existing completion-date logic uses (see
// `CompletionControls.tsx`), so the App agrees on wall-clock rendering without
// bundling a TZ database. An unparseable instant degrades gracefully to a
// placeholder rather than throwing.

/** IANA time zone shared by every Walt Disney World park (US Eastern). */
export const WDW_TIME_ZONE = 'America/New_York';

/** Shown in place of an unparseable / absent instant so rendering never throws. */
const INVALID_PLACEHOLDER = '—';

/**
 * Format an ISO-8601 instant as a park-local wall-clock time (e.g. `3:45 PM`).
 * Returns a stable placeholder for an absent or unparseable value.
 */
export function formatParkTime(iso: string | undefined): string {
  const date = parse(iso);
  if (date === undefined) {
    return INVALID_PLACEHOLDER;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * Format an ISO-8601 instant as a compact park-local hour (e.g. `4 PM`).
 * Used for the wait-time forecast chart's x-axis labels, where space is
 * tight and the forecast is hour-granular. Returns a stable placeholder for
 * an absent or unparseable value.
 */
export function formatParkHour(iso: string | undefined): string {
  const date = parse(iso);
  if (date === undefined) {
    return INVALID_PLACEHOLDER;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    hour: 'numeric',
  }).format(date);
}

/**
 * Format an ISO-8601 instant as a park-local date-and-time (e.g.
 * `May 1, 3:45 PM`). Used for the Retrieved_At and Upstream_Last_Updated
 * stamps where the calendar context is useful. Returns a stable placeholder
 * for an absent or unparseable value.
 */
export function formatParkDateTime(iso: string | undefined): string {
  const date = parse(iso);
  if (date === undefined) {
    return INVALID_PLACEHOLDER;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Parse an ISO instant to a `Date`, or `undefined` when absent/unparseable. */
function parse(iso: string | undefined): Date | undefined {
  if (iso === undefined || iso.length === 0) {
    return undefined;
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  return new Date(ms);
}
