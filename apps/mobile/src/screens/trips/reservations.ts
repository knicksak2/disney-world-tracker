/**
 * Pure derivation core for the Reservations screen (trip-reservations R1.3,
 * R2.1–R2.3, R5.2).
 *
 * A Reservation is a Planned_Item carrying a non-null `reservationKind`, so
 * selecting the Trip's Reservations is a filter over the Planned_List the
 * Schedule Builder already loads — no second endpoint and no second source of
 * truth. This module holds that selection and the presentation mapping so both
 * are testable (and property-testable) without rendering.
 *
 * No I/O and no React: keep it that way.
 */

import type { PlannedItemDTO, ReservationKind } from '@dwt/shared';

/** One date's Reservations, ordered by Booked_Time ascending (R2.1). */
export interface ReservationDateGroup {
  /** The `planned_date` these Reservations fall on, as `YYYY-MM-DD`. */
  readonly date: string;
  readonly items: readonly PlannedItemDTO[];
}

/**
 * Ionicons glyph names per kind. Paired with a text label in
 * {@link reservationKindPresentation} so a kind is never conveyed by icon or
 * color alone (R2.3).
 */
export const RESERVATION_KIND_ICONS: Readonly<Record<ReservationKind, string>> = {
  dining: 'restaurant-outline',
  lightning_lane: 'flash-outline',
  activity: 'ticket-outline',
  other: 'bookmark-outline',
};

/** Human-readable label per kind. */
const RESERVATION_KIND_LABELS: Readonly<Record<ReservationKind, string>> = {
  dining: 'Dining',
  lightning_lane: 'Lightning Lane',
  activity: 'Activity',
  other: 'Reservation',
};

/**
 * A Reservation is a Planned_Item with a non-null `reservationKind`. An
 * ordinary planned item is not a Reservation even when it carries a pinned
 * `plannedTime` (R1.3).
 */
export function isReservation(item: PlannedItemDTO): boolean {
  return item.reservationKind != null;
}

/**
 * Icon + text label for a Reservation kind (R2.3). Falls back to the neutral
 * `other` presentation for an unrecognized value so a future kind added to the
 * shared vocabulary renders as a reservation rather than crashing the screen.
 */
export function reservationKindPresentation(kind: ReservationKind): {
  readonly icon: string;
  readonly label: string;
} {
  return {
    icon: RESERVATION_KIND_ICONS[kind] ?? RESERVATION_KIND_ICONS.other,
    label: RESERVATION_KIND_LABELS[kind] ?? RESERVATION_KIND_LABELS.other,
  };
}

/**
 * The display title for a Reservation (R2.2, R5.2): the Catalog Experience's
 * name when it has one, else the Custom_Title of a Non_Catalog_Reservation,
 * else the kind label — so an off-property dinner reads as "Dining" rather than
 * as a break, which is how it is stored.
 */
export function reservationTitle(item: PlannedItemDTO): string {
  const experienceName = item.experienceName?.trim();
  if (experienceName) return experienceName;

  const customTitle = item.customTitle?.trim();
  if (customTitle) return customTitle;

  if (item.reservationKind != null) {
    return reservationKindPresentation(item.reservationKind).label;
  }
  return 'Reservation';
}

/**
 * Sort key for a Reservation's Booked_Time. `plannedTime` is an ISO instant, so
 * lexicographic order over the parsed epoch is chronological. A Reservation
 * always has one (R1.5); a malformed or absent value sorts last rather than
 * poisoning the comparison with `NaN`.
 */
