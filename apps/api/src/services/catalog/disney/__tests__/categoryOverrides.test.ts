// Feature: catalog-taxonomy-cleanup, Property 3: A curated override always outranks a rule-based drop
// Feature: catalog-taxonomy-cleanup, Property 4: Classification is unchanged for every non-overridden document

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ExperienceCategory } from '@dwt/shared';
import {
  CATEGORY_OVERRIDES,
  categoryOverrideFor,
} from '../categoryOverrides.js';
import { classifyFacility } from '../classifyFacility.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  parseEnterpriseId,
  type FacilityDocument,
} from '../facilityDoc.js';
import { isExcludedFacility } from '../facilityExclusion.js';

const NUM_RUNS = 200;

describe('categoryOverrides - Unit Tests', () => {
  it('contains exactly 53 curated overrides', () => {
    expect(CATEGORY_OVERRIDES.size).toBe(53);
  });

  it('has well-formed Enterprise_Id keys for all 53 entries', () => {
    for (const key of CATEGORY_OVERRIDES.keys()) {
      const parsed = parseEnterpriseId(key);
      expect(parsed).not.toBeNull();
      expect(parsed?.numericId).toMatch(/^\d+$/);
      expect(parsed?.entityType.length).toBeGreaterThan(0);
    }
  });

  it('explicitly excludes 18447293;entityType=Entertainment (Tree of Life Awakenings)', () => {
    expect(CATEGORY_OVERRIDES.has('18447293;entityType=Entertainment')).toBe(false);
    expect(categoryOverrideFor('18447293;entityType=Entertainment')).toBeNull();
  });

  it('includes Uwanja Camp (293719;entityType=Recreation) as a curated keep mapped to PlayArea', () => {
    expect(categoryOverrideFor('293719;entityType=Recreation')).toBe('PlayArea');
  });

  it('includes Mickey\'s Not-So-Scary Halloween Party (19637044;entityType=Recreation) mapped to Event', () => {
    expect(categoryOverrideFor('19637044;entityType=Recreation')).toBe('Event');
  });

  it('table-driven: maps all 53 overrides to their expected categories via classifyFacility', () => {
    const expectedOverrides: Record<string, ExperienceCategory> = {
      // Shows (18)
      '80069748;entityType=Attraction': 'Show',
      '80069754;entityType=Attraction': 'Show',
      '80010200;entityType=Attraction': 'Show',
      '80010170;entityType=Attraction': 'Show',
      '136550;entityType=Attraction': 'Show',
      '16124144;entityType=Attraction': 'Show',
      '62992;entityType=Attraction': 'Show',
      '19463785;entityType=Attraction': 'Show',
      '80010145;entityType=Attraction': 'Show',
      '80010180;entityType=Attraction': 'Show',
      '80010174;entityType=Attraction': 'Show',
      '19473173;entityType=Attraction': 'Show',
      '19497952;entityType=Attraction': 'Show',
      '16767276;entityType=Attraction': 'Show',
      '18770880;entityType=Attraction': 'Show',
      '412735091;entityType=Attraction': 'Show',
      '18269694;entityType=Attraction': 'Show',
      '19503896;entityType=Attraction': 'Show',

      // Walkthroughs (17)
      '80010175;entityType=Attraction': 'Walkthrough',
      '80010164;entityType=Attraction': 'Walkthrough',
      '80010126;entityType=Attraction': 'Walkthrough',
      '80010214;entityType=Attraction': 'Walkthrough',
      '80010184;entityType=Attraction': 'Walkthrough',
      '80010196;entityType=Attraction': 'Walkthrough',
      '80010217;entityType=Attraction': 'Walkthrough',
      '411794307;entityType=Attraction': 'Walkthrough',
      '411794409;entityType=Attraction': 'Walkthrough',
      '16767209;entityType=Attraction': 'Walkthrough',
      '26421;entityType=Attraction': 'Walkthrough',
      '80069745;entityType=Attraction': 'Walkthrough',
      '80069743;entityType=Attraction': 'Walkthrough',
      '61525;entityType=Attraction': 'Walkthrough',
      '80010137;entityType=Attraction': 'Walkthrough',
      '160914;entityType=Attraction': 'Walkthrough',
      '411708725;entityType=Attraction': 'Walkthrough',

      // PlayArea (9)
      '80010144;entityType=Attraction': 'PlayArea',
      '220239;entityType=Attraction': 'PlayArea',
      '3831;entityType=Attraction': 'PlayArea',
      '91245;entityType=Attraction': 'PlayArea',
      '412606840;entityType=Attraction': 'PlayArea',
      '56404;entityType=Attraction': 'PlayArea',
      '16512939;entityType=Attraction': 'PlayArea',
      '65083;entityType=Attraction': 'PlayArea',
      '293719;entityType=Recreation': 'PlayArea',

      // Game (8)
      '17272158;entityType=Attraction': 'Game',
      '17396838;entityType=Attraction': 'Game',
      '19062768;entityType=Attraction': 'Game',
      '411657083;entityType=Attraction': 'Game',
      '411657082;entityType=Attraction': 'Game',
      '19272517;entityType=Attraction': 'Game',
      '412396709;entityType=Attraction': 'Game',
      '80010119;entityType=Attraction': 'Game',

      // Event (1)
      '19637044;entityType=Recreation': 'Event',
    };

    expect(Object.keys(expectedOverrides)).toHaveLength(53);

    for (const [id, expectedCat] of Object.entries(expectedOverrides)) {
      const doc: FacilityDocument = {
        id,
        name: `Test Facility ${id}`,
        type: 'attraction',
      };
      expect(classifyFacility(doc)).toBe(expectedCat);
    }
  });
});

