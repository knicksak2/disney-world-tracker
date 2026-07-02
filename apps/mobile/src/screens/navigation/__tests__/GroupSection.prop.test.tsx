/**
 * Property-based test for the `GroupSection` Group_Header (task 7.3).
 *
 * Implements the feature's correctness Property 9 against the presentation-only
 * `GroupSection` primitive. The Group_Header must present the group's Park or
 * Experience_Category name and announce its Expanded/Collapsed state
 * consistently:
 *
 *   - The name the header DISPLAYS (its `header` content) and the name it
 *     ANNOUNCES (its `accessibilityLabel`) are identical whether the section is
 *     Expanded or Collapsed — only the Group_Body's visibility changes
 *     (R9.1, R9.3, R12.2).
 *   - The header's announced `accessibilityState.expanded` equals the section's
 *     current Expanded (`true`) or Collapsed (`false`) state (R12.3).
 *
 * The test renders the SAME generated group in BOTH states side by side (one
 * Collapsed, one Expanded) in a single tree and compares their headers, so any
 * divergence in the displayed/announced name between the two states fails the
 * property. `fast-check` drives a blend of catalog group names and arbitrary
 * non-empty names at `numRuns: 100`.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import { GroupSection } from '../GroupSection';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Group-name candidate: a blend of real catalog Park / Experience_Category
 * names and arbitrary non-empty, non-whitespace names. Every generated value
 * has at least one non-whitespace character so the header text is queryable
 * and the displayed name is meaningful in both states.
 */
const nameArb = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Magic Kingdom',
      'EPCOT',
      "Disney's Hollywood Studios",
      "Disney's Animal Kingdom",
      'Ride',
      'Show',
      'Restaurant',
      'Parade',
      'Character Meet',
      'Other',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.constantFrom('A', 'z', 'Park', 'Land'), fc.string({ maxLength: 12 }))
      .map(([head, tail]) => head + tail),
  },
);

// ---------------------------------------------------------------------------
// Feature: experience-detail-navigation, Property 9: Group_Header content and
// announced state are consistent
// ---------------------------------------------------------------------------
//
// Validates: Requirements 9.1, 9.3, 12.2, 12.3

describe('Property 9: Group_Header content and announced state are consistent', () => {
  it('displays/announces the group name identically in both states and announces the current expanded state', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        // The accessibility label includes the group name (R12.2), matching how
        // the grouped-view screens construct it. Both sections use the SAME
        // label-construction so any state-dependent divergence would surface.
        const accessibilityLabel = `${name}, group`;

        // Render the SAME group in both states side by side: one Collapsed,
        // one Expanded. The header content (the `header` node) is identical.
        const view = render(
          <>
            <GroupSection
              sectionKey={`parks:${name}`}
              expanded={false}
              onToggle={() => {}}
              header={<Text>{name}</Text>}
              accessibilityLabel={accessibilityLabel}
              testID="collapsed"
            >
              <Text>collapsed body</Text>
            </GroupSection>
            <GroupSection
              sectionKey={`parks:${name}`}
              expanded
              onToggle={() => {}}
              header={<Text>{name}</Text>}
              accessibilityLabel={accessibilityLabel}
              testID="expanded"
            >
              <Text>expanded body</Text>
            </GroupSection>
          </>,
        );

        try {
          const collapsedHeader = view.getByTestId('collapsed-header');
          const expandedHeader = view.getByTestId('expanded-header');

          // DISPLAYED name: the header content renders the name identically in
          // both states — so the name appears exactly twice (one header each),
          // independent of body visibility (R9.1, R9.3).
          expect(view.queryAllByText(name)).toHaveLength(2);

          // ANNOUNCED name: the accessibility label is identical across the two
          // states and includes the group name (R9.3, R12.2).
          const collapsedLabel = collapsedHeader.props.accessibilityLabel;
          const expandedLabel = expandedHeader.props.accessibilityLabel;
          expect(collapsedLabel).toBe(expandedLabel);
          expect(String(collapsedLabel)).toContain(name);
          expect(String(expandedLabel)).toContain(name);

          // ANNOUNCED state: the header's accessibility expanded state equals
          // the section's current Collapsed/Expanded state (R12.3).
          expect(collapsedHeader.props.accessibilityState?.expanded).toBe(false);
          expect(expandedHeader.props.accessibilityState?.expanded).toBe(true);
        } finally {
          // Tear down this iteration's tree before the next run mounts a fresh
          // one, so the renderer never holds overlapping mounted trees.
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
