/**
 * Preservation property test for rows that carry no navigation affordance
 * (bugfix spec: experience-detail-back-navigation, Task 2).
 *
 * Validates (Preservation — behavior that must remain unchanged by the fix):
 *   Requirements 3.5
 *   (Property 2 — Preservation: No-Affordance Rows)
 *
 * Observation-first methodology over a WIDE input domain of Experience_Id
 * values (present, empty, whitespace-only, explicit-null, and missing): the
 * baseline behavior is that `resolveExperienceTarget` returns `null` exactly
 * when the Experience_Id is missing or blank, and a `CompletionRow` for such an
 * entry renders WITHOUT a navigation affordance — it is not announced as a
 * button and a tap performs no navigation — even when an `onOpenExperience`
 * callback is supplied. These tests are EXPECTED TO PASS on the unfixed code
 * and must CONTINUE TO PASS after the navigation-structure fix (the fix changes
 * only where navigation is dispatched, not whether a no-id row is activatable).
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
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

const experienceNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

const fieldsArb: fc.Arbitrary<CompletionRowFields> = fc.constantFrom(
  'parks',
  'categories',
  'experiences',
);

// Base entry without the experienceId field; each property supplies the id
// shape under test.
const baseEntryArb = fc.record({
  experienceName: experienceNameArb,
  park: parkArb,
  category: categoryArb,
  completedOn: completedOnArb,
  rating: ratingArb,
  sharedNote: sharedNoteArb,
});

// A blank Experience_Id: empty or whitespace-only.
const blankIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 1,
    maxLength: 6,
  }),
);

// The "missing / null" shapes: an explicit null id, or the field omitted.
type MaybeId = { readonly experienceId?: string | null };
const missingIdArb: fc.Arbitrary<MaybeId> = fc.oneof(
  fc.constant<MaybeId>({ experienceId: null }),
  fc.constant<MaybeId>({}),
);

// Union of all "no available Experience_Id" shapes (clause 3.5 precondition).
const noTargetEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.oneof(
  fc.record({
    base: baseEntryArb,
    experienceId: blankIdArb,
  }).map(({ base, experienceId }) => ({ ...base, experienceId }) as CompletionEntryDTO),
  fc.record({
    base: baseEntryArb,
    maybeId: missingIdArb,
  }).map(({ base, maybeId }) => ({ ...base, ...maybeId }) as unknown as CompletionEntryDTO),
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Preservation 3.5 — a row with no available Experience_Id carries no navigation affordance', () => {
  it('does not announce the row as a button and performs no navigation when tapped, even with a callback supplied', () => {
    fc.assert(
      fc.property(noTargetEntryArb, fieldsArb, (entry, fields) => {
        // Precondition (baseline): the entry resolves to no navigation target.
        expect(resolveExperienceTarget(entry)).toBeNull();

        const onOpenExperience = jest.fn();
        const view = render(
          <CompletionRow
            entry={entry}
            fields={fields}
            onOpenExperience={onOpenExperience}
            testID={ROW_TEST_ID}
          />,
        );

        try {
          const row = view.getByTestId(ROW_TEST_ID);

          // No navigation affordance: the row is NOT exposed as a button
          // (clause 3.5 / R6.1).
          expect(row.props.accessibilityRole).not.toBe('button');

          // Tapping (or assistive activation) performs no navigation — the
          // callback is never invoked for a no-id row.
          fireEvent.press(row);
          expect(onOpenExperience).not.toHaveBeenCalled();
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
