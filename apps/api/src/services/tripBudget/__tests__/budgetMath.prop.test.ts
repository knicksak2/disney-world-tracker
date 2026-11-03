// Feature: trip-budget, Property 1: Largest-remainder share allocation
// Feature: trip-budget, Property 3: Line-level math and per-person split
// Feature: trip-budget, Property 28: Tip applies only to dining category
/**
 * Property tests for Budget math helpers.
 *
 * Validates: Requirements 3.4, 6.6, 6.9, 7.1, 7.2, 7.7
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BUDGET_CATEGORIES, BUDGET_DEFAULT_TAX_BPS } from '@dwt/shared';
import { allocateShares, computeLine } from '../budgetMath.js';
import type { BudgetSettingsEffective, PersonKey } from '../types.js';

const mockSettings: BudgetSettingsEffective = {
  taxBps: BUDGET_DEFAULT_TAX_BPS,
  diningTipBps: 1800,
  savedCents: 0,
  savingsTargetCents: null,
};

describe('Budget Math (Task 12.1)', () => {
  describe('Worked examples and Round 5 M2 unit cases', () => {
    it('subtotal 99,000 at 650 bps tax is 6,435', () => {
      const res = computeLine(
        {
          category: 'tickets',
          applyTip: false,
          allocations: [{ personKey: 'm:p1', cents: 99_000 }],
        },
        mockSettings,
      );
      expect(res.subtotalCents).toBe(99_000);
      expect(res.taxCents).toBe(6435);
      expect(res.tipCents).toBe(0);
      expect(res.totalCents).toBe(105_435);
    });

    it('tip at 1,800 bps on 99,000 dining is 17,820', () => {
      const res = computeLine(
        {
          category: 'dining',
          applyTip: true,
          allocations: [{ personKey: 'm:p1', cents: 99_000 }],
        },
        mockSettings,
      );
      expect(res.subtotalCents).toBe(99_000);
      expect(res.taxCents).toBe(6435);
      expect(res.tipCents).toBe(17_820);
      expect(res.totalCents).toBe(99_000 + 6435 + 17_820);
    });

    it('three-person remainder split: allocateShares(100, [1, 1, 1]) = [34, 33, 33]', () => {
      expect(allocateShares(100, [1, 1, 1])).toEqual([34, 33, 33]);
    });

    it('applyTip: true on non-dining line yields tip 0', () => {
      for (const cat of BUDGET_CATEGORIES.filter((c) => c !== 'dining')) {
        const res = computeLine(
          {
            category: cat,
            applyTip: true,
            allocations: [{ personKey: 'm:p1', cents: 5000 }],
          },
          mockSettings,
        );
        expect(res.tipCents).toBe(0);
      }
    });

    it('a zero-subtotal line still emits one perPerson entry per allocation with taxCents: 0 and tipCents: 0', () => {
      const res = computeLine(
        {
          category: 'dining',
          applyTip: true,
          allocations: [
            { personKey: 'm:p1', cents: 0 },
            { personKey: 'g:p2', cents: 0 },
          ],
        },
        mockSettings,
      );
      expect(res.subtotalCents).toBe(0);
      expect(res.taxCents).toBe(0);
      expect(res.tipCents).toBe(0);
      expect(res.totalCents).toBe(0);
      expect(res.perPerson).toEqual([
        { personKey: 'm:p1', cents: 0, taxCents: 0, tipCents: 0 },
        { personKey: 'g:p2', cents: 0, taxCents: 0, tipCents: 0 },
      ]);
    });

    // Round 5 M2 specific unit tests
    it('Round 5 M2: allocateShares handles asymmetric and zero weights correctly (reproduces allocateProportionally bugs)', () => {
      expect(allocateShares(1, [0, 1, 1])).toEqual([0, 1, 0]);
      expect(allocateShares(2, [1, 3, 3, 3])).toEqual([0, 1, 1, 0]);
      expect(allocateShares(0, [5, 0])).toEqual([0, 0]);
      expect(allocateShares(7, [0, 0])).toEqual([0, 0]);
      expect(allocateShares(100, [1, 1, 1])).toEqual([34, 33, 33]);
    });

    it('computeLine with allocations [0, 100, 100] and 50 bps tax splits [0, 1, 0]', () => {
      const settingsWith50Bps: BudgetSettingsEffective = {
        ...mockSettings,
        taxBps: { ...mockSettings.taxBps, shopping: 50 },
      };

      const res = computeLine(
        {
          category: 'shopping',
          applyTip: false,
          allocations: [
            { personKey: 'm:p1', cents: 0 },
            { personKey: 'm:p2', cents: 100 },
            { personKey: 'g:p3', cents: 100 },
          ],
        },
        settingsWith50Bps,
      );

      // tax = floor((200 * 50 + 5000) / 10000) = 1 cent
      expect(res.taxCents).toBe(1);
      expect(res.perPerson[0]).toEqual({ personKey: 'm:p1', cents: 0, taxCents: 0, tipCents: 0 });
      expect(res.perPerson[1]).toEqual({ personKey: 'm:p2', cents: 100, taxCents: 1, tipCents: 0 });
      expect(res.perPerson[2]).toEqual({ personKey: 'g:p3', cents: 100, taxCents: 0, tipCents: 0 });
    });
  });

  describe('Property 1: allocateShares invariants', () => {
    it('Property 1: non-negativity, exact sum, zero weight gets 0, and deviation < 1 cent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1_000_000 }),
          fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 20 }),
          (totalCents, weights) => {
            const shares = allocateShares(totalCents, weights);
            expect(shares).toHaveLength(weights.length);

            const S = weights.reduce((a, b) => a + b, 0);

            if (S === 0) {
              expect(shares.every((s) => s === 0)).toBe(true);
              return;
            }

            // 1. Non-negativity
            expect(shares.every((s) => s >= 0 && Number.isSafeInteger(s))).toBe(true);

            // 2. Exact sum
            const sumShares = shares.reduce((a, b) => a + b, 0);
            expect(sumShares).toBe(totalCents);

            // 3. Zero weight gets 0
            for (let i = 0; i < weights.length; i++) {
              if (weights[i] === 0) {
                expect(shares[i]).toBe(0);
              }
            }

            // 4. Deviation less than 1 cent from exact proportional share
            for (let i = 0; i < weights.length; i++) {
              const exact = (totalCents * weights[i]!) / S;
              expect(Math.abs(shares[i]! - exact)).toBeLessThan(1.0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Property 1: generator with zero weights, ties and totals 0..5', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }),
          fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 6 }),
          (totalCents, weights) => {
            const shares = allocateShares(totalCents, weights);
            const S = weights.reduce((a, b) => a + b, 0);

            if (S === 0) {
              expect(shares.every((s) => s === 0)).toBe(true);
              return;
            }

            expect(shares.every((s) => s >= 0)).toBe(true);
            expect(shares.reduce((a, b) => a + b, 0)).toBe(totalCents);
            for (let i = 0; i < weights.length; i++) {
              if (weights[i] === 0) expect(shares[i]).toBe(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Exhaustive small-domain test: T 0..30, 1 to 5 weights each 0..5 (~289k vectors)', () => {
      // Loop over 1 to 5 weights
      function testRecursive(depth: number, maxDepth: number, currentWeights: number[]) {
        if (depth === maxDepth) {
          const S = currentWeights.reduce((a, b) => a + b, 0);
          for (let T = 0; T <= 30; T++) {
            const shares = allocateShares(T, currentWeights);
            if (S === 0) {
              for (let i = 0; i < shares.length; i++) {
                if (shares[i] !== 0) throw new Error('Expected 0 share for S=0');
              }
            } else {
              let sum = 0;
              for (let i = 0; i < currentWeights.length; i++) {
                const s = shares[i]!;
                const w = currentWeights[i]!;
                if (s < 0) throw new Error(`Negative share: ${s}`);
                if (w === 0 && s !== 0) throw new Error(`Zero weight got non-zero: ${s}`);
                const exact = (T * w) / S;
                if (Math.abs(s - exact) >= 1.0) throw new Error(`Deviation >= 1: ${s} vs ${exact}`);
                sum += s;
              }
              if (sum !== T) throw new Error(`Sum mismatch: ${sum} vs ${T}`);
            }
          }
          return;
        }

        for (let w = 0; w <= 5; w++) {
          currentWeights.push(w);
          testRecursive(depth + 1, maxDepth, currentWeights);
          currentWeights.pop();
        }
      }

      for (let len = 1; len <= 5; len++) {
        testRecursive(0, len, []);
      }
    }, 30_000);
  });

  describe('Property 3 & Property 28: computeLine invariants', () => {
    it('Property 3: Line subtotal, tax, tip and per-person sum conservation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...BUDGET_CATEGORIES),
          fc.boolean(),
          fc.array(
            fc.record({
              personKey: fc.constantFrom<PersonKey>('m:u1', 'm:u2', 'g:g1', 'g:g2'),
              cents: fc.integer({ min: 0, max: 50_000 }),
            }),
            { minLength: 1, maxLength: 8 },
          ),
          (category, applyTip, allocations) => {
            const res = computeLine({ category, applyTip, allocations }, mockSettings);

            // Subtotal equals sum of allocation cents
            const expectedSubtotal = allocations.reduce((sum, a) => sum + a.cents, 0);
            expect(res.subtotalCents).toBe(expectedSubtotal);

            // Total equals subtotal + tax + tip
            expect(res.totalCents).toBe(res.subtotalCents + res.taxCents + res.tipCents);

            // Per person sums conserve
            const sumPerPersonCents = res.perPerson.reduce((sum, p) => sum + p.cents, 0);
            const sumPerPersonTax = res.perPerson.reduce((sum, p) => sum + p.taxCents, 0);
            const sumPerPersonTip = res.perPerson.reduce((sum, p) => sum + p.tipCents, 0);

            expect(sumPerPersonCents).toBe(res.subtotalCents);
            expect(sumPerPersonTax).toBe(res.taxCents);
            expect(sumPerPersonTip).toBe(res.tipCents);

            // Non-negativity for every person
            for (const p of res.perPerson) {
              expect(p.cents).toBeGreaterThanOrEqual(0);
              expect(p.taxCents).toBeGreaterThanOrEqual(0);
              expect(p.tipCents).toBeGreaterThanOrEqual(0);
              expect(p.cents + p.taxCents + p.tipCents).toBeGreaterThanOrEqual(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Property 28: Tip is strictly 0 when category !== dining', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...BUDGET_CATEGORIES.filter((c) => c !== 'dining')),
          fc.boolean(),
          fc.array(
            fc.record({
              personKey: fc.constantFrom<PersonKey>('m:u1', 'g:g1'),
              cents: fc.integer({ min: 1, max: 10_000 }),
            }),
            { minLength: 1, maxLength: 4 },
          ),
          (category, applyTip, allocations) => {
            const res = computeLine({ category, applyTip, allocations }, mockSettings);
            expect(res.tipCents).toBe(0);
            for (const p of res.perPerson) {
              expect(p.tipCents).toBe(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
