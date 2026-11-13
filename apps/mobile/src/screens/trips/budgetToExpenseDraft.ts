/**
 * Pure mapping from a Budget_Line to an Expense form pre-fill
 * (trip-budget Requirement 23.2; trip-expenses Requirement 17).
 *
 * No I/O, no React. All money is integer cents. The payer is deliberately NOT part of the
 * draft: the Expense form defaults it to the member opening the form, who may change it.
 *
 * Amount rule: each Budget_Allocation contributes `effectiveCents + taxCents + tipCents`
 * (the person's slice of the line total including tax and tip, because an Expense records
 * what was actually charged). The Expense amount is the sum of those slices, which equals
 * `line.totalCents` for any DTO the server builds (the server allocates tax and tip
 * across people with a largest-remainder split that sums exactly).
 */

import {
  BUDGET_TO_EXPENSE_CATEGORY,
  EXPENSE_DESCRIPTION_MAX,
  type BudgetLineDTO,
  type ExpenseCategory,
} from '@dwt/shared';

export interface ExpenseDraftShare {
  /** Exactly one of `memberId` / `guestId` is non-null. */
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly amountCents: number;
}

export interface ExpenseFormDraft {
  /** The Budget_Line this draft came from; used to link the saved Expense back (Requirement 23.5). */
  readonly budgetLineId: string;
  readonly description: string;
  /** `YYYY-MM-DD`, or null when the line has no planned day (the form then keeps today). */
  readonly date: string | null;
  readonly category: ExpenseCategory;
  readonly amountCents: number;
  /** Catalog restaurant link; non-null only when `category === 'dining'`. */
  readonly experienceId: string | null;
  /** One entry per allocated person with a positive amount, in the allocations' order. */
  readonly shares: readonly ExpenseDraftShare[];
}

export function budgetLineToExpenseDraft(line: BudgetLineDTO): ExpenseFormDraft {
  const category = BUDGET_TO_EXPENSE_CATEGORY[line.category];

  const shares: ExpenseDraftShare[] = [];
  for (const a of line.allocations) {
    const amountCents = a.effectiveCents + a.taxCents + a.tipCents;
    if (amountCents <= 0) continue;
    shares.push({ memberId: a.memberId, guestId: a.guestId, amountCents });
  }

  return {
    budgetLineId: line.id,
    description: line.description.trim().slice(0, EXPENSE_DESCRIPTION_MAX),
    date: line.plannedDate,
    category,
    amountCents: shares.reduce((sum, s) => sum + s.amountCents, 0),
    // The Expense schema accepts a Catalog restaurant link only for `dining` (Req 11.1, 11.8).
    experienceId: category === 'dining' ? line.experienceId : null,
    shares,
  };
}
