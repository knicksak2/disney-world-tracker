/**
 * Pure math for forecast calibration loop.
 * Recency-weighted mean absolute error and bias.
 */

/**
 * Updates the running accuracy summary using an Exponential Moving Average (EMA).
 * `error = forecast - observed`
 */
export function updateAccuracy(
  prev: { mae: number; bias: number; sampleCount: number },
  error: number,
  weight: number
): { mae: number; bias: number; sampleCount: number } {
  if (prev.sampleCount === 0) {
    return {
      mae: Math.abs(error),
      bias: error,
      sampleCount: 1,
    };
  }
  
  const newMae = prev.mae + weight * (Math.abs(error) - prev.mae);
  const newBias = prev.bias + weight * (error - prev.bias);
  
  return {
    mae: newMae,
    bias: newBias,
    sampleCount: prev.sampleCount + 1,
  };
}

/**
 * Applies the measured bias correction to a raw forecast index.
 * The bias is `forecast - observed`, so a positive bias means we historically 
 * forecast too high, so we subtract the bias.
 * Clamps the final value to [0.4, 3.0].
 */
export function applyBiasCorrection(rawIndex: number, bias: number): number {
  // Clamped bias correction: don't let it swing more than ±0.5
  const correction = Math.max(-0.5, Math.min(0.5, bias));
  const corrected = rawIndex - correction;
  return Math.max(0.4, Math.min(3.0, corrected));
}
