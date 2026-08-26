// Feature: catalog-taxonomy-cleanup, Property 1: Exclusion is a pure, total, deterministic function of the document
// Feature: catalog-taxonomy-cleanup, Property 2: Every enumerated rule matches its intent and nothing broader
// Feature: catalog-taxonomy-cleanup, Property 10: A curated clone is excluded regardless of its sibling's presence

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AMENITY_SUB_TYPES,
  ANIMAL_PLACARD_SUFFIX,
  DUPLICATE_CLONE_IDS,
  EXCLUDED_NAME_LIST,
  ExclusionRule,
  exclusionRuleFor,
  isExcludedFacility,
} from '../facilityExclusion.js';
import { CATEGORY_OVERRIDES, categoryOverrideFor } from '../categoryOverrides.js';
import { parseEnterpriseId, type FacilityDocument } from '../facilityDoc.js';

const NUM_RUNS = 200;

describe('facilityExclusion - Unit Tests', () => {
  describe('Rule 1: audio_tour (R1.2)', () => {
    it('matches audio-tour documents', () => {
      const doc1: FacilityDocument = {
        id: '19477000;entityType=audio-tour',
        type: 'audio-tour',
        name: '240 Shoe Size',
      };
      const doc2: FacilityDocument = {
        id: '19477001;entityType=audio-tour',
        type: 'audio-tour',
      };
      expect(exclusionRuleFor(doc1)).toBe('audio_tour');
      expect(exclusionRuleFor(doc2)).toBe('audio_tour');
      expect(isExcludedFacility(doc1)).toBe(true);
      expect(isExcludedFacility(doc2)).toBe(true);
    });
  });

  describe('Rule 2: amenity_sub_type (R1.3)', () => {
    it('matches every amenity sub-type', () => {
      for (const subType of AMENITY_SUB_TYPES) {
        const doc: FacilityDocument = {
          id: `facility-${subType}`,
          type: 'recreation',
          subType,
          name: `Test ${subType}`,
        };
        expect(exclusionRuleFor(doc)).toBe('amenity_sub_type');
        expect(isExcludedFacility(doc)).toBe(true);
      }
    });
  });

  describe('Rule 3: animal_placard (R1.4)', () => {
    it('matches names ending with ANIMAL_PLACARD_SUFFIX', () => {
      const doc1: FacilityDocument = {
        id: '18447001;entityType=Attraction',
        type: 'attraction',
        name: 'African Hogs - Disney Animals',
      };
      const doc2: FacilityDocument = {
        id: '18447002;entityType=Attraction',
        type: 'attraction',
        name: 'Zebras - Disney Animals',
      };
      expect(exclusionRuleFor(doc1)).toBe('animal_placard');
      expect(exclusionRuleFor(doc2)).toBe('animal_placard');
      expect(isExcludedFacility(doc1)).toBe(true);
    });
  });

  describe('Rule 4: rental_inventory (R1.5)', () => {
    it('matches rental inventory names', () => {
      const doc1: FacilityDocument = {
        id: '18447003;entityType=Attraction',
        name: 'Beachcomber Shacks',
      };
      const doc2: FacilityDocument = {
        id: '18447004;entityType=Attraction',
        name: 'Beachcomber Shacks Premium',
      };
      const doc3: FacilityDocument = {
        id: '18447005;entityType=Attraction',
        name: 'Polar Patios',
      };
      const doc4: FacilityDocument = {
        id: '18447006;entityType=Attraction',
        name: 'Polar Patios VIP',
      };
      const doc5: FacilityDocument = {
        id: '18447007;entityType=Attraction',
        name: 'Poolside Patios',
      };
      const doc6: FacilityDocument = {
        id: '18447008;entityType=Attraction',
        name: 'Cabana Umbrellas',
      };
      const doc7: FacilityDocument = {
        id: '18447009;entityType=Attraction',
        name: 'Shade Umbrellas',
      };
      expect(exclusionRuleFor(doc1)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc2)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc3)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc4)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc5)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc6)).toBe('rental_inventory');
      expect(exclusionRuleFor(doc7)).toBe('rental_inventory');
    });
  });

  describe('Rule 5: community_hall (R1.6)', () => {
    it('matches Community Hall facilities', () => {
      const doc1: FacilityDocument = {
        id: '18447008;entityType=Attraction',
        name: 'Community Hall at Disney’s BoardWalk',
      };
      const doc2: FacilityDocument = {
        id: '18447009;entityType=Attraction',
        name: 'Bay Lake Tower Community Hall',
      };
      expect(exclusionRuleFor(doc1)).toBe('community_hall');
      expect(exclusionRuleFor(doc2)).toBe('community_hall');
      expect(isExcludedFacility(doc1)).toBe(true);
    });
  });

  describe('Rule 6: informational_page (R1.7, Task 11.2)', () => {
    it('matches informational pages including Allergy-Friendly pages', () => {
      const names = [
        'Guide for Families',
        'Weather Updates',
        'Night Owls Guide',
        'Little Ones Guide',
        'Park Hopper Hours',
        'World Showcase Entry',
        'World ShowPlace',
        'Summer Fun in the Disney Water Parks',
        'Enhanced Nighttime Spectaculars',
        'Choose Your Favorite Things',
        'Real Stuff for Real Life',
        'Merchandise Pickup',
        'Keepsakes Shop Info',
        'Photo Opportunities Spot',
        'Allergy-Friendly Offerings at Mickey\'s Not-So-Scary Halloween Party',
        'Allergy-Friendly Options at 2026 EPCOT International Food & Wine Festival',
        'Allergy Request Trick-or-Treating Experience',
      ];
      for (const name of names) {
        const doc: FacilityDocument = {
          id: `info-${name}`,
          name,
        };
        expect(exclusionRuleFor(doc)).toBe('informational_page');
        expect(isExcludedFacility(doc)).toBe(true);
      }
    });

    it('does not match non-allergy normal experiences (negative control)', () => {
      const nonAllergy = [
        { id: '1', name: 'Aladdin\'s Flying Carpets', type: 'attraction' },
        { id: '2', name: 'Alice in Wonderland', type: 'attraction' },
      ];
      for (const doc of nonAllergy) {
        expect(exclusionRuleFor(doc)).toBeNull();
      }
    });
  });

  describe('Rule 7: excluded_name (R1.8)', () => {
    it('matches exact strings in EXCLUDED_NAME_LIST', () => {
      for (const name of EXCLUDED_NAME_LIST) {
        const doc: FacilityDocument = {
          id: `facility-${name}`,
          name,
        };
        const rule = exclusionRuleFor(doc);
        expect(rule).not.toBeNull();
        expect(isExcludedFacility(doc)).toBe(true);
      }
    });
  });

  describe('Rule 8: service_facility (R1.9)', () => {
    it('matches guest service facilities and learning experiences', () => {
      const doc1: FacilityDocument = {
        id: '18447026;entityType=Attraction',
        name: 'Best Friends Pet Hotel at Walt Disney World',
      };
      const doc2: FacilityDocument = {
        id: '18447027;entityType=Attraction',
        name: "Disney's Signature Portrait Session",
      };
      expect(exclusionRuleFor(doc1)).toBe('service_facility');
      expect(exclusionRuleFor(doc2)).toBe('service_facility');
    });
  });

  describe('Rule 9: duplicate_clone (R8.1, R8.2, R8.4, R8.11, Task 11.1, 11.3)', () => {
    const retainedSiblings: Record<string, string> = {
      '19631365;entityType=Recreation': '90004996;entityType=Event',
      '19610128;entityType=Recreation': '18584410;entityType=Event',
      '19610126;entityType=Recreation': '90004988;entityType=Event',
      '19628700;entityType=Recreation': '90004982;entityType=Event',
      '19636301;entityType=Recreation': '18998437;entityType=Event',
      '19611304;entityType=Recreation': '18721320;entityType=Attraction',
      '19611305;entityType=Recreation': '18693677;entityType=Attraction',
      '19632587;entityType=Recreation': '19382527;entityType=Entertainment',
      '19614667;entityType=Recreation': '65353;entityType=Spa',
      '80010856;entityType=Entertainment': '80010856;entityType=Dinner-Show',
      '90002032;entityType=restaurant': '80010856;entityType=Dinner-Show',
      '412316772;entityType=restaurant': '412297708;entityType=restaurant',
      '16917380;entityType=Entertainment': '16012973;entityType=restaurant',
      '17000640;entityType=Entertainment': '19611303;entityType=Recreation',
    };

    it('contains exactly 14 curated duplicate clone entries (R8.2)', () => {
      expect(DUPLICATE_CLONE_IDS).toHaveLength(14);
      const uniqueIds = new Set(DUPLICATE_CLONE_IDS);
      expect(uniqueIds.size).toBe(14);
    });

    it('has well-formed Enterprise_Id keys for all 14 entries', () => {
      for (const id of DUPLICATE_CLONE_IDS) {
        const parsed = parseEnterpriseId(id);
        expect(parsed).not.toBeNull();
        expect(parsed?.numericId).toMatch(/^\d+$/);
        expect(parsed?.entityType.length).toBeGreaterThan(0);
      }
    });

    it('ensures no id in DUPLICATE_CLONE_IDS is also a retained sibling of another entry', () => {
      const dropSet = new Set(DUPLICATE_CLONE_IDS);
      for (const [dropId, retainId] of Object.entries(retainedSiblings)) {
        expect(dropSet.has(dropId)).toBe(true);
        expect(dropSet.has(retainId)).toBe(false);
      }
    });

    it('R8.11: cross-check that no id appears in both DUPLICATE_CLONE_IDS and CATEGORY_OVERRIDES', () => {
      for (const id of DUPLICATE_CLONE_IDS) {
        expect(CATEGORY_OVERRIDES.has(id)).toBe(false);
      }
    });

    it('Task 11.1b: Mickey\'s Not-So-Scary Halloween Party is in CATEGORY_OVERRIDES as Event and absent from DUPLICATE_CLONE_IDS', () => {
      const halloweenPartyId = '19637044;entityType=Recreation';
      expect(categoryOverrideFor(halloweenPartyId)).toBe('Event');
      expect(DUPLICATE_CLONE_IDS.includes(halloweenPartyId)).toBe(false);
    });

    it('R8.4: unconditionally excludes a clone even when its retained sibling is absent from the document set', () => {
      for (const cloneId of DUPLICATE_CLONE_IDS) {
        const doc: FacilityDocument = {
          id: cloneId,
          name: 'Clone Experience Without Sibling Present',
          type: 'attraction',
        };
        expect(exclusionRuleFor(doc)).toBe('duplicate_clone');
        expect(isExcludedFacility(doc)).toBe(true);
      }
    });

    it('evaluates duplicate_clone LAST after earlier content rules', () => {
      // If a clone document ALSO matches an audio-tour type, audio_tour wins
      const doc: FacilityDocument = {
        id: '19631365;entityType=Recreation',
        type: 'audio-tour',
        name: 'Audio Tour Clone',
      };
      expect(exclusionRuleFor(doc)).toBe('audio_tour');
    });
  });

  describe('Negative cases: active park headliners are never excluded', () => {
    it('does not exclude real rides, shows, and attractions', () => {
      const headliners: FacilityDocument[] = [
        { id: '1', name: 'Space Mountain', type: 'attraction' },
        { id: '2', name: 'Haunted Mansion', type: 'attraction' },
        { id: '3', name: 'Pirates of the Caribbean', type: 'attraction' },
        { id: '4', name: 'Avatar Flight of Passage', type: 'attraction' },
        { id: '5', name: 'Star Wars: Rise of the Resistance', type: 'attraction' },
        { id: '6', name: 'Guardians of the Galaxy: Cosmic Rewind', type: 'attraction' },
        { id: '7', name: 'Festival of the Lion King', type: 'entertainment' },
        { id: '8', name: 'Be Our Guest Restaurant', type: 'restaurant' },
        { id: '9', name: 'Cinderella Castle', type: 'attraction' },
      ];

      for (const doc of headliners) {
        expect(exclusionRuleFor(doc)).toBeNull();
        expect(isExcludedFacility(doc)).toBe(false);
      }
    });

    it('tolerates empty/minimal documents without throwing', () => {
      expect(exclusionRuleFor({ id: '1' })).toBeNull();
      expect(exclusionRuleFor({ id: '1', name: '' })).toBeNull();
    });
  });
});

