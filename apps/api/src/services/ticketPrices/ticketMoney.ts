/**
 * Pure money conversion for ticket prices without floating-point arithmetic.
 *
 * Validates: Requirements 11.3
 */

const DOLLARS_STRING_REGEX = /^\d+(\.\d{1,2})?$/;
const MAX_CENTS = 1_000_000_00; // $1,000,000.00 in cents

/**
 * Converts a dollar string (e.g. "697.36", "139", "139.5") into integer cents.
 *
 * Performs decimal-string arithmetic (never floating point).
 * Returns null when:
 * - not a string
 * - does not match /^\d+(\.\d{1,2})?$/ (rejects negatives, exponents, commas, spaces, extra decimals)
 * - total cents <= 0
 * - total cents > 1,000,000,00 ($1M cap)
 */
export function dollarsStringToCents(s: unknown): number | null {
  if (typeof s !== 'string') {
    return null;
  }
  const str = s.trim();
  if (!DOLLARS_STRING_REGEX.test(str)) {
    return null;
  }

  const dotIdx = str.indexOf('.');
  let cents: number;
  if (dotIdx === -1) {
    cents = parseInt(str, 10) * 100;
  } else {
    const whole = parseInt(str.slice(0, dotIdx), 10);
    const fracStr = str.slice(dotIdx + 1);
    const frac = parseInt(fracStr.length === 1 ? `${fracStr}0` : fracStr, 10);
    cents = whole * 100 + frac;
  }

  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_CENTS) {
    return null;
  }

  return cents;
}
