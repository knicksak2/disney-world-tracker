/**
 * Pure weather-sensitivity learning. No I/O — property-testable.
 *
 * Turns per-condition observed average waits (from joining `wait_samples` to
 * `weather_observations`) into a per-condition wait multiplier relative to the
 * clear-sky baseline. The prediction path (`waitMath.weatherAdjustment`) further
 * clamps the stored multiplier to [0.75, 1.25] at apply time and treats a missing
 * condition as a 1.0 no-op — so we deliberately write NO row for the baseline
 * condition, and omit any condition that hasn't accumulated enough observations
 * yet (a multiplier learned from a handful of samples is noise, not signal).
 */

export interface ConditionWaitAggregate {
  readonly condition: string;
  readonly avgWait: number;
  readonly sampleCount: number;
}

export interface WeatherSensitivity {
  readonly condition: string;
  readonly waitMultiplier: number;
  readonly sampleCount: number;
}

/** All other conditions are measured relative to this one. */
export const WEATHER_BASELINE_CONDITION = 'clear';
/** Minimum observations required in BOTH the baseline and a condition before its multiplier is trusted. */
export const WEATHER_MIN_SAMPLES = 20;
/**
 * Storage bounds for the learned ratio. Kept wider than the apply-time clamp in
 * `weatherAdjustment` ([0.75, 1.25]) so the continuous internal value isn't
 * pre-flattened, while still rejecting absurd ratios from thin/degenerate data.
 */
export const WEATHER_MULTIPLIER_MIN = 0.5;
export const WEATHER_MULTIPLIER_MAX = 2.0;

/**
 * Compute per-condition wait multipliers for a single Experience.
 * Returns an empty list when the baseline is missing or under-sampled, and omits
 * any individual condition that is under-sampled. Never returns a baseline row.
 */
export function computeWeatherSensitivities(
  aggregates: readonly ConditionWaitAggregate[],
  minSamples: number = WEATHER_MIN_SAMPLES,
): WeatherSensitivity[] {
  const baseline = aggregates.find((a) => a.condition === WEATHER_BASELINE_CONDITION);
  if (!baseline || baseline.sampleCount < minSamples || baseline.avgWait <= 0) {
    return [];
  }

  const results: WeatherSensitivity[] = [];
  for (const agg of aggregates) {
    if (agg.condition === WEATHER_BASELINE_CONDITION) continue;
    if (agg.sampleCount < minSamples || agg.avgWait <= 0) continue;

    const ratio = agg.avgWait / baseline.avgWait;
    const clamped = Math.max(WEATHER_MULTIPLIER_MIN, Math.min(WEATHER_MULTIPLIER_MAX, ratio));
    results.push({
      condition: agg.condition,
      waitMultiplier: clamped,
      sampleCount: agg.sampleCount,
    });
  }
  return results;
}
