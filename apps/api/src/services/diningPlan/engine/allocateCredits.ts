/**
 * One Person's credit allocation for one plan (Requirement 10; design.md "Allocation"; Properties 3 and 5).
 *
 * Table-service meals: an exact 0/1 knapsack with weights 1 or 2 (the Credit_Cost) solved by a suffix DP, so a
 * two-credit meal is never taken greedily over two one-credit meals worth more together. Quick-service meals all
 * weigh 1, so the best `capacity.qs` by savings is optimal. Ties prefer earlier meals (by `order`).
 */

export interface AllocationItem {
  readonly id: string;
  readonly kind: 'ts' | 'qs';
  /** Credits the meal consumes: the Credit_Cost for `ts`, 1 for `qs`. */
  readonly weight: number;
  readonly savingsCents: number;
  /** Position by (date, meal period); smaller is earlier. */
  readonly order: number;
}

export interface AllocationCapacity {
  readonly ts: number;
  readonly qs: number;
}

function assertNonNegativeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${what} must be a non-negative integer, got ${value}`);
}

/** Earlier `order` first; `id` breaks an exact tie so the result never depends on input order. */
function byOrder(a: AllocationItem, b: AllocationItem): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The ids of the meals to cover. A meal with savings of 0 or less is never covered (Requirement 10.5). */
export function allocateCredits(items: readonly AllocationItem[], capacity: AllocationCapacity): Set<string> {
  assertNonNegativeInteger(capacity.ts, 'capacity.ts');
  assertNonNegativeInteger(capacity.qs, 'capacity.qs');
  for (const item of items) {
    if (!Number.isSafeInteger(item.weight) || item.weight < 1) {
      throw new RangeError(`weight of ${item.id} must be a positive integer, got ${item.weight}`);
    }
  }
  const covered = new Set<string>();

  // Table service: suffix DP. f[i][w] = best savings from items i.. with capacity w.
  const ts = items.filter((i) => i.kind === 'ts' && i.savingsCents > 0 && i.weight <= capacity.ts).sort(byOrder);
  const n = ts.length;
  const width = capacity.ts + 1;
  const f = new Float64Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    const { weight, savingsCents } = ts[i]!;
    for (let w = 0; w < width; w += 1) {
      const skip = f[(i + 1) * width + w]!;
      f[i * width + w] = weight <= w ? Math.max(skip, savingsCents + f[(i + 1) * width + w - weight]!) : skip;
    }
  }
  // Reconstruct forward: take item i whenever taking it is still optimal (">=" covers earlier meals on ties).
  let w = capacity.ts;
  for (let i = 0; i < n; i += 1) {
    const { id, weight, savingsCents } = ts[i]!;
    if (weight <= w && savingsCents + f[(i + 1) * width + w - weight]! >= f[(i + 1) * width + w]!) {
      covered.add(id);
      w -= weight;
    }
  }

  // Quick service: the highest savings first, earlier meals on ties.
  const qs = items
    .filter((i) => i.kind === 'qs' && i.savingsCents > 0)
    .sort((a, b) => b.savingsCents - a.savingsCents || byOrder(a, b));
  for (const item of qs.slice(0, capacity.qs)) covered.add(item.id);

  return covered;
}
