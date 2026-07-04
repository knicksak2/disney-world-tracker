// Feature: experience-detail-navigation, Property 5: Row accessibility label includes the Experience name
//
// Validates: Requirements 4.2
//
// Property 5 (from design.md → Correctness Properties):
//   For any Completion_Entry rendered as an activatable Completed_Experience_Row,
//   the row's accessibility label includes that entry's Experience name.
//
// Test strategy:
//   - A `CompletionRow` is activatable only when an `onOpenExperience` callback
//     is supplied AND the entry resolves to a navigation target — i.e. it has a
//     present, non-blank `experienceId` (`resolveExperienceTarget`). The
//     generators below therefore always supply a non-blank `experienceId` and a
//     non-empty `experienceName`, and the row is always rendered with the
//     `onOpenExperience` callback, so every generated row is activatable.
//   - The remaining DTO fields (park, category, completedOn, rating, sharedNote)
//     are filled with arbitrary valid values so they cannot influence the label.
//   - For each generated entry, the rendered activatable row's
//     `accessibilityLabel` must contain the entry's `experienceName` (R4.2).
//   - `fast-check` drives a blend of arbitrary non-empty names (including names
//     with whitespace, punctuation, and unicode) at `numRuns: 100`.

import React from 'react';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO, ExperienceCategory, Park } from '@dwt/shared';

import { CompletionRow, type CompletionRowFields } from '../CompletionRow';
import { resolveExperienceTarget } from '../experienceNavigation';

const NUM_RUNS = 100;
const ROW_TEST_ID = 'completion-row';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const ratingArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 10 }),
);

const sharedNoteArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 12 }),
);

const completedOnArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2018-01-01'), max: new Date('2025-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

// A non-empty Experience name: a blend of real-looking names and arbitrary
// strings, every one retaining at least one non-whitespace character so the
// row has a meaningful name (per the task note).
const experienceNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'Space Mountain',
      'Haunted Mansion',
      "Pirates of the Caribbean",
      'Test Track',
      'Be Our Guest',
      "It's a Small World",
    ),
  },
  {
    weight: 3,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 24 })
      .filter((s) => s.trim().length > 0),
  },
);

// A present, non-blank Experience_Id so the entry always resolves to a target
// and the rendered row is activatable.
const presentIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.string({ minLength: 1, maxLength: 16 }).filter((s) => s.trim().length > 0),
);

const fieldsArb: fc.Arbitrary<CompletionRowFields> = fc.constantFrom(
  'parks',
  'categories',
  'experiences',
);

const activatableEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: presentIdArb,
  experienceName: experienceNameArb,
  park: parkArb,
  areaType: fc.constantFrom(...AREA_TYPES),
  category: categoryArb,
  completedOn: completedOnArb,
  rating: ratingArb,
  sharedNote: sharedNoteArb,
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 5: activatable row accessibility label includes the Experience name (R4.2)', () => {
  it('exposes an accessibility label that contains the entry Experience name', () => {
    fc.assert(
      fc.property(activatableEntryArb, fieldsArb, (entry, fields) => {
        // Precondition: the entry resolves to a navigation target, so supplying
        // `onOpenExperience` makes the row a single activatable control (R4.1).
        expect(resolveExperienceTarget(entry)).not.toBeNull();

        const view = render(
          <CompletionRow
            entry={entry}
            fields={fields}
            onOpenExperience={() => {}}
            testID={ROW_TEST_ID}
          />,
        );

        try {
          const row = view.getByTestId(ROW_TEST_ID);

          // The activatable row announces itself as a button (R4.1) and its
          // accessibility label includes the Experience name (R4.2).
          expect(row.props.accessibilityRole).toBe('button');
          const label = String(row.props.accessibilityLabel);
          expect(label).toContain(entry.experienceName);
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
