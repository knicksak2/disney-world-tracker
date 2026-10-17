/**
 * Property tests for packingListView helpers (Task 11.3).
 *
 * Validates: Requirements 11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.12
 */

import fc from 'fast-check';
import {
  PACKING_CATEGORIES,
  packingItemCreateSchema,
  type PackingCategory,
  type PackingItemDTO,
  type PackingListDTO,
  type TripRole,
} from '@dwt/shared';
import {
  groupByCategory,
  applyFilter,
  togglePackedOptimistic,
  validatePackingForm,
  canEditItem,
} from '../packingListView';

describe('packingListView', () => {
  // Feature: trip-booking-timeline, Property 32 (view half): Group/filter/count consistency
  describe('Property 32 (view half): Group and filter consistency', () => {
    const itemArb = fc.record({
      id: fc.uuid(),
      tripId: fc.constant('trip-1'),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.constantFrom<PackingCategory>(...PACKING_CATEGORIES),
      quantity: fc.integer({ min: 1, max: 10 }),
      packed: fc.boolean(),
      packedAt: fc.constant(null),
      packedByDisplayName: fc.constant(null),
      addedById: fc.uuid(),
      addedByDisplayName: fc.constant('User'),
      assigneeId: fc.oneof(fc.constant(null), fc.constant('viewer-id'), fc.uuid()),
      assigneeDisplayName: fc.constant(null),
      createdAt: fc
        .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
        .map((ms) => new Date(ms).toISOString()),
    }) as fc.Arbitrary<PackingItemDTO>;

    it('groups follow vocabulary order, omit empty groups, and order items oldest first', () => {
      fc.assert(
        fc.property(fc.array(itemArb, { minLength: 0, maxLength: 40 }), (items) => {
          const groups = groupByCategory(items);

          // Every group has items
          for (const g of groups) {
            expect(g.items.length).toBeGreaterThan(0);
            for (const it of g.items) {
              expect(it.category).toBe(g.category);
            }
            // Oldest first within group
            for (let i = 1; i < g.items.length; i++) {
              expect(g.items[i - 1]!.createdAt.localeCompare(g.items[i]!.createdAt)).toBeLessThanOrEqual(
                0,
              );
            }
          }

          // Category sequence follows PACKING_CATEGORIES order
          const categoryIndices = groups.map((g) => PACKING_CATEGORIES.indexOf(g.category));
          for (let i = 1; i < categoryIndices.length; i++) {
            expect(categoryIndices[i]!).toBeGreaterThan(categoryIndices[i - 1]!);
          }

          // Total items across groups equals input items length
          const totalGrouped = groups.reduce((acc, g) => acc + g.items.length, 0);
          expect(totalGrouped).toBe(items.length);
        }),
        { numRuns: 100 },
      );
    });

    it('filters partition items correctly without altering unfiltered list counts', () => {
      const viewerId = 'viewer-id';

      fc.assert(
        fc.property(fc.array(itemArb, { minLength: 0, maxLength: 30 }), (items) => {
          const all = applyFilter(items, 'all', viewerId);
          const mine = applyFilter(items, 'mine', viewerId);
          const unpacked = applyFilter(items, 'unpacked', viewerId);

          expect(all).toEqual(items);

          for (const it of mine) {
            expect(it.assigneeId).toBe(viewerId);
          }
          for (const it of unpacked) {
            expect(it.packed).toBe(false);
          }

          // Unfiltered counts are invariant
          expect(items.length).toBe(all.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: trip-booking-timeline, Property 33 (optimistic half): Optimistic toggle is reversible
  describe('Property 33 (optimistic half): Reversible optimistic toggle', () => {
    it('toggling an item and rolling back restores the exact original list and counts', () => {
      const itemArb = fc.record({
        id: fc.uuid(),
        tripId: fc.constant('trip-1'),
        name: fc.string({ minLength: 1, maxLength: 50 }),
        category: fc.constantFrom<PackingCategory>(...PACKING_CATEGORIES),
        quantity: fc.integer({ min: 1, max: 10 }),
        packed: fc.boolean(),
        packedAt: fc.constant(null),
        packedByDisplayName: fc.constant(null),
        addedById: fc.uuid(),
        addedByDisplayName: fc.constant('User'),
        assigneeId: fc.constant(null),
        assigneeDisplayName: fc.constant(null),
        createdAt: fc.constant('2026-10-01T00:00:00.000Z'),
      }) as fc.Arbitrary<PackingItemDTO>;

      fc.assert(
        fc.property(
          fc.array(itemArb, { minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 19 }),
          (rawItems, targetIndexRaw) => {
            const items = rawItems;
            const targetIndex = targetIndexRaw % items.length;
            const target = items[targetIndex]!;
            const originalList: PackingListDTO = {
              items,
              totalCount: items.length,
              packedCount: items.filter((it) => it.packed).length,
            };

            const toggledState = !target.packed;
            const updated = togglePackedOptimistic(originalList, target.id, toggledState);
            const rolledBack = togglePackedOptimistic(updated, target.id, target.packed);

            expect(rolledBack).toEqual(originalList);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: trip-booking-timeline, Property 35 (client half): canEditItem matches the server rule
  describe('Property 35 (client half): Item edit permission', () => {
    it('only an Organizer or the adder may edit an item', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<TripRole>('organizer', 'member'),
          fc.uuid(),
          fc.uuid(),
          (role, viewerId, addedById) => {
            const permitted = canEditItem(role, viewerId, { addedById });
            if (role === 'organizer') {
              expect(permitted).toBe(true);
            } else if (viewerId === addedById) {
              expect(permitted).toBe(true);
            } else {
              expect(permitted).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: trip-booking-timeline, Property 29 (client half): Form validation equals the shared schema
  describe('Property 29 (client half): Form validation parity', () => {
    it('validatePackingForm matches packingItemCreateSchema.safeParse', () => {
      fc.assert(
        fc.property(
          fc.record({
            name: fc.string(),
            category: fc.oneof(fc.constantFrom(...PACKING_CATEGORIES), fc.string()),
            quantity: fc.oneof(fc.integer({ min: -5, max: 110 }), fc.constant(undefined)),
            assigneeId: fc.oneof(fc.uuid(), fc.constant(null), fc.constant(undefined), fc.string()),
          }),
          (formValues) => {
            const clientResult = validatePackingForm(formValues);
            const schemaResult = packingItemCreateSchema.safeParse(formValues);

            expect(clientResult.ok).toBe(schemaResult.success);
            if (!clientResult.ok && !schemaResult.success) {
              const expectedField = schemaResult.error.issues[0]?.path[0];
              expect(clientResult.field).toBe(expectedField);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
