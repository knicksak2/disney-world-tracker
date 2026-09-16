// Feature: food-item-logging, Property 12: Client-Side Sort/Filter/Search Composition and Determinism
//
// Validates: Requirements 8.7, 8.8, 8.9, 8.10, 9.7, 9.8

import fc from 'fast-check';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

import {
  deriveDisplayedFoodLogs,
  type FoodHistorySort,
} from '../foodHistoryFilters';

const sampleRestaurants: readonly string[] = [
  'Be Our Guest',
  'Le Cellier',
  'Space 220',
  'Spring Roll Cart',
  'Fife and Drum',
];

const sampleDishes = [
  'Grey Stuff',
  'French Onion Soup',
  'Cheddar Cheese Soup',
  'Filet Mignon',
  'Space Waffles',
  'Cheeseburger Spring Roll',
] as const;

const logArb = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  foodItemId: fc.uuid(),
  visitedOn: fc.integer({ min: 1, max: 28 }).map(
    (d) => `2026-06-${String(d).padStart(2, '0')}`,
  ),
  userTz: fc.constant('America/New_York'),
  loggedAt: fc
    .tuple(
      fc.integer({ min: 0, max: 23 }),
      fc.integer({ min: 0, max: 59 }),
      fc.integer({ min: 0, max: 59 }),
    )
    .map(
      ([h, m, s]) =>
        `2026-06-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`,
    ),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  note: fc.option(fc.string({ minLength: 0, maxLength: 20 }), { nil: null }),
  foodItemName: fc.constantFrom(...sampleDishes),
  currentlyOnMenu: fc.boolean(),
  scope: fc.constantFrom('rest', 'loc'),
  placeName: fc.constantFrom(...sampleRestaurants),
}).map((raw): FoodItemLogWithContextDTO => ({
  id: raw.id,
  userId: raw.userId,
  foodItemId: raw.foodItemId,
  visitedOn: raw.visitedOn,
  userTz: raw.userTz,
  loggedAt: raw.loggedAt,
  rating: raw.rating,
  note: raw.note,
  foodItemName: raw.foodItemName,
  currentlyOnMenu: raw.currentlyOnMenu,
  restaurantName: raw.scope === 'rest' ? raw.placeName : null,
  locationName: raw.scope === 'loc' ? raw.placeName : null,
}));

const sortArb: fc.Arbitrary<FoodHistorySort> = fc.constantFrom(
  'recent',
  'oldest',
  'ratingDesc',
  'ratingAsc',
);

describe('deriveDisplayedFoodLogs (Property 12)', () => {
  it('Property 12: Filter, search, and sort compose without resetting each other, and result is deterministic', () => {
    fc.assert(
      fc.property(
        fc.array(logArb, { minLength: 0, maxLength: 15 }),
        fc.subarray([...sampleRestaurants]),
        fc.constantFrom('', 'e', 'Soup', 'Spring', 'NonExistentZzzz'),
        sortArb,
        (rows, selectedFilterArray, searchText, sort) => {
          const selectedSet: ReadonlySet<string> = new Set<string>(selectedFilterArray);

          const result1 = deriveDisplayedFoodLogs(rows, {
            sort,
            selectedRestaurantNames: selectedSet,
            searchText,
          });

          const result2 = deriveDisplayedFoodLogs(rows, {
            sort,
            selectedRestaurantNames: selectedSet,
            searchText,
          });

          // Determinism: two runs with identical inputs produce identical order
          expect(result1.map((r) => r.id)).toEqual(result2.map((r) => r.id));

          // Composition: a row appears iff it satisfies both filter and search criteria
          const q = searchText.trim().toLowerCase();
          for (const row of result1) {
            const place = row.restaurantName ?? row.locationName;
            if (selectedSet.size > 0) {
              expect(place !== null && selectedSet.has(place)).toBe(true);
            }
            if (q.length > 0) {
              const matched = [row.foodItemName, row.restaurantName, row.locationName].some(
                (val) => typeof val === 'string' && val.toLowerCase().includes(q),
              );
              expect(matched).toBe(true);
            }
          }

          // Completeness: all rows matching both criteria are included
          const expectedCount = rows.filter((row) => {
            const place = row.restaurantName ?? row.locationName;
            const matchesFilter = selectedSet.size === 0 || (place !== null && selectedSet.has(place));
            const matchesSearch =
              q.length === 0 ||
              [row.foodItemName, row.restaurantName, row.locationName].some(
                (val) => typeof val === 'string' && val.toLowerCase().includes(q),
              );
            return matchesFilter && matchesSearch;
          }).length;
          expect(result1.length).toBe(expectedCount);

          // Sort correctness
          if (sort === 'ratingDesc') {
            let seenNull = false;
            for (let i = 0; i < result1.length; i++) {
              const curr = result1[i]!;
              if (curr.rating === null) {
                seenNull = true;
              } else {
                // No rated row can appear after a null rating
                expect(seenNull).toBe(false);
                if (i > 0 && result1[i - 1]!.rating !== null) {
                  expect(result1[i - 1]!.rating! >= curr.rating).toBe(true);
                }
              }
            }
          } else if (sort === 'ratingAsc') {
            let seenNull = false;
            for (let i = 0; i < result1.length; i++) {
              const curr = result1[i]!;
              if (curr.rating === null) {
                seenNull = true;
              } else {
                // No rated row can appear after a null rating
                expect(seenNull).toBe(false);
                if (i > 0 && result1[i - 1]!.rating !== null) {
                  expect(result1[i - 1]!.rating! <= curr.rating).toBe(true);
                }
              }
            }
          } else if (sort === 'oldest') {
            for (let i = 0; i < result1.length - 1; i++) {
              const a = result1[i]!;
              const b = result1[i + 1]!;
              if (a.visitedOn === b.visitedOn) {
                expect(a.loggedAt <= b.loggedAt).toBe(true);
              } else {
                expect(a.visitedOn < b.visitedOn).toBe(true);
              }
            }
          } else {
            // 'recent'
            for (let i = 0; i < result1.length - 1; i++) {
              const a = result1[i]!;
              const b = result1[i + 1]!;
              if (a.visitedOn === b.visitedOn) {
                expect(a.loggedAt >= b.loggedAt).toBe(true);
              } else {
                expect(a.visitedOn > b.visitedOn).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
