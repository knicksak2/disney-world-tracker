// Feature: festival-booth-tagging, Property 30: Menu Keyword Match Is Festival-Specific
/**
 * Property-based tests for `menuMatchesFestival`.
 *
 * Property 30 (design.md → Correctness Properties):
 *
 *   For any set of menus and any two distinct FestivalSlug values a and b, if
 *   menuMatchesFestival(menus, a) is true because of a specific group name,
 *   that same group name does not cause menuMatchesFestival(menus, b) to be
 *   true — i.e. no group name matches more than one Festival's keyword
 *   pattern.
 *
 * Validates: Requirements 3.9
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { FESTIVAL_SLUGS, type FestivalSlug, type MenuDTO } from '@dwt/shared';

import { menuMatchesFestival } from '../menuMatch.js';

const NUM_RUNS = 100;

/** Known Disney naming variants per festival, used to build realistic group names. */
const VARIANT_TEMPLATES: Record<FestivalSlug, readonly string[]> = {
  'food-and-wine': [
    'Food & Wine Festival Food Offerings',
    'Food and Wine Festival Beverage Offering',
    'Food & Wine Festival Alcoholic Beverage Offerings',
  ],
  'flower-and-garden': [
    'Flower & Garden Festival Food Offerings',
    'Flower and Garden Festival Beverage Offering',
  ],
  'festival-of-the-arts': [
    'Festival of the Arts Food Offerings',
    'Festival of the Arts Beverage Offering',
  ],
  'festival-of-the-holidays': [
    'Festival of the Holidays Food Offerings',
    'Festival of the Holidays Beverage Offering',
  ],
};

const slugArb = fc.constantFrom(...FESTIVAL_SLUGS);

function menuWithGroup(groupName: string): readonly MenuDTO[] {
  return [
    {
      menuType: 'Lunch And Dinner',
      cuisineType: null,
      groups: [{ name: groupName, items: [] }],
    },
  ];
}

describe('Property 30: menuMatchesFestival keyword match is festival-specific', () => {
  it('a group name matching one festival keyword never matches a different festival', () => {
    fc.assert(
      fc.property(slugArb, slugArb, (slugA, slugB) => {
        fc.pre(slugA !== slugB);

        for (const variant of VARIANT_TEMPLATES[slugA]) {
          const menus = menuWithGroup(variant);
          const matchesA = menuMatchesFestival(menus, slugA);
          const matchesB = menuMatchesFestival(menus, slugB);

          expect(matchesA).toBe(true);
          expect(matchesB).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a random non-festival string never matches any festival', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 40 }).filter(
          (s) => !/festival/i.test(s),
        ),
        slugArb,
        (groupName, slug) => {
          const menus = menuWithGroup(groupName);
          expect(menuMatchesFestival(menus, slug)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('each festival keyword variant matches its own slug across every slug pairing', () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        for (const variant of VARIANT_TEMPLATES[slug]) {
          const menus = menuWithGroup(variant);
          expect(menuMatchesFestival(menus, slug)).toBe(true);

          for (const otherSlug of FESTIVAL_SLUGS) {
            if (otherSlug === slug) continue;
            expect(menuMatchesFestival(menus, otherSlug)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
