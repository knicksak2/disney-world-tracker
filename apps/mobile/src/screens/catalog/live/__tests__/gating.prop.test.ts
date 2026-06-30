// Feature: experience-live-details, Property 15: Category gating yields at most one live section, determined solely by category
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
//
// Property 15 (from design.md):
//   For any ExperienceCategory, `liveSectionFor(category)` returns exactly one
//   LiveSection value (a single value, never multiple), determined solely by
//   the category:
//     - Ride / Character_Meet → 'wait_status'  (R7.2)
//     - Show / Parade         → 'showtimes'     (R7.3)
//     - Restaurant            → 'dining'        (R7.4)
//     - Other                 → 'none'          (R7.1)
//   And the same category always yields the same section (determinism, R7.5:
//   "at most one live operational section, determined solely by the
//   Experience's Experience_Category").
//
// Test strategy:
//   - Generate every ExperienceCategory uniformly from the closed shared
//     `EXPERIENCE_CATEGORIES` tuple (the authoritative union), so the property
//     exercises the entire input space rather than a hand-picked subset.
//   - For each generated category, assert the result is one of the four valid
//     LiveSection members (a single scalar value — the function's return type
//     guarantees it can never be "multiple" sections, and asking for set
//     membership confirms it is exactly one of the allowed values).
//   - Assert the result equals the category's expected section from an
//     independent reference table, which encodes R7.1–R7.4 directly. This
//     pins "determined solely by category": the section depends on nothing but
//     the category argument.
//   - Assert determinism by calling the function twice and requiring identical
//     results — a category always maps to the same single section.

import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES } from '@dwt/shared';
import type { ExperienceCategory } from '@dwt/shared';

import { liveSectionFor } from '../../gating';
import type { LiveSection } from '../../gating';

// ---------------------------------------------------------------------------
// Reference table (independent of the implementation)
// ---------------------------------------------------------------------------
//
// Encodes the requirement-mandated mapping directly so the property checks the
// implementation against an oracle rather than against itself.
const EXPECTED_SECTION: Readonly<Record<ExperienceCategory, LiveSection>> = {
  Ride: 'wait_status', // R7.2
  Character_Meet: 'wait_status', // R7.2
  Show: 'showtimes', // R7.3
  Parade: 'showtimes', // R7.3
  Restaurant: 'dining', // R7.4
  Other: 'none', // R7.1
};

const ALL_SECTIONS: readonly LiveSection[] = ['wait_status', 'showtimes', 'dining', 'none'];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(...EXPERIENCE_CATEGORIES);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 15: Category gating yields at most one live section, determined solely by category (R7.1-R7.5)', () => {
  test('every category maps to exactly one valid section, solely by category, deterministically', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const section = liveSectionFor(category);

        // Exactly one valid LiveSection value: the return is a single scalar
        // that is a member of the allowed set (never "multiple" sections).
        expect(ALL_SECTIONS).toContain(section);

        // Determined solely by category: matches the independent oracle.
        expect(section).toBe(EXPECTED_SECTION[category]);

        // Determinism: the same category always yields the same section.
        expect(liveSectionFor(category)).toBe(section);
      }),
      { numRuns: 100 },
    );
  });
});
