/**
 * Pure read-time derivations over a Ride_Shape.
 * No I/O.
 */

export interface HourlyWait {
  hour: number;
  wait: number;
}

/**
 * Finds the best (lowest) and worst (highest) hours from a shape.
 */
export function bestWorstHours(
  shape: readonly HourlyWait[]
): { bestHour: number | undefined; worstHour: number | undefined } {
  if (!shape.length) {
    return { bestHour: undefined, worstHour: undefined };
  }

  let best = shape[0]!;
  let worst = shape[0]!;

  for (const entry of shape) {
    if (entry.wait < best.wait) best = entry;
    if (entry.wait > worst.wait) worst = entry;
  }

  return { bestHour: best.hour, worstHour: worst.hour };
}

/**
 * Computes morning escalation rate (rope-drop value).
 * e.g., how quickly the wait climbs after open.
 * Defined as the wait difference between the first and second hour (or similar).
 */
export function escalationRate(shape: readonly HourlyWait[]): number | undefined {
  if (shape.length < 2) return undefined;
  // Sort by hour to ensure morning first
  const sorted = [...shape].sort((a, b) => a.hour - b.hour);
  return sorted[1]!.wait - sorted[0]!.wait;
}

/**
 * Computes the coefficient of variation (CV = stddev / mean).
 */
export function coefficientOfVariation(mean: number, stddev: number): number {
  if (mean <= 0) return 0;
  return stddev / mean;
}

/**
 * Computes the park's peak window (hours with the highest aggregate wait).
 */
export function peakWindow(
  parkAggregateShape: readonly HourlyWait[]
): { startHour: number; endHour: number } | undefined {
  if (parkAggregateShape.length === 0) return undefined;
  
  const sorted = [...parkAggregateShape].sort((a, b) => b.wait - a.wait);
  // Pick top 25% of hours as the peak window
  const peakHoursCount = Math.max(1, Math.floor(parkAggregateShape.length * 0.25));
  const peakHours = sorted.slice(0, peakHoursCount).map((h) => h.hour);
  
  return {
    startHour: Math.min(...peakHours),
    endHour: Math.max(...peakHours),
  };
}
