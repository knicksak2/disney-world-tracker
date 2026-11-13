import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocateCredits, type AllocationItem } from '../allocateCredits.js';

function ts(id: string, weight: number, savingsCents: number, order: number): AllocationItem {
  return { id, kind: 'ts', weight, savingsCents, order };
}
function qs(id: string, savingsCents: number, order: number): AllocationItem {
  return { id, kind: 'qs', weight: 1, savingsCents, order };
}
const sorted = (s: Set<string>) => [...s].sort();

describe('allocateCredits: table service', () => {
  it('takes two one-credit meals over one two-credit meal worth less than both (the design counter-example)', () => {
    const items = [ts('crt', 2, 12_000, 0), ts('a', 1, 7_000, 1), ts('b', 1, 6_900, 2)];
    expect(sorted(allocateCredits(items, { ts: 2, qs: 0 }))).toEqual(['a', 'b']);
  });

  it('takes the two-credit meal when it is worth more than the best pair', () => {
    const items = [ts('crt', 2, 14_000, 0), ts('a', 1, 7_000, 1), ts('b', 1, 6_900, 2)];
    expect(sorted(allocateCredits(items, { ts: 2, qs: 0 }))).toEqual(['crt']);
    expect(sorted(allocateCredits(items, { ts: 3, qs: 0 }))).toEqual(['a', 'crt']);
  });

  it('covers nothing with capacity 0, and everything coverable when capacity exceeds the items', () => {
    const items = [ts('a', 1, 5_000, 0), ts('b', 2, 9_000, 1), qs('c', 1_800, 2)];
    expect(allocateCredits(items, { ts: 0, qs: 0 }).size).toBe(0);
    expect(sorted(allocateCredits(items, { ts: 40, qs: 40 }))).toEqual(['a', 'b', 'c']);
  });

  it('never fits a two-credit meal into one credit', () => {
    expect(allocateCredits([ts('crt', 2, 20_000, 0)], { ts: 1, qs: 0 }).size).toBe(0);
    expect(sorted(allocateCredits([ts('crt', 2, 20_000, 0), ts('a', 1, 100, 1)], { ts: 1, qs: 0 }))).toEqual(['a']);
  });

  it('covers the earliest meals when savings tie, whatever the input order', () => {
    const items = [ts('d', 1, 5_000, 3), ts('b', 1, 5_000, 1), ts('c', 1, 5_000, 2), ts('a', 1, 5_000, 0)];
    expect(sorted(allocateCredits(items, { ts: 2, qs: 0 }))).toEqual(['a', 'b']);
  });

  it('never covers a meal whose savings are 0 or less, even with spare credits', () => {
    expect(sorted(allocateCredits([ts('a', 1, 0, 0), ts('b', 1, -5, 1), ts('c', 1, 1, 2)], { ts: 5, qs: 0 }))).toEqual(['c']);
    expect(sorted(allocateCredits([qs('a', 0, 0), qs('b', 10, 1)], { ts: 0, qs: 5 }))).toEqual(['b']);
  });
});

describe('allocateCredits: quick service and kinds', () => {
  it('takes the highest-savings quick-service meals, earlier first on ties', () => {
    const items = [qs('a', 3_000, 0), qs('b', 5_000, 1), qs('c', 5_000, 2), qs('d', 4_000, 3)];
    expect(sorted(allocateCredits(items, { ts: 0, qs: 2 }))).toEqual(['b', 'c']);
    const boundary = [qs('x', 5_000, 0), qs('late', 4_000, 3), qs('early', 4_000, 1)];
    expect(sorted(allocateCredits(boundary, { ts: 0, qs: 2 }))).toEqual(['early', 'x']);
  });

  it('never covers a meal with the other kind of credit', () => {
    const items = [ts('t', 1, 9_000, 0), qs('q', 1_500, 1)];
    expect(sorted(allocateCredits(items, { ts: 0, qs: 5 }))).toEqual(['q']);
    expect(sorted(allocateCredits(items, { ts: 5, qs: 0 }))).toEqual(['t']);
  });

  it('rejects a negative or fractional capacity and a weight below 1', () => {
    expect(() => allocateCredits([], { ts: -1, qs: 0 })).toThrow(RangeError);
    expect(() => allocateCredits([], { ts: 0, qs: 1.5 })).toThrow(RangeError);
    expect(() => allocateCredits([ts('a', 0, 100, 0)], { ts: 1, qs: 0 })).toThrow(RangeError);
  });
});

