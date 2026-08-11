/**
 * Pure math for crowd forecasting.
 */

export interface ForecastFeatures {
  typicalContinuous: number;
  llMultipassPrice?: number | null;
  trailingMedianPrice?: number | null;
  openHours: number;
  typicalOpenHours: number;
  extendedEvening: boolean;
  seasonalPriorValue: number;
  historyEstimate?: number | null;
  comparableSampleCount: number;
  biasCorrection: number; // Applied directly (clamped later)
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes the forecast index based on available features.
 */
export function forecastIndex(features: ForecastFeatures): number {
  let llMultiplier = 1.0;
  if (features.llMultipassPrice && features.trailingMedianPrice && features.trailingMedianPrice > 0) {
    llMultiplier = clamp(features.llMultipassPrice / features.trailingMedianPrice, 0.7, 1.4);
  }

  let hoursMultiplier = 1.0;
  if (features.typicalOpenHours > 0) {
    hoursMultiplier = clamp(features.openHours / features.typicalOpenHours, 0.9, 1.2);
  }

  const eveningMultiplier = features.extendedEvening ? 1.1 : 1.0;

  const featureModel = features.typicalContinuous
    * llMultiplier
    * hoursMultiplier
    * eveningMultiplier
    * features.seasonalPriorValue;

  let finalForecast = featureModel;

  if (features.historyEstimate != null && features.historyEstimate > 0) {
    const w = Math.min(1.0, features.comparableSampleCount / 20);
    finalForecast = w * features.historyEstimate + (1 - w) * featureModel;
  }

  // Apply bias correction. The bias correction should be clamped ±0.5
  const correction = clamp(features.biasCorrection, -0.5, 0.5);
  finalForecast = finalForecast - correction;

  // Clamped to [0.4, 3.0]
  return clamp(finalForecast, 0.4, 3.0);
}

/** Default calendar-proximity window for historical comparable selection (±days). */
export const COMPARABLE_DAY_WINDOW = 7;

/** Minimum same-day-of-week samples to prefer dow-filtered comparables. */
const MIN_DOW_SAMPLES = 3;

export interface ComparableHistoryRow {
  date: Date;
  crowd_index: number;
}

/**
 * Selects crowd_index values from history that fall within ±windowDays
 * of the target date's day-of-year, wrapping the Dec↔Jan boundary.
 * Prefers same-day-of-week rows when enough remain (≥ MIN_DOW_SAMPLES).
 *
 * Pure — no I/O.
 */
export function selectComparableIndices(
  targetDate: Date,
  history: ComparableHistoryRow[],
  windowDays: number = COMPARABLE_DAY_WINDOW,
): number[] {
  if (history.length === 0) return [];

  const targetDoy = dayOfYear(targetDate);
  const targetDow = targetDate.getDay(); // 0-6

  // Filter to rows within the calendar-proximity window (wrapping year boundary)
  const inWindow = history.filter(row => {
    const rowDoy = dayOfYear(row.date);
    return doyDistance(targetDoy, rowDoy) <= windowDays;
  });

  if (inWindow.length === 0) return [];

  // Prefer same day-of-week when enough samples remain
  const sameDow = inWindow.filter(row => row.date.getDay() === targetDow);
  const selected = sameDow.length >= MIN_DOW_SAMPLES ? sameDow : inWindow;

  return selected.map(r => r.crowd_index);
}

/** 1-based day-of-year (Jan 1 = 1, Dec 31 = 365/366). */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

/** Circular distance between two day-of-year values on a 365-day ring. */
function doyDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 365 - diff);
}
