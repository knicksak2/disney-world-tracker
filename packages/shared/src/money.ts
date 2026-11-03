/**
 * Shared integer-cent monetary calculation helpers.
 *
 * Implements pure, I/O-free rounding and allocation math shared across
 * server budget calculations and mobile display components.
 *
 * Validates: Requirements 6.9, 7.8, Properties 28, 42
 */

/**
 * Computes a basis-point share of an integer cent amount, rounding half up.
 * 10,000 bps = 100.00%.
 *
 * Formula: Math.floor((cents * bps + 5000) / 10000)
 */
export function bpsOf(cents: number, bps: number): number {
  return Math.floor((cents * bps + 5000) / 10000);
}

/**
 * Splits an integer cent total evenly across `count` recipients.
 * Gives the floor share to all recipients, then distributes the remainder
 * one cent at a time in list order (lower indices receive the larger amount).
 *
 * Sum of the returned array strictly equals `totalCents`.
 *
 * @throws Error if count < 1 or count is not an integer.
 */
export function splitCentsEvenly(totalCents: number, count: number): number[] {
  if (count < 1 || !Number.isInteger(count)) {
    throw new Error('count must be an integer >= 1');
  }
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const result = new Array<number>(count).fill(base);
  for (let i = 0; i < remainder; i++) {
    result[i] = (result[i] ?? base) + 1;
  }
  return result;
}
