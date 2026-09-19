/**
 * Pure calculation logic for vacation countdown.
 *
 * Implements Task 15.1 (Requirements 2.1).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculates the number of days until an upcoming trip begins.
 * Returns 0 if the trip has already started or begins today.
 */
export function calculateCountdownDays(
  startDateInput: string | Date,
  now: Date = new Date(),
): number {
  const start =
    typeof startDateInput === 'string' ? new Date(startDateInput) : startDateInput;

  if (Number.isNaN(start.getTime())) {
    return 0;
  }

  // Normalize both dates to UTC midnight for day-level granularity
  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const nowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const diffMs = startUtc - nowUtc;
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / MS_PER_DAY);
}
