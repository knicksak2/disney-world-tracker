// Feature: day-planning-optimization, Property 19: ExperiencePicker multi-select filtering, land/attribute derivation, and park scoping
/**
 * Property-based tests for experiencePickerFilters.ts (Task 20.1).
 *
 * Validates: Requirements 4.12, 4.15
 */

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import {
  PARKS,
  type ExperienceCategory,
  type ExperienceDTO,
  type FacetValueDTO,
  type GroupedFacetsDTO,
  type Park,
} from '@dwt/shared';

import type { DestinationId } from '../../catalog/destinations';
import {
  WHITELISTED_FACET_GROUPS,
  deriveFilterChips,
  deriveQuickChips,
  filterExperiencesMulti,
  formatEmptyFilterMessage,
  formatSearchHintMessage,
  isKnownPark,
  matchesExperienceAttribute,
  resolveParkScope,
  type ExperiencePickerTab,
} from '../experiencePickerFilters';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const facetValueArb: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: fc.oneof(
    fc.constantFrom(
      'thrill-rides',
      'slow-rides',
      'slow-rides-rec',
      'water-rides',
      'dark',
      'quick-service',
      'table-service',
      'character-dining',
      'fireworks',
    ),
    fc.string({ minLength: 1, maxLength: 25 }),
  ),
  name: fc.oneof(
    fc.constantFrom(
      'Thrill Rides',
      'Slow Rides',
      'Water Rides',
      'Dark',
      'Quick Service',
      'Table Service',
      'Character Dining',
      'Fireworks',
      'Kids',
      'Adults',
      'Preschoolers',
      'Any Height',
    ),
    fc.string({ minLength: 1, maxLength: 30 }),
  ),
});

const groupedFacetsArb: fc.Arbitrary<GroupedFacetsDTO> = fc.record({
  thrillFactor: fc.array(facetValueArb, { maxLength: 3 }),
  interests: fc.array(facetValueArb, { maxLength: 3 }),
  parkInterests: fc.array(facetValueArb, { maxLength: 3 }),
  disneyFavorites: fc.array(facetValueArb, { maxLength: 3 }),
  quickService: fc.array(facetValueArb, { maxLength: 2 }),
  tableService: fc.array(facetValueArb, { maxLength: 2 }),
  dining: fc.array(facetValueArb, { maxLength: 2 }),
  age: fc.array(facetValueArb, { maxLength: 4 }),
  height: fc.array(facetValueArb, { maxLength: 2 }),
});

const experienceArb: fc.Arbitrary<ExperienceDTO> = fc
  .record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
    category: fc.constantFrom<ExperienceCategory>(
      'Ride',
      'Show',
      'Restaurant',
      'Parade',
      'Character_Meet',
      'Resort',
      'Recreation',
      'Spa',
      'Event',
      'Other',
    ),
    description: fc.string({ maxLength: 50 }),
    active: fc.boolean(),
    imageUrl: fc.constant<string | null>(null),
    land: fc.option(
      fc.constantFrom(
        'Fantasyland',
        'Tomorrowland',
        'Adventureland',
        'Frontierland',
        'World Discovery',
        'World Nature',
        'World Showcase',
        '',
        ' ',
      ),
      { nil: null },
    ),
    worldShowcaseCountry: fc.option(
      fc.constantFrom('France', 'Canada', 'Mexico', 'Japan', '', ' '),
      { nil: null },
    ),
    areaType: fc.constantFrom<'ThemePark' | 'WaterPark' | 'DisneySprings' | 'Resort'>(
      'ThemePark',
      'WaterPark',
      'DisneySprings',
      'Resort',
    ),
    priceTier: fc.option(
      fc.constantFrom('$', '$$', '$$$', '$$$$', ' ', ''),
      { nil: null },
    ),
    subType: fc.option(
      fc.oneof(
        fc.constantFrom(
          'Quick Service',
          'Table Service',
          'Fine / Signature Dining',
          'Counter Service',
          'Roller Coaster',
          'Water Ride',
          'Nighttime Spectacular',
          'Stage Show',
          'Character Meet',
          ' ',
          '',
        ),
        fc.string({ maxLength: 30 }),
      ),
      { nil: null },
    ),
    groupedFacets: fc.option(groupedFacetsArb, { nil: undefined }),
  })
  .map((exp) => {
    if (exp.groupedFacets === undefined) {
      const { groupedFacets: _gf, ...rest } = exp;
      return rest as ExperienceDTO;
    }
    return exp as ExperienceDTO;
  });

const datasetArb = fc.array(experienceArb, { minLength: 0, maxLength: 25 });

