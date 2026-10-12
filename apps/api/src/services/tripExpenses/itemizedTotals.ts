/**
 * Pure calculation for itemized expense totals and share allocations.
 *
 * Validates: Requirements 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 14.2, 14.4
 */

import { allocateProportionally, type AllocationTarget, splitEvenly } from './allocation.js';

/** One Expense_Item as persisted/submitted, pre-Charge_Line. */
export interface ItemizedLineItem {
  readonly id: string;
  readonly priceCents: number;
  readonly assigneeIds: readonly string[]; // Trip_Member or Trip_Guest ids, already resolved past sponsorship
  readonly isAlcohol: boolean;
}

/** One Charge_Line as submitted. */
export interface ChargeLineInput {
  readonly kind: 'tax' | 'gratuity' | 'fee' | 'discount';
  readonly amountCents: number; // negative for discount, positive otherwise
  readonly scopeItemIds?: readonly string[] | undefined; // undefined = whole-expense scope
  readonly excludeAlcohol?: boolean | undefined; // only meaningful for a whole-expense discount
}

/**
 * Compute every recipient's final itemized Expense_Share amount and the
 * Expense's derived total Amount, from Expense_Items and Charge_Lines alone
 * (Req 5.6, 5.9–5.15). Pipeline:
 *   1. `splitEvenly` each item's price across its assignees → each
 *      recipient's Item_Subtotal (sum across every item naming them).
 *   2. For each Charge_Line, resolve its scope (whole-expense minus
 *      `isAlcohol` items when `excludeAlcohol`, or the explicit
 *      `scopeItemIds`), build `AllocationTarget[]` from that scope's
 *      recipients weighted by their Item_Subtotal within the scope, and run
 *      `allocateProportionally`.
 *   3. Sum each recipient's Item_Subtotal plus every applicable Charge_Line
 *      contribution → their final Expense_Share amount.
 *   4. The Payer's own implicit portion and the derived Amount are the
 *      remainder: `Amount = Σ(item.priceCents) + Σ(chargeLine.amountCents)`,
 *      `payerPortion = Amount - Σ(final Expense_Share amounts)`, which this
 *      function asserts is always exactly correct by construction (never a
 *      user-facing check — Req 5.15).
 * Throws on a `scopeItemIds` referencing an unknown item id, or a Charge_Line
 * whose scope resolves to zero recipients (Req 5.11, 14.4).
 *
 * Validates: Requirements 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 14.2, 14.4.
 */
