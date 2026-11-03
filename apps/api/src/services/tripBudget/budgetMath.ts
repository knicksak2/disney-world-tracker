/**
 * Pure math helpers for Trip Budget calculations.
 *
 * Uses largest-remainder algorithm for integer division without negative shares (Round 5 M2).
 * Imports bpsOf from '@dwt/shared' and defines no second copy.
 *
 * Validates: Requirements 3.4, 6.6, 6.9, 7.1, 7.2, 7.7
 */

import { bpsOf, type BudgetCategory } from '@dwt/shared';
import type { BudgetSettingsEffective, LineMath, PersonKey } from './types.js';

/**
 * Largest-remainder allocation over integers (pure; no floats).
 *
 * Preconditions: totalCents and every weight are non-negative safe integers.
 * Postconditions:
 * - Every share is a non-negative integer.
 * - Shares sum to exactly totalCents.
 * - A weight of 0 receives exactly 0.
 * - Each share deviates from the proportional value by less than 1 cent.
 */
export function allocateShares(totalCents: number, weights: readonly number[]): number[] {
  const S = weights.reduce((a, w) => a + w, 0);
  if (S === 0) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((totalCents * w) / S));
  const frac = weights.map((w) => (totalCents * w) % S);
  let left = totalCents - base.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((i, j) => frac[j]! - frac[i]! || i - j);
  for (const i of order) {
    if (left === 0) break;
    base[i]! += 1;
    left -= 1;
  }
  return base;
}

/**
 * Compute line-level subtotal, tax, tip, total, and per-person breakdown.
 */
export function computeLine(
  l: {
    category: BudgetCategory;
    applyTip: boolean;
    allocations: readonly { personKey: PersonKey; cents: number }[];
  },
  s: BudgetSettingsEffective,
): LineMath {
  const subtotalCents = l.allocations.reduce((sum, a) => sum + a.cents, 0);
  const taxRate = s.taxBps[l.category] ?? 0;
  const taxCents = bpsOf(subtotalCents, taxRate);
  const tipCents = l.applyTip && l.category === 'dining' ? bpsOf(subtotalCents, s.diningTipBps) : 0;
  const totalCents = subtotalCents + taxCents + tipCents;

  const weights = l.allocations.map((a) => a.cents);
  const perPersonTaxes = allocateShares(taxCents, weights);
  const perPersonTips = allocateShares(tipCents, weights);

  const perPerson = l.allocations.map((a, i) => ({
    personKey: a.personKey,
    cents: a.cents,
    taxCents: perPersonTaxes[i]!,
    tipCents: perPersonTips[i]!,
  }));

  return {
    subtotalCents,
    taxCents,
    tipCents,
    totalCents,
    perPerson,
  };
}

