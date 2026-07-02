/**
 * Property-based test for the pure Group_Section state model in
 * `groupSectionState.ts`.
 *
 * This suite implements one of the feature's correctness properties against the
 * framework-free reducer that backs the collapsible grouped views. The property
 * runs with `fast-check` at `numRuns: 100`.
 *
 *   - Property 7 — Default Collapsed on first display.
 *
 * `initialGroupSectionState` returns an empty set, and `isExpanded` reports a
 * key as Expanded only when it is a member of the state. The property exploits
 * this by checking, over arbitrary key sets, that the initial state reports
 * every key Collapsed and holds no Expanded section at all.
 */

import fc from 'fast-check';

import { initialGroupSectionState, isExpanded } from '../groupSectionState';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Section keys spanning the two per-mode namespaces the screens use
 * (e.g. `parks:Magic Kingdom`, `categories:Ride`) plus free-form strings, so
 * the generated key sets exercise realistic and adversarial keys alike,
 * including the empty string.
 */
const keyArb = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.tuple(fc.constantFrom('parks', 'categories'), fc.string({ maxLength: 16 })).map(
    ([ns, name]) => `${ns}:${name}`,
  ),
);

/** A set of distinct group keys, possibly empty. */
const keySetArb = fc.uniqueArray(keyArb, { maxLength: 30 });

// ---------------------------------------------------------------------------
// Feature: experience-detail-navigation, Property 7: Default Collapsed on first
// display
// ---------------------------------------------------------------------------
//
// Validates: Requirements 8.1, 10.3

describe('Property 7: Default Collapsed on first display', () => {
  it('reports every Group_Section Collapsed in the initial state', () => {
    fc.assert(
      fc.property(keySetArb, (keys) => {
        const state = initialGroupSectionState();

        // No section is Expanded on first display, regardless of which keys
        // the Grouped_View_Mode presents (R8.1, R10.3).
        for (const key of keys) {
          expect(isExpanded(state, key)).toBe(false);
        }

        // The initial state holds no Expanded section at all — the empty set
        // is the canonical all-Collapsed state.
        expect(state.size).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
