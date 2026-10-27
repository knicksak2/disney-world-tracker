// Feature: trip-expenses, Property 3: Net_Balance always sums to exactly zero
/**
 * Property and unit tests for Net_Balances and Pairwise Balances.
 *
 * Validates: Requirements 2.7, 6.1, 6.2, 6.3, 6.5, 6.6
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type BalanceEvent,
  computeNetBalances,
  computePairwiseBalances,
} from '../balances.js';

describe('computeNetBalances and computePairwiseBalances', () => {
  it('handles Crystal Palace prix-fixe $57/$37 adult/child tier example', () => {
    const payer = 'user-alice';
    const memberBob = 'user-bob';
    // Bob has 1 Adult ($57) and 1 Child ($37) = $94 (9400 cents)
    // Alice paid for the whole meal
    const events: BalanceEvent[] = [
      {
        kind: 'expense_payer',
        memberId: payer,
        amountCents: 9400,
        counterpartyId: memberBob,
        sourceId: 'expense-1',
        description: 'Crystal Palace Lunch',
        date: '2026-10-02',
      },
      {
        kind: 'expense_share',
        memberId: memberBob,
        amountCents: 9400,
        counterpartyId: payer,
        sourceId: 'expense-1',
        description: 'Crystal Palace Lunch',
        date: '2026-10-02',
      },
    ];

    const net = computeNetBalances(events, [payer, memberBob]);
    expect(net.get(payer)).toBe(9400); // Alice is owed 9400
    expect(net.get(memberBob)).toBe(-9400); // Bob owes 9400
    expect(net.get(payer)! + net.get(memberBob)!).toBe(0);

    const pairwise = computePairwiseBalances(events);
    expect(pairwise).toHaveLength(1);
    // Alice and Bob:
    const a = payer < memberBob ? payer : memberBob;
    const b = payer < memberBob ? memberBob : payer;
    // If a is Alice, Alice owes Bob -9400 (Bob owes Alice 9400)
    // If a is Bob, Bob owes Alice 9400
    const pair = pairwise[0]!;
    expect(pair.memberIdA).toBe(a);
    expect(pair.memberIdB).toBe(b);
    if (pair.memberIdA === memberBob) {
      expect(pair.aOwesB).toBe(9400);
    } else {
      expect(pair.aOwesB).toBe(-9400);
    }
  });

  it('Property 3: Net_Balance always sums to exactly zero (>= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 6 }), // members
        fc.array(
          fc.record({
            sourceId: fc.uuid(),
            memberIndexA: fc.integer({ min: 0, max: 5 }),
            memberIndexB: fc.integer({ min: 0, max: 5 }),
            amountCents: fc.integer({ min: 1, max: 50_000 }),
            isSettlement: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (allMemberIds, rawInteractions) => {
          const events: BalanceEvent[] = [];

          for (const inter of rawInteractions) {
            const idA = allMemberIds[inter.memberIndexA % allMemberIds.length]!;
            const idB = allMemberIds[inter.memberIndexB % allMemberIds.length]!;
            if (idA === idB) continue;

            if (inter.isSettlement) {
              // idA pays idB
              events.push({
                kind: 'settlement_paid',
                memberId: idA,
                counterpartyId: idB,
                amountCents: inter.amountCents,
                sourceId: inter.sourceId,
                description: 'Repayment',
                date: '2026-10-02',
              });
              events.push({
                kind: 'settlement_received',
                memberId: idB,
                counterpartyId: idA,
                amountCents: inter.amountCents,
                sourceId: inter.sourceId,
                description: 'Repayment',
                date: '2026-10-02',
              });
            } else {
              // idA is payer, idB owes idA
              events.push({
                kind: 'expense_payer',
                memberId: idA,
                counterpartyId: idB,
                amountCents: inter.amountCents,
                sourceId: inter.sourceId,
                description: 'Shared Expense',
                date: '2026-10-02',
              });
              events.push({
                kind: 'expense_share',
                memberId: idB,
                counterpartyId: idA,
                amountCents: inter.amountCents,
                sourceId: inter.sourceId,
                description: 'Shared Expense',
                date: '2026-10-02',
              });
            }
          }

          const balances = computeNetBalances(events, allMemberIds);

          // All members have an entry
          for (const mId of allMemberIds) {
            expect(balances.has(mId)).toBe(true);
          }

          // Invariant: sum of all net balances is exactly 0
          let total = 0;
          for (const net of balances.values()) {
            total += net;
          }
          expect(total).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('omits pairs with zero mutual balance in computePairwiseBalances', () => {
    const userA = 'user-a';
    const userB = 'user-b';

    // userB owes userA 5000, then userB pays userA 5000
    const events: BalanceEvent[] = [
      {
        kind: 'expense_share',
        memberId: userB,
        counterpartyId: userA,
        amountCents: 5000,
        sourceId: 'exp-1',
        description: 'Dinner',
        date: '2026-10-01',
      },
      {
        kind: 'expense_payer',
        memberId: userA,
        counterpartyId: userB,
        amountCents: 5000,
        sourceId: 'exp-1',
        description: 'Dinner',
        date: '2026-10-01',
      },
      {
        kind: 'settlement_paid',
        memberId: userB,
        counterpartyId: userA,
        amountCents: 5000,
        sourceId: 'set-1',
        description: 'Repayment',
        date: '2026-10-02',
      },
      {
        kind: 'settlement_received',
        memberId: userA,
        counterpartyId: userB,
        amountCents: 5000,
        sourceId: 'set-1',
        description: 'Repayment',
        date: '2026-10-02',
      },
    ];

    const net = computeNetBalances(events, [userA, userB]);
    expect(net.get(userA)).toBe(0);
    expect(net.get(userB)).toBe(0);

    const pairwise = computePairwiseBalances(events);
    expect(pairwise).toHaveLength(0); // net zero omitted!
  });

  it('reduces net balances toward zero when a partial settlement is paid (Req 6.2, 7.1)', () => {
    const creditor = 'user-knicksak2';
    const debtor = 'user-test';

    // debtor owes creditor $100.00 (10000 cents), then pays $8.00 (800 cents)
    const events: BalanceEvent[] = [
      {
        kind: 'expense_payer',
        memberId: creditor,
        counterpartyId: debtor,
        amountCents: 10000,
        sourceId: 'exp-1',
        description: 'Halloween party tickets',
        date: '2026-10-06',
      },
      {
        kind: 'expense_share',
        memberId: debtor,
        counterpartyId: creditor,
        amountCents: 10000,
        sourceId: 'exp-1',
        description: 'Halloween party tickets',
        date: '2026-10-06',
      },
      {
        kind: 'settlement_paid',
        memberId: debtor,
        counterpartyId: creditor,
        amountCents: 800,
        sourceId: 'set-1',
        description: 'Settlement',
        date: '2026-10-27',
      },
      {
        kind: 'settlement_received',
        memberId: creditor,
        counterpartyId: debtor,
        amountCents: 800,
        sourceId: 'set-1',
        description: 'Settlement',
        date: '2026-10-27',
      },
    ];

    const net = computeNetBalances(events, [creditor, debtor]);
    expect(net.get(creditor)).toBe(9200);
    expect(net.get(debtor)).toBe(-9200);
  });

  it('reports 0 for members with no activity (Req 6.3)', () => {
    const userA = 'user-a';
    const userB = 'user-b';
    const userC = 'user-c'; // no events

    const events: BalanceEvent[] = [
      {
        kind: 'expense_payer',
        memberId: userA,
        counterpartyId: userB,
        amountCents: 1000,
        sourceId: 'exp-1',
        description: 'Snack',
        date: '2026-10-01',
      },
      {
        kind: 'expense_share',
        memberId: userB,
        counterpartyId: userA,
        amountCents: 1000,
        sourceId: 'exp-1',
        description: 'Snack',
        date: '2026-10-01',
      },
    ];

    const net = computeNetBalances(events, [userA, userB, userC]);
    expect(net.get(userC)).toBe(0);
  });
});
