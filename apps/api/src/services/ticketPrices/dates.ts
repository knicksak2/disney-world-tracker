/**
 * Pure date arithmetic for ticket prices and budget calculations.
 *
 * This is the ONE home of date arithmetic, imported by freshness.ts,
 * resolveTicketPrice.ts, refreshPlanner.ts, typicalPrice.ts, and tripBudget/savingsPlan.ts.
 *
 * Validates: Requirements 11.3, 11.4, 11.14, 5.10
 */

import { wdwToday } from '../trips/wdwClock.js';

const MS_PER_DAY = 86_400_000;

/**
 * Returns signed whole calendar days from `a` to `b` (both `YYYY-MM-DD`).
 *
 * Evaluated at UTC midnight so daylight saving transitions never produce
 * fractional or distorted day counts.
 */
export function daysBetween(a: string, b: string): number {
  const msA = Date.parse(`${a}T00:00:00.000Z`);
  const msB = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((msB - msA) / MS_PER_DAY);
}

/**
 * Returns the calendar date `YYYY-MM-DD` at Walt Disney World (America/New_York)
 * for a given UTC instant.
 */
export function wdwDateOf(instant: Date): string {
  return wdwToday(instant);
}

/**
 * Returns the calendar date `YYYY-MM-DD` exactly `n` whole days from `date` (signed).
 * Evaluated on UTC midnight so DST never affects calendar day arithmetic.
 */
export function addDays(date: string, n: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + n * MS_PER_DAY;
  return new Date(ms).toISOString().split('T')[0]!;
}

/**
 * Anchor a `YYYY-MM-DD` calendar date at 12:00:00.000Z (noon UTC).
 *
 * In America/New_York (UTC-5 EST / UTC-4 EDT), 12:00 UTC is always 07:00 EST or 08:00 EDT
 * on the exact same calendar date, avoiding the previous-day bug of `new Date('YYYY-MM-DD')`.
 * Round 5 L5.
 */
export function dateToInstant(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

