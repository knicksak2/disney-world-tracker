/**
 * Pure allocation primitives for Trip Expenses.
 *
 * Validates: Requirements 3.4, 3.5, 5.3, 5.4, 5.9, 5.10, 5.11, 12.3
 */

/** One (recipientId, weight) pair to receive a proportional slice of a signed integer-cent amount. */
export interface AllocationTarget {
  readonly recipientId: string;
  readonly weight: number; // non-negative; e.g. an Item_Subtotal or an original Expense_Share amount
}

/**
 * Distribute `totalCents` (may be negative, e.g. a discount or Refund) across
 * `targets` in proportion to each target's weight, in integer cents, such
 * that the returned amounts sum to exactly `totalCents`. Each target's base
 * share is `round(totalCents * weight / sum(weights))`; the remainder
 * (`totalCents - sum(base shares)`) is distributed one cent at a time, in
 * `targets` array order, to make the total exact. Returns an empty array
 * when `targets` is empty or `sum(weights)` is zero (the caller is expected
 * to route the full `totalCents` to the Payer's implicit portion in that
 * case). This single primitive backs both Charge_Line allocation (Req 5.10,
 * 5.11) and Refund distribution (Req 12.3) so there is one rounding rule.
 *
 * Validates: Requirements 5.9, 5.10, 5.11, 12.3.
 */
export function allocateProportionally(
  totalCents: number,
  targets: readonly AllocationTarget[],
): readonly { recipientId: string; amountCents: number }[] {
  if (targets.length === 0) {
    return [];
  }

  const sumWeights = targets.reduce((sum, t) => sum + t.weight, 0);
  if (sumWeights <= 0) {
    return [];
  }

  const resultAmounts: number[] = targets.map((t) =>
    Math.round((totalCents * t.weight) / sumWeights),
  );

  const allocatedSum = resultAmounts.reduce((sum, val) => sum + val, 0);
  const remainder = totalCents - allocatedSum;

  if (remainder !== 0) {
    const step = remainder > 0 ? 1 : -1;
    let remaining = Math.abs(remainder);
    let idx = 0;
    while (remaining > 0) {
      resultAmounts[idx % targets.length]! += step;
      remaining--;
      idx++;
    }
  }

  return targets.map((t, i) => ({
    recipientId: t.recipientId,
    amountCents: resultAmounts[i]!,
  }));
}

/**
 * Split `priceCents` evenly in integer cents across `assigneeIds`, assigning
 * the base `floor(priceCents / assigneeIds.length)` to everyone and the
 * remainder one cent at a time in array order (Req 3.4, 5.4). Degenerates to
 * `[{ assigneeId: assigneeIds[0], amountCents: priceCents }]` for a
 * single-assignee input (Req 5.3).
 *
 * Validates: Requirements 3.4, 3.5, 5.3, 5.4.
 */
export function splitEvenly(
  priceCents: number,
  assigneeIds: readonly string[],
): readonly { assigneeId: string; amountCents: number }[] {
  if (assigneeIds.length === 0) {
    return [];
  }

  if (assigneeIds.length === 1) {
    return [{ assigneeId: assigneeIds[0]!, amountCents: priceCents }];
  }

  const count = assigneeIds.length;
  const base = Math.floor(priceCents / count);
  const remainder = priceCents - base * count;

  return assigneeIds.map((assigneeId, idx) => ({
    assigneeId,
    amountCents: base + (idx < remainder ? 1 : 0),
  }));
}
