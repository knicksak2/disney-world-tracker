/**
 * Tests for Trip Expenses domain schemas in `@dwt/shared`.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 2.2, 2.5, 2.6, 3.1, 3.2,
 *            3.6, 3.7, 4.1, 4.3, 4.6, 5.1, 5.2, 5.7, 5.8, 7.1, 7.2, 11.1,
 *            11.2, 11.8, 12.1, 12.2, 14.1, 14.2
 */

import { describe, expect, it } from 'vitest';

import {
  chargeLineInputSchema,
  expenseCreateSchema,
  expenseEditSchema,
  expenseItemInputSchema,
  expenseShareInputSchema,
  expenseTierCountInputSchema,
  expenseTierInputSchema,
  refundCreateSchema,
  settlementCreateSchema,
  tripGuestAddSchema,
  tripGuestRenameSchema,
} from '../tripExpenses.js';

const VALID_UUID_1 = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_3 = '33333333-3333-4333-8333-333333333333';
const VALID_DATE = '2026-10-02';

describe('expenseShareInputSchema (R2.5, R3.1, R3.2)', () => {
  it('accepts valid share with memberId', () => {
    const res = expenseShareInputSchema.safeParse({
      memberId: VALID_UUID_1,
      amountCents: 2500,
    });
    expect(res.success).toBe(true);
  });

  it('accepts valid share with guestId', () => {
    const res = expenseShareInputSchema.safeParse({
      guestId: VALID_UUID_2,
      amountCents: 1500,
    });
    expect(res.success).toBe(true);
  });

  it('rejects share with neither memberId nor guestId', () => {
    const res = expenseShareInputSchema.safeParse({
      amountCents: 1500,
    });
    expect(res.success).toBe(false);
  });

  it('rejects share with both memberId and guestId', () => {
    const res = expenseShareInputSchema.safeParse({
      memberId: VALID_UUID_1,
      guestId: VALID_UUID_2,
      amountCents: 1500,
    });
    expect(res.success).toBe(false);
  });

  it('rejects zero or negative amountCents', () => {
    expect(
      expenseShareInputSchema.safeParse({
        memberId: VALID_UUID_1,
        amountCents: 0,
      }).success,
    ).toBe(false);

    expect(
      expenseShareInputSchema.safeParse({
        memberId: VALID_UUID_1,
        amountCents: -500,
      }).success,
    ).toBe(false);
  });
});

