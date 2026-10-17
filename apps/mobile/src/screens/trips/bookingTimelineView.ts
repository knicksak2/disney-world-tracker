/**
 * Pure presentation helpers for Trip Booking Timeline (Task 11.2).
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.14
 */

import { Ionicons } from '@expo/vector-icons';
import {
  checkInOverrideRange,
  formatMonthDay,
  type BookingWindowDTO,
  type BookingSettingsUpdateInput,
  type StayType,
  type LightningLaneTiming,
  type WindowStatus,
} from '@dwt/shared';
import { WDW_TIME_ZONE } from '../catalog/live/parkTime';

export type IoniconName = keyof typeof Ionicons.glyphMap;

export interface SettingsFormValues {
  readonly stayType: StayType | null;
  readonly lightningLaneTiming: LightningLaneTiming | null;
  readonly checkInOverride: string | null;
}

/**
 * Maps window status and whole-day countdown to human-readable label (R6.4).
 *
 * Upcoming:
 * - daysUntilDrop > 1: "Opens in N days"
 * - daysUntilDrop === 1: "Opens tomorrow"
 * - daysUntilDrop === 0: "Opens today"
 * Open: "Open now"
 * Past: null
 */
export function countdownLabel(
  w: Pick<BookingWindowDTO, 'status' | 'daysUntilDrop'>,
): string | null {
  if (w.status === 'upcoming') {
    const days = w.daysUntilDrop;
    if (days === null || days === undefined) return null;
    if (days > 1) return `Opens in ${days} days`;
    if (days === 1) return 'Opens tomorrow';
    return 'Opens today';
  }
  if (w.status === 'open') {
    return 'Open now';
  }
  return null;
}

/**
 * Returns distinct icon and text label for window status (R6.5).
 */
export function statusPresentation(status: WindowStatus): {
  icon: IoniconName;
  label: 'Upcoming' | 'Open' | 'Past';
} {
  switch (status) {
    case 'upcoming':
      return { icon: 'time-outline', label: 'Upcoming' };
    case 'open':
      return { icon: 'lock-open-outline', label: 'Open' };
    case 'past':
      return { icon: 'hourglass-outline', label: 'Past' };
  }
}

/**
 * Returns distinct icon and text label for window done state (R6.5).
 */
export function donePresentation(done: boolean): {
  icon: IoniconName;
  label: 'Done' | 'Not done';
} {
  return done
    ? { icon: 'checkmark-circle', label: 'Done' }
    : { icon: 'ellipse-outline', label: 'Not done' };
}

/**
 * Splits windows into active (upcoming + open) and past groups, preserving order (R6.2).
 */
export function splitWindows(ws: readonly BookingWindowDTO[]): {
  active: BookingWindowDTO[];
  past: BookingWindowDTO[];
} {
  const active: BookingWindowDTO[] = [];
  const past: BookingWindowDTO[] = [];
  for (const w of ws) {
    if (w.status === 'past') {
      past.push(w);
    } else {
      active.push(w);
    }
  }
  return { active, past };
}

/**
 * Formats a drop instant in America/New_York as "Sat, Jun 1 · 6:00 AM ET".
 */
export function formatDropMoment(dropAt: string): string {
  const date = new Date(dropAt);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';

  return `${weekday}, ${month} ${day} · ${hour}:${minute} ${dayPeriod} ET`;
}

/**
 * Returns source label for display in settings summary card (R6.7).
 */
export function sourceLabel(
  source: 'auto' | 'trip_start' | 'override',
): 'Detected automatically' | 'Set by an Organizer' {
  return source === 'override' ? 'Set by an Organizer' : 'Detected automatically';
}

/**
 * Computes the delta payload between stored and draft settings, returning only differing fields (R6.8).
 */
export function pickChangedSettings(
  stored: SettingsFormValues,
  draft: SettingsFormValues,
): BookingSettingsUpdateInput {
  const diff: Record<string, unknown> = {};
  if (draft.stayType !== stored.stayType) {
    diff.stayType = draft.stayType;
  }
  if (draft.lightningLaneTiming !== stored.lightningLaneTiming) {
    diff.lightningLaneTiming = draft.lightningLaneTiming;
  }
  if (draft.checkInOverride !== stored.checkInOverride) {
    diff.checkInOverride = draft.checkInOverride;
  }
  return diff as BookingSettingsUpdateInput;
}

/**
 * Returns allowed check-in date range text, e.g. "Choose a date from Jun 1 to Jul 1" (R6.14).
 */
export function checkInRangeText(tripStart: string): string {
  const { min, max } = checkInOverrideRange(tripStart);
  return `Choose a date from ${formatMonthDay(min)} to ${formatMonthDay(max)}`;
}
