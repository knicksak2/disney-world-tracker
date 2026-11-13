/**
 * Nearest-rank percentile (Requirement 7.2, Property 12).
 *
 * `i = clamp(ceil(p / 100 * n) - 1, 0, n - 1)` on an ascending list, so the chosen price is always a real menu price.
 * The product `p * n` is formed before dividing by 100 so an integer `p` never picks up a float error
 * (`7 / 100 * 100` is 7.000000000000001, whose ceiling is 8; `7 * 100 / 100` is exactly 7). A non-finite `p` picks
 * the maximum.
 */
export function pickPercentile(sortedAsc: readonly number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const rank = Number.isFinite(p) ? Math.ceil((p * n) / 100) - 1 : n - 1;
  const i = Math.min(n - 1, Math.max(0, rank));
  return sortedAsc[i]!;
}
