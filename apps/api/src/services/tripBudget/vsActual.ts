/**
 * Pure Budget versus Actual expense comparisons (Requirement 17).
 *
 * Maps Budget categories to Expense categories and conserves sums (Property 23).
 *
 * Validates: Requirements 17.1, 17.2
 */

import {
  BUDGET_CATEGORIES,
  BUDGET_TO_EXPENSE_CATEGORY,
  EXPENSE_CATEGORIES,
  type BudgetCategory,
  type ExpenseCategory,
  type VsActualDTO,
} from '@dwt/shared';

export interface ComputeVsActualInput {
  lineTotalsByBudgetCategory: Readonly<Record<BudgetCategory, number>> | Partial<Record<BudgetCategory, number>>;
  actualByExpenseCategory: Readonly<Record<ExpenseCategory, number>> | Partial<Record<ExpenseCategory, number>>;
}

export function computeVsActual(i: ComputeVsActualInput): VsActualDTO[] {
  // Accumulate budgeted cents per ExpenseCategory
  const budgetedByExpCat: Record<ExpenseCategory, number> = {
    hotel: 0,
    tickets: 0,
    lightning_lane: 0,
    dining: 0,
    shopping: 0,
    transportation: 0,
    other: 0,
  };

  for (const bCat of BUDGET_CATEGORIES) {
    const cents = i.lineTotalsByBudgetCategory[bCat] ?? 0;
    const expCat = BUDGET_TO_EXPENSE_CATEGORY[bCat];
    budgetedByExpCat[expCat] += cents;
  }

  // Emit rows in canonical EXPENSE_CATEGORIES order
  return EXPENSE_CATEGORIES.map((expCat) => ({
    expenseCategory: expCat,
    budgetedCents: budgetedByExpCat[expCat] ?? 0,
    actualCents: i.actualByExpenseCategory[expCat] ?? 0,
  }));
}

