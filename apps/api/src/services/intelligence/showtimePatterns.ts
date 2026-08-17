/**
 * Pure derivation of historical showtime patterns (crowd-calendar R12).
 *
 * WDW-local time conversions come from the shared `wdwClock` rather than a
 * private copy — see the "Reuse these" steering note. Re-exported here for the
 * modules that consume them alongside this derivation.
 */

import {
  wdwDayOfWeek as getETDayOfWeek,
  wdwIsoAtMinutes as minutesFromMidnightETToISO,
  wdwMinutesFromMidnight as isoInstantToMinutesFromMidnightET,
  wdwOffsetMinutes as getETOffsetMinutes,
} from '../trips/wdwClock.js';

export { getETDayOfWeek, getETOffsetMinutes, isoInstantToMinutesFromMidnightET, minutesFromMidnightETToISO };

export const SHOWTIME_PATTERN_WINDOW_DAYS = 180;
export const SHOWTIME_PATTERN_MIN_SAMPLES = 3;
export const SHOWTIME_PATTERN_MIN_FREQUENCY = 0.5;

export interface RawShowtimeSignal {
  readonly experience_id: string;
  readonly date: string; // YYYY-MM-DD
  readonly showtimes: unknown; // Raw upstream objects, projected objects, or ISO strings
}

export interface DerivedShowTimePattern {
  readonly experience_id: string;
  readonly day_of_week: number; // 0 = Sunday, 6 = Saturday (Eastern Time)
  readonly start_minutes: number; // Minutes from midnight ET (0-1440), bucketed to 5m
  readonly frequency: number;
  readonly sample_count: number;
}

/**
 * Normalizes an array of showtime entries across all 3 shapes in the codebase:
 *   1. Raw upstream object: `{ startTime: string, endTime?: string, type?: string }` (stored in DB)
 *   2. Projected object: `{ start: string, ... }` (Showtime in LiveDetail.ts)
 *   3. Bare ISO string: `'2026-08-17T14:45:00.000Z'` or offset string `'2026-08-17T10:45:00-04:00'`
 *
 * Emits canonical UTC ISO instants (`.toISOString()`), sorted ascending.
 * Non-arrays yield `{ instants: [], skipped: 0 }`. Unparseable entries increment `skipped`.
 */
export function normalizeShowtimeEntries(raw: unknown): { instants: string[]; skipped: number } {
  if (!Array.isArray(raw)) {
    return { instants: [], skipped: 0 };
  }

  const instants: string[] = [];
  let skipped = 0;

  for (const entry of raw) {
    let candidate: unknown;
    if (typeof entry === 'string') {
      candidate = entry;
    } else if (entry !== null && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      if (typeof obj['startTime'] === 'string') {
        candidate = obj['startTime'];
      } else if (typeof obj['start'] === 'string') {
        candidate = obj['start'];
      }
    }

    if (typeof candidate !== 'string' || candidate.trim() === '') {
      skipped++;
      continue;
    }

    const d = new Date(candidate);
    if (Number.isNaN(d.getTime())) {
      skipped++;
      continue;
    }

    instants.push(d.toISOString());
  }

  instants.sort((a, b) => a.localeCompare(b));

  return { instants, skipped };
}

/**
 * Bucket minutes from midnight to nearest 5 minutes.
 */
export function bucketStartMinutes(minutes: number): number {
  return Math.max(0, Math.min(1440, Math.round(minutes / 5) * 5));
}

/**
 * Derive typical showtime patterns from historical daily signals across trailing days.
 */
export function deriveShowTimePatterns(signals: readonly RawShowtimeSignal[], logger?: any): DerivedShowTimePattern[] {
  // 1. Group signals by (experience_id, day_of_week)
  const grouped = new Map<string, { experience_id: string; day_of_week: number; dates: Map<string, Set<number>> }>();

  for (const sig of signals) {
    const { instants, skipped } = normalizeShowtimeEntries(sig.showtimes);
    if (skipped > 0 && logger?.warn) {
      logger.warn({ experience_id: sig.experience_id, date: sig.date, skipped }, `deriveShowTimePatterns skipped ${skipped} unparseable showtime entries`);
    }
    if (instants.length === 0) {
      continue;
    }
    const dow = getETDayOfWeek(sig.date);
    const groupKey = `${sig.experience_id}:${dow}`;

    let entry = grouped.get(groupKey);
    if (!entry) {
      entry = { experience_id: sig.experience_id, day_of_week: dow, dates: new Map() };
      grouped.set(groupKey, entry);
    }

    let bucketsForDate = entry.dates.get(sig.date);
    if (!bucketsForDate) {
      bucketsForDate = new Set<number>();
      entry.dates.set(sig.date, bucketsForDate);
    }

    for (const isoStr of instants) {
      const rawMins = isoInstantToMinutesFromMidnightET(sig.date, isoStr);
      if (Number.isNaN(rawMins) || rawMins < 0 || rawMins > 1440) continue;
      const bucket = bucketStartMinutes(rawMins);
      bucketsForDate.add(bucket);
    }
  }

  const results: DerivedShowTimePattern[] = [];

  for (const { experience_id, day_of_week, dates } of grouped.values()) {
    const totalObservedDates = dates.size;
    if (totalObservedDates < SHOWTIME_PATTERN_MIN_SAMPLES) {
      continue;
    }

    const bucketCounts = new Map<number, number>();
    for (const bucketSet of dates.values()) {
      for (const bucket of bucketSet) {
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      }
    }

    for (const [start_minutes, sample_count] of bucketCounts.entries()) {
      const frequency = sample_count / totalObservedDates;
      if (sample_count >= SHOWTIME_PATTERN_MIN_SAMPLES && frequency >= SHOWTIME_PATTERN_MIN_FREQUENCY) {
        results.push({
          experience_id,
          day_of_week,
          start_minutes,
          frequency,
          sample_count,
        });
      }
    }
  }

  // Sort deterministically by (experience_id, day_of_week, start_minutes)
  return results.sort((a, b) => {
    if (a.experience_id !== b.experience_id) return a.experience_id.localeCompare(b.experience_id);
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return a.start_minutes - b.start_minutes;
  });
}
