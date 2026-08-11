/**
 * Pure math for wait times and crowd indices.
 * Property-testable, no I/O.
 */

import type { ThemeParksLiveEntry } from '../live/themeParksLiveClient.js';

/**
 * Applies an Exponential Moving Average (EMA) update.
 * @param prev The previous EMA value.
 * @param sample The new observation.
 * @param weight The EMA weight (alpha), e.g. 2 / (N + 1).
 */
export function applyEma(prev: number, sample: number, weight: number): number {
  return prev + weight * (sample - prev);
}

/**
 * Updates the streaming variance using EMA.
 * The standard deviation is the square root of this variance.
 */
export function emaVariance(
  prevVariance: number,
  prevMean: number,
  sample: number,
  weight: number
): number {
  // Welford-like EMA variance update
  return (1 - weight) * (prevVariance + weight * Math.pow(sample - prevMean, 2));
}

/**
 * Normalizes a daily average wait into a continuous crowd index.
 * For example, scaling relative to the park's all-time distribution.
 * For simplicity as a starting formula, we can assume a linear mapping based
 * on known park distribution min/max or typical values.
 */
export function normalizeCrowdIndex(
  dailyAvg: number,
  parkDistribution: { typical: number; maxTypical: number }
): number {
  if (parkDistribution.typical <= 0) return 1.0;
  // A simple continuous index centered around 5.0 for the typical day
  // bounded loosely. We'll map dailyAvg / typical roughly to 1-10.
  // Using 1.0 = typical (from formula: 1.0 = typical day).
  // Wait, the spec says featureModel typical is a continuous baseline or 1.0.
  // Let's normalize such that dailyAvg == typical -> 1.0
  const continuous = dailyAvg / parkDistribution.typical;
  return continuous;
}

/**
 * Computes the crowd multiplier from continuous indices.
 * @param forecastContinuous The forecast (or observed) continuous index.
 * @param typicalContinuous The typical continuous index for this park/day-of-week.
 */
export function crowdMultiplier(
  forecastContinuous: number,
  typicalContinuous: number
): number {
  if (typicalContinuous <= 0) return 1.0;
  const ratio = forecastContinuous / typicalContinuous;
  return Math.max(0.4, Math.min(2.0, ratio));
}

/**
 * Maps a continuous crowd index to a 1-10 display integer.
 * This is the ONLY place where quantization occurs.
 */
export function displayLevel(continuousIndex: number): number {
  // Assuming continuousIndex 1.0 = typical (middle, ~5)
  // Let's map continuousIndex to [1, 10].
  // E.g., if continuousIndex is 1.0, level is 5.
  // If continuous = 2.0, level = 10.
  // Formula: level = 5 * continuousIndex
  const scaled = Math.round(5 * continuousIndex);
  return Math.max(1, Math.min(10, scaled));
}

export interface SeasonBucket {
  wait: number;
  sampleCount: number;
}

export interface ShapeBucket {
  wait: number;
}

/**
 * Selects the most specific reliable tier for a wait prediction.
 */
export function selectTier(
  seasonBucket: SeasonBucket | null | undefined,
  shapeBucket: ShapeBucket | null | undefined,
  parkTypical: number,
  crowdMultiplier: number,
  threshold: number = 30
): number {
  if (seasonBucket && seasonBucket.sampleCount >= threshold) {
    return seasonBucket.wait;
  }
  if (shapeBucket && shapeBucket.wait > 0) {
    return shapeBucket.wait * crowdMultiplier;
  }
  return parkTypical * crowdMultiplier;
}

/**
 * Computes the bounded weather adjustment multiplier.
 */
export function weatherAdjustment(
  sensitivity: number | null | undefined,
  forecastCondition: string | null | undefined
): number {
  if (!sensitivity || !forecastCondition) {
    return 1.0; // Out of horizon or no sensitivity known
  }
  return Math.max(0.75, Math.min(1.25, sensitivity));
}

// ---------------------------------------------------------------------------
// Standby-basket crowd-index refinement (R2.7 / R2.8)
// ---------------------------------------------------------------------------

/**
 * Minimum Ride_Shape sample_count before a ride is eligible for the
 * per-ride-relative crowd index. Below this threshold the shape is too
 * noisy to divide by.
 */
export const CROWD_INDEX_MIN_SHAPE_SAMPLES = 5;

/**
 * Minimum expected wait (minutes) from the Ride_Shape before a ride is
 * included in the per-ride-relative index. A ride whose shape shows
 * < 5 min expected produces wild ratios (e.g. observed 20 / expected 2
 * = 10×) that would dominate the mean.
 */
const CROWD_INDEX_MIN_EXPECTED_MINUTES = 5;

/**
 * Per-ride observed/expected ratio is clamped to [0, MAX_RIDE_RATIO] so
 * one ride with a small expected can't dominate the park's mean index.
 */
const MAX_RIDE_RATIO = 5.0;

/**
 * Input shape for a single ride in the per-ride-relative crowd index.
 * `observed` is the current posted standby wait; `expected` is the
 * Ride_Shape's avg_wait_minutes for this (day_of_week, hour); `sampleCount`
 * is the shape bucket's sample_count.
 */
export interface RelativeCrowdRide {
  observed: number;
  expected: number;
  sampleCount: number;
}

/**
 * True iff a ThemeParks live entry is operating AND exposes a numeric
 * STANDBY queue wait (walk-on 0 included). False for non-operating entries
 * or any entry with no STANDBY queue (shows, dining, parades, walk-through
 * experiences without a posted standby line).
 *
 * Used to gate both the `wait_samples` insert and the crowd-index basket.
 * Pure — no I/O.
 */
export function isStandbyBasketEntry(entry: ThemeParksLiveEntry): boolean {
  if (entry.status !== 'OPERATING') return false;
  const waitTime = entry.queue?.STANDBY?.waitTime;
  return typeof waitTime === 'number' && !Number.isNaN(waitTime);
}

/**
 * Per-ride-relative crowd index: the mean of each ride's
 * `observed / expected` ratio, over basket-eligible rides.
 *
 * A ride is excluded when:
 *   - its Ride_Shape sample_count < CROWD_INDEX_MIN_SHAPE_SAMPLES (too noisy)
 *   - its expected <= 0 (no meaningful baseline)
 *   - its expected < CROWD_INDEX_MIN_EXPECTED_MINUTES (ratio too volatile)
 *
 * Each included ride's ratio is clamped to [0, MAX_RIDE_RATIO] so a single
 * ride with a small expected can't dominate the mean.
 *
 * Returns 1.0 when every included ride sits at its expected wait.
 * Returns NaN when the eligible basket is empty — callers MUST check
 * `Number.isNaN(result)` and skip writing the index slice.
 */
export function relativeCrowdIndex(rides: readonly RelativeCrowdRide[]): number {
  let sum = 0;
  let count = 0;

  for (const ride of rides) {
    if (ride.sampleCount < CROWD_INDEX_MIN_SHAPE_SAMPLES) continue;
    if (ride.expected <= 0) continue;
    if (ride.expected < CROWD_INDEX_MIN_EXPECTED_MINUTES) continue;

    const ratio = Math.min(ride.observed / ride.expected, MAX_RIDE_RATIO);
    // observed can be 0 (walk-on), so ratio can be 0 — that's a valid
    // low-crowd signal. Clamp floor is 0 (already guaranteed since
    // observed >= 0 and expected > 0).
    sum += Math.max(0, ratio);
    count++;
  }

  if (count === 0) return NaN;
  return sum / count;
}
