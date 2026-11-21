// Feature: experience-favorites, Property 12: Group Favorites preview cap and modal filter conjunction
/**
 * Property-based tests for `groupFavoritesView.ts` (Task 14.3).
 *
 * Validates: Requirements 9.6, 9.7
 */

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type GroupFavoriteDTO,
  type Park,
} from '@dwt/shared';

import {
  GROUP_FAVORITES_PREVIEW_LIMIT,
  deriveGroupFavoriteParks,
  filterGroupFavorites,
  sliceGroupFavoritesPreview,
} from '../groupFavoritesView';

const NUM_RUNS = 100;

const groupFavoriteArb: fc.Arbitrary<GroupFavoriteDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES),
  favoritingCount: fc.integer({ min: 2, max: 12 }),
  favoritingDisplayNames: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 2,
    maxLength: 6,
  }),
});

describe('Feature: experience-favorites, Property 12: Group Favorites preview cap and modal filter conjunction', () => {
  it('sliceGroupFavoritesPreview returns exact leading prefix, hiddenCount, and hasMore invariant', () => {
    fc.assert(
      fc.property(
        fc.array(groupFavoriteArb, { maxLength: 25 }),
        fc.integer({ min: 0, max: 15 }),
        (items, limit) => {
          const preview = sliceGroupFavoritesPreview(items, limit);
          const expectedLen = Math.min(items.length, limit);

          expect(preview.visibleItems).toHaveLength(expectedLen);
          expect(preview.visibleItems).toEqual(items.slice(0, expectedLen));
          expect(preview.hiddenCount).toBe(items.length - expectedLen);
          expect(preview.hasMore).toBe(items.length > limit);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('default GROUP_FAVORITES_PREVIEW_LIMIT is 5 and handles non-integer/negative limits safely', () => {
    expect(GROUP_FAVORITES_PREVIEW_LIMIT).toBe(5);
    fc.assert(
      fc.property(fc.array(groupFavoriteArb, { maxLength: 12 }), (items) => {
        const defaultPreview = sliceGroupFavoritesPreview(items);
        expect(defaultPreview.visibleItems.length).toBe(Math.min(items.length, 5));
        expect(defaultPreview.hasMore).toBe(items.length > 5);

        const negativePreview = sliceGroupFavoritesPreview(items, -3);
        expect(negativePreview.visibleItems).toEqual([]);
        expect(negativePreview.hiddenCount).toBe(items.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveGroupFavoriteParks counts non-null parks without duplicates in canonical PARKS order', () => {
    fc.assert(
      fc.property(fc.array(groupFavoriteArb, { maxLength: 30 }), (items) => {
        const derived = deriveGroupFavoriteParks(items);
        const totalNonNull = items.filter((item) => item.park !== null).length;
        const derivedSum = derived.reduce((acc, entry) => acc + entry.count, 0);

        expect(derivedSum).toBe(totalNonNull);
        const parks = derived.map((entry) => entry.park);
        expect(new Set(parks).size).toBe(parks.length);

        const canonicalIndices = parks.map((park) =>
          (PARKS as readonly string[]).indexOf(park),
        );
        for (let i = 1; i < canonicalIndices.length; i += 1) {
          expect(canonicalIndices[i]).toBeGreaterThan(canonicalIndices[i - 1]!);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('filterGroupFavorites returns exact ordered subsequence matching BOTH park and query predicates', () => {
    const queryArb = fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constantFrom('a', 'e', 'i', 'o', 'Magic', 'EPCOT', 'Al'),
      fc.string({ maxLength: 10 }),
    );
    const parkFilterArb = fc.option(fc.constantFrom<string>(...PARKS), { nil: null });

    fc.assert(
      fc.property(
        fc.array(groupFavoriteArb, { maxLength: 25 }),
        parkFilterArb,
        queryArb,
        (items, selectedPark, rawQuery) => {
          const filtered = filterGroupFavorites(items, selectedPark, rawQuery);
          const q = rawQuery.trim().toLowerCase();

          const expected = items.filter((item) => {
            if (selectedPark !== null && item.park !== selectedPark) {
              return false;
            }
            if (q.length > 0) {
              const nameMatch = item.experienceName.toLowerCase().includes(q);
              const parkMatch = (item.park ?? '').toLowerCase().includes(q);
              const memberMatch = item.favoritingDisplayNames.some((n) =>
                n.toLowerCase().includes(q),
              );
              return nameMatch || parkMatch || memberMatch;
            }
            return true;
          });

          expect(filtered).toEqual(expected);
          if (selectedPark === null && q.length === 0) {
            expect(filtered).toEqual(items);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