describe('categoryOverrides - Property Tests', () => {
  const overrideEntries = [...CATEGORY_OVERRIDES.entries()];
  const overrideEntryArb = fc.constantFrom(...overrideEntries);

  it('Property 3: A curated override always outranks a rule-based drop', () => {
    // Generates documents with an overridden id and potentially rule-matching fields
    fc.assert(
      fc.property(
        overrideEntryArb,
        fc.record({
          subType: fc.option(fc.constantFrom('Spa / Hot Tub', 'Quiet Pool', 'Arcade'), { nil: undefined }),
          name: fc.option(fc.constantFrom('Cabanas', 'Golf Lessons', 'Sample - Disney Animals'), { nil: undefined }),
          type: fc.option(fc.constantFrom('audio-tour', 'recreation', 'attraction', 'spa'), { nil: undefined }),
        }),
        ([enterpriseId, expectedCategory], noise) => {
          const doc: FacilityDocument = {
            id: enterpriseId,
            ...(noise.name !== undefined ? { name: noise.name } : {}),
            ...(noise.subType !== undefined ? { subType: noise.subType } : {}),
            ...(noise.type !== undefined ? { type: noise.type } : {}),
          };

          // Override returns the category
          expect(categoryOverrideFor(doc.id)).toBe(expectedCategory);
          // classifyFacility returns the overridden category
          expect(classifyFacility(doc)).toBe(expectedCategory);

          // In sync logic: even if isExcludedFacility(doc) is true,
          // categoryOverrideFor(doc.id) !== null ensures it is admitted.
          const isAdmitted = !isExcludedFacility(doc) || categoryOverrideFor(doc.id) !== null;
          expect(isAdmitted).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 4: Classification is unchanged for every non-overridden document', () => {
    // Pure baseline classifier without overrides
    function baselineClassify(doc: FacilityDocument): ExperienceCategory | null {
      const type = doc.type;
      if (type === undefined || !EXPERIENCE_ELIGIBLE_TYPES.has(type)) {
        return null;
      }
      const subType = doc.subType;
      const signal = subType !== undefined && subType.trim() !== '' ? subType : doc.name;
      const isParade = signal !== undefined && /parade/i.test(signal);
      const isMeet = signal !== undefined && /character|meet[- ]?(?:and[- ]?)?greet/i.test(signal);
      const sub = isParade ? 'Parade' : isMeet ? 'Character_Meet' : null;

      switch (type) {
        case 'attraction':
          return sub ?? 'Ride';
        case 'entertainment':
          return sub ?? 'Show';
        case 'restaurant':
        case 'dinner-show':
          return 'Restaurant';
        case 'tour':
        case 'audio-tour':
          return 'Tour';
        case 'recreation':
        case 'recreation-activity':
          return 'Recreation';
        case 'spa':
          return 'Spa';
        case 'event':
        case 'dining-event':
          return 'Event';
        default:
          return 'Other';
      }
    }

    const nonOverriddenDocArb = fc
      .record({
        id: fc.string({ minLength: 1 }),
        hasType: fc.boolean(),
        type: fc.string(),
        hasSubType: fc.boolean(),
        subType: fc.string(),
        hasName: fc.boolean(),
        name: fc.string(),
      })
      .map((r) => {
        const doc: FacilityDocument = {
          id: r.id,
          ...(r.hasType ? { type: r.type } : {}),
          ...(r.hasSubType ? { subType: r.subType } : {}),
          ...(r.hasName ? { name: r.name } : {}),
        };
        return doc;
      })
      .filter((doc) => !CATEGORY_OVERRIDES.has(doc.id));

    fc.assert(
      fc.property(nonOverriddenDocArb, (doc) => {
        expect(categoryOverrideFor(doc.id)).toBeNull();
        expect(classifyFacility(doc)).toBe(baselineClassify(doc));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
