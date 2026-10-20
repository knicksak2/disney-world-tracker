import { wdwToday } from '../../trips/wdwClock.js';

export interface RecapHighlightPhoto {
  id: string;
  sortAt: Date;
}

export function selectRecapHighlights<T extends RecapHighlightPhoto>(
  photos: ReadonlyArray<T>,
  max: number
): T[] {
  if (photos.length === 0 || max <= 0) {
    return [];
  }

  // Group by America/New_York day (YYYY-MM-DD)
  const byDay = new Map<string, T>();

  for (const photo of photos) {
    const day = wdwToday(photo.sortAt);
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, photo);
    } else {
      const existingTime = existing.sortAt.getTime();
      const photoTime = photo.sortAt.getTime();
      if (photoTime < existingTime || (photoTime === existingTime && photo.id < existing.id)) {
        byDay.set(day, photo);
      }
    }
  }

  // Sort distinct days ascending
  const sortedDays = Array.from(byDay.keys()).sort();

  // Keep first `max` days
  const chosenDays = sortedDays.slice(0, max);

  return chosenDays.map((day) => byDay.get(day)!);
}
