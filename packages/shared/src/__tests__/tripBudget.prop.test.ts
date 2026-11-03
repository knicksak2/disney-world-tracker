import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BUDGET_CATEGORIES,
  EXPENSE_AMOUNT_MAX_CENTS,
  budgetLineInputSchema,
} from '../index.js';

const NUM_RUNS = 100;

describe('Trip Budget Line Input Properties', () => {
  const memberIdArb = fc.uuid();
  const guestIdArb = fc.uuid();

  const validAllocationArb = fc.oneof(
    fc.record({
      memberId: memberIdArb,
      amountCents: fc.integer({ min: 0, max: EXPENSE_AMOUNT_MAX_CENTS }),
    }),
    fc.record({
      guestId: guestIdArb,
      amountCents: fc.integer({ min: 0, max: EXPENSE_AMOUNT_MAX_CENTS }),
    })
  );

  const validLineInputArb = fc.record({
    category: fc.constantFrom(...BUDGET_CATEGORIES),
    description: fc.string({ minLength: 1, maxLength: 200 }).map((s) => s.trim() || 'Trip Item'),
    priceSource: fc.constant('user_entered' as const),
    allocations: fc.array(validAllocationArb, { minLength: 1, maxLength: 10 }),
  });

  // Feature: trip-budget, Property 32: For any valid line input parsing succeeds; invalid amount or negative cents fails
  it('// Feature: trip-budget, Property 32: For any valid line input parsing succeeds; invalid amount or negative cents fails', () => {
    fc.assert(
      fc.property(validLineInputArb, (input) => {
        // Valid input passes
        const parsed = budgetLineInputSchema.safeParse(input);
        expect(parsed.success).toBe(true);

        // Negative cents fails
        const withNegativeCents = {
          ...input,
          allocations: [
            {
              memberId: '11111111-1111-4111-8111-111111111111',
              amountCents: -1,
            },
          ],
        };
        const negParsed = budgetLineInputSchema.safeParse(withNegativeCents);
        expect(negParsed.success).toBe(false);

        // Over-cap amount fails
        const withOverCapCents = {
          ...input,
          allocations: [
            {
              memberId: '11111111-1111-4111-8111-111111111111',
              amountCents: EXPENSE_AMOUNT_MAX_CENTS + 1,
            },
          ],
        };
        const overCapParsed = budgetLineInputSchema.safeParse(withOverCapCents);
        expect(overCapParsed.success).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

