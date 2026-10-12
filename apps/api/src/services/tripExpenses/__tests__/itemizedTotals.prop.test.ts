// Feature: trip-expenses, Property 1: Every Split_Mode's shares plus the Payer's implicit portion sum to exactly the Amount
// Feature: trip-expenses, Property 5: A Charge_Line's alcohol exclusion never allocates to a flagged item's assignees via that Charge_Line
/**
 * Property and unit tests for itemized totals and charge line allocations.
 *
 * Validates: Requirements 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 14.2, 14.4
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type ChargeLineInput,
  computeItemizedTotals,
  type ItemizedLineItem,
} from '../itemizedTotals.js';

describe('computeItemizedTotals', () => {
  it('handles concrete receipt: food + alcohol + tax + 20% gratuity + alcohol-excluded discount', () => {
    const payer = 'user-payer';
    const guest1 = 'user-guest1';
    const guest2 = 'user-guest2';

    const items: ItemizedLineItem[] = [
      {
        id: 'item-food-1',
        priceCents: 5000, // $50 steak for guest1
        assigneeIds: [guest1],
        isAlcohol: false,
      },
      {
        id: 'item-food-2',
        priceCents: 3000, // $30 shared pizza for guest1 and guest2 ($15 each)
        assigneeIds: [guest1, guest2],
        isAlcohol: false,
      },
      {
        id: 'item-alcohol',
        priceCents: 2000, // $20 cocktail for guest2
        assigneeIds: [guest2],
        isAlcohol: true,
      },
      {
        id: 'item-payer-food',
        priceCents: 4000, // $40 burger for payer
        assigneeIds: [payer],
        isAlcohol: false,
      },
    ];

    // Subtotals:
    // guest1: $50 + $15 = $65 (6500 cents)
    // guest2: $15 + $20 = $35 (3500 cents)
    // payer: $40 (4000 cents)
    // Total items = 14000 cents ($140)

    // Non-alcohol items: food-1 ($50), food-2 ($30), payer-food ($40) = $120 (12000 cents)
    // Non-alcohol subtotals:
    // guest1: $65 (6500)
    // guest2: $15 (1500)
    // payer: $40 (4000)

    const chargeLines: ChargeLineInput[] = [
      // Tax: $14 across all items (1400 cents)
      { kind: 'tax', amountCents: 1400 },
      // Gratuity: 20% of $140 = $28 (2800 cents)
      { kind: 'gratuity', amountCents: 2800 },
      // Discount: -$12 (1200 cents) excluding alcohol
      { kind: 'discount', amountCents: -1200, excludeAlcohol: true },
    ];

    const result = computeItemizedTotals(items, chargeLines, payer);

    // Derived amount = 14000 + 1400 + 2800 - 1200 = 17000 cents ($170.00)
    expect(result.amountCents).toBe(17000);

    // Sum of shares + payer implicit = derived amount
    const sharesSum = result.shares.reduce((sum, s) => sum + s.amountCents, 0);
    expect(sharesSum + result.payerImplicitCents).toBe(result.amountCents);

    // Payer is NOT in shares
    expect(result.shares.some((s) => s.recipientId === payer)).toBe(false);

    // Guest 1 and Guest 2 are in shares
    expect(result.shares).toHaveLength(2);
  });

  it('rejects excludeAlcohol when zero items are flagged alcohol (Req 14.4)', () => {
    const items: ItemizedLineItem[] = [
      { id: 'item-1', priceCents: 2000, assigneeIds: ['user-1'], isAlcohol: false },
    ];
    const chargeLines: ChargeLineInput[] = [
      { kind: 'discount', amountCents: -500, excludeAlcohol: true },
    ];

    expect(() => computeItemizedTotals(items, chargeLines, 'payer')).toThrow(
      'trip_validation_failed',
    );
  });

  it('rejects invalid or empty scopeItemIds (Req 5.11)', () => {
    const items: ItemizedLineItem[] = [
      { id: 'item-1', priceCents: 2000, assigneeIds: ['user-1'], isAlcohol: false },
    ];

    // empty scope
    expect(() =>
      computeItemizedTotals(
        items,
        [{ kind: 'tax', amountCents: 100, scopeItemIds: [] }],
        'payer',
      ),
    ).toThrow('trip_validation_failed');

    // unknown item id
    expect(() =>
      computeItemizedTotals(
        items,
        [{ kind: 'tax', amountCents: 100, scopeItemIds: ['non-existent-item'] }],
        'payer',
      ),
    ).toThrow('trip_validation_failed');
  });

  it('Property 1: Every Split_Mode shares plus Payer implicit portion sum to exactly derived Amount (>= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // payerId
        fc.array(
          fc.record({
            id: fc.uuid(),
            priceCents: fc.integer({ min: 100, max: 20_000 }),
            assigneeIds: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
            isAlcohol: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(
          fc.record({
            kind: fc.constantFrom<'tax' | 'gratuity' | 'fee'>('tax', 'gratuity', 'fee'),
            amountCents: fc.integer({ min: 1, max: 2000 }),
          }),
          { maxLength: 3 },
        ),
        (payerId, rawItems, chargeLines) => {
          // unique item ids and deduplicated assignees
          const seen = new Set<string>();
          const items: ItemizedLineItem[] = [];
          for (const item of rawItems) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              items.push({
                ...item,
                assigneeIds: Array.from(new Set(item.assigneeIds)),
              });
            }
          }
          if (items.length === 0) return;

          const res = computeItemizedTotals(items, chargeLines, payerId);

          // Invariant: sum(shares) + payerImplicit === derived amount
          const sharesSum = res.shares.reduce((s, sh) => s + sh.amountCents, 0);
          expect(sharesSum + res.payerImplicitCents).toBe(res.amountCents);

          // Payer is never in shares
          expect(res.shares.some((s) => s.recipientId === payerId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 5: Charge_Line alcohol exclusion never allocates to a flagged item assignee via that Charge_Line (>= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // alcohol-only user
        fc.uuid(), // food user
        fc.integer({ min: 500, max: 5000 }),
        fc.integer({ min: 500, max: 5000 }),
        fc.integer({ min: -500, max: -10 }),
        (alcoholUser, foodUser, alcPrice, foodPrice, discountCents) => {
          if (alcoholUser === foodUser) return;

          const items: ItemizedLineItem[] = [
            {
              id: 'alcohol-item',
              priceCents: alcPrice,
              assigneeIds: [alcoholUser],
              isAlcohol: true,
            },
            {
              id: 'food-item',
              priceCents: foodPrice,
              assigneeIds: [foodUser],
              isAlcohol: false,
            },
          ];

          const chargeLines: ChargeLineInput[] = [
            {
              kind: 'discount',
              amountCents: discountCents,
              excludeAlcohol: true,
            },
          ];

          const res = computeItemizedTotals(items, chargeLines);

          // The alcohol-only user must NOT receive any discount from this Charge_Line
          // Their final share must equal their exact alcohol item price
          const alcoholShare = res.shares.find((s) => s.recipientId === alcoholUser);
          expect(alcoholShare?.amountCents).toBe(alcPrice);

          // The food user absorbs the entire discount
          const foodShare = res.shares.find((s) => s.recipientId === foodUser);
          expect(foodShare?.amountCents).toBe(foodPrice + discountCents);
        },
      ),
      { numRuns: 100 },
    );
  });
});
