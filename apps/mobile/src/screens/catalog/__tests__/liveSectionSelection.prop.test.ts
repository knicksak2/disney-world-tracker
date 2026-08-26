// Feature: experience-detail-redesign, Property 12: At most one live section by category
//
// Validates: Requirements 8.3
//
// Property 12 (from design.md):
//   For any Experience category, `liveSectionFor` returns exactly one
//   `LiveSection` value, so the screen selects at most one
//   Live_Operational_Section based solely on category.
//
// Test strategy:
//   - Generate every ExperienceCategory uniformly from the closed shared
//     `EXPERIENCE_CATEGORIES` tuple (the authoritative union), so the property
//     exercises the entire input space rather than a hand-picked subset.
//   - Assert the result is exactly one member of the valid LiveSection set —
//     the return type guarantees a single scalar, and set membership confirms
//     it is one of the allowed values (never zero, never "multiple").
//   - Assert the section depends solely on the category by comparing against an
//     independent reference oracle and by requiring determinism (calling twice
//     yields the same value).

import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES } from '@dwt/shared';
import type { ExperienceCategory } from '@dwt/shared';

import { liveSectionFor, NO_LIVE_SHAPE } from '../gating';
import type { LiveSection } from '../gating';

// ---------------------------------------------------------------------------
// Reference oracle (independent of the implementation)
// ---------------------------------------------------------------------------
//
// Encodes the requirement-mandated category → section mapping directly so the
// property checks the implementation against an oracle rather than itself.
const EXPECTED_SECTION: Readonly<Record<ExperienceCategory, LiveSection>> = {
  Ride: 'wait_status',
  Character_Meet: 'wait_status',
  Walkthrough: 'none',
  PlayArea: 'none',
  Game: 'none',
  Show: 'showtimes',
  Parade: 'showtimes',
  Restaurant: 'dining',
  Tour: 'none',
  Recreation: 'none',
  Spa: 'none',
  Event: 'none',
  Other: 'none',
  Resort: 'none',
};

const ALL_SECTIONS: readonly LiveSection[] = ['wait_status', 'showtimes', 'dining', 'none'];

const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(...EXPERIENCE_CATEGORIES);

describe('Property 12: At most one live section by category (R8.3)', () => {
  // With no Live_Detail loaded (`NO_LIVE_SHAPE`), the gate reduces to the
  // original category-only mapping, so this property still holds verbatim; the
  // live-shape fallbacks are covered by catalog-taxonomy-cleanup Property 9.
  test('every category maps to exactly one valid LiveSection, solely by category', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const section = liveSectionFor(category, NO_LIVE_SHAPE);

        // Exactly one valid LiveSection value: a single scalar that is a member
        // of the allowed set (never zero, never "multiple" sections).
        expect(ALL_SECTIONS).toContain(section);

        // Selected solely by category: matches the independent oracle.
        expect(section).toBe(EXPECTED_SECTION[category]);

        // Determinism: the same category always yields the same section.
        expect(liveSectionFor(category, NO_LIVE_SHAPE)).toBe(section);
      }),
      { numRuns: 100 },
    );
  });
});
