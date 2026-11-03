// Feature: trip-budget, Property 13: The freshness label is a total, monotone function
/**
 * Property 13:
 * ticketAgeClass is defined for every (asOf, today) pair and is monotone:
 * as today advances, the class never becomes less severe;
 * the boundaries are exactly 45 and 120 days (46 is may_have_changed, 121 is estimate);
 * and worseLabel is commutative, associative and idempotent over the severity order.
 *
 * Validates: Requirements 14.1, 14.2
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PriceLabelKind } from '@dwt/shared';
import { addDays, dateToInstant } from '../dates.js';
import { LABEL_SEVERITY, ticketAgeClass, worseLabel } from '../freshness.js';

const NUM_RUNS = 100;
const CFG = { freshDays: 45, estimateAfterDays: 120 };

describe('freshness — Property 13: The freshness label is a total, monotone function', () => {
  it('Property 13: exact boundary tests (45/46 and 120/121 days)', () => {
    const baseDate = '2026-06-01';
    const asOf = dateToInstant(baseDate);

    // 0 to 45 days -> current
    expect(ticketAgeClass(asOf, baseDate, CFG)).toBe('current');
    expect(ticketAgeClass(asOf, addDays(baseDate, 45), CFG)).toBe('current');

    // 46 to 120 days -> may_have_changed
    expect(ticketAgeClass(asOf, addDays(baseDate, 46), CFG)).toBe('may_have_changed');
    expect(ticketAgeClass(asOf, addDays(baseDate, 120), CFG)).toBe('may_have_changed');

    // 121+ days -> estimate
    expect(ticketAgeClass(asOf, addDays(baseDate, 121), CFG)).toBe('estimate');
    expect(ticketAgeClass(asOf, addDays(baseDate, 300), CFG)).toBe('estimate');
  });

  it('Property 13: monotonicity - as today advances, severity never decreases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 200 }),
        fc.integer({ min: 0, max: 50 }),
        (initialDays, additionalDays) => {
          const baseDate = '2026-06-01';
          const asOf = dateToInstant(baseDate);

          const today1 = addDays(baseDate, initialDays);
          const today2 = addDays(today1, additionalDays);

          const class1 = ticketAgeClass(asOf, today1, CFG);
          const class2 = ticketAgeClass(asOf, today2, CFG);

          const severity1 = LABEL_SEVERITY[class1];
          const severity2 = LABEL_SEVERITY[class2];

          expect(severity2).toBeGreaterThanOrEqual(severity1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 13: worseLabel is commutative, associative, and idempotent', () => {
    const allLabels: PriceLabelKind[] = ['current', 'may_have_changed', 'estimate', 'add_your_price'];

    // Idempotent: worseLabel(a, a) === a
    for (const a of allLabels) {
      expect(worseLabel(a, a)).toBe(a);
    }

    // Commutative: worseLabel(a, b) === worseLabel(b, a)
    for (const a of allLabels) {
      for (const b of allLabels) {
        expect(worseLabel(a, b)).toBe(worseLabel(b, a));
      }
    }

    // Associative: worseLabel(worseLabel(a, b), c) === worseLabel(a, worseLabel(b, c))
    for (const a of allLabels) {
      for (const b of allLabels) {
        for (const c of allLabels) {
          expect(worseLabel(worseLabel(a, b), c)).toBe(worseLabel(a, worseLabel(b, c)));
        }
      }
    }
  });
});