/** Every subset, by brute force: the best total, and among the best sets the one that covers earlier meals first. */
function bruteForce(items: readonly AllocationItem[], capacity: number): { best: number; preferred: string[] } {
  const ordered = [...items].sort((a, b) => a.order - b.order);
  let best = 0;
  let preferred: boolean[] = ordered.map(() => false);
  for (let mask = 0; mask < 1 << ordered.length; mask += 1) {
    let weight = 0;
    let savings = 0;
    let valid = true;
    const take = ordered.map((_, i) => (mask & (1 << i)) !== 0);
    take.forEach((t, i) => {
      if (!t) return;
      weight += ordered[i]!.weight;
      savings += ordered[i]!.savingsCents;
      if (ordered[i]!.savingsCents <= 0) valid = false;
    });
    if (!valid || weight > capacity) continue;
    // Lexicographically prefer covering the earlier meal at the first difference.
    const firstDiff = take.findIndex((t, i) => t !== preferred[i]);
    if (savings > best || (savings === best && firstDiff >= 0 && take[firstDiff])) {
      best = savings;
      preferred = take;
    }
  }
  return { best, preferred: ordered.filter((_, i) => preferred[i]).map((it) => it.id).sort() };
}

describe('allocation properties', () => {
  const tsItemsArb = fc
    .array(fc.record({ weight: fc.constantFrom(1, 2), savingsCents: fc.integer({ min: -500, max: 20_000 }) }), { maxLength: 10 })
    .chain((raw) =>
      fc.shuffledSubarray(raw.map((_, i) => i), { minLength: raw.length, maxLength: raw.length }).map((orders) =>
        raw.map((r, i) => ts(`m${i}`, r.weight, r.savingsCents, orders[i]!)),
      ),
    );

  // Feature: dining-plan-calculator, Property 3: Credit allocation is optimal
  // Validates: Requirements 10.1, 10.3, 10.5
  it('Property 3: table-service allocation equals the brute-force optimum and fits the capacity; quick service takes the top meals', () => {
    fc.assert(
      fc.property(tsItemsArb, fc.integer({ min: 0, max: 12 }), fc.array(fc.integer({ min: -100, max: 9_000 }), { maxLength: 10 }), fc.integer({ min: 0, max: 12 }), (tsItems, tsCap, qsSavings, qsCap) => {
        const qsItems = qsSavings.map((s, i) => qs(`q${i}`, s, 100 + i));
        const covered = allocateCredits([...tsItems, ...qsItems], { ts: tsCap, qs: qsCap });
        const tsCovered = tsItems.filter((it) => covered.has(it.id));
        expect(tsCovered.reduce((a, it) => a + it.weight, 0)).toBeLessThanOrEqual(tsCap);
        expect(tsCovered.reduce((a, it) => a + it.savingsCents, 0)).toBe(bruteForce(tsItems, tsCap).best);
        for (const it of tsCovered) expect(it.savingsCents).toBeGreaterThan(0);

        const qsCovered = qsItems.filter((it) => covered.has(it.id));
        const positive = qsSavings.filter((s) => s > 0).sort((a, b) => b - a);
        expect(qsCovered.length).toBe(Math.min(qsCap, positive.length));
        expect(qsCovered.reduce((a, it) => a + it.savingsCents, 0)).toBe(positive.slice(0, qsCap).reduce((a, s) => a + s, 0));
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dining-plan-calculator, Property 5: Allocation is deterministic with earlier-meal ties
  // Validates: Requirements 10.4, 16.9
  it('Property 5: input order never matters, and ties cover the earliest meals', () => {
    fc.assert(
      fc.property(tsItemsArb, fc.integer({ min: 0, max: 12 }), fc.integer(), (items, cap, seed) => {
        const base = sorted(allocateCredits(items, { ts: cap, qs: 0 }));
        const permuted = [...items].sort((a, b) => ((a.order * 7919 + seed) % 13) - ((b.order * 7919 + seed) % 13));
        expect(sorted(allocateCredits(permuted, { ts: cap, qs: 0 }))).toEqual(base);
        expect(sorted(allocateCredits([...items].reverse(), { ts: cap, qs: 0 }))).toEqual(base);
        // Among every optimal set, the one chosen covers the earlier meal at the first difference.
        expect(base).toEqual(bruteForce(items, cap).preferred);
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 }), fc.constantFrom(1, 2), fc.integer({ min: 1, max: 9_000 }), (n, cap, weight, savings) => {
        const items = Array.from({ length: n }, (_, i) => ts(`m${n - 1 - i}`, weight, savings, n - 1 - i));
        const covered = allocateCredits(items, { ts: cap, qs: 0 });
        const k = Math.min(n, Math.floor(cap / weight));
        expect(sorted(covered)).toEqual(Array.from({ length: k }, (_, i) => `m${i}`).sort());
      }),
      { numRuns: 200 },
    );
  });
});