describe('facilityExclusion - Property Tests', () => {
  // Arbitrary generator for FacilityDocument
  const facilityDocArb: fc.Arbitrary<FacilityDocument> = fc
    .record({
      id: fc.string({ minLength: 1 }),
      hasType: fc.boolean(),
      type: fc.string(),
      hasSubType: fc.boolean(),
      subType: fc.string(),
      hasName: fc.boolean(),
      name: fc.string(),
      hasDescription: fc.boolean(),
      description: fc.string(),
    })
    .map((r) => {
      const doc: FacilityDocument = {
        id: r.id,
        ...(r.hasType ? { type: r.type } : {}),
        ...(r.hasSubType ? { subType: r.subType } : {}),
        ...(r.hasName ? { name: r.name } : {}),
        ...(r.hasDescription ? { description: r.description } : {}),
      };
      return doc;
    });

  it('Property 1: Exclusion is a pure, total, deterministic function of the document', () => {
    const validRules: ReadonlySet<ExclusionRule> = new Set<ExclusionRule>([
      'audio_tour',
      'amenity_sub_type',
      'animal_placard',
      'rental_inventory',
      'community_hall',
      'informational_page',
      'excluded_name',
      'service_facility',
      'duplicate_clone',
    ]);

    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        const rule1 = exclusionRuleFor(doc);
        const rule2 = exclusionRuleFor(doc);

        // Deterministic
        expect(rule1).toBe(rule2);

        // Total: returns null or valid ExclusionRule
        if (rule1 !== null) {
          expect(validRules.has(rule1)).toBe(true);
        }

        // isExcludedFacility consistent with exclusionRuleFor
        expect(isExcludedFacility(doc)).toBe(rule1 !== null);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 2: Every enumerated rule matches its intent and nothing broader', () => {
    // 1. audio_tour
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          hasName: fc.boolean(),
          name: fc.string(),
        }),
        (base) => {
          const doc: FacilityDocument = {
            id: base.id,
            type: 'audio-tour',
            ...(base.hasName ? { name: base.name } : {}),
          };
          expect(exclusionRuleFor(doc)).toBe('audio_tour');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 2. amenity_sub_type
    const amenitySubTypeArb = fc.constantFrom(...AMENITY_SUB_TYPES);
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          subType: amenitySubTypeArb,
          type: fc.constantFrom('recreation', 'attraction', 'spa', 'resort'),
        }),
        (doc) => {
          expect(exclusionRuleFor(doc)).toBe('amenity_sub_type');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 3. animal_placard
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          prefix: fc.string(),
          type: fc.constantFrom('attraction', 'entertainment'),
        }),
        ({ id, prefix, type }) => {
          const doc: FacilityDocument = {
            id,
            type,
            name: `${prefix}${ANIMAL_PLACARD_SUFFIX}`,
          };
          expect(exclusionRuleFor(doc)).toBe('animal_placard');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 4. rental_inventory
    const rentalTriggerArb = fc.constantFrom(
      'Beachcomber Shacks',
      'Beachcomber Shacks Premium',
      'Polar Patios',
      'Polar Patios VIP',
      'Poolside Patios',
      'Cabana Umbrellas',
      'Shade Umbrellas',
    );
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          name: rentalTriggerArb,
          type: fc.constantFrom('recreation', 'attraction'),
        }),
        (doc) => {
          expect(exclusionRuleFor(doc)).toBe('rental_inventory');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 5. community_hall
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          prefix: fc.string(),
          suffix: fc.string(),
          type: fc.constantFrom('recreation', 'attraction'),
        }),
        ({ id, prefix, suffix, type }) => {
          const doc: FacilityDocument = {
            id,
            type,
            name: `${prefix}Community Hall${suffix}`,
          };
          expect(exclusionRuleFor(doc)).toBe('community_hall');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 6. informational_page
    const infoPagePrefixArb = fc.constantFrom(
      'Guide for Families',
      'Weather Updates',
      'Night Owls Guide',
      'Little Ones Guide',
      'Park Hopper Hours',
      'World Showcase Entry',
      'World ShowPlace',
      'Summer Fun in the Disney Water Parks',
      'Enhanced Nighttime Spectaculars',
      'Choose Your Favorite Things',
      'Real Stuff for Real Life',
      'Allergy-Friendly Offerings',
    );
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          prefix: infoPagePrefixArb,
          type: fc.constantFrom('attraction', 'entertainment', 'guest-service'),
        }),
        ({ id, prefix, type }) => {
          const doc: FacilityDocument = {
            id,
            type,
            name: prefix,
          };
          expect(exclusionRuleFor(doc)).toBe('informational_page');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 7. excluded_name
    const excludedNameArb = fc.constantFrom(
      ...EXCLUDED_NAME_LIST.filter((n) => !n.includes('Community Hall')),
    );
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          name: excludedNameArb,
          type: fc.constantFrom('recreation', 'attraction'),
        }),
        (doc) => {
          expect(exclusionRuleFor(doc)).toBe('excluded_name');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 8. service_facility
    const serviceFacilityArb = fc.constantFrom(
      'Best Friends Pet Hotel',
      'Signature Portrait Session',
    );
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          name: serviceFacilityArb,
          type: fc.constantFrom('guest-service', 'recreation'),
        }),
        (doc) => {
          expect(exclusionRuleFor(doc)).toBe('service_facility');
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 9. duplicate_clone
    const duplicateCloneArb = fc.constantFrom(...DUPLICATE_CLONE_IDS);
    fc.assert(
      fc.property(
        fc.record({
          id: duplicateCloneArb,
          name: fc.constant('Neutral Attraction Name'),
          type: fc.constant('attraction'),
        }),
        (doc) => {
          expect(exclusionRuleFor(doc)).toBe('duplicate_clone');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 10: A curated clone is excluded regardless of its sibling\'s presence', () => {
    const duplicateCloneArb = fc.constantFrom(...DUPLICATE_CLONE_IDS);
    fc.assert(
      fc.property(
        fc.record({
          id: duplicateCloneArb,
          name: fc.option(fc.string(), { nil: undefined }),
          type: fc.option(fc.string(), { nil: undefined }),
          subType: fc.option(fc.string(), { nil: undefined }),
        }),
        (base) => {
          const doc: FacilityDocument = {
            id: base.id,
            ...(base.name !== undefined ? { name: base.name } : {}),
            ...(base.type !== undefined ? { type: base.type } : {}),
            ...(base.subType !== undefined ? { subType: base.subType } : {}),
          };

          // Regardless of other attributes or presence of sibling documents,
          // the clone is always excluded (either matching an earlier content rule or duplicate_clone)
          const rule = exclusionRuleFor(doc);
          expect(rule).not.toBeNull();
          expect(isExcludedFacility(doc)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

