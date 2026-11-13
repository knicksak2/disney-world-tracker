/**
 * One Person's credit allocation across consecutive plan-active Plan_Stays (Requirements 25.6, 25.7; design.md
 * "Multi-Stay Extension" step 4; Properties 29, 30 and 34).
 *
 * Each stay's credits are its own (they never carry over), and a meal can use a stay's credits only on a date of that
 * stay, check-in to check-out inclusive. So a meal on a Hand_Off_Date (one stay's check-out and the next one's
 * check-in) is *flexible*: either stay may cover it. Every other meal is fixed to the one stay containing its date.
 *
 * A DP over the stays in date order decides which flexible meals each hand-off offers to the outgoing stay; the
 * incoming stay is offered the rest. (The design also enumerates subsets of the rest for the incoming stay; offering
 * a knapsack more items never lowers its value, so offering all of them reaches the same optimum.) Each stay then
 * solves its exact single-stay knapsack (`allocateCredits`) over its fixed meals plus the flexible meals offered to it.
 * At most 3 flexible meals exist per hand-off (one per meal period), so each stage has at most 8 x 8 transitions.
 */

import { allocateCredits, type AllocationCapacity, type AllocationItem } from './allocateCredits.js';

export interface CrossStayMeal extends AllocationItem {
  readonly date: string;
}

export interface ActiveStay {
  readonly key: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly capacity: AllocationCapacity;
}

function bitCount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) n += 1;
  return n;
}

/**
 * True when claim set `a` is preferred to `b` on an equal total: more meals claimed by the outgoing stay, then the set
 * holding the earlier meal at the first difference (bit j is the j-th flexible meal in `order`).
 */
function preferredClaim(a: number, b: number): boolean {
  const ca = bitCount(a);
  const cb = bitCount(b);
  if (ca !== cb) return ca > cb;
  const diff = a ^ b;
  if (diff === 0) return false;
  return (a & diff & -diff) !== 0;
}

function byOrder(a: AllocationItem, b: AllocationItem): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Maps every meal id to the key of the stay whose credits cover it, or null when it is paid out of pocket. With one
 * active stay this is exactly `allocateCredits` over the meals in that stay.
 */
export function allocateAcrossStays(meals: readonly CrossStayMeal[], stays: readonly ActiveStay[]): Map<string, string | null> {
  const result = new Map<string, string | null>(meals.map((m) => [m.id, null]));
  const ordered = [...stays].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
  const n = ordered.length;
  if (n === 0) return result;
  for (let i = 1; i < n; i += 1) {
    // Stays share at most their hand-off date (trip-lodging-stays rejects overlapping nights).
    if (ordered[i]!.checkIn < ordered[i - 1]!.checkOut) {
      throw new RangeError(`stays ${ordered[i - 1]!.key} and ${ordered[i]!.key} share nights`);
    }
  }

  const fixed: CrossStayMeal[][] = ordered.map(() => []);
  // flex[i]: the meals at the hand-off between stay i and stay i + 1.
  const flex: CrossStayMeal[][] = ordered.map(() => []);
  for (const meal of [...meals].sort(byOrder)) {
    const eligible: number[] = [];
    ordered.forEach((s, i) => {
      if (s.checkIn <= meal.date && meal.date <= s.checkOut) eligible.push(i);
    });
    // With no shared nights a date is in at most two stays, and then they are consecutive and it is their hand-off.
    // A zero-night stay is never active (its plan is unavailable, `no_nights`), so three stays never share a date.
    if (eligible.length === 1) fixed[eligible[0]!]!.push(meal);
    else if (eligible.length === 2) flex[eligible[0]!]!.push(meal);
    else if (eligible.length > 2) throw new RangeError(`meal ${meal.id} on ${meal.date} falls in ${eligible.length} stays`);
  }

  const memo = new Map<string, { value: number; covered: Set<string> }>();
  const knapsack = (i: number, inMask: number, outMask: number) => {
    const key = `${i}:${inMask}:${outMask}`;
    let hit = memo.get(key);
    if (hit === undefined) {
      const inFlex = i > 0 ? flex[i - 1]! : [];
      const outFlex = i < n - 1 ? flex[i]! : [];
      // The incoming stay is offered the previous hand-off's meals the outgoing stay did not claim.
      const offered = [
        ...fixed[i]!,
        ...inFlex.filter((_, j) => (inMask & (1 << j)) === 0),
        ...outFlex.filter((_, j) => (outMask & (1 << j)) !== 0),
      ];
      const covered = allocateCredits(offered, ordered[i]!.capacity);
      const value = offered.reduce((sum, m) => (covered.has(m.id) ? sum + m.savingsCents : sum), 0);
      hit = { value, covered };
      memo.set(key, hit);
    }
    return hit;
  };

  // stage[i][X] = best savings over stays 0..i when stay i claims X of the outgoing hand-off, and the claim of the
  // previous hand-off (by stay i - 1) that achieves it.
  const stage: { value: number; prevClaim: number }[][] = [];
  for (let i = 0; i < n; i += 1) {
    const inCount = i > 0 ? flex[i - 1]!.length : 0;
    const outCount = i < n - 1 ? flex[i]!.length : 0;
    const row: { value: number; prevClaim: number }[] = [];
    for (let x = 0; x < 1 << outCount; x += 1) {
      let best: { value: number; prevClaim: number } | null = null;
      for (let prev = 0; prev < 1 << inCount; prev += 1) {
        const before = i > 0 ? stage[i - 1]![prev]!.value : 0;
        const value = before + knapsack(i, prev, x).value;
        if (best === null || value > best.value || (value === best.value && preferredClaim(prev, best.prevClaim))) {
          best = { value, prevClaim: prev };
        }
      }
      row.push(best!);
    }
    stage.push(row);
  }

  // Reconstruct from the last stay, which has no outgoing hand-off.
  let claim = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const { prevClaim } = stage[i]![claim]!;
    for (const id of knapsack(i, prevClaim, claim).covered) result.set(id, ordered[i]!.key);
    claim = prevClaim;
  }
  return result;
}
