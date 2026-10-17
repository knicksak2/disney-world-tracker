import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  nameKey,
  selectStarterToAdd,
  wouldExceedCap,
  sortPackingItems,
  summarizePacking,
  projectAssignee,
  nextPackedState,
} from '../packing.js';
import {
  PACKING_CATEGORIES,
  STARTER_PACKING_LIST,
  type PackingCategory,
} from '@dwt/shared';

describe('packing.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 30: The Packing_List never exceeds 300 items, and batch adds are all-or-nothing
  it('Property 30: The Packing_List never exceeds 300 items, and batch adds are all-or-nothing', () => {
    // Exact boundary tests around 300
    expect(wouldExceedCap(300, 1)).toBe(true);
    expect(wouldExceedCap(299, 1)).toBe(false);
    expect(wouldExceedCap(299, 2)).toBe(true);
    expect(wouldExceedCap(0, 300)).toBe(false);
    expect(wouldExceedCap(0, 301)).toBe(true);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 350 }),
        fc.integer({ min: 1, max: 50 }),
        (existing, toAdd) => {
          const exceeds = wouldExceedCap(existing, toAdd);
          expect(exceeds).toBe(existing + toAdd > 300);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 31: The starter action adds exactly the missing entries and is idempotent
  it('Property 31: The starter action adds exactly the missing entries and is idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(
              '  sunscreen ',
              'SUNSCREEN',
              'MagicBand or physical ticket',
              'magicband or physical ticket',
              'Phone charger & battery',
              'UNKNOWN_ITEM'
            ),
            fc.string({ minLength: 1, maxLength: 30 })
          )
        ),
        existingNames => {
          const toAdd = selectStarterToAdd(existingNames, STARTER_PACKING_LIST);

          // All selected items are from STARTER_PACKING_LIST
          for (const item of toAdd) {
            expect(STARTER_PACKING_LIST).toContain(item);
          }

          // Case-insensitive / whitespace trimmed check: none of the selected items were in existingNames
          const existingKeys = new Set(existingNames.map(nameKey));
          for (const item of toAdd) {
            expect(existingKeys.has(nameKey(item.name))).toBe(false);
          }

          // Order is strictly preserved
          let lastStarterIdx = -1;
          for (const item of toAdd) {
            const idx = STARTER_PACKING_LIST.indexOf(item);
            expect(idx).toBeGreaterThan(lastStarterIdx);
            lastStarterIdx = idx;
          }

          // Idempotency: re-running with existingNames + toAdd yields 0 items
          const combinedNames = [...existingNames, ...toAdd.map(i => i.name)];
          const secondRun = selectStarterToAdd(combinedNames, STARTER_PACKING_LIST);
          expect(secondRun.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );

    // Empty existing yields STARTER_PACKING_LIST.length
    expect(selectStarterToAdd([], STARTER_PACKING_LIST).length).toBe(
      STARTER_PACKING_LIST.length
    );
  });

  // Feature: trip-booking-timeline, Property 32: Packing lists sort, group, count, and filter consistently
  it('Property 32: Packing lists sort, group, count, and filter consistently', () => {
    interface TestItem {
      id: string;
      category: PackingCategory;
      createdAt: string;
      packed: boolean;
    }

    const itemArb: fc.Arbitrary<TestItem> = fc.record({
      id: fc.uuid(),
      category: fc.constantFrom<PackingCategory>(...PACKING_CATEGORIES),
      createdAt: fc.constantFrom(
        '2025-05-01T10:00:00.000Z',
        '2025-05-02T10:00:00.000Z',
        '2025-05-03T10:00:00.000Z'
      ),
      packed: fc.boolean(),
    });

    fc.assert(
      fc.property(fc.array(itemArb, { minLength: 0, maxLength: 20 }), items => {
        const sorted = sortPackingItems(items);
        expect(sorted.length).toBe(items.length);

        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i]!;
          const b = sorted[i + 1]!;
          const catDiff =
            PACKING_CATEGORIES.indexOf(a.category) - PACKING_CATEGORIES.indexOf(b.category);
          if (catDiff === 0) {
            const dateDiff = a.createdAt.localeCompare(b.createdAt);
            if (dateDiff === 0) {
              expect(a.id.localeCompare(b.id)).toBeLessThanOrEqual(0);
            } else {
              expect(dateDiff).toBeLessThan(0);
            }
          } else {
            expect(catDiff).toBeLessThan(0);
          }
        }

        const summary = summarizePacking(items);
        expect(summary.totalCount).toBe(items.length);
        expect(summary.packedCount).toBe(items.filter(i => i.packed).length);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 33: Packed-state transitions record or clear the packing member consistently, and the optimistic toggle is reversible
  it('Property 33: Packed-state transitions record or clear the packing member consistently, and the optimistic toggle is reversible', () => {
    const stateArb = fc.oneof(
      fc.record({
        packed: fc.constant(true),
        packedBy: fc.uuid(),
        packedAt: fc.constant('2025-05-01T12:00:00.000Z'),
      }),
      fc.record({
        packed: fc.constant(false),
        packedBy: fc.constant(null),
        packedAt: fc.constant(null),
      })
    );

    fc.assert(
      fc.property(
        stateArb,
        fc.boolean(),
        fc.uuid(),
        fc.constant('2025-05-02T15:00:00.000Z'),
        (prev, newPacked, userId, nowIso) => {
          const next = nextPackedState(prev, newPacked, userId, nowIso);

          // Same state returns previous state unchanged (identity or deep equal)
          if (prev.packed === newPacked) {
            expect(next).toEqual(prev);
          } else if (newPacked) {
            expect(next).toEqual({
              packed: true,
              packedBy: userId,
              packedAt: nowIso,
            });
          } else {
            expect(next).toEqual({
              packed: false,
              packedBy: null,
              packedAt: null,
            });
          }

          // Always satisfies CHECK constraint:
          // packed => packedAt != null
          // !packed => packedBy == null && packedAt == null
          if (next.packed) {
            expect(next.packedAt).not.toBeNull();
            expect(next.packedBy).not.toBeNull();
          } else {
            expect(next.packedAt).toBeNull();
            expect(next.packedBy).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 34: A departed or unknown assignee is projected as unassigned without changing the stored row
  it('Property 34: A departed or unknown assignee is projected as unassigned without changing the stored row', () => {
    fc.assert(
      fc.property(
        fc.record({
          assigneeId: fc.oneof(fc.constant(null), fc.uuid()),
          assigneeName: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
          assigneeIsMember: fc.boolean(),
        }),
        row => {
          // Deep freeze to ensure no mutation
          const frozen = Object.freeze({ ...row });
          const projected = projectAssignee(frozen);

          if (!row.assigneeIsMember || row.assigneeId === null) {
            expect(projected.assigneeId).toBeNull();
            expect(projected.assigneeDisplayName).toBeNull();
          } else {
            expect(projected.assigneeId).toBe(row.assigneeId);
            expect(projected.assigneeDisplayName).toBe(row.assigneeName);
          }

          expect(frozen).toEqual(row);
        }
      ),
      { numRuns: 100 }
    );
  });
});
