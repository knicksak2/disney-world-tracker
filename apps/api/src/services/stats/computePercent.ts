/**
 * Stats_Service: completion-percentage primitive.
 *
 * Pure functions only — no I/O, no clock, no DB access. The Stats_Service
 * routes call `computePercent` once per overall / per-Park / per-Category
 * roll-up and pass the resulting number back as the JSON `percent` field.
 *
 * Validates: R3.1, R3.2, R3.3, R3.6, R3.7, R3.8.
 */

/**
 * Round a finite number to one decimal place using "round half away from zero"
 * semantics, matching the design's stated rounding rule.
 *
 * Examples:
 *   round1(0)      ===  0
 *   round1(0.05)   ===  0.1   (half rounds away from zero)
 *   round1(1.24)   ===  1.2
 *   round1(1.25)   ===  1.3
 *   round1(-0.05)  === -0.1   (half rounds away from zero on the negative side)
 *
 * Implementation note: JavaScript's `Math.round` rounds half toward positive
 * infinity (so `Math.round(-0.5) === 0`), which is *not* half-away-from-zero.
 * Splitting the sign off and rounding the absolute magnitude turns
 * `Math.round` into the desired half-away-from-zero behaviour for both signs.
 */
export function round1(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 10)) / 10;
}

/**
 * Compute a completion percentage in the range [0.0, 100.0], rounded to one
 * decimal place, with `denominator === 0` reported as `0.0` per R3.6/R3.7.
 *
 * The result is also capped at `100.0` per R3.8 so callers can never observe
 * a percentage greater than 100, even if a bug elsewhere yields
 * `numerator > denominator`.
 *
 * @param numerator   count of completed Experiences (caller-provided; expected
 *                    non-negative integer)
 * @param denominator total count of Experiences in the slice being measured
 *                    (caller-provided; expected non-negative integer)
 */
export function computePercent(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0.0;
  }
  const raw = (numerator * 100) / denominator;
  return Math.min(100.0, round1(raw));
}

/**
 * Round a finite number to `decimals` decimal places using "round half up"
 * (half toward positive infinity) semantics.
 *
 * This is distinct from `round1`, which rounds half *away from zero*. The two
 * rules coincide for non-negative inputs but differ for negatives:
 *   roundHalfUpDecimal(-0.05, 1) ===  0.0   (half rounds toward +∞)
 *   round1(-0.05)                === -0.1   (half rounds away from zero)
 *
 * The Percentile_Rank (R7.3) is specified as round-half-up. Percentile values
 * are always non-negative, so this coincides with round1 in practice, but the
 * percentile module uses this helper so the round-half-up rule is honored by
 * name rather than by coincidence.
 *
 * Examples:
 *   roundHalfUpDecimal(0.05, 1)   === 0.1   (half rounds up)
 *   roundHalfUpDecimal(1.25, 1)   === 1.3
 *   roundHalfUpDecimal(66.649, 1) === 66.6
 *   roundHalfUpDecimal(66.65, 1)  === 66.7
 *
 * Implementation note: JavaScript's `Math.round` already rounds half toward
 * positive infinity (`Math.round(0.5) === 1`, `Math.round(-0.5) === 0`), which
 * is exactly the round-half-up rule, so it is applied directly to the scaled
 * magnitude.
 *
 * @param value    the finite number to round (non-finite inputs are returned
 *                 unchanged, matching `round1`)
 * @param decimals the number of decimal places to round to (expected
 *                 non-negative integer)
 */
export function roundHalfUpDecimal(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
