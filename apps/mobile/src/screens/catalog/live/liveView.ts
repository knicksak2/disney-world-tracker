// Feature: experience-live-details, Task 10.3 — pure App-side view helpers
//
// Validates: Requirements 4.2, 4.3, 4.4, 4.11, 4.12, 5.1, 5.2, 6.3, 6.7
//
// These helpers carry the *logic* of the live detail view — ordering,
// selection, and empty-state decisions — separated from layout so they can be
// property-tested in isolation (tasks 10.4–10.7). Every function here is pure,
// total, and deterministic: no React, no clock, no I/O. The "current time" is
// always supplied by the caller as `now`.
//
//   - upcomingForecast / lowestWaitEntry  → forecast view ordering + highlight (R4.11, R4.12)
//   - waitStatusDisplay                   → wait/status display gating        (R4.2, R4.3, R4.4)
//   - sortedShowtimes                     → showtime ordering                 (R5.1, R5.2)
//   - diningHoursState / diningWalkupState→ dining empty-state decisions      (R6.3, R6.7)

import type {
  DiningAvailabilityEntry,
  ForecastEntry,
  OperatingHours,
  OperatingStatus,
  Showtime,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Time helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Parse an ISO-8601 instant to epoch milliseconds. Returns `NaN` for an
 * unparseable value; callers use `NaN`-safe comparisons so a malformed time
 * never throws and never reorders ahead of a valid one.
 */
function toMillis(iso: string): number {
  return Date.parse(iso);
}

// ---------------------------------------------------------------------------
// Forecast view (R4.11, R4.12)
// ---------------------------------------------------------------------------

/**
 * Filter a Wait_Time_Forecast to the entries whose forecast time is at or after
 * `now`, sorted ascending by forecast time (R4.11). An absent forecast, or one
 * with no upcoming entries, yields an empty array — which drives the
 * "no wait time forecast available" empty state (R4.12).
 *
 * Ties on time preserve the upstream entry order (stable, index tie-break) so
 * the result is fully deterministic. Entries with an unparseable time are
 * excluded (they cannot be placed on the timeline).
 */
export function upcomingForecast(
  forecast: readonly ForecastEntry[] | undefined,
  now: Date,
): readonly ForecastEntry[] {
  if (forecast === undefined || forecast.length === 0) {
    return [];
  }

  const nowMs = now.getTime();

  return forecast
    .map((entry, index) => ({ entry, index, ms: toMillis(entry.time) }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => (a.ms - b.ms) || (a.index - b.index))
    .map(({ entry }) => entry);
}

/**
 * Pick the single entry with the lowest predicted standby wait (R4.11). The
 * tie-break is deterministic: among entries sharing the minimum `waitMinutes`,
 * the one with the earliest forecast time wins, and if still tied the earlier
 * position in the input list wins.
 *
 * Returns `undefined` for an empty list, so the caller highlights nothing when
 * there are no upcoming entries.
 *
 * Callers typically pass the result of {@link upcomingForecast}; the function
 * is total over any list, so the highlight is well-defined regardless.
 */
export function lowestWaitEntry(
  entries: readonly ForecastEntry[],
): ForecastEntry | undefined {
  let best: { entry: ForecastEntry; ms: number; index: number } | undefined;

  entries.forEach((entry, index) => {
    const ms = toMillis(entry.time);
    if (best === undefined) {
      best = { entry, ms, index };
      return;
    }

    if (entry.waitMinutes < best.entry.waitMinutes) {
      best = { entry, ms, index };
      return;
    }

    if (entry.waitMinutes === best.entry.waitMinutes) {
      // Tie-break 1: earliest forecast time. Treat an unparseable time as
      // "latest" so a valid time is always preferred deterministically.
      const candidateMs = Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
      const bestMs = Number.isFinite(best.ms) ? best.ms : Number.POSITIVE_INFINITY;
      if (candidateMs < bestMs) {
        best = { entry, ms, index };
      }
      // Tie-break 2 (equal time): keep the earlier index — already held by
      // `best` since we iterate in order, so no action needed.
    }
  });

  return best?.entry;
}

/**
 * A single bar in the wait-time forecast chart: the source entry, its height
 * as a fraction of the tallest upcoming bar (`0..1`), and whether it is the
 * highlighted lowest-wait entry.
 */
export interface ForecastBar {
  readonly entry: ForecastEntry;
  /** Height relative to the largest wait in the set, in `[0, 1]`. */
  readonly heightFraction: number;
  /** True for the single highlighted lowest-wait entry. */
  readonly isLowest: boolean;
}

/**
 * Build the bar model for the forecast chart (R4.11). Each bar's height is
 * normalized against the largest `waitMinutes` in the set so the tallest bar
 * fills the chart and the rest scale proportionally; when every wait is `0`
 * (or the set is empty) all fractions are `0`. The entry matching `lowest`
 * (typically from {@link lowestWaitEntry}) is flagged for highlighting.
 *
 * Pure and total: the input order is preserved and no value is mutated, so the
 * chart renders deterministically for equal inputs.
 */
export function forecastChartBars(
  entries: readonly ForecastEntry[],
  lowest: ForecastEntry | undefined,
): readonly ForecastBar[] {
  const maxWait = entries.reduce(
    (max, entry) => (entry.waitMinutes > max ? entry.waitMinutes : max),
    0,
  );
  return entries.map((entry) => ({
    entry,
    heightFraction: maxWait > 0 ? entry.waitMinutes / maxWait : 0,
    isLowest: entry === lowest,
  }));
}

// ---------------------------------------------------------------------------
// Wait / status display gating (R4.2, R4.3, R4.4)
// ---------------------------------------------------------------------------

/**
 * The decision for the Ride/Character_Meet wait-and-status display:
 *   - `standby` — show the standby Wait_Time value (Operating + wait present).
 *   - `no_wait` — show the "no standby wait posted" indicator (Operating, wait absent).
 *   - `none`    — show no wait value at all (any non-Operating status).
 */
export type WaitStatusDisplay =
  | { readonly kind: 'standby'; readonly waitMinutes: number }
  | { readonly kind: 'no_wait' }
  | { readonly kind: 'none' };

/**
 * Decide the wait/status display purely from the Operating_Status and whether a
 * standby Wait_Time is present:
 *   - standby value shown iff status is Operating AND a wait is present (R4.2);
 *   - the no-wait indicator shown when status is Operating AND wait is absent (R4.4);
 *   - nothing shown for Closed/Down/Refurbishment/Unknown (R4.3).
 */
export function waitStatusDisplay(
  status: OperatingStatus,
  waitMinutes: number | undefined,
): WaitStatusDisplay {
  if (status !== 'Operating') {
    return { kind: 'none' }; // R4.3
  }
  if (waitMinutes === undefined) {
    return { kind: 'no_wait' }; // R4.4
  }
  return { kind: 'standby', waitMinutes }; // R4.2
}

// ---------------------------------------------------------------------------
// Showtime view (R5.1, R5.2)
// ---------------------------------------------------------------------------

/**
 * Sort current-day Showtimes ascending by start time (R5.1). Ties on start
 * preserve the input order (stable, index tie-break) for determinism. An empty
 * input yields an empty array, which drives the "no performances scheduled"
 * empty state (R5.2).
 */
export function sortedShowtimes(
  showtimes: readonly Showtime[],
): readonly Showtime[] {
  return showtimes
    .map((showtime, index) => ({ showtime, index, ms: toMillis(showtime.start) }))
    .sort((a, b) => {
      const aMs = Number.isFinite(a.ms) ? a.ms : Number.POSITIVE_INFINITY;
      const bMs = Number.isFinite(b.ms) ? b.ms : Number.POSITIVE_INFINITY;
      return (aMs - bMs) || (a.index - b.index);
    })
    .map(({ showtime }) => showtime);
}

// ---------------------------------------------------------------------------
// Dining empty states (R6.3, R6.7)
// ---------------------------------------------------------------------------

/**
 * The dining-hours display decision:
 *   - `available` — one or more current-day hours sets carry both an open and a
 *     close time, carried through for display (R6.2).
 *   - `unavailable` — no such set exists, driving the "dining hours unavailable"
 *     empty state (R6.3).
 */
export type DiningHoursState =
  | { readonly kind: 'available'; readonly hours: readonly OperatingHours[] }
  | { readonly kind: 'unavailable' };

/**
 * Decide the dining-hours empty state purely from the Operating_Hours data: the
 * "dining hours unavailable" empty state shows exactly when there is no
 * current-day hours set carrying both an open and a close time (R6.3).
 */
export function diningHoursState(
  operatingHours: readonly OperatingHours[],
): DiningHoursState {
  const usable = operatingHours.filter(
    (hours) => isPresent(hours.open) && isPresent(hours.close),
  );
  if (usable.length === 0) {
    return { kind: 'unavailable' }; // R6.3
  }
  return { kind: 'available', hours: usable };
}

/**
 * The walk-up dining display decision:
 *   - `available` — the Dining_Availability has one or more entries (R6.6).
 *   - `unavailable` — the Dining_Availability is empty, driving the "walk-up
 *     availability unavailable" empty state (R6.7).
 */
export type DiningWalkupState =
  | { readonly kind: 'available'; readonly entries: readonly DiningAvailabilityEntry[] }
  | { readonly kind: 'unavailable' };

/**
 * Decide the walk-up dining empty state purely from the Dining_Availability:
 * the "walk-up availability unavailable" empty state shows exactly when the
 * list is empty (R6.7); otherwise the entries are carried through (R6.6).
 */
export function diningWalkupState(
  diningAvailability: readonly DiningAvailabilityEntry[],
): DiningWalkupState {
  if (diningAvailability.length === 0) {
    return { kind: 'unavailable' }; // R6.7
  }
  return { kind: 'available', entries: diningAvailability }; // R6.6
}

/** True when an ISO time string is a present, non-empty value. */
function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Lightning Lane / boarding group display (ThemeParks.wiki, R11.6, R11.7)
// ---------------------------------------------------------------------------

/**
 * Humanize a coarse upstream state token (e.g. `"SOLD_OUT"`, `"PAID_RETURN"`,
 * `"FINISHED"`) into a readable label ("Sold out", "Paid return", "Finished").
 * Returns `undefined` for an absent/blank token so the caller omits the row.
 * Pure and total.
 */
export function humanizeCoarseState(state: string | undefined): string | undefined {
  if (state === undefined) {
    return undefined;
  }
  const trimmed = state.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const spaced = trimmed.replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Format a Lightning Lane price. ThemeParks.wiki reports `amount` in the
 * currency's minor units (e.g. `1500` for `USD` = `$15.00`), so the amount is
 * divided by 100 and formatted with the currency. Falls back to a plain
 * `"<amount> <currency>"` when the currency code is not recognized by `Intl`.
 * Pure and total.
 */
export function formatLightningLanePrice(
  amount: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}
