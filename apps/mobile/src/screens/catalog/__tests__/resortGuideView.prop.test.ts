import fc from 'fast-check';
import {
  computeVisibleItems,
  filterDiningByCategory,
  classifyDiningCategory,
  extractDynamicQuickChips,
  type DiningCategoryFilter,
} from '../resortGuideView';

describe('resortGuideView pure property tests', () => {
  // Feature: catalog-redesign, Property 1: Inline disclosure truncation invariant
  test('Property 1: Inline disclosure truncation invariant', () => {
    // Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7, 5.8
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.uuid(), title: fc.string() }), { minLength: 0, maxLength: 50 }),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 10 }),
        (items, expanded, isFiltered, limit) => {
          const result = computeVisibleItems({
            items,
            limit,
            expanded,
            isFiltered,
          });

          const total = items.length;
          expect(result.totalCount).toBe(total);

          if (expanded || isFiltered) {
            // When expanded or filtered, no truncation
            expect(result.visibleItems.length).toBe(total);
            expect(result.visibleItems).toEqual(items);
            expect(result.hiddenCount).toBe(0);
            expect(result.isTruncated).toBe(false);
          } else {
            // When collapsed and unfiltered
            const expectedCount = Math.min(total, limit);
            expect(result.visibleItems.length).toBe(expectedCount);
            expect(result.visibleItems).toEqual(items.slice(0, limit));
            expect(result.hiddenCount).toBe(Math.max(0, total - limit));
            expect(result.isTruncated).toBe(total > limit);
            expect(result.canExpand).toBe(total > limit);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: catalog-redesign, Property 2: Dining category filter soundness and completeness
  test('Property 2: Dining category filter soundness and completeness', () => {
    // Validates: Requirements 5.4, 5.5, 2.7
    const diningCategoryFilterArb = fc.constantFrom(
      'all',
      'table',
      'quick',
      'lounge',
    ) as fc.Arbitrary<DiningCategoryFilter>;

    const tagSampleArb = fc.constantFrom(
      'Rooftop Signature',
      'Tiki Lounge',
      'Poolside Bar',
      'Savanna Table Service',
      'Quick Service Counter',
      'Bakery & Snack',
      'Fine / Signature Dining',
      'Character Buffet',
      'Casual Dining',
      'Unknown Category',
      '',
    );

    const venueArb = fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      tag: tagSampleArb,
      tags: fc.array(tagSampleArb, { maxLength: 3 }),
      category: fc.constantFrom('Restaurant', 'Lounge', 'QuickService', undefined),
    });

    fc.assert(
      fc.property(fc.array(venueArb, { minLength: 0, maxLength: 30 }), diningCategoryFilterArb, (venues, filter) => {
        const filtered = filterDiningByCategory(venues, filter);

        if (filter === 'all') {
          expect(filtered).toEqual(venues);
          return;
        }

        // Soundness: every item in filtered matches the target category
        for (const venue of filtered) {
          const cat = classifyDiningCategory(venue);
          expect(cat).toBe(filter);
        }

        // Completeness: no item in venues matching target category is omitted
        const expectedItems = venues.filter((v) => classifyDiningCategory(v) === filter);
        expect(filtered.length).toBe(expectedItems.length);
        expect(filtered).toEqual(expectedItems);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: catalog-redesign, Property 3: Dynamic quick chips derivation uniqueness and relevance
  test('Property 3: Dynamic quick chips derivation uniqueness and relevance', () => {
    // Validates: Requirements 3.5
    const expArb = fc.record({
      category: fc.constantFrom('Ride', 'Restaurant', 'Show', 'Recreation', undefined),
      tag: fc.constantFrom('Thrill', 'Indoor', 'Water', 'Dark Ride', 'Table Service', undefined),
      tags: fc.array(fc.constantFrom('Classic', 'Character', 'Fireworks', 'Quick Service'), { maxLength: 3 }),
      thrill: fc.boolean(),
      heightMin: fc.constantFrom(undefined, 32, 40, 44, 48),
    });

    const activeTabArb = fc.constantFrom('All', 'Rides', 'Dining', 'Shows');

    fc.assert(
      fc.property(fc.array(expArb, { minLength: 1, maxLength: 25 }), activeTabArb, (experiences, activeTab) => {
        const chips = extractDynamicQuickChips(experiences, activeTab);

        // 1. Uniqueness: No duplicate chip labels
        const chipSet = new Set(chips);
        expect(chipSet.size).toBe(chips.length);

        // 2. Relevance: Every chip label corresponds to at least one experience in the list
        for (const chip of chips) {
          const matchCount = experiences.filter((exp) => {
            if (chip === 'Thrill Ride' && exp.thrill) return true;
            if (chip.startsWith('Height ') && exp.heightMin && chip === `Height ${exp.heightMin}"+`) return true;
            if (exp.tag === chip) return true;
            if (exp.tags?.includes(chip)) return true;
            if (chip === 'Table Service' && classifyDiningCategory({ tag: exp.tag, tags: exp.tags, category: exp.category }) === 'table') return true;
            if (chip === 'Quick Service' && classifyDiningCategory({ tag: exp.tag, tags: exp.tags, category: exp.category }) === 'quick') return true;
            if (chip === 'Lounges & Bars' && classifyDiningCategory({ tag: exp.tag, tags: exp.tags, category: exp.category }) === 'lounge') return true;
            return false;
          }).length;

          expect(matchCount).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
