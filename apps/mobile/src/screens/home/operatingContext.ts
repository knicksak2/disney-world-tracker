/**
 * Pure derivation core for the Home tab operating context subtitle.
 * (Requirement 2.6, Correctness Property 9, design.md Section 12)
 *
 * Never fabricates values; omits missing hours or weather segments rather
 * than substituting placeholders.
 */

import type { Park } from '@dwt/shared';

export const WDW_TIME_ZONE = 'America/New_York';

export interface OperatingContextInputs {
  readonly park: Park;
  readonly parkHours?: { readonly openTime?: string | undefined; readonly closeTime?: string | undefined } | undefined;
  readonly weather?: { readonly tempF: number; readonly condition: string } | null | undefined;
  readonly dayContext?: { readonly currentDay: number; readonly totalDays: number } | string | undefined;
}

/**
 * Format an ISO timestamp or human time string to 'h:mm A' in Eastern time.
 * Returns null if unparseable or empty.
 */
export function formatTime(timeStr?: string | null): string | null {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // If already in 12-hour format with AM/PM (e.g., '8:00 AM', '11:00 PM')
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, ' ').toUpperCase();
  }

  try {
    const date = new Date(trimmed);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: WDW_TIME_ZONE,
    });
  } catch {
    return null;
  }
}

/**
 * Format a weather object to '${temp}° ${condition}'.
 * Returns null if weather is null, undefined, or missing finite temperature.
 */
export function formatWeather(
  weather?: { readonly tempF: number; readonly condition: string } | null,
): string | null {
  if (!weather || typeof weather !== 'object') return null;
  if (typeof weather.tempF !== 'number' || !Number.isFinite(weather.tempF)) return null;

  const temp = Math.round(weather.tempF);
  const condition = typeof weather.condition === 'string' ? weather.condition.trim() : '';
  return condition ? `${temp}° ${condition}` : `${temp}°`;
}

/**
 * Format day-count context to 'Day ${currentDay} of ${totalDays}'.
 * Returns null if dayContext is undefined, null, or invalid.
 */
export function formatDayContext(
  dayContext?: { readonly currentDay: number; readonly totalDays: number } | string | null | undefined,
): string | null {
  if (!dayContext) return null;
  if (typeof dayContext === 'string') {
    const trimmed = dayContext.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof dayContext === 'object') {
    const { currentDay, totalDays } = dayContext;
    if (
      typeof currentDay === 'number' &&
      Number.isFinite(currentDay) &&
      typeof totalDays === 'number' &&
      Number.isFinite(totalDays) &&
      totalDays >= 1
    ) {
      return `Day ${currentDay} of ${totalDays}`;
    }
  }
  return null;
}

/**
 * Builds the Home header's operating-context subtitle from only the fields
 * present in the query results (R2.6). Never fabricates a value; omits
 * missing segments (hours, weather, day context) entirely (R2.6, Property 9).
 */
export function buildOperatingContextSubtitle(inputs: OperatingContextInputs): string {
  if (!inputs || typeof inputs !== 'object') {
    return 'Magic Kingdom';
  }
  const park = inputs.park ?? 'Magic Kingdom';
  const daySegment = formatDayContext(inputs.dayContext);
  const open = formatTime(inputs.parkHours?.openTime);
  const close = formatTime(inputs.parkHours?.closeTime);

  let hoursSegment: string | null = null;
  if (open && close) {
    hoursSegment = `${open} – ${close}`;
  } else if (open) {
    hoursSegment = open;
  } else if (close) {
    hoursSegment = close;
  }

  const weatherSegment = formatWeather(inputs.weather);

  const segments: string[] = [park];
  if (daySegment) {
    segments.push(daySegment);
  }
  if (hoursSegment) {
    segments.push(hoursSegment);
  }
  if (weatherSegment) {
    segments.push(weatherSegment);
  }

  return segments.join(' • ');
}
