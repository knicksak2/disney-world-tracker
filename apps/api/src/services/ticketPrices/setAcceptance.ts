/**
 * Sanity guard for accepting ticket price sets (Requirement 11.9, 11.10, review F18).
 *
 * Compares rows per window day rather than raw count so healthy sets are not rejected
 * when the calendar window naturally shrinks.
 *
 * Validates: Requirements 11.9, 11.10
 */

import type { ParsedPricesSet } from './parsePricesResponse.js';

export type SetVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid_price' | 'row_count_drop' | 'unrecognized_fraction' };

export interface PreviousSetMeta {
  readonly rowCount: number;
  readonly windowDays: number;
}

export interface SetAcceptanceConfig {
  readonly minRatio: number;
  readonly maxUnrecognizedFraction: number;
}

/**
 * Validates whether a parsed ticket prices set is sane and acceptable.
 *
 * Rules:
 * - ok requires:
 *   1. rows.length > 0 (otherwise 'empty')
 *   2. invalidPriceCount === 0 (otherwise 'invalid_price')
 *   3. current rows/windowDay rate >= previous rows/windowDay rate * cfg.minRatio (otherwise 'row_count_drop')
 *   4. skippedUnrecognized / totalEntries <= cfg.maxUnrecognizedFraction (otherwise 'unrecognized_fraction')
 */
export function acceptPricesSet(
  parsed: ParsedPricesSet,
  totalEntries: number,
  previous: PreviousSetMeta | null,
  windowDays: number,
  cfg: SetAcceptanceConfig,
): SetVerdict {
  if (parsed.rows.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (parsed.invalidPriceCount > 0) {
    return { ok: false, reason: 'invalid_price' };
  }

  if (previous !== null && previous.windowDays > 0 && windowDays > 0) {
    const previousRate = previous.rowCount / previous.windowDays;
    const currentRate = parsed.rows.length / windowDays;
    if (currentRate < previousRate * cfg.minRatio) {
      return { ok: false, reason: 'row_count_drop' };
    }
  }

  if (totalEntries > 0) {
    const unrecognizedFraction = parsed.skippedUnrecognized / totalEntries;
    if (unrecognizedFraction > cfg.maxUnrecognizedFraction) {
      return { ok: false, reason: 'unrecognized_fraction' };
    }
  }

  return { ok: true };
}
