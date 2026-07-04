// Feature: experience-detail-navigation, Property 10: Expanded Group_Body content matches the group's named entries
//
// Validates: Requirements 11.1, 11.2
//
// Property 10 (from design.md → Correctness Properties):
//   For any Expanded Group_Section: when the group has one or more
//   Completion_Entries with an available Experience name, the Group_Body
//   renders exactly those entries' Completed_Experience_Rows (same count and
//   identity, in the group's order); when the group has zero such entries, the
//   Group_Body renders a single Compact_Empty_State and no rows.
//
// Test strategy:
//   The grouped panes of StatsScreen / FriendProfileScreen select an Expanded
//   GroupSection's Group_Body content like this: take the group's named
//   entries (the same `namedEntries` projection the grouping helpers apply in
//   source order); when any exist, render the group's CompletionRows; otherwise
//   render a single CompactEmptyState. This test reproduces exactly that
//   body-selection in a small `renderGroupBody` helper and renders it inside a
//   real GroupSection in the Expanded state (the screens own the wiring; this
//   test owns only the body-selection logic).
//
//   For each generated group of entries (a deliberate blend of named, empty,
//   and whitespace-only names), the test asserts:
//     - when named entries exist: the body contains exactly one row per named
//       entry, identified and ordered by the named entries' source order
//       (R11.1), and no Compact_Empty_State; and
//     - when no named entries exist: the body contains exactly one
//       Compact_Empty_State and zero rows (R11.2).
//
//   `fast-check` drives the entry lists at `numRuns: 100`.

import React from 'react';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO } from '@dwt/shared';

import { CompletionRow } from '../CompletionRow';
import { CompactEmptyState } from '../CompactEmptyState';
import { GroupSection } from '../GroupSection';
import { namedEntries } from '../grouping';

const NUM_RUNS = 100;
const EMPTY_TEST_ID = 'compact-empty';
const ROW_PREFIX = 'group-row-';

// ---------------------------------------------------------------------------
// Body-selection (mirrors the grouped panes of StatsScreen / FriendProfileScreen)
// ---------------------------------------------------------------------------

/**
 * The same Group_Body content selection the screens apply for an Expanded
 * GroupSection: render the group's named-entry CompletionRows in source order
 * when any exist (R11.1), otherwise a single CompactEmptyState (R11.2). Each
 * row is tagged with a stable, index-based testID so the test can assert the
 * rendered rows' count, identity, and order against the named entries.
 */
function renderGroupBody(entries: readonly CompletionEntryDTO[]): React.ReactNode {
  const named = namedEntries(entries);
  if (named.length === 0) {
    return <CompactEmptyState message="Nothing completed here yet" testID={EMPTY_TEST_ID} />;
  }
  return named.map((entry, index) => (
    <CompletionRow
      key={`${ROW_PREFIX}${index}`}
      entry={entry}
      fields="parks"
      onOpenExperience={() => {}}
      testID={`${ROW_PREFIX}${index}`}
    />
  ));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Experience-name candidate mixing three sources so each generated group is a
 * blend of named and unnamed entries (exercising both branches of Property 10):
 *   - guaranteed-named strings (leading non-whitespace char + arbitrary tail)
 *   - the empty string (an unnamed entry)
 *   - whitespace-only strings (an unnamed entry the trim must reject)
 */
const nameArb = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom('a', 'Z', 'Space Mountain', 'Test Track'),
        fc.string({ maxLength: 12 }),
      )
      .map(([head, tail]) => head + tail),
  },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 6 }) },
);

/** A single Completion_Entry; a present, non-blank id keeps each row well-formed. */
const entryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: nameArb,
  park: fc.constantFrom(...PARKS),
  areaType: fc.constantFrom(...AREA_TYPES),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc.constant('2024-01-01'),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
});

/** A group's entry list, including unnamed entries; empty lists are allowed. */
const entriesArb = fc.array(entryArb, { maxLength: 20 });

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: Expanded Group_Body content matches the group\u2019s named entries (R11.1, R11.2)', () => {
  it('renders exactly the named-entry rows in order, or a single Compact_Empty_State when none', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const named = namedEntries(entries);

        const view = render(
          <GroupSection
            sectionKey="parks:Test"
            expanded
            onToggle={() => {}}
            header={<></>}
            accessibilityLabel="Test, group"
            testID="section"
          >
            {renderGroupBody(entries)}
          </GroupSection>,
        );

        try {
          const rows = view.queryAllByTestId(new RegExp(`^${ROW_PREFIX}\\d+$`));

          if (named.length === 0) {
            // Empty branch (R11.2): exactly one Compact_Empty_State, no rows.
            expect(rows).toHaveLength(0);
            expect(view.queryAllByTestId(EMPTY_TEST_ID)).toHaveLength(1);
          } else {
            // Non-empty branch (R11.1): exactly one row per named entry, no
            // Compact_Empty_State.
            expect(view.queryByTestId(EMPTY_TEST_ID)).toBeNull();
            expect(rows).toHaveLength(named.length);

            // Identity + order: row i is the i-th named entry. The activatable
            // row's accessibility label includes its Experience name, so the
            // rendered rows line up index-for-index with the named entries in
            // the group's source order.
            named.forEach((entry, index) => {
              const row = view.getByTestId(`${ROW_PREFIX}${index}`);
              expect(String(row.props.accessibilityLabel)).toContain(entry.experienceName);
            });
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