describe('expenseTierInputSchema & expenseTierCountInputSchema (R4.1, R4.2)', () => {
  it('accepts valid tier definition', () => {
    const res = expenseTierInputSchema.safeParse({
      name: 'Adult',
      priceCents: 5700,
    });
    expect(res.success).toBe(true);
  });

  it('rejects tier with empty name or price <= 0', () => {
    expect(
      expenseTierInputSchema.safeParse({
        name: '   ',
        priceCents: 5700,
      }).success,
    ).toBe(false);

    expect(
      expenseTierInputSchema.safeParse({
        name: 'Adult',
        priceCents: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts valid tier count with memberId and count >= 1', () => {
    const res = expenseTierCountInputSchema.safeParse({
      tierId: VALID_UUID_1,
      memberId: VALID_UUID_2,
      count: 2,
    });
    expect(res.success).toBe(true);
  });

  it('rejects tier count with count < 1', () => {
    const res = expenseTierCountInputSchema.safeParse({
      tierId: VALID_UUID_1,
      memberId: VALID_UUID_2,
      count: 0,
    });
    expect(res.success).toBe(false);
  });
});

describe('expenseItemInputSchema (R5.1, R5.2, R14.1)', () => {
  it('accepts valid itemized line item', () => {
    const res = expenseItemInputSchema.safeParse({
      name: 'Dole Whip',
      priceCents: 699,
      assigneeIds: [VALID_UUID_1, VALID_UUID_2],
      isAlcohol: false,
    });
    expect(res.success).toBe(true);
  });

  it('rejects item with zero assignees', () => {
    const res = expenseItemInputSchema.safeParse({
      name: 'Dole Whip',
      priceCents: 699,
      assigneeIds: [],
    });
    expect(res.success).toBe(false);
  });

  it('rejects item with duplicate assignees', () => {
    const res = expenseItemInputSchema.safeParse({
      name: 'Dole Whip',
      priceCents: 699,
      assigneeIds: [VALID_UUID_1, VALID_UUID_1],
    });
    expect(res.success).toBe(false);
  });
});

describe('chargeLineInputSchema (R5.8, R5.11)', () => {
  it('accepts valid positive tax, fee, and gratuity', () => {
    expect(
      chargeLineInputSchema.safeParse({
        kind: 'tax',
        amountCents: 500,
      }).success,
    ).toBe(true);

    expect(
      chargeLineInputSchema.safeParse({
        kind: 'gratuity',
        amountCents: 1500,
      }).success,
    ).toBe(true);

    expect(
      chargeLineInputSchema.safeParse({
        kind: 'fee',
        amountCents: 200,
      }).success,
    ).toBe(true);
  });

  it('accepts valid negative discount', () => {
    const res = chargeLineInputSchema.safeParse({
      kind: 'discount',
      amountCents: -1000,
      excludeAlcohol: true,
    });
    expect(res.success).toBe(true);
  });

  it('rejects positive discount (R5.8 sign check)', () => {
    const res = chargeLineInputSchema.safeParse({
      kind: 'discount',
      amountCents: 1000,
    });
    expect(res.success).toBe(false);
  });

  it('rejects negative tax/fee/gratuity (R5.8 sign check)', () => {
    const res = chargeLineInputSchema.safeParse({
      kind: 'tax',
      amountCents: -500,
    });
    expect(res.success).toBe(false);
  });

  it('rejects empty scopeItemIds when provided (R5.11)', () => {
    const res = chargeLineInputSchema.safeParse({
      kind: 'tax',
      amountCents: 500,
      scopeItemIds: [],
    });
    expect(res.success).toBe(false);
  });
});

describe('expenseCreateSchema & expenseEditSchema splitMode discrimination (R1.1, R1.4, R3.6, R4.6, R5.7)', () => {
  it('accepts valid exact splitMode expense', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Groceries',
      date: VALID_DATE,
      splitMode: 'exact',
      amountCents: 5000,
      shares: [
        { memberId: VALID_UUID_2, amountCents: 2000 },
        { memberId: VALID_UUID_3, amountCents: 1000 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects exact expense when shares sum exceeds amountCents (R3.1)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Groceries',
      date: VALID_DATE,
      splitMode: 'exact',
      amountCents: 2500,
      shares: [
        { memberId: VALID_UUID_2, amountCents: 2000 },
        { memberId: VALID_UUID_3, amountCents: 1000 },
      ],
    });
    expect(res.success).toBe(false);
  });

  it('rejects exact expense when amountCents is missing (R1.4)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Groceries',
      date: VALID_DATE,
      splitMode: 'exact',
      shares: [{ memberId: VALID_UUID_2, amountCents: 2000 }],
    });
    expect(res.success).toBe(false);
  });

  it('accepts valid even splitMode expense', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Hotel Room',
      date: VALID_DATE,
      category: 'hotel',
      splitMode: 'even',
      amountCents: 30000,
      participantIds: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3],
    });
    expect(res.success).toBe(true);
  });

  it('rejects even expense with fewer than one other participant (R3.6)', () => {
    // Only payer in participantIds
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Hotel Room',
      date: VALID_DATE,
      splitMode: 'even',
      amountCents: 30000,
      participantIds: [VALID_UUID_1],
    });
    expect(res.success).toBe(false);

    // Empty participantIds
    const resEmpty = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Hotel Room',
      date: VALID_DATE,
      splitMode: 'even',
      amountCents: 30000,
      participantIds: [],
    });
    expect(resEmpty.success).toBe(false);
  });

  it('accepts valid tiered splitMode expense', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Buffet',
      date: VALID_DATE,
      category: 'dining',
      splitMode: 'tiered',
      amountCents: 20000,
      tiers: [
        { name: 'Adult', priceCents: 5700 },
        { name: 'Child', priceCents: 3700 },
      ],
      tierCounts: [
        { tierId: 'Adult', memberId: VALID_UUID_2, count: 1 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects tiered expense with zero tiers (R4.6)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Buffet',
      date: VALID_DATE,
      splitMode: 'tiered',
      amountCents: 20000,
      tiers: [],
    });
    expect(res.success).toBe(false);
  });

  it('accepts valid itemized splitMode expense without amountCents (R1.1, R5.14)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Dinner at Steakhouse 71',
      date: VALID_DATE,
      category: 'dining',
      splitMode: 'itemized',
      items: [
        { name: 'Steak', priceCents: 4500, assigneeIds: [VALID_UUID_1] },
        { name: 'Pasta', priceCents: 3200, assigneeIds: [VALID_UUID_2] },
      ],
      chargeLines: [
        { kind: 'tax', amountCents: 600 },
        { kind: 'gratuity', amountCents: 1500 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects itemized expense if client submits amountCents (R1.1, R1.4, R5.14)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Dinner',
      date: VALID_DATE,
      splitMode: 'itemized',
      amountCents: 9800, // forbidden for itemized!
      items: [
        { name: 'Steak', priceCents: 4500, assigneeIds: [VALID_UUID_1] },
      ],
    });
    expect(res.success).toBe(false);
  });

  it('rejects itemized expense with zero items (R5.7)', () => {
    const res = expenseCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Dinner',
      date: VALID_DATE,
      splitMode: 'itemized',
      items: [],
    });
    expect(res.success).toBe(false);
  });

  it('enforces catalog linking consistency (R11.1, R11.2, R11.8)', () => {
    // experienceId with non-dining category -> reject
    expect(
      expenseCreateSchema.safeParse({
        payerId: VALID_UUID_1,
        description: 'Hotel',
        date: VALID_DATE,
        category: 'hotel',
        splitMode: 'even',
        amountCents: 1000,
        participantIds: [VALID_UUID_1, VALID_UUID_2],
        experienceId: VALID_UUID_3,
      }).success,
    ).toBe(false);

    // resortId with non-hotel category -> reject
    expect(
      expenseCreateSchema.safeParse({
        payerId: VALID_UUID_1,
        description: 'Dining',
        date: VALID_DATE,
        category: 'dining',
        splitMode: 'even',
        amountCents: 1000,
        participantIds: [VALID_UUID_1, VALID_UUID_2],
        resortId: VALID_UUID_3,
      }).success,
    ).toBe(false);

    // both experienceId and resortId -> reject
    expect(
      expenseCreateSchema.safeParse({
        payerId: VALID_UUID_1,
        description: 'Both',
        date: VALID_DATE,
        category: 'dining',
        splitMode: 'even',
        amountCents: 1000,
        participantIds: [VALID_UUID_1, VALID_UUID_2],
        experienceId: VALID_UUID_2,
        resortId: VALID_UUID_3,
      }).success,
    ).toBe(false);
  });

  it('validates expenseEditSchema identically to create', () => {
    const res = expenseEditSchema.safeParse({
      payerId: VALID_UUID_1,
      description: 'Edited Expense',
      date: VALID_DATE,
      splitMode: 'even',
      amountCents: 5000,
      participantIds: [VALID_UUID_1, VALID_UUID_2],
    });
    expect(res.success).toBe(true);
  });
});