function bookedTimeKey(item: PlannedItemDTO): number {
  if (item.plannedTime == null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(item.plannedTime);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * Select the Reservations from a Planned_List and group them by date (R1.3,
 * R2.1, R2.4, R2.7).
 *
 * - Items whose `reservationKind` is null are excluded; every other item is kept
 *   exactly once, so the result is a lossless partition of the Reservations.
 * - Groups are date-ascending and distinct; no empty group is emitted.
 * - Items within a group are non-descending by Booked_Time, with a stable
 *   tie-break on `id` so two bookings at the same minute keep a total, stable
 *   order rather than flickering between renders.
 * - A Reservation dated outside the Trip's range still gets its own group
 *   rather than being hidden (R2.7) — this function knows nothing about the
 *   Trip's start/end dates, which is what makes that true by construction.
 */
export function groupReservationsByDate(
  items: readonly PlannedItemDTO[],
): readonly ReservationDateGroup[] {
  const byDate = new Map<string, PlannedItemDTO[]>();

  for (const item of items) {
    if (item.reservationKind == null) continue;
    // A Reservation always has a date (R1.5); guard anyway so a malformed row
    // from an older client cannot drop into an untitled group.
    if (item.plannedDate == null) continue;

    const bucket = byDate.get(item.plannedDate);
    if (bucket) {
      bucket.push(item);
    } else {
      byDate.set(item.plannedDate, [item]);
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, group]) => ({
      date,
      items: [...group].sort((a, b) => {
        const delta = bookedTimeKey(a) - bookedTimeKey(b);
        if (delta !== 0 && Number.isFinite(delta)) return delta;
        if (delta !== 0) return bookedTimeKey(a) === Number.POSITIVE_INFINITY ? 1 : -1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    }));
}

/** Total number of Reservations across every group. */
export function countReservations(groups: readonly ReservationDateGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/** IANA zone every WDW park observes; the zone a Booked_Time is entered in. */
const WDW_TIME_ZONE = 'America/New_York';

/**
 * The offset, in minutes, between `America/New_York` and UTC on a given
 * calendar date. Positive when ET is ahead of UTC (never, for WDW) and negative
 * otherwise, e.g. `-240` during EDT and `-300` during EST.
 *
 * Derived from `Intl` rather than hardcoded so DST transitions are handled
 * without bundling a TZ database. Anchored at 12:00 UTC, which is the same
 * calendar day in ET year-round, so the lookup can never land on the wrong day.
 */
function etOffsetMinutes(dateString: string): number {
  const anchor = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return 0;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(anchor);

  const read = (type: string): number => {
    const value = parts.find((p) => p.type === type)?.value ?? '0';
    return Number.parseInt(value, 10);
  };

  let hour = read('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
  return Math.round((asUtc - anchor.getTime()) / 60000);
}

/**
 * Convert a Booked_Time expressed as park-local wall clock into the UTC ISO
 * instant the wire contract and `planned_time TIMESTAMPTZ` column expect.
 *
 * A guest reads their reservation as "6:00 PM" at Walt Disney World, never as an
 * instant, so the input is interpreted in `America/New_York` on the reservation's
 * own date — deliberately, not in the device's local zone. Returns `null` for a
 * malformed date or time so the caller can surface a validation message instead
 * of posting a bad instant.
 *
 * Accepts the Time_Picker's unambiguous 12-hour form (`6:25 PM`, R3.12) as well
 * as 24-hour `H:MM` / `HH:MM`. The meridiem form exists because bare digits are
 * ambiguous: "1:00" was read as 1 AM when the user meant 1 PM, silently saving a
 * booking twelve hours off. With a picked meridiem that is unrepresentable.
 */
export function etWallClockToIso(dateString: string, timeText: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;

  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(timeText.trim());
  if (!match) return null;

  let hours = Number.parseInt(match[1]!, 10);
  const minutes = Number.parseInt(match[2]!, 10);
  const meridiem = match[3]?.toUpperCase();

  if (meridiem !== undefined) {
    // A 12-hour value only admits hours 1–12; 0 or 13+ with a meridiem is
    // malformed rather than something to coerce.
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  }

  if (hours > 23 || minutes > 59) return null;

  const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
  const asIfUtc = Date.UTC(year!, month! - 1, day!, hours, minutes, 0, 0);
  // ET is behind UTC, so the offset is negative and subtracting it moves forward.
  const instant = asIfUtc - etOffsetMinutes(dateString) * 60000;
  return new Date(instant).toISOString();
}

/**
 * The park-local `HH:MM` text for an ISO instant, for seeding the time field
 * when editing an existing Reservation. Returns an empty string for an absent
 * or unparseable value.
 */
export function isoToEtWallClock(iso: string | null | undefined): string {
  if (iso == null || iso.length === 0) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));

  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

/**
 * The park-local 12-hour `H:MM AM/PM` text for an ISO instant, for seeding the
 * Time_Picker when editing an existing Reservation (R3.10). Returns an empty
 * string for an absent or unparseable value, which the picker renders as "no
 * selection" rather than inventing a time the user did not choose.
 */
export function isoToWheelTime(iso: string | null | undefined): string {
  const wallClock = isoToEtWallClock(iso);
  if (wallClock.length === 0) return '';

  const [hourText, minuteText] = wallClock.split(':');
  const hour24 = Number.parseInt(hourText!, 10);
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minuteText} ${meridiem}`;
}

/**
 * A group's date rendered as a readable heading (e.g. `Thu, Oct 1`). Formatted
 * from the calendar date's own components, so it never shifts by a day due to
 * the device's zone.
 */
export function formatGroupDate(dateString: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;
  const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
  const utcNoon = new Date(Date.UTC(year!, month! - 1, day!, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(utcNoon);
}
