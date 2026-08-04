/**
 * Pure math for wait times and crowd indices.
 * Property-testable, no I/O.
 */

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
