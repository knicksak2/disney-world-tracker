/**
 * Property and unit tests for the Budget_Line -> Expense pre-fill mapping
 * (trip-budget task 22.2; Requirement 23.2).
 *
 * // Feature: trip-budget, Property 51: Logging a Budget_Line as an Expense pre-fills faithfully and links softly
 */

import fc from 'fast-check';
import {
  BUDGET_CATEGORIES,
  BUDGET_TO_EXPENSE_CATEGORY,
  EXPENSE_AMOUNT_MAX_CENTS,
  EXPENSE_DESCRIPTION_MAX,
  expenseCreateSchema,
  type BudgetAllocationDTO,
  type BudgetCategory,
  type BudgetLineDTO,
} from '@dwt/shared';
import { budgetLineToExpenseDraft } from '../budgetToExpenseDraft';

const DATE_ARB = fc
  .tuple(fc.integer({ min: 2026, max: 2028 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

interface AllocSpec {
  readonly personId: string;
  readonly isGuest: boolean;
  readonly effectiveCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
}

const allocSpecsArb = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((personId) =>
        fc.record({
          personId: fc.constant(personId),
          isGuest: fc.boolean(),
          effectiveCents: fc.integer({ min: 0, max: 400_000 }),
          taxCents: fc.integer({ min: 0, max: 40_000 }),
          tipCents: fc.integer({ min: 0, max: 40_000 }),
        }),
      ),
    ),
  ) as fc.Arbitrary<AllocSpec[]>;

function makeLine(
  specs: readonly AllocSpec[],
  over: Partial<BudgetLineDTO> & { category: BudgetCategory },
): BudgetLineDTO {
  const allocations: BudgetAllocationDTO[] = specs.map((s, i) => ({
    id: `alloc-${i}`,
    memberId: s.isGuest ? null : s.personId,
    guestId: s.isGuest ? s.personId : null,
    storedCents: s.effectiveCents,
    effectiveCents: s.effectiveCents,
    taxCents: s.taxCents,
    tipCents: s.tipCents,
    priceRef: null,
  }));
  const subtotalCents = specs.reduce((n, s) => n + s.effectiveCents, 0);
  const taxCents = specs.reduce((n, s) => n + s.taxCents, 0);
  const tipCents = specs.reduce((n, s) => n + s.tipCents, 0);
  return {
    id: 'line-1',
    tripId: 'trip-1',
    createdBy: 'user-1',
    description: 'Dinner',
    plannedDate: null,
    park: null,
    experienceId: null,
    priceSource: 'user_entered',
    effectivePriceSource: 'user_entered',
    priceLabelKind: 'your_price',
    asOf: '2026-11-01T00:00:00.000Z',
    attribution: null,
    applyTip: false,
    linkedExpenseId: null,
    suggestionKey: null,
    subtotalCents,
    taxCents,
    tipCents,
    totalCents: subtotalCents + taxCents + tipCents,
    allocations,
    ...over,
  };
}

describe('budgetLineToExpenseDraft', () => {
  it('Property 51(a): amount, shares, category, dining link, description and date follow the mapping rules', () => {
    fc.assert(
      fc.property(
        allocSpecsArb,
        fc.constantFrom(...BUDGET_CATEGORIES),
        fc.option(DATE_ARB, { nil: null }),
        fc.option(fc.uuid(), { nil: null }),
        fc.string({ minLength: 0, maxLength: 260 }),
        (specs, category, plannedDate, experienceId, description) => {
          const line = makeLine(specs, { category, plannedDate, experienceId, description });
          const draft = budgetLineToExpenseDraft(line);

          // Amount equals the line total and the sum of the shares.
          const shareSum = draft.shares.reduce((n, s) => n + s.amountCents, 0);
          expect(draft.amountCents).toBe(shareSum);
          expect(draft.amountCents).toBe(line.totalCents);

          // One share per allocation with a positive amount, same Person_Key, exactly one id set.
          const positive = line.allocations.filter((a) => a.effectiveCents + a.taxCents + a.tipCents > 0);
          expect(draft.shares).toHaveLength(positive.length);
          draft.shares.forEach((s, i) => {
            const a = positive[i]!;
            expect(s.memberId).toBe(a.memberId);
            expect(s.guestId).toBe(a.guestId);
            expect(s.amountCents).toBe(a.effectiveCents + a.taxCents + a.tipCents);
            expect((s.memberId === null) !== (s.guestId === null)).toBe(true);
          });

          // Category via the shared total mapping; dining-only Catalog link.
          expect(draft.category).toBe(BUDGET_TO_EXPENSE_CATEGORY[category]);
          expect(draft.experienceId).toBe(draft.category === 'dining' ? experienceId : null);

          // Description: trimmed input cut to the Expense maximum.
          expect(draft.description.length).toBeLessThanOrEqual(EXPENSE_DESCRIPTION_MAX);
          expect(draft.description).toBe(description.trim().slice(0, EXPENSE_DESCRIPTION_MAX));

          expect(draft.date).toBe(plannedDate);
          expect(draft.budgetLineId).toBe(line.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 51(a): for any payer, the exact payload built from the draft validates and the payer remainder is their own share', () => {
    fc.assert(
      fc.property(
        allocSpecsArb,
        fc.uuid(),
        fc.nat({ max: 20 }),
        (specs, outsiderId, payerPick) => {
          const line = makeLine(specs, { category: 'dining' });
          const draft = budgetLineToExpenseDraft(line);
          fc.pre(draft.amountCents > 0 && draft.amountCents <= EXPENSE_AMOUNT_MAX_CENTS);

          // The payer is a Trip_Member: any allocated member, or a member who was not allocated.
          const allocatedMembers = draft.shares.filter((s) => s.memberId !== null).map((s) => s.memberId!);
          const candidates = [...allocatedMembers, outsiderId];
          const payerId = candidates[payerPick % candidates.length]!;

          // Mirrors ExpenseFormModal's exact branch: every person except the payer, positive amounts only.
          const sharesPayload = draft.shares
            .filter((s) => (s.memberId ?? s.guestId) !== payerId)
            .map((s) => (s.memberId ? { memberId: s.memberId, amountCents: s.amountCents } : { guestId: s.guestId!, amountCents: s.amountCents }));
          const othersSum = sharesPayload.reduce((n, s) => n + s.amountCents, 0);

          const payerOwn = draft.shares.find((s) => s.memberId === payerId)?.amountCents ?? 0;
          // The implicit payer remainder equals the payer's own budgeted slice (0 when the payer was not allocated).
          expect(draft.amountCents - othersSum).toBe(payerOwn);
          expect(othersSum).toBeLessThanOrEqual(draft.amountCents);

          const parsed = expenseCreateSchema.safeParse({
            payerId,
            description: draft.description || 'x',
            date: draft.date ?? '2026-11-08',
            category: draft.category,
            splitMode: 'exact',
            amountCents: draft.amountCents,
            ...(draft.experienceId ? { experienceId: draft.experienceId } : {}),
            shares: sharesPayload,
          });
          expect(parsed.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maps each of the seven Budget_Categories to the Expense category of Requirement 17.1', () => {
    const expected: Record<BudgetCategory, string> = {
      tickets: 'tickets',
      lightning_lane: 'lightning_lane',
      dining: 'dining',
      lodging: 'hotel',
      transportation: 'transportation',
      shopping: 'shopping',
      other: 'other',
    };
    const specs: AllocSpec[] = [{ personId: '11111111-1111-4111-8111-111111111111', isGuest: false, effectiveCents: 1000, taxCents: 0, tipCents: 0 }];
    for (const cat of BUDGET_CATEGORIES) {
      expect(budgetLineToExpenseDraft(makeLine(specs, { category: cat })).category).toBe(expected[cat]);
    }
  });

  it('keeps the Catalog link only for dining lines', () => {
    const specs: AllocSpec[] = [{ personId: '11111111-1111-4111-8111-111111111111', isGuest: false, effectiveCents: 1000, taxCents: 0, tipCents: 0 }];
    const exp = '22222222-2222-4222-8222-222222222222';
    expect(budgetLineToExpenseDraft(makeLine(specs, { category: 'dining', experienceId: exp })).experienceId).toBe(exp);
    expect(budgetLineToExpenseDraft(makeLine(specs, { category: 'lightning_lane', experienceId: exp })).experienceId).toBeNull();
    expect(budgetLineToExpenseDraft(makeLine(specs, { category: 'lodging', experienceId: exp })).experienceId).toBeNull();
  });

  it('includes tax and tip in each person\'s amount and in the total', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const g = '33333333-3333-4333-8333-333333333333';
    const line = makeLine(
      [
        { personId: a, isGuest: false, effectiveCents: 10_000, taxCents: 650, tipCents: 1800 },
        { personId: g, isGuest: true, effectiveCents: 5_000, taxCents: 325, tipCents: 900 },
      ],
      { category: 'dining', applyTip: true, plannedDate: '2026-11-10', description: '  Be Our Guest  ' },
    );
    const draft = budgetLineToExpenseDraft(line);
    expect(draft.shares).toEqual([
      { memberId: a, guestId: null, amountCents: 12_450 },
      { memberId: null, guestId: g, amountCents: 6_225 },
    ]);
    expect(draft.amountCents).toBe(18_675);
    expect(draft.description).toBe('Be Our Guest');
    expect(draft.date).toBe('2026-11-10');
  });

  it('cuts a 300-character description to 200 and leaves a null planned day as null', () => {
    const specs: AllocSpec[] = [{ personId: '11111111-1111-4111-8111-111111111111', isGuest: false, effectiveCents: 500, taxCents: 0, tipCents: 0 }];
    const draft = budgetLineToExpenseDraft(makeLine(specs, { category: 'other', description: 'x'.repeat(300), plannedDate: null }));
    expect(draft.description).toHaveLength(200);
    expect(draft.date).toBeNull();
  });

  it('drops zero-cent allocations from the shares', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const draft = budgetLineToExpenseDraft(
      makeLine(
        [
          { personId: a, isGuest: false, effectiveCents: 0, taxCents: 0, tipCents: 0 },
          { personId: b, isGuest: false, effectiveCents: 700, taxCents: 0, tipCents: 0 },
        ],
        { category: 'shopping' },
      ),
    );
    expect(draft.shares).toEqual([{ memberId: b, guestId: null, amountCents: 700 }]);
    expect(draft.amountCents).toBe(700);
  });
});
