/**
 * Pure freshness classification and label severity merging for ticket prices.
 *
 * Validates: Requirements 14.1, 14.2
 */

import type { PriceLabelKind } from '@dwt/shared';
import { daysBetween, wdwDateOf } from './dates.js';

export type TicketAgeClass = 'current' | 'may_have_changed' | 'estimate';

/**
 * Classifies the age of a cached ticket prices set relative to today (WDW calendar).
 *
 * Clamps negative days (clock skew) to 0.
 * Boundaries:
 * - days <= freshDays -> 'current'
 * - days <= estimateAfterDays -> 'may_have_changed'
 * - otherwise -> 'estimate'
 */
export function ticketAgeClass(
  asOf: Date,
  today: string,
  cfg: { freshDays: number; estimateAfterDays: number },
): TicketAgeClass {
  const asOfDate = wdwDateOf(asOf);
  const days = Math.max(0, daysBetween(asOfDate, today));
  if (days <= cfg.freshDays) {
    return 'current';
  }
  if (days <= cfg.estimateAfterDays) {
    return 'may_have_changed';
  }
  return 'estimate';
}

export const LABEL_SEVERITY: Record<PriceLabelKind, number> = {
  current: 0,
  may_have_changed: 1,
  estimate: 2,
  add_your_price: 3,
  your_price: 99,
};

/**
 * Returns the worse (more severe) of two price label kinds.
 * Commutative, associative, and idempotent.
 */
export function worseLabel(a: PriceLabelKind, b: PriceLabelKind): PriceLabelKind {
  const sevA = LABEL_SEVERITY[a] ?? 0;
  const sevB = LABEL_SEVERITY[b] ?? 0;
  return sevA >= sevB ? a : b;
}
