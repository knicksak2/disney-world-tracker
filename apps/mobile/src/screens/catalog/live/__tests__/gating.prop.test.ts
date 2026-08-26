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

import { liveSectionFor, NO_LIVE_SHAPE } from '../../gating';
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
  Walkthrough: 'none', // R5.2 (default without live standby wait)
  PlayArea: 'none', // R5.2
  Game: 'none', // R5.2
  Show: 'showtimes', // R7.3
  Parade: 'showtimes', // R7.3
  Restaurant: 'dining', // R7.4
  Tour: 'none', // R7.1
  Recreation: 'none', // R7.1
  Spa: 'none', // R7.1
  Event: 'none', // R7.1
  Other: 'none', // R7.1
  Resort: 'none', // R7.1 — resort stand-in has no live section
};

const ALL_SECTIONS: readonly LiveSection[] = ['wait_status', 'showtimes', 'dining', 'none'];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(...EXPERIENCE_CATEGORIES);

const liveShapeArb = fc.record({
  hasStandbyWait: fc.boolean(),
  hasShowtimes: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 15: Category gating yields at most one live section, determined solely by category (R7.1-R7.5)', () => {
  // With no Live_Detail loaded (`NO_LIVE_SHAPE`) the gate reduces to the
  // original category-only mapping, so this property holds verbatim; the
  // live-shape fallbacks are covered by catalog-taxonomy-cleanup Property 9.
  test('every category maps to exactly one valid section, solely by category, deterministically', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const section = liveSectionFor(category, NO_LIVE_SHAPE);

        // Exactly one valid LiveSection value: the return is a single scalar
        // that is a member of the allowed set (never "multiple" sections).
        expect(ALL_SECTIONS).toContain(section);

        // Determined solely by category: matches the independent oracle.
        expect(section).toBe(EXPECTED_SECTION[category]);

        // Determinism: the same category always yields the same section.
        expect(liveSectionFor(category, NO_LIVE_SHAPE)).toBe(section);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: catalog-taxonomy-cleanup, Property 9: Live section gating for new categories and show fallbacks
  test('Property 9: Live section gating for new categories and show fallbacks (R5.1-R5.5)', () => {
    fc.assert(
      fc.property(categoryArb, liveShapeArb, (category, live) => {
        const section = liveSectionFor(category, live);

        expect(ALL_SECTIONS).toContain(section);

        if (category === 'Ride' || category === 'Character_Meet') {
          expect(section).toBe('wait_status');
        } else if (
          category === 'Walkthrough' ||
          category === 'PlayArea' ||
          category === 'Game'
        ) {
          expect(section).toBe(live.hasStandbyWait ? 'wait_status' : 'none');
        } else if (category === 'Show' || category === 'Parade') {
          if (!live.hasShowtimes && live.hasStandbyWait) {
            expect(section).toBe('wait_status');
          } else {
            expect(section).toBe('showtimes');
          }
        } else if (category === 'Restaurant') {
          expect(section).toBe('dining');
        } else {
          // Structural categories: Tour, Recreation, Spa, Event, Other, Resort
          expect(section).toBe('none');
        }
      }),
      { numRuns: 200 },
    );
  });
});
