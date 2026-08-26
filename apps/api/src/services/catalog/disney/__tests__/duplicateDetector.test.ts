// Feature: catalog-taxonomy-cleanup, Property 11: Duplicate detection reports without mutating

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  detectDuplicateGroups,
  KNOWN_DISTINCT_NAMESAKES,
  normalizeExperienceName,
} from '../duplicateDetector.js';

const NUM_RUNS = 200;

describe('duplicateDetector - Unit Tests', () => {
  describe('normalizeExperienceName', () => {
    it('normalizes case, whitespace, accents, and punctuation', () => {
      expect(normalizeExperienceName("Mickey's PhilharMagic")).toBe(
        'mickey s philharmagic',
      );
      expect(normalizeExperienceName('Mickey’s PhilharMagic')).toBe(
        'mickey s philharmagic',
      );
      expect(normalizeExperienceName('EPCOT® International Food & Wine Festival')).toBe(
        'epcot international food wine festival',
      );
      expect(normalizeExperienceName('EPCOT International Food & Wine Festival')).toBe(
        'epcot international food wine festival',
      );
      expect(normalizeExperienceName('  Palais   du Cinéma  ')).toBe(
        'palais du cinema',
      );
    });
  });

  describe('detectDuplicateGroups', () => {
    it('reports a genuine duplicate clone pair sharing a normalized name', () => {
      const experiences = [
        {
          upstreamEntityId: '19632587;entityType=Recreation',
          category: 'Recreation',
          name: 'Drawn to Life',
        },
        {
          upstreamEntityId: '19382527;entityType=Entertainment',
          category: 'Show',
          name: 'Drawn to Life',
        },
        {
          upstreamEntityId: '80010192;entityType=Attraction',
          category: 'Ride',
          name: 'Space Mountain',
        },
      ];

      const groups = detectDuplicateGroups(experiences);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.normalizedName).toBe('drawn to life');
      expect(groups[0]?.members).toHaveLength(2);
      expect(groups[0]?.members.map((m) => m.enterpriseId)).toEqual([
        '19632587;entityType=Recreation',
        '19382527;entityType=Entertainment',
      ]);
    });

    it('suppresses the KNOWN_DISTINCT_NAMESAKES Hilton pair from the report (R8.9)', () => {
      const experiences = [
        {
          upstreamEntityId: '80069785;entityType=resort:resort-visit',
          category: 'Resort',
          name: 'Hilton Orlando Lake Buena Vista',
        },
        {
          upstreamEntityId: '412312319;entityType=restaurant',
          category: 'Restaurant',
          name: 'Hilton Orlando Lake Buena Vista',
        },
      ];

      const groups = detectDuplicateGroups(experiences);
      expect(groups).toEqual([]);
    });

    it('groups names differing only by apostrophe style or trademark symbol', () => {
      const experiences = [
        {
          upstreamEntityId: 'id-1',
          category: 'Show',
          name: "Mickey's PhilharMagic",
        },
        {
          upstreamEntityId: 'id-2',
          category: 'Show',
          name: 'Mickey’s PhilharMagic',
        },
      ];

      const groups = detectDuplicateGroups(experiences);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.normalizedName).toBe('mickey s philharmagic');
      expect(groups[0]?.members).toHaveLength(2);
    });

    it('does not report unique single-member experiences', () => {
      const experiences = [
        {
          upstreamEntityId: 'id-1',
          category: 'Ride',
          name: 'Space Mountain',
        },
        {
          upstreamEntityId: 'id-2',
          category: 'Ride',
          name: 'Big Thunder Mountain',
        },
        {
          upstreamEntityId: 'id-3',
          category: 'Show',
          name: 'Country Bear Jamboree',
        },
      ];

      const groups = detectDuplicateGroups(experiences);
      expect(groups).toEqual([]);
    });
  });
});

describe('duplicateDetector - Property Tests', () => {
  const experienceArb = fc.record({
    upstreamEntityId: fc.string({ minLength: 1 }),
    category: fc.constantFrom(
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
    ),
    name: fc.string({ minLength: 1 }),
  });

  it('Property 11: Duplicate detection reports without mutating', () => {
    fc.assert(
      fc.property(fc.array(experienceArb, { maxLength: 20 }), (experiences) => {
        // Deep clone before running detection
        const snapshot = JSON.stringify(experiences);

        const groups = detectDuplicateGroups(experiences);

        // Assert no mutation occurred to input experiences array or its objects
        expect(JSON.stringify(experiences)).toBe(snapshot);

        // Verify structure of reported groups
        for (const group of groups) {
          expect(group.members.length).toBeGreaterThanOrEqual(2);
          expect(group.normalizedName.length).toBeGreaterThan(0);

          // All members in a group must normalize to the group's normalizedName
          for (const member of group.members) {
            const original = experiences.find(
              (e) => e.upstreamEntityId === member.enterpriseId,
            );
            expect(original).toBeDefined();
            if (original) {
              expect(normalizeExperienceName(original.name)).toBe(
                group.normalizedName,
              );
            }
          }

          // Check that no reported group is in KNOWN_DISTINCT_NAMESAKES
          const memberIds = new Set(group.members.map((m) => m.enterpriseId));
          const isNamesake = KNOWN_DISTINCT_NAMESAKES.some(
            (list) =>
              list.length === memberIds.size &&
              list.every((id) => memberIds.has(id)),
          );
          expect(isNamesake).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