describe('settlementCreateSchema (R7.1, R7.2)', () => {
  it('accepts valid settlement between distinct members', () => {
    const res = settlementCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      recipientId: VALID_UUID_2,
      amountCents: 5000,
      date: VALID_DATE,
    });
    expect(res.success).toBe(true);
  });

  it('rejects settlement where payerId === recipientId (R7.2)', () => {
    const res = settlementCreateSchema.safeParse({
      payerId: VALID_UUID_1,
      recipientId: VALID_UUID_1,
      amountCents: 5000,
      date: VALID_DATE,
    });
    expect(res.success).toBe(false);
  });
});

describe('tripGuestAddSchema & tripGuestRenameSchema (R2.2, R2.11)', () => {
  it('accepts valid guest name', () => {
    expect(tripGuestAddSchema.safeParse({ name: 'Bobbie' }).success).toBe(true);
    expect(tripGuestRenameSchema.safeParse({ name: 'Robert' }).success).toBe(true);
  });

  it('accepts valid guest with optional sponsorMemberId', () => {
    expect(
      tripGuestAddSchema.safeParse({ name: 'Bobbie', sponsorMemberId: VALID_UUID_1 }).success,
    ).toBe(true);
    expect(
      tripGuestRenameSchema.safeParse({ name: 'Robert', sponsorMemberId: VALID_UUID_1 }).success,
    ).toBe(true);
  });

  it('rejects invalid sponsorMemberId', () => {
    expect(
      tripGuestAddSchema.safeParse({ name: 'Bobbie', sponsorMemberId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(
      tripGuestRenameSchema.safeParse({ name: 'Robert', sponsorMemberId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects empty or whitespace-only name', () => {
    expect(tripGuestAddSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(tripGuestRenameSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects over-length name (> 100 chars)', () => {
    expect(tripGuestAddSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });
});

describe('refundCreateSchema (R12.1, R12.2)', () => {
  it('accepts valid refund with positive amount', () => {
    const res = refundCreateSchema.safeParse({
      amountCents: 2500,
      date: VALID_DATE,
    });
    expect(res.success).toBe(true);
  });

  it('rejects non-positive amount', () => {
    expect(refundCreateSchema.safeParse({ amountCents: 0, date: VALID_DATE }).success).toBe(false);
    expect(refundCreateSchema.safeParse({ amountCents: -10, date: VALID_DATE }).success).toBe(false);
  });
});
