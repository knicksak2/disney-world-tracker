/**
 * Pure calculation and conversions for historical showtime pattern derivation (crowd-calendar R12).
 */

export const SHOWTIME_PATTERN_WINDOW_DAYS = 180;
export const SHOWTIME_PATTERN_MIN_SAMPLES = 3;
export const SHOWTIME_PATTERN_MIN_FREQUENCY = 0.5;

export interface RawShowtimeSignal {
  readonly experience_id: string;
  readonly date: string; // YYYY-MM-DD
  readonly showtimes: readonly string[]; // Canonical ISO instant strings
}

export interface DerivedShowTimePattern {
  readonly experience_id: string;
  readonly day_of_week: number; // 0 = Sunday, 6 = Saturday (Eastern Time)
  readonly start_minutes: number; // Minutes from midnight ET (0-1440), bucketed to 5m
  readonly frequency: number;
  readonly sample_count: number;
}

/**
 * Get Eastern Time offset in minutes (-240 for EDT, -300 for EST).
 */
export function getETOffsetMinutes(dateStringOrInstant: string | Date): number {
  const targetDate = typeof dateStringOrInstant === 'string'
    ? (dateStringOrInstant.includes('T') ? new Date(dateStringOrInstant) : new Date(`${dateStringOrInstant}T12:00:00Z`))
    : dateStringOrInstant;
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(targetDate);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
  if (tzPart) {
    const match = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (match) {
      const hours = parseInt(match[1]!, 10);
      const mins = match[2] ? parseInt(match[2], 10) : 0;
      return hours * 60 + (hours < 0 ? -mins : mins);
    }
  }
  const str = targetDate.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
  return str.includes('EDT') || str.includes('GMT-4') ? -240 : -300;
}

/**
 * Convert a canonical ISO instant string to minutes from midnight ET on that date.
 */
export function isoInstantToMinutesFromMidnightET(dateString: string, isoStr: string): number {
  const targetTime = new Date(isoStr).getTime();
  const offsetMins = getETOffsetMinutes(dateString);
  const d = new Date(`${dateString}T00:00:00Z`);
  const midnightET_UTC = d.getTime() - offsetMins * 60000;
  return Math.round((targetTime - midnightET_UTC) / 60000);
}

/**
 * Convert minutes from midnight ET back to an ISO instant on the specified date.
 */
export function minutesFromMidnightETToISO(dateString: string, minutesFromMidnightET: number): string {
  const offsetMins = getETOffsetMinutes(dateString);
  const d = new Date(`${dateString}T00:00:00Z`);
  const targetUTC = d.getTime() - offsetMins * 60000 + minutesFromMidnightET * 60000;
  return new Date(targetUTC).toISOString();
}

/**
 * Derive 0-6 weekday in America/New_York (0 = Sunday, ..., 6 = Saturday).
 */
export function getETDayOfWeek(dateString: string): number {
  const d = new Date(`${dateString}T12:00:00-04:00`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const dayStr = formatter.format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[dayStr] ?? d.getUTCDay();
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
export function deriveShowTimePatterns(signals: readonly RawShowtimeSignal[]): DerivedShowTimePattern[] {
  // 1. Group signals by (experience_id, day_of_week)
  const grouped = new Map<string, { experience_id: string; day_of_week: number; dates: Map<string, Set<number>> }>();

  for (const sig of signals) {
    if (!sig.showtimes || !Array.isArray(sig.showtimes) || sig.showtimes.length === 0) {
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

    for (const isoStr of sig.showtimes) {
      if (typeof isoStr !== 'string') continue;
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
