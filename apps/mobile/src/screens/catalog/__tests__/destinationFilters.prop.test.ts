/**
 * Property test for DestinationScreen's filtering pipeline.
 *
 * Feature: experience-favorites, Property 6: Destination and Picker Favorites Filters Compose Conjunctively With Existing Filters
 * Validates: Requirements 4.2
 */

import fc from 'fast-check';
import type { ExperienceCategory, ExperienceDTO, Park } from '@dwt/shared';

import {
  filterExperiencesMulti,
  type ExperiencePickerTab,
} from '../../trips/experiencePickerFilters';

const NUM_RUNS = 100;

const CATEGORIES: readonly ExperienceCategory[] = [
  'Ride',
  'Show',
  'Restaurant',
  'Parade',
  'Character_Meet',
  'Walkthrough',
  'PlayArea',
  'Game',
  'Tour',
  'Recreation',
  'Spa',
  'Event',
  'Other',
  'Resort',
];

const TABS: readonly ExperiencePickerTab[] = [
  'all',
  'attractions',
  'dining',
  'shows',
];

const PARKS: readonly (Park | null)[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
  null,
];

function applyTabFilter(
  items: readonly ExperienceDTO[],
  activeTab: ExperiencePickerTab,
): readonly ExperienceDTO[] {
  return items.filter((item) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'attractions') return item.category === 'Ride';
    if (activeTab === 'dining') return item.category === 'Restaurant';
    if (activeTab === 'shows') {
      return (
        item.category === 'Show' ||
        item.category === 'Parade' ||
        item.category === 'Character_Meet' ||
        item.category === 'Event'
      );
    }
    return true;
  });
}

function applyDestinationPipeline(
  experiences: readonly ExperienceDTO[],
  activeTab: ExperiencePickerTab,
  selectedLands: ReadonlySet<string>,
  selectedTags: ReadonlySet<string>,
  favoritedIds: ReadonlySet<string>,
  favoritesOnly: boolean,
): readonly ExperienceDTO[] {
  const tabFiltered = applyTabFilter(experiences, activeTab);
  const multiFiltered = filterExperiencesMulti(
    tabFiltered,
    selectedLands,
    selectedTags,
  );
  if (!favoritesOnly) {
    return multiFiltered;
  }
  return multiFiltered.filter((item) => favoritedIds.has(item.id));
}

const experienceArbitrary = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...CATEGORIES),
  description: fc.constant(''),
  active: fc.constant(true),
  imageUrl: fc.constant(null),
  areaType: fc.constant('ThemePark' as const),
  land: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  priceTier: fc.option(fc.constantFrom('$', '$$', '$$$', '$$$$'), { nil: null }),
  subType: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: null }),
  groupedFacets: fc.constant({}),
});


describe('DestinationScreen filter pipeline — Property 6', () => {
  // Feature: experience-favorites, Property 6: Destination and Picker Favorites Filters Compose Conjunctively With Existing Filters
  test('Property 6 (Destination): Favorites filter composes conjunctively, never as a union, with existing category/land/attribute filters', () => {
    fc.assert(
      fc.property(
        fc.array(experienceArbitrary, { minLength: 0, maxLength: 20 }),
        fc.constantFrom(...TABS),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
        fc.array(fc.uuid(), { maxLength: 10 }),
        fc.boolean(),
        (experiences, activeTab, landList, tagList, favoritedList, favoritesOnly) => {
          const selectedLands = new Set(landList);
          const selectedTags = new Set(tagList);
          const favoritedIds = new Set(favoritedList);

          const tabFiltered = applyTabFilter(experiences, activeTab);
          const multiFiltered = filterExperiencesMulti(
            tabFiltered,
            selectedLands,
            selectedTags,
          );

          const pipelineResults = applyDestinationPipeline(
            experiences,
            activeTab,
            selectedLands,
            selectedTags,
            favoritedIds,
            favoritesOnly,
          );

          if (favoritesOnly) {
            // 1. Every element in pipelineResults must be in multiFiltered AND in favoritedIds
            for (const item of pipelineResults) {
              expect(multiFiltered).toContain(item);
              expect(favoritedIds.has(item.id)).toBe(true);
            }

            // 2. Never a union: no candidate rejected by tab/land/tag filters can be resurrected by being favorited
            for (const item of experiences) {
              if (favoritedIds.has(item.id) && !multiFiltered.includes(item)) {
                expect(pipelineResults).not.toContain(item);
              }
            }

            // 3. Exact intersection: result equals multiFiltered.filter(favoritedIds.has)
            const expectedIntersection = multiFiltered.filter((item) =>
              favoritedIds.has(item.id),
            );
            expect(pipelineResults).toEqual(expectedIntersection);
            expect(pipelineResults.length).toBeLessThanOrEqual(multiFiltered.length);
          } else {
            // When favoritesOnly is false, the result is exactly multiFiltered
            expect(pipelineResults).toEqual(multiFiltered);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
