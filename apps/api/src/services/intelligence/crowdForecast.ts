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