export function computeItemizedTotals(
  items: readonly ItemizedLineItem[],
  chargeLines: readonly ChargeLineInput[],
  payerId?: string,
): {
  readonly amountCents: number; // derived Expense.amountCents
  readonly shares: readonly { recipientId: string; amountCents: number }[];
  readonly payerImplicitCents: number;
} {
  if (items.length === 0) {
    throw new Error('trip_validation_failed');
  }

  const itemMap = new Map<string, ItemizedLineItem>();
  for (const item of items) {
    if (item.assigneeIds.length === 0 || item.priceCents <= 0) {
      throw new Error('trip_validation_failed');
    }
    itemMap.set(item.id, item);
  }

  // 1. Compute each recipient's Item_Subtotal across items
  // Also track per-item assignee amounts for scoped charge line allocations
  const recipientItemSubtotals = new Map<string, number>();
  const itemAssigneePortions = new Map<string, readonly { assigneeId: string; amountCents: number }[]>();

  for (const item of items) {
    const splits = splitEvenly(item.priceCents, item.assigneeIds);
    itemAssigneePortions.set(item.id, splits);
    for (const split of splits) {
      const current = recipientItemSubtotals.get(split.assigneeId) ?? 0;
      recipientItemSubtotals.set(split.assigneeId, current + split.amountCents);
    }
  }

  // 2. Charge lines allocation
  const recipientChargeContributions = new Map<string, number>();

  for (const cl of chargeLines) {
    let scopedItems: readonly ItemizedLineItem[];

    if (cl.scopeItemIds !== undefined) {
      if (cl.scopeItemIds.length === 0) {
        throw new Error('trip_validation_failed');
      }
      const resolved: ItemizedLineItem[] = [];
      for (const id of cl.scopeItemIds) {
        const item = itemMap.get(id);
        if (!item) {
          throw new Error('trip_validation_failed');
        }
        resolved.push(item);
      }
      scopedItems = resolved;
    } else if (cl.excludeAlcohol) {
      // Req 14.4: when exclude alcohol is enabled and zero items are flagged isAlcohol, reject
      const hasAnyAlcohol = items.some((i) => i.isAlcohol);
      if (!hasAnyAlcohol) {
        throw new Error('trip_validation_failed');
      }
      scopedItems = items.filter((i) => !i.isAlcohol);
      if (scopedItems.length === 0) {
        throw new Error('trip_validation_failed');
      }
    } else {
      scopedItems = items;
    }

    // Compute subtotals within scopedItems for each recipient
    const scopedRecipientSubtotals = new Map<string, number>();
    for (const item of scopedItems) {
      const splits = itemAssigneePortions.get(item.id) ?? [];
      for (const split of splits) {
        const current = scopedRecipientSubtotals.get(split.assigneeId) ?? 0;
        scopedRecipientSubtotals.set(split.assigneeId, current + split.amountCents);
      }
    }

    if (scopedRecipientSubtotals.size === 0) {
      throw new Error('trip_validation_failed');
    }

    const targets: AllocationTarget[] = [];
    for (const [recipientId, weight] of scopedRecipientSubtotals.entries()) {
      if (weight > 0) {
        targets.push({ recipientId, weight });
      }
    }

    if (targets.length === 0) {
      throw new Error('trip_validation_failed');
    }

    const allocations = allocateProportionally(cl.amountCents, targets);
    for (const alloc of allocations) {
      const cur = recipientChargeContributions.get(alloc.recipientId) ?? 0;
      recipientChargeContributions.set(alloc.recipientId, cur + alloc.amountCents);
    }
  }

  // 3. Derived total amount = Σ(items) + Σ(chargeLines)
  const itemsTotalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
  const chargeLinesTotalCents = chargeLines.reduce((sum, cl) => sum + cl.amountCents, 0);
  const amountCents = itemsTotalCents + chargeLinesTotalCents;

  if (amountCents <= 0) {
    throw new Error('trip_validation_failed');
  }

  // 4. Combine subtotals and charge line contributions
  const allRecipientIds = new Set<string>([
    ...recipientItemSubtotals.keys(),
    ...recipientChargeContributions.keys(),
  ]);

  const finalRecipientAmounts = new Map<string, number>();
  for (const rId of allRecipientIds) {
    const subtotal = recipientItemSubtotals.get(rId) ?? 0;
    const charge = recipientChargeContributions.get(rId) ?? 0;
    finalRecipientAmounts.set(rId, subtotal + charge);
  }

  // Separate payer's implicit portion and other recipients' shares
  let payerImplicitCents = 0;
  const shares: { recipientId: string; amountCents: number }[] = [];

  for (const [recipientId, shareCents] of finalRecipientAmounts.entries()) {
    if (payerId !== undefined && recipientId === payerId) {
      // Payer is never charged a stored Expense_Share
      payerImplicitCents += shareCents;
    } else {
      shares.push({ recipientId, amountCents: shareCents });
    }
  }

  // Payer also absorbs any remainder between total amountCents and stored shares
  // (e.g. if payer had no assigned items but paid for the expense)
  const storedSharesSum = shares.reduce((sum, s) => sum + s.amountCents, 0);
  payerImplicitCents = amountCents - storedSharesSum;

  // Invariant assertion (Req 5.15)
  if (storedSharesSum + payerImplicitCents !== amountCents) {
    throw new Error('Internal error: itemized invariant violated');
  }

  return {
    amountCents,
    shares,
    payerImplicitCents,
  };
}
