/**
 * America/New_York day grouping shared by the member Trip Album and the recipient
 * Recap Album (photo-uploads Requirements 13.8, 15.32, decision D35).
 *
 * Pure: no React, no I/O. Items keep their input order inside a group; groups are
 * ordered by day key, newest day first.
 */

export function getNewYorkDayKey(isoString: string): string {
  const d = new Date(isoString);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

export function formatNewYorkDayHeading(dayKey: string): string {
  const [yearStr, monthStr, dayStr] = dayKey.split('-');
  const year = parseInt(yearStr ?? '2026', 10);
  const month = parseInt(monthStr ?? '1', 10);
  const day = parseInt(dayStr ?? '1', 10);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export interface DayGroup<T> {
  readonly dayKey: string;
  readonly dayHeading: string;
  readonly photos: readonly T[];
}

export function groupBySortAtNewYorkDay<T extends { readonly sortAt: string }>(
  items: readonly T[],
): readonly DayGroup<T>[] {
  const groups: Map<string, T[]> = new Map();
  for (const item of items) {
    const dayKey = getNewYorkDayKey(item.sortAt);
    let list = groups.get(dayKey);
    if (!list) {
      list = [];
      groups.set(dayKey, list);
    }
    list.push(item);
  }

  // Sort dayKeys descending (most recent day first)
  const sortedDayKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
  return sortedDayKeys.map((dayKey) => ({
    dayKey,
    dayHeading: formatNewYorkDayHeading(dayKey),
    photos: groups.get(dayKey) ?? [],
  }));
}
