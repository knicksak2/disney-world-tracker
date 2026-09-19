/**
 * Pure calculation logic for Park Wait Pulse.
 *
 * Implements Task 15.1 (Requirements 2.1, 2.5).
 */

export type CrowdTrend = 'Walk-on' | 'Light lines' | 'Moderate' | 'Heavy';

export interface PulseEntry {
  readonly waitMinutes: number | null;
  readonly status?: string;
}

/**
 * Calculates the integer average wait time for operating attractions reporting a wait.
 * Returns null if no attraction reports a non-negative wait time.
 */
export function calculateParkWaitAverage(
  entries: readonly PulseEntry[],
): number | null {
  const validWaits = entries
    .map((e) => e.waitMinutes)
    .filter((w): w is number => w !== null && w >= 0);

  if (validWaits.length === 0) {
    return null;
  }

  const sum = validWaits.reduce((acc, curr) => acc + curr, 0);
  return Math.round(sum / validWaits.length);
}

/**
 * Classifies the crowd trend badge based on average wait time in minutes:
 *   - < 20 min: 'Walk-on'
 *   - < 35 min: 'Light lines'
 *   - < 50 min: 'Moderate'
 *   - >= 50 min: 'Heavy'
 */
export function classifyCrowdTrend(avgMinutes: number | null): CrowdTrend {
  if (avgMinutes === null || avgMinutes < 20) {
    return 'Walk-on';
  }
  if (avgMinutes < 35) {
    return 'Light lines';
  }
  if (avgMinutes < 50) {
    return 'Moderate';
  }
  return 'Heavy';
}
