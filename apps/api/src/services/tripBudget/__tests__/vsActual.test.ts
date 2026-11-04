import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BUDGET_CATEGORIES,
  EXPENSE_CATEGORIES,
  type BudgetCategory,
  type ExpenseCategory,
} from '@dwt/shared';
import { computeVsActual } from '../vsActual.js';

describe('vsActual', () => {
  // Feature: trip-budget, Property 23: Budget versus actual is a total mapping with conserved sums
  // Validates: Requirements 17.1, 17.2
  it('Property 23: returns entries in EXPENSE_CATEGORIES order, conserves budgeted and actual sums, and maps lightning_lane and tickets 1:1', () => {
    const budgetTotalsArb = fc.record(
      Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, fc.nat(1_000_000)])),
    ) as unknown as fc.Arbitrary<Record<BudgetCategory, number>>;

    const actualTotalsArb = fc.record(
      Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, fc.nat(1_000_000)])),
    ) as unknown as fc.Arbitrary<Record<ExpenseCategory, number>>;

    fc.assert(
      fc.property(budgetTotalsArb, actualTotalsArb, (budgetTotals, actualTotals) => {
        const rows = computeVsActual({
          lineTotalsByBudgetCategory: budgetTotals,
          actualByExpenseCategory: actualTotals,
        });

        // 1. One entry per ExpenseCategory in canonical order
        expect(rows.map((r) => r.expenseCategory)).toEqual(EXPENSE_CATEGORIES);

        // 2. Conserved budgeted sum
        const sumBudgetedInput = Object.values(budgetTotals).reduce((a, b) => a + b, 0);
        const sumBudgetedOutput = rows.reduce((a, r) => a + r.budgetedCents, 0);
        expect(sumBudgetedOutput).toBe(sumBudgetedInput);

        // 3. Conserved actual sum
        const sumActualInput = Object.values(actualTotals).reduce((a, b) => a + b, 0);
        const sumActualOutput = rows.reduce((a, r) => a + r.actualCents, 0);
        expect(sumActualOutput).toBe(sumActualInput);

        // 4. tickets and lightning_lane map 1:1
        const ticketsRow = rows.find((r) => r.expenseCategory === 'tickets')!;
        expect(ticketsRow.budgetedCents).toBe(budgetTotals.tickets);

        const llRow = rows.find((r) => r.expenseCategory === 'lightning_lane')!;
        expect(llRow.budgetedCents).toBe(budgetTotals.lightning_lane);

        // 5. hotel receives lodging
        const hotelRow = rows.find((r) => r.expenseCategory === 'hotel')!;
        expect(hotelRow.budgetedCents).toBe(budgetTotals.lodging);
      }),
      { numRuns: 100 },
    );
  });

  describe('unit cases', () => {
    it('handles empty/zero inputs cleanly', () => {
      const rows = computeVsActual({
        lineTotalsByBudgetCategory: {} as Record<BudgetCategory, number>,
        actualByExpenseCategory: {} as Record<ExpenseCategory, number>,
      });

      expect(rows).toHaveLength(EXPENSE_CATEGORIES.length);
      for (const row of rows) {
        expect(row.budgetedCents).toBe(0);
        expect(row.actualCents).toBe(0);
      }
    });

    it('maps tickets and lightning_lane to their respective expenseCategories', () => {
      const rows = computeVsActual({
        lineTotalsByBudgetCategory: {
          tickets: 50000,
          lightning_lane: 15000,
          dining: 20000,
          lodging: 80000,
          transportation: 10000,
          shopping: 5000,
          other: 2000,
        },
        actualByExpenseCategory: {
          hotel: 75000,
          tickets: 60000,
          lightning_lane: 12000,
          dining: 18000,
          shopping: 4000,
          transportation: 9000,
          other: 1000,
        },
      });

      const ticketsRow = rows.find((r) => r.expenseCategory === 'tickets');
      expect(ticketsRow).toEqual({
        expenseCategory: 'tickets',
        budgetedCents: 50000,
        actualCents: 60000,
      });

      const llRow = rows.find((r) => r.expenseCategory === 'lightning_lane');
      expect(llRow).toEqual({
        expenseCategory: 'lightning_lane',
        budgetedCents: 15000,
        actualCents: 12000,
      });

      const hotelRow = rows.find((r) => r.expenseCategory === 'hotel');
      expect(hotelRow).toEqual({
        expenseCategory: 'hotel',
        budgetedCents: 80000,
        actualCents: 75000,
      });
    });
  });
});

