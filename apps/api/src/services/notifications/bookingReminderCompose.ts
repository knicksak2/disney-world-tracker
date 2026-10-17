import {
  BOOKING_REMINDER_BODY_MAX,
  BOOKING_RULES,
  WINDOW_KINDS,
  formatDateRange,
  type ReminderLead,
  type WindowKind,
} from '@dwt/shared';

export const REMINDER_TITLES: Record<ReminderLead, string> = {
  eve: 'Booking window opens tomorrow',
  open: 'Booking window is open',
  week: 'Booking window in 7 days',
};

export interface TripBookingReminderEventWindow {
  readonly kind: WindowKind;
  readonly dropAt: string;
  readonly firstCovered: string;
  readonly lastCovered: string;
}

export interface TripBookingReminderEvent {
  readonly tripId: string;
  readonly tripName: string;
  readonly lead: ReminderLead;
  readonly windows: readonly TripBookingReminderEventWindow[];
  readonly dispatchedAt: string;
}

export interface ComposedBookingReminder {
  readonly title: string;
  readonly body: string;
}

/**
 * Formats minutes from midnight into 12-hour 'h:mm AM/PM' string.
 * e.g. 360 -> '6:00 AM', 420 -> '7:00 AM'
 */
export function formatClock12(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${period}`;
}

/**
 * Slices a string to at most maxLen characters without splitting surrogate pairs.
 */
export function sliceSafe(str: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  let result = '';
  for (const char of str) {
    if (result.length + char.length > maxLen) {
      break;
    }
    result += char;
  }
  return result;
}

function formatKindsLabel(kinds: readonly WindowKind[]): string {
  const hasDining = kinds.includes('dining');
  const hasLL = kinds.includes('lightning_lane');
  if (hasDining && hasLL) return 'Dining & Lightning Lane';
  if (hasDining) return 'Dining';
  if (hasLL) return 'Lightning Lane';
  return '';
}

/**
 * R9.6, R7.6: Pure composition of booking reminder push notifications.
 * Title follows the lead. Body is at most 100 characters.
 * Prepends "Opened at <h:mm AM/PM>: " iff some listed window has dropAt <= dispatchedAt.
 * Truncates Trip name first (with '…'), drops Trip name if it cannot fit,
 * and only truncates the whole body if it still exceeds 100 characters without the name.
 */
export function composeBookingReminder(
  event: TripBookingReminderEvent | (Omit<TripBookingReminderEvent, 'dispatchedAt'> & { dispatchedAt?: string }),
  dispatchedAtOverride?: string
): ComposedBookingReminder {
  const title = REMINDER_TITLES[event.lead];

  const dispatchInstant = dispatchedAtOverride ?? event.dispatchedAt ?? new Date().toISOString();
  const dispatchMs = Date.parse(dispatchInstant);

  // Check if any window has opened (dropAt <= dispatchedAt)
  const openedWindows = event.windows.filter(w => Date.parse(w.dropAt) <= dispatchMs);
  let prefix = '';
  if (openedWindows.length > 0) {
    const earliestOpened = openedWindows.slice().sort(
      (a, b) =>
        a.dropAt.localeCompare(b.dropAt) ||
        WINDOW_KINDS.indexOf(a.kind) - WINDOW_KINDS.indexOf(b.kind)
    )[0]!;
    const dropMinutes = BOOKING_RULES[earliestOpened.kind].dropMinutes;
    prefix = `Opened at ${formatClock12(dropMinutes)}: `;
  }

  const kinds = [...new Set(event.windows.map(w => w.kind))];
  const kindsLabel = formatKindsLabel(kinds);

  const minFirst = event.windows.map(w => w.firstCovered).sort()[0]!;
  const maxLast = event.windows.map(w => w.lastCovered).sort().reverse()[0]!;
  const dateRange = formatDateRange(minFirst, maxLast);

  const base = `${prefix}${kindsLabel} for ${dateRange}`;
  const tripName = (event.tripName || '').trim();

  let body: string;
  if (tripName.length === 0) {
    body = base.length <= BOOKING_REMINDER_BODY_MAX ? base : sliceSafe(base, BOOKING_REMINDER_BODY_MAX);
  } else {
    const full = `${base} · ${tripName}`;
    if (full.length <= BOOKING_REMINDER_BODY_MAX) {
      body = full;
    } else {
      // Truncate name first with trailing ellipsis
      // Base + ' · ' + ellipsis requires base.length + 4 characters
      const availableForName = BOOKING_REMINDER_BODY_MAX - base.length - 4;
      if (availableForName >= 1) {
        const truncatedName = sliceSafe(tripName, availableForName);
        if (truncatedName.length > 0) {
          body = `${base} · ${truncatedName}…`;
        } else {
          body = base.length <= BOOKING_REMINDER_BODY_MAX ? base : sliceSafe(base, BOOKING_REMINDER_BODY_MAX);
        }
      } else {
        body = base.length <= BOOKING_REMINDER_BODY_MAX ? base : sliceSafe(base, BOOKING_REMINDER_BODY_MAX);
      }
    }
  }

  return { title, body };
}
