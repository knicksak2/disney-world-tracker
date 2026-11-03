/**
 * Typical price derivation for Lightning Lane Multi Pass, Premier Pass, and Single Pass.
 *
 * Validates: Requirements 15.7, 15.8
 */

import { wdwDayOfWeek } from '../trips/wdwClock.js';
import { daysBetween } from '../ticketPrices/dates.js';

export type TypicalResult =
  | {
      priceCents: number;
      sampleCount: number;
      basis: 'weekday_month' | 'weekday';
      newestSampleDate: string;
    }
  | {
      priceCents: null;
      reason: 'no_estimate';
    };

/**
 * Calculates the median of an array of integer cents.
 * Odd count: middle element of sorted array.
 * Even count: Math.round((a + b) / 2) of the two middle elements.
 */
export function medianCents(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('medianCents requires at least one value');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Derives the typical Lightning Lane price from historical samples.
 *
 * Filtering:
 * - date < today AND daysBetween(date, today) <= lookbackDays AND daysBetween(date, today) > 0
 *
 * Steps:
 * 1. Filter by same wdwDayOfWeek and same calendar month (MM). If >= minSamples, return median with basis 'weekday_month'.
 * 2. Filter by same wdwDayOfWeek only. If >= minSamples, return median with basis 'weekday'.
 * 3. Otherwise return { priceCents: null, reason: 'no_estimate' }.
 *
 * newestSampleDate is the maximum date string of the chosen basis subset (round 4 L4).
 */
export function typicalLlPrice(
  history: readonly { date: string; cents: number }[],
  target: { date: string },
  today: string,
  cfg: { lookbackDays: number; minSamples: number },
): TypicalResult {
  // Filter history: strictly before today, and within lookback window
  const eligible = history.filter((row) => {
    if (row.date >= today) return false;
    const diff = daysBetween(row.date, today);
    return diff > 0 && diff <= cfg.lookbackDays;
  });

  if (eligible.length < cfg.minSamples) {
    return { priceCents: null, reason: 'no_estimate' };
  }

  const targetWeekday = wdwDayOfWeek(target.date);
  const targetMonth = target.date.slice(5, 7);

  // Step 1: same weekday and same month
  const step1Samples = eligible.filter(
    (row) =>
      wdwDayOfWeek(row.date) === targetWeekday &&
      row.date.slice(5, 7) === targetMonth,
  );

  if (step1Samples.length >= cfg.minSamples) {
    let newest = step1Samples[0]!.date;
    for (const s of step1Samples) {
      if (s.date > newest) newest = s.date;
    }
    return {
      priceCents: medianCents(step1Samples.map((s) => s.cents)),
      sampleCount: step1Samples.length,
      basis: 'weekday_month',
      newestSampleDate: newest,
    };
  }

  // Step 2: same weekday only
  const step2Samples = eligible.filter(
    (row) => wdwDayOfWeek(row.date) === targetWeekday,
  );

  if (step2Samples.length >= cfg.minSamples) {
    let newest = step2Samples[0]!.date;
    for (const s of step2Samples) {
      if (s.date > newest) newest = s.date;
    }
    return {
      priceCents: medianCents(step2Samples.map((s) => s.cents)),
      sampleCount: step2Samples.length,
      basis: 'weekday',
      newestSampleDate: newest,
    };
  }

  return { priceCents: null, reason: 'no_estimate' };
}

