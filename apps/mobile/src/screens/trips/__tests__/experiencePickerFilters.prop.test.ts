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
import { FESTIVAL_SLUGS, FESTIVAL_SLUG_LABELS } from '@dwt/shared';
import {
  WHITELISTED_FACET_GROUPS,
  deriveFilterChips,
  deriveQuickChips,
  filterExperiencesMulti,
  formatEmptyFilterMessage,
  formatSearchHintMessage,
  isKnownPark,
  isSuppressedAttributeFacet,
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
    festivalTag: fc.option(
      fc.record({
        slug: fc.constantFrom(...FESTIVAL_SLUGS),
        year: fc.integer({ min: 2015, max: 2100 }),
      }),
      { nil: undefined },
    ),
  })
  .map((exp) => {
    let result = exp as ExperienceDTO;
    if (exp.groupedFacets === undefined) {
      const { groupedFacets: _gf, ...rest } = result;
      result = rest as ExperienceDTO;
    }
    if (exp.festivalTag === undefined) {
      const { festivalTag: _ft, ...rest } = result;
      result = rest as ExperienceDTO;
    }
    return result;
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
        const { landChips, priceChips, attributeChips, festivalChips, allChips } =
          deriveFilterChips(experiences);

        // 1. Total partition integrity
        expect(allChips).toEqual([
          ...landChips,
          ...priceChips,
          ...attributeChips,
          ...festivalChips,
        ]);

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

  // Feature: festival-booth-tagging, Property 29 (mobile side): festivalChips
  // dedup/labeling and selectedFestivals OR/AND composition
  it('deriveFilterChips.festivalChips are deduped by slug, labeled via FESTIVAL_SLUG_LABELS, and never emitted for an unobserved slug (R8.9, R8.11)', () => {
    fc.assert(
      fc.property(datasetArb, (experiences) => {
        const { festivalChips } = deriveFilterChips(experiences);

        // 1. Uniqueness by slug
        const slugs = festivalChips.map((c) => c.rawValue);
        expect(new Set(slugs).size).toBe(slugs.length);

        // 2. Every chip is labeled via FESTIVAL_SLUG_LABELS, never the raw slug alone
        for (const chip of festivalChips) {
          expect(chip.kind).toBe('festival');
          expect(chip.label).toBe(
            FESTIVAL_SLUG_LABELS[chip.rawValue as keyof typeof FESTIVAL_SLUG_LABELS],
          );
          expect(chip.accessibilityLabel).toContain('festival filter');
        }

        // 3. Soundness: every chip's slug was actually observed in the input
        const observedSlugs = new Set<string>(
          experiences
            .map((e) => e.festivalTag?.slug)
            .filter((s): s is NonNullable<typeof s> => typeof s === 'string'),
        );
        for (const chip of festivalChips) {
          expect(observedSlugs.has(chip.rawValue)).toBe(true);
        }

        // 4. Completeness: every observed slug produced exactly one chip
        expect(new Set(slugs)).toEqual(observedSlugs);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('filterExperiencesMulti selectedFestivals composes OR-within/AND-across like selectedLands/selectedTags, and an empty set is a no-op (R8.10)', () => {
    fc.assert(
      fc.property(
        datasetArb,
        fc.array(fc.constantFrom(...FESTIVAL_SLUGS), { maxLength: 3 }),
        (experiences, festivalList) => {
          const selectedFestivals = new Set(festivalList);
          const emptyLands = new Set<string>();
          const emptyTags = new Set<string>();

          // Backward-compatibility: omitting the 4th argument entirely must
          // behave identically to passing an explicit empty set.
          const omittedArgResult = filterExperiencesMulti(experiences, emptyLands, emptyTags);
          const explicitEmptyResult = filterExperiencesMulti(
            experiences,
            emptyLands,
            emptyTags,
            new Set<string>(),
          );
          expect(omittedArgResult).toEqual(explicitEmptyResult);

          const filtered = filterExperiencesMulti(
            experiences,
            emptyLands,
            emptyTags,
            selectedFestivals,
          );

          if (selectedFestivals.size === 0) {
            expect(filtered).toBe(experiences);
            return;
          }

          // Soundness: every surviving experience carries a selected festival slug.
          for (const exp of filtered) {
            expect(
              exp.festivalTag !== undefined &&
                exp.festivalTag !== null &&
                selectedFestivals.has(exp.festivalTag.slug),
            ).toBe(true);
          }

          // Completeness: every experience with a selected slug survived.
          for (const exp of experiences) {
            const matches =
              exp.festivalTag !== undefined &&
              exp.festivalTag !== null &&
              selectedFestivals.has(exp.festivalTag.slug);
            if (matches) {
              expect(filtered).toContain(exp);
            }
          }
        },
      ),
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

  // Feature: experience-favorites, Property 6: Destination and Picker Favorites Filters Compose Conjunctively With Existing Filters
  //
  // Amended (Requirement 6, revised): the "Favorites" quick-chip was promoted
  // to a dedicated picker tab whose candidate source (favoriteSourcedItems)
  // is already pre-filtered to the Favorited_Set by the caller — see
  // ExperiencePicker.test.tsx's "Favorites" tab suite for the
  // component-level behavior. This property test still holds unchanged: set
  // intersection is commutative, so filtering-to-favorites-then-by-chips
  // (today's actual pipeline order on the Favorites tab) and
  // filtering-by-chips-then-to-favorites (modeled below) produce the
  // identical result — the conjunction invariant this property guards is
  // independent of which side applies first.
  describe('Property 6: ExperiencePicker Favorites Filter Conjunction', () => {
    it('composes favorites filtering conjunctively, never as a union, with land and attribute filters', () => {
      fc.assert(
        fc.property(
          fc.array(experienceArb, { minLength: 1, maxLength: 30 }),
          fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 3 }),
          fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 3 }),
          fc.array(fc.uuid(), { maxLength: 10 }),
          fc.boolean(),
          (candidates, landFilters, tagFilters, favoritedList, favoritesOnly) => {
            const selectedLands = new Set(landFilters);
            const selectedTags = new Set(tagFilters);
            const favoritedIds = new Set(favoritedList);

            const multiFiltered = filterExperiencesMulti(
              candidates,
              selectedLands,
              selectedTags,
            );

            const pipelineFiltered = favoritesOnly
              ? multiFiltered.filter((exp) => favoritedIds.has(exp.id))
              : multiFiltered;

            if (favoritesOnly) {
              // 1. Every element in pipelineFiltered must be in multiFiltered AND in favoritedIds
              for (const exp of pipelineFiltered) {
                expect(multiFiltered).toContain(exp);
                expect(favoritedIds.has(exp.id)).toBe(true);
              }

              // 2. Never a union: no candidate rejected by land/tag filters can be resurrected by being favorited
              for (const exp of candidates) {
                if (favoritedIds.has(exp.id) && !multiFiltered.includes(exp)) {
                  expect(pipelineFiltered).not.toContain(exp);
                }
              }

              // 3. Exact intersection size: count of items satisfying both conditions
              const expectedIntersection = multiFiltered.filter((exp) =>
                favoritedIds.has(exp.id),
              );
              expect(pipelineFiltered).toEqual(expectedIntersection);
              expect(pipelineFiltered.length).toBeLessThanOrEqual(multiFiltered.length);
            } else {
              expect(pipelineFiltered).toEqual(multiFiltered);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe('Festival filtering, noisy tag cleanup, and synonym normalization', () => {
    it('suppresses internal and redundant Disney facet noise', () => {
      expect(isSuppressedAttributeFacet('EPCOT AreaXX')).toBe(true);
      expect(isSuppressedAttributeFacet('areaxx')).toBe(true);
      expect(isSuppressedAttributeFacet('Menu Category Display')).toBe(true);
      expect(isSuppressedAttributeFacet('walkupWaitList')).toBe(true);
      expect(isSuppressedAttributeFacet('Festival Kiosk')).toBe(true);
      expect(isSuppressedAttributeFacet('Theme Park Dining')).toBe(true);
      expect(isSuppressedAttributeFacet('All Quick Service')).toBe(true);

      // Legitimate attributes are not suppressed
      expect(isSuppressedAttributeFacet('Quick Service')).toBe(false);
      expect(isSuppressedAttributeFacet('Table Service')).toBe(false);
      expect(isSuppressedAttributeFacet('Character Dining')).toBe(false);
      expect(isSuppressedAttributeFacet('American')).toBe(false);
    });

    it('deriveFilterChips excludes suppressed noise facets and deduplicates synonyms', () => {
      const experiences: ExperienceDTO[] = [
        {
          id: 'exp-1',
          name: 'Noise Booth',
          park: 'EPCOT',
          category: 'Restaurant',
          description: '',
          active: true,
          imageUrl: null,
          areaType: 'ThemePark',
          groupedFacets: {
            dining: [
              { id: 'f-1', name: 'EPCOT AreaXX' },
              { id: 'f-2', name: 'Menu Category Display' },
              { id: 'f-3', name: 'walkupWaitList' },
              { id: 'f-4', name: 'Bar-Lounge' },
            ],
            diningInterests: [
              { id: 'f-5', name: 'Theme Park Dining' },
              { id: 'f-6', name: 'Bars/Lounges' },
            ],
            quickService: [
              { id: 'f-7', name: 'Festival Kiosk' },
              { id: 'f-8', name: 'All Quick Service' },
              { id: 'f-9', name: 'Quick Service' },
            ],
            cuisine: [
              { id: 'f-10', name: 'Snack' },
              { id: 'f-11', name: 'Snacks' },
            ],
          },
        },
      ];

      const { attributeChips } = deriveFilterChips(experiences);
      const rawValues = attributeChips.map((c) => c.rawValue);

      // Suppressed tags should not be present
      expect(rawValues).not.toContain('EPCOT AreaXX');
      expect(rawValues).not.toContain('Menu Category Display');
      expect(rawValues).not.toContain('walkupWaitList');
      expect(rawValues).not.toContain('Festival Kiosk');
      expect(rawValues).not.toContain('Theme Park Dining');
      expect(rawValues).not.toContain('All Quick Service');

      // Canonical tags should be present and deduplicated
      expect(rawValues).toContain('Quick Service');
      expect(rawValues).toContain('Bars/Lounges');
      expect(rawValues).not.toContain('Bar-Lounge');
      expect(rawValues).toContain('Snacks');
      expect(rawValues).not.toContain('Snack');
    });

    it('matchesExperienceAttribute matches both canonical and synonym attribute values', () => {
      const expBarLounge: ExperienceDTO = {
        id: 'exp-bar',
        name: 'Rose & Crown Pub',
        park: 'EPCOT',
        category: 'Restaurant',
        description: '',
        active: true,
        imageUrl: null,
        areaType: 'ThemePark',
        groupedFacets: {
          dining: [{ id: 'f-bar', name: 'Bar-Lounge' }],
        },
      };

      const expSnack: ExperienceDTO = {
        id: 'exp-snack',
        name: 'Popcorn Cart',
        park: 'EPCOT',
        category: 'Restaurant',
        description: '',
        active: true,
        imageUrl: null,
        areaType: 'ThemePark',
        groupedFacets: {
          cuisine: [{ id: 'f-snack', name: 'Snack' }],
        },
      };

      // Searching for 'Bars/Lounges' matches 'Bar-Lounge'
      expect(matchesExperienceAttribute(expBarLounge, 'Bars/Lounges')).toBe(true);
      expect(matchesExperienceAttribute(expBarLounge, 'bar-lounge')).toBe(true);

      // Searching for 'Snacks' matches 'Snack'
      expect(matchesExperienceAttribute(expSnack, 'Snacks')).toBe(true);
      expect(matchesExperienceAttribute(expSnack, 'snack')).toBe(true);
    });

    it('deriveQuickChips prioritizes active festival chips on dining and all tabs', () => {
      const festivalChips = [
        {
          id: 'festival-food-and-wine',
          label: 'EPCOT International Food & Wine Festival',
          kind: 'festival' as const,
          rawValue: 'food-and-wine',
          accessibilityLabel: 'EPCOT International Food & Wine Festival, festival filter',
        },
      ];
      const attributeChips = [
        {
          id: 'attr-qs',
          label: '🍔 Quick Service',
          kind: 'attribute' as const,
          rawValue: 'Quick Service',
          accessibilityLabel: 'Quick Service, attribute filter',
        },
        {
          id: 'attr-ts',
          label: '🍽️ Table Service',
          kind: 'attribute' as const,
          rawValue: 'Table Service',
          accessibilityLabel: 'Table Service, attribute filter',
        },
      ];
      const priceChips = [
        {
          id: 'price-s',
          label: '💵 $ (Under $15)',
          kind: 'price' as const,
          rawValue: '$',
          accessibilityLabel: 'Price tier: $',
        },
      ];

      // On dining tab, festival chip appears first
      const diningQuick = deriveQuickChips(attributeChips, 'dining', priceChips, festivalChips);
      expect(diningQuick[0]!.id).toBe('festival-food-and-wine');
      expect(diningQuick[0]!.kind).toBe('festival');

      // On all tab, festival chip appears first
      const allQuick = deriveQuickChips(attributeChips, 'all', priceChips, festivalChips);
      expect(allQuick[0]!.id).toBe('festival-food-and-wine');

      // On attractions tab, festival chip is not injected
      const attractionsQuick = deriveQuickChips(attributeChips, 'attractions', priceChips, festivalChips);
      expect(attractionsQuick.some((c) => c.kind === 'festival')).toBe(false);
    });
  });
});
