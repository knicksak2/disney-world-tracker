/**
 * Product ID mapping, building and cross-checking for Disney ticket pricing calendar.
 *
 * Pattern: theme-park_{numDays}_{A|C}_{opt}_{res}_RF_AF_SOF_progenstr[_{park}]
 *
 * Validates: Requirements 11.4, 11.5
 */

import type { TicketDiscountGroup, TicketOption } from '@dwt/shared';

export interface TicketProductParts {
  readonly numDays: number;
  readonly ageGroup: 'adult' | 'child';
  readonly optionCode: TicketOption;
  readonly discountGroup: TicketDiscountGroup;
  readonly park: 'any' | 'mk' | 'ep' | 'hs' | 'ak';
}

const ID_RE = /^theme-park_(\d{1,2})_([AC])_(0|P|PHP|WPS)_(0|2)_RF_AF_SOF_progenstr(?:_(mk|ep|hs|ak))?$/;

const OPT_CODE_TO_CHAR: Record<TicketOption, string> = {
  base: '0',
  park_hopper: 'P',
  park_hopper_plus: 'PHP',
  water_parks_sports: 'WPS',
};

const CHAR_TO_OPT_CODE: Record<string, TicketOption> = {
  '0': 'base',
  P: 'park_hopper',
  PHP: 'park_hopper_plus',
  WPS: 'water_parks_sports',
};

const RES_CODE_TO_CHAR: Record<TicketDiscountGroup, string> = {
  'std-gst': '0',
  'fl-resident': '2',
};

const CHAR_TO_RES_CODE: Record<string, TicketDiscountGroup> = {
  '0': 'std-gst',
  '2': 'fl-resident',
};

/**
 * Parse a Disney ticket product ID into structured components.
 * Total function: returns null on no match, never throws.
 */
export function parseTicketProductId(id: string): TicketProductParts | null {
  if (typeof id !== 'string') return null;
  const match = ID_RE.exec(id.trim());
  if (!match) return null;

  const numDays = parseInt(match[1]!, 10);
  if (numDays < 1 || numDays > 10) return null;

  const ageGroup: 'adult' | 'child' = match[2] === 'A' ? 'adult' : 'child';
  const optionCode = CHAR_TO_OPT_CODE[match[3]!];
  const discountGroup = CHAR_TO_RES_CODE[match[4]!];
  if (!optionCode || !discountGroup) return null;

  const park = (match[5] as 'mk' | 'ep' | 'hs' | 'ak' | undefined) ?? 'any';

  return {
    numDays,
    ageGroup,
    optionCode,
    discountGroup,
    park,
  };
}

/**
 * Build a Disney ticket product ID from structured components.
 * Inverse of parseTicketProductId for matching IDs.
 */
export function buildTicketProductId(p: TicketProductParts): string {
  const age = p.ageGroup === 'adult' ? 'A' : 'C';
  const opt = OPT_CODE_TO_CHAR[p.optionCode] ?? '0';
  const res = RES_CODE_TO_CHAR[p.discountGroup] ?? '0';
  const parkSuffix = p.optionCode === 'base' && p.numDays === 1 && p.park !== 'any' ? `_${p.park}` : '';
  return `theme-park_${p.numDays}_${age}_${opt}_${res}_RF_AF_SOF_progenstr${parkSuffix}`;
}

/**
 * Cross-checks parsed product parts against the response entry and requested query parameters.
 *
 * Rules:
 * - p.numDays must equal requested.numDays
 * - p.discountGroup must equal requested.discountGroup
 * - If entry has ageGroup, p.ageGroup must agree with entry.ageGroup
 * - Park suffix rule: park suffix is accepted ONLY when optionCode === 'base' and numDays === 1.
 *   A suffix on any other id fails crossCheck.
 */
export function crossCheck(
  p: TicketProductParts,
  entry: { ageGroup?: unknown },
  requested: { numDays: number; discountGroup: string },
): boolean {
  if (p.numDays !== requested.numDays) return false;
  if (p.discountGroup !== requested.discountGroup) return false;

  if (typeof entry.ageGroup === 'string') {
    if (entry.ageGroup.toLowerCase() !== p.ageGroup) return false;
  }

  // Suffix is accepted ONLY on 1-day base rows
  if (p.park !== 'any' && (p.optionCode !== 'base' || p.numDays !== 1)) {
    return false;
  }

  return true;
}
