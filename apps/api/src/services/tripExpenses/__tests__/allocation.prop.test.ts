// Feature: trip-expenses, Property 2: allocateProportionally and splitEvenly are exact and deterministic
/**
 * Property and unit tests for pure allocation primitives.
 *
 * Validates: Requirements 3.4, 3.5, 5.3, 5.4, 5.10, 5.11, 12.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocateProportionally, type AllocationTarget, splitEvenly } from '../allocation.js';

describe('splitEvenly', () => {
  it('handles the $1,321.65 two-way even split example', () => {
    // 132165 cents split across two assignees
    const res = splitEvenly(132165, ['user-1', 'user-2']);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ assigneeId: 'user-1', amountCents: 66083 });
    expect(res[1]).toEqual({ assigneeId: 'user-2', amountCents: 66082 });
    expect(res[0]!.amountCents + res[1]!.amountCents).toBe(132165);
  });

  it('handles single assignee', () => {
    const res = splitEvenly(5000, ['user-1']);
    expect(res).toEqual([{ assigneeId: 'user-1', amountCents: 5000 }]);
  });

  it('handles empty assignees', () => {
    expect(splitEvenly(5000, [])).toEqual([]);
  });

  it('Property 2: splitEvenly is exact and deterministic (>= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        (priceCents, rawIds) => {
          // unique assignee ids
          const assigneeIds = Array.from(new Set(rawIds));
          if (assigneeIds.length === 0) return;

          const res1 = splitEvenly(priceCents, assigneeIds);
          const res2 = splitEvenly(priceCents, assigneeIds);

          // Determinism
          expect(res1).toEqual(res2);

          // Exact sum
          const sum = res1.reduce((acc, r) => acc + r.amountCents, 0);
          expect(sum).toBe(priceCents);

          // Each share within 1 cent of priceCents / length
          const ideal = priceCents / assigneeIds.length;
          for (const r of res1) {
            expect(Math.abs(r.amountCents - ideal)).toBeLessThan(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('allocateProportionally', () => {
  it('Property 2: allocateProportionally is exact and deterministic (>= 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.array(
          fc.record({
            recipientId: fc.uuid(),
            weight: fc.integer({ min: 1, max: 100_000 }),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        (totalCents, targets: AllocationTarget[]) => {
          const res1 = allocateProportionally(totalCents, targets);
          const res2 = allocateProportionally(totalCents, targets);

          // Determinism
          expect(res1).toEqual(res2);

          // Exact sum
          const sum = res1.reduce((acc, r) => acc + r.amountCents, 0);
          expect(sum).toBe(totalCents);

          // Within 1 cent of ideal continuous share
          const sumWeights = targets.reduce((acc, t) => acc + t.weight, 0);
          for (let i = 0; i < targets.length; i++) {
            const ideal = (totalCents * targets[i]!.weight) / sumWeights;
            expect(Math.abs(res1[i]!.amountCents - ideal)).toBeLessThan(1.5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('handles negative discount allocation exactness', () => {
    const targets: AllocationTarget[] = [
      { recipientId: 'user-1', weight: 4000 },
      { recipientId: 'user-2', weight: 6000 },
    ];
    // -1500 cents discount (40% to user-1 = -600, 60% to user-2 = -900)
    const res = allocateProportionally(-1500, targets);
    expect(res).toEqual([
      { recipientId: 'user-1', amountCents: -600 },
      { recipientId: 'user-2', amountCents: -900 },
    ]);
    expect(res.reduce((s, r) => s + r.amountCents, 0)).toBe(-1500);
  });

  it('handles empty targets or zero weights', () => {
    expect(allocateProportionally(1000, [])).toEqual([]);
    expect(
      allocateProportionally(1000, [{ recipientId: 'user-1', weight: 0 }]),
    ).toEqual([]);
  });
});
