// Feature: trip-budget, Property 27: Picker selections become valid Expense and Budget payloads
// Validates: Requirements 9.2, 9.4, 9.5

import fc from 'fast-check';
import {
  EXPENSE_AMOUNT_MAX_CENTS,
  EXPENSE_ITEM_NAME_MAX,
  expenseItemInputSchema,
  menuPriceRefSchema,
} from '@dwt/shared';

import {
  isAlcoholicGroupType,
  selectionSubtotalCents,
  selectionToBudgetPriceRef,
  selectionToExpenseItems,
  type SelectedItemState,
} from '../menuItemPicker.pure';

const arbUuid = fc.uuid();
const arbAssigneeIds = fc.uniqueArray(arbUuid, { minLength: 1, maxLength: 5 });

const arbItemState: fc.Arbitrary<SelectedItemState> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 150 }).filter((s) => s.trim().length > 0),
  priceCents: fc.integer({ min: 1, max: 200_000 }),
  priceLabel: fc.option(fc.string({ maxLength: 80 }), { nil: null }),
  quantity: fc.integer({ min: 1, max: 10 }),
  isAlcohol: fc.boolean(),
});

describe('Property 27: Picker selections become valid Expense and Budget payloads', () => {
  it('every produced expense row satisfies expenseItemInputSchema, repeats by quantity, and preserves subtotal', () => {
    fc.assert(
      fc.property(
        fc.array(arbItemState, { minLength: 1, maxLength: 10 }),
        arbAssigneeIds,
        (items, assigneeIds) => {
          const selection = { items };
          const expenseRows = selectionToExpenseItems(selection, assigneeIds);

          // Row count equals sum of quantities
          const expectedCount = items.reduce((sum, it) => sum + it.quantity, 0);
          expect(expenseRows).toHaveLength(expectedCount);

          // Every row satisfies expenseItemInputSchema
          for (const row of expenseRows) {
            const parsed = expenseItemInputSchema.safeParse(row);
            expect(parsed.success).toBe(true);

            // Name is within 1..100 characters
            expect(row.name.length).toBeGreaterThanOrEqual(1);
            expect(row.name.length).toBeLessThanOrEqual(EXPENSE_ITEM_NAME_MAX);

            // Price is positive and within cap
            expect(row.priceCents).toBeGreaterThan(0);
            expect(row.priceCents).toBeLessThanOrEqual(EXPENSE_AMOUNT_MAX_CENTS);

            // Assignees match exactly
            expect(row.assigneeIds).toEqual(assigneeIds);

            // Expense payload contains no field marking item as picked
            expect(row).not.toHaveProperty('origin');
            expect(row).not.toHaveProperty('isPicked');
            expect(row).not.toHaveProperty('source');
          }

          // Sum of produced rows equals selectionSubtotalCents
          const totalProducedCents = expenseRows.reduce((sum, r) => sum + r.priceCents, 0);
          expect(totalProducedCents).toBe(selectionSubtotalCents(selection));

          // Budget price ref is also valid
          const budgetRef = selectionToBudgetPriceRef(selection);
          const parsedBudget = menuPriceRefSchema.safeParse(budgetRef);
          expect(parsedBudget.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sets isAlcohol exactly for items from group type matching Alcoholic Beverage', () => {
    fc.assert(
      fc.property(fc.string(), (groupType) => {
        const matches = isAlcoholicGroupType(groupType);
        const normalized = groupType.trim().toLowerCase();
        if (normalized === 'alcoholic beverage') {
          expect(matches).toBe(true);
        } else {
          expect(matches).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});

