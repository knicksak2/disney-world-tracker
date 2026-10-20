// Feature: photo-uploads, Task 22.7 — pure formatting helpers shared by the
// Trip Summary screen and the shared Trip Recap screen (Requirement 15.23).

/** Mean rating shown to one decimal at most; an em dash for a non-finite value. */
export function formatMeanRating(mean: number): string {
  if (!Number.isFinite(mean)) {
    return '—';
  }
  const rounded = Math.round(mean * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "1 rating" / "N ratings". */
export function ratingCountLabel(count: number): string {
  return count === 1 ? '1 rating' : `${count} ratings`;
}

/**
 * Whole-number itinerary percentage, clamped to 100. An empty plan reads as 100
 * (the ring is not shown then; kept for parity with the Summary screen).
 */
export function itineraryPercent(completed: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100;
}

/** True when a non-empty plan is fully completed. */
export function isItineraryComplete(completed: number, total: number): boolean {
  return total > 0 && completed >= total;
}