const destinationIdArb: fc.Arbitrary<DestinationId | 'all'> = fc.constantFrom<
  DestinationId | 'all'
>(
  'all',
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
  'Typhoon Lagoon',
  'Blizzard Beach',
  'Disney Springs',
  'Resorts',
);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 19: ExperiencePicker multi-select filtering, land/price/attribute derivation, and park scoping', () => {
  it('deriveFilterChips partitions unique land, price, and attribute chips, excludes age/height, and dedupes (R4.15)', () => {
    fc.assert(
      fc.property(datasetArb, (experiences) => {
        const { landChips, priceChips, attributeChips, allChips } = deriveFilterChips(experiences);

        // 1. Total partition integrity
        expect(allChips).toEqual([...landChips, ...priceChips, ...attributeChips]);

        // 2. Land chip uniqueness & formatting
        const landIds = new Set(landChips.map((c) => c.id));
        const landRaw = new Set(landChips.map((c) => c.rawValue.toLowerCase()));
        expect(landIds.size).toBe(landChips.length);
        expect(landRaw.size).toBe(landChips.length);

        for (const lc of landChips) {
          expect(lc.kind).toBe('land');
          expect(lc.label).toBe(`📍 ${lc.rawValue}`);
          expect(lc.rawValue.trim().length).toBeGreaterThan(0);
          expect(lc.accessibilityLabel).toContain('land filter');
        }

        // 3. Price chip uniqueness, formatting, and sorting
        const priceIds = new Set(priceChips.map((c) => c.id));
        expect(priceIds.size).toBe(priceChips.length);
        for (const pc of priceChips) {
          expect(pc.kind).toBe('price');
          expect(pc.label).toContain(pc.rawValue);
          expect(pc.accessibilityLabel).toContain('Price tier:');
        }

        // 4. Attribute chip uniqueness & compound deduplication (id OR case-insensitive trimmed name)
        const attrIds = new Set(attributeChips.map((c) => c.id.toLowerCase()));
        const attrNames = new Set(attributeChips.map((c) => c.rawValue.toLowerCase()));
        expect(attrIds.size).toBe(attributeChips.length);
        expect(attrNames.size).toBe(attributeChips.length);

        for (const ac of attributeChips) {
          expect(ac.kind).toBe('attribute');
          expect(ac.rawValue.trim().length).toBeGreaterThan(0);
          expect(ac.accessibilityLabel).toContain('attribute filter');
        }

        // 5. Noise exclusion: age and height facet values that appear ONLY in age/height are never emitted
        for (const ac of attributeChips) {
          const rawLower = ac.rawValue.toLowerCase();
          // Verify that this tag is backed by a whitelisted group or subType
          const backedByWhitelist = experiences.some((exp) => {
            if (typeof exp.subType === 'string' && exp.subType.trim().toLowerCase() === rawLower) {
              return true;
            }
            if (exp.groupedFacets) {
              for (const gk of WHITELISTED_FACET_GROUPS) {
                const group = exp.groupedFacets[gk];
                if (
                  Array.isArray(group) &&
                  group.some(
                    (f) =>
                      (typeof f.name === 'string' && f.name.trim().toLowerCase() === rawLower) ||
                      (typeof f.id === 'string' && f.id.trim().toLowerCase() === ac.id.toLowerCase()),
                  )
                ) {
                  return true;
                }
              }
            }
            return false;
          });
          expect(backedByWhitelist).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('filterExperiencesMulti satisfies identity on empty sets, OR within dimensions, and AND across dimensions (R4.15)', () => {
    fc.assert(
      fc.property(
        datasetArb,
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
        (experiences, landList, tagList) => {
          const selectedLands = new Set(landList.map((l) => l.trim()).filter((l) => l.length > 0));
          const selectedTags = new Set(tagList.map((t) => t.trim()).filter((t) => t.length > 0));

          const filtered = filterExperiencesMulti(experiences, selectedLands, selectedTags);

          // 1. Identity on empty sets
          if (selectedLands.size === 0 && selectedTags.size === 0) {
            expect(filtered).toBe(experiences);
          } else {
            // 2. Subset property
            expect(filtered.length).toBeLessThanOrEqual(experiences.length);

            // 3. Soundness: every item satisfies the selection criteria
            for (const exp of filtered) {
              if (selectedLands.size > 0) {
                const expLand = exp.worldShowcaseCountry || exp.land;
                expect(typeof expLand === 'string' && selectedLands.has(expLand.trim())).toBe(true);
              }
              if (selectedTags.size > 0) {
                const matchesSomeTag = Array.from(selectedTags).some((tag) =>
                  matchesExperienceAttribute(exp, tag),
                );
                expect(matchesSomeTag).toBe(true);
              }
            }

            // 4. Idempotent
            const doubleFiltered = filterExperiencesMulti(filtered, selectedLands, selectedTags);
            expect(doubleFiltered).toEqual(filtered);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveQuickChips returns at most 4 unique, valid attribute/price chips prioritized by active tab (R4.15)', () => {
    const tabArb: fc.Arbitrary<ExperiencePickerTab> = fc.constantFrom(
      'all',
      'attractions',
      'dining',
      'shows',
      'breaks',
    );

    fc.assert(
      fc.property(datasetArb, tabArb, (experiences, activeTab) => {
        const { priceChips, attributeChips } = deriveFilterChips(experiences);
        const quickChips = deriveQuickChips(attributeChips, activeTab, priceChips);
        const pool = [...priceChips, ...attributeChips];

        // 1. Length constraint
        expect(quickChips.length).toBeLessThanOrEqual(4);
        expect(quickChips.length).toBeLessThanOrEqual(pool.length);

        // 2. Uniqueness
        const ids = new Set(quickChips.map((c) => c.id));
        expect(ids.size).toBe(quickChips.length);

        // 3. Soundness: every quick chip is a member of the derived pool
        for (const qc of quickChips) {
          const exists = pool.some((p) => p.id === qc.id && p.rawValue === qc.rawValue);
          expect(exists).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolveParkScope exhaustively maps DestinationId | all with exactly one or zero filter keys (R4.12)', () => {
    fc.assert(
      fc.property(destinationIdArb, (destId) => {
        const scope = resolveParkScope(destId);

        if (destId === 'all') {
          expect(scope).toEqual({});
        } else if (destId === 'Resorts') {
          expect(scope).toEqual({ areaType: 'Resort' });
        } else {
          expect(scope).toEqual({ parkId: destId });
          expect(scope.areaType).toBeUndefined();
        }

        expect(scope.parkId !== undefined && scope.areaType !== undefined).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('isKnownPark strictly narrows canonical members of PARKS (R4.12)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom<Park>(...PARKS),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
        ),
        (val) => {
          const isPark = isKnownPark(val);
          if (typeof val === 'string' && (PARKS as readonly string[]).includes(val)) {
            expect(isPark).toBe(true);
          } else {
            expect(isPark).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  describe('formatEmptyFilterMessage and formatSearchHintMessage', () => {
    it('formats search hint correctly', () => {
      expect(formatSearchHintMessage()).toBe('Search for experiences to add to your plan.');
    });

    it('formats empty filter message for free-text search queries across tabs and parks', () => {
      expect(formatEmptyFilterMessage('all', 'all', 'Space', false)).toBe(
        'No experiences matched “Space”.',
      );
      expect(formatEmptyFilterMessage('Magic Kingdom', 'attractions', 'Thunder', false)).toBe(
        'No rides in Magic Kingdom matched “Thunder”.',
      );
      expect(formatEmptyFilterMessage('EPCOT', 'dining', 'Space 220', false)).toBe(
        'No restaurants in EPCOT matched “Space 220”.',
      );
      expect(formatEmptyFilterMessage('Animal Kingdom', 'shows', 'Lion King', false)).toBe(
        'No shows in Animal Kingdom matched “Lion King”.',
      );
      expect(formatEmptyFilterMessage('Resorts', 'breaks', 'Polynesian', false)).toBe(
        'No locations in Resorts matched “Polynesian”.',
      );
    });

    it('formats empty filter message when filters are active without query', () => {
      expect(formatEmptyFilterMessage('all', 'dining', '', true)).toBe(
        'No restaurants found matching active filters.',
      );
      expect(formatEmptyFilterMessage('Magic Kingdom', 'attractions', '', true)).toBe(
        'No rides in Magic Kingdom found matching active filters.',
      );
    });

    it('formats empty filter message when only park filter is active without sub-filter or query', () => {
      expect(formatEmptyFilterMessage('Magic Kingdom', 'shows', '', false)).toBe(
        'No shows found in Magic Kingdom matching active filters.',
      );
      expect(formatEmptyFilterMessage('Resorts', 'all', '', false)).toBe(
        'No experiences found in Resorts matching active filters.',
      );
    });

    it('formats fallback message when no specific filter matches', () => {
      expect(formatEmptyFilterMessage('all', 'all', '', false)).toBe(
        'No experiences matched active filters.',
      );
    });
  });
});
