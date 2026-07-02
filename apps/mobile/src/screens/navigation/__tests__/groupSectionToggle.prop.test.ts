/**
 * Property-based test for the pure Group_Section toggle reducer in
 * `groupSectionState.ts`.
 *
 * This suite implements one of the feature's correctness properties against the
 * framework-free toggle logic that backs the collapsible grouped views. It runs
 * with `fast-check` at `numRuns: 100`.
 *
 *   - Property 8 — toggling affects exactly one section and is self-inverse.
 *
 * `GroupSectionState` is a `ReadonlySet<string>` of the keys of currently
 * Expanded sections, so two states are "equal" when they have the same
 * membership (not the same reference). All equality assertions below compare
 * membership rather than object identity.
 */

import fc from 'fast-check';

import { initialGroupSectionState, isExpanded, toggle } from '../groupSectionState';
import type { GroupSectionState } from '../groupSectionState';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A section key drawn from a small, fixed pool so generated states and target
 * keys collide often — this exercises both the "key already Expanded" and "key
 * Collapsed" branches of `toggle` and ensures `k` and `j` frequently appear in
 * the state.
 */
const keyArb = fc.constantFrom(
  'parks:Magic Kingdom',
  'parks:EPCOT',
  'parks:Hollywood Studios',
  'parks:Animal Kingdom',
  'categories:Ride',
  'categories:Show',
  'categories:Restaurant',
  'categories:Other',
);

/** An arbitrary state: any subset of the key pool reported as Expanded. */
const stateArb: fc.Arbitrary<GroupSectionState> = fc
  .uniqueArray(keyArb)
  .map((keys) => new Set(keys));

/** A pair of distinct keys `k !== j`. */
const distinctKeyPairArb = fc.tuple(keyArb, keyArb).filter(([k, j]) => k !== j);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set equality by membership (same elements), independent of reference. */
function sameMembership(a: GroupSectionState, b: GroupSectionState): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const key of a) {
    if (!b.has(key)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Feature: experience-detail-navigation, Property 8: Toggling affects exactly
// one section and is self-inverse
// ---------------------------------------------------------------------------
//
// Validates: Requirements 7.3, 10.1

describe('Property 8: toggle affects exactly one section and is self-inverse', () => {
  it('flips k, leaves every j !== k unchanged, and toggling k twice restores the state', () => {
    fc.assert(
      fc.property(stateArb, distinctKeyPairArb, (state, [k, j]) => {
        const toggled = toggle(state, k);

        // (1) `toggle` flips the Expanded/Collapsed state of the target key k
        // (R7.3).
        expect(isExpanded(toggled, k)).toBe(!isExpanded(state, k));

        // (2) Any other key j !== k keeps its Expanded/Collapsed state (R10.1).
        expect(isExpanded(toggled, j)).toBe(isExpanded(state, j));

        // ...and every non-target key currently in the state is left untouched.
        for (const other of state) {
          if (other !== k) {
            expect(isExpanded(toggled, other)).toBe(true);
          }
        }

        // (3) `toggle` is its own inverse: toggling k twice yields a state with
        // the same membership as the original (R7.3). "=== state" is set
        // equality (same membership), not reference equality.
        const roundTrip = toggle(toggled, k);
        expect(sameMembership(roundTrip, state)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('changes membership in exactly one key relative to the original state', () => {
    fc.assert(
      fc.property(stateArb, keyArb, (state, k) => {
        const toggled = toggle(state, k);

        // The symmetric difference between state and toggled is exactly {k}:
        // only the target key's membership changed; every other key is
        // untouched (R10.1).
        const allKeys = new Set<string>([...state, ...toggled]);
        const changed: string[] = [];
        for (const key of allKeys) {
          if (state.has(key) !== toggled.has(key)) {
            changed.push(key);
          }
        }
        expect(changed).toEqual([k]);

        // `toggle` does not mutate the input state.
        expect(state.has(k)).toBe(isExpanded(state, k));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round-trips from the initial all-Collapsed state for any key', () => {
    fc.assert(
      fc.property(keyArb, (k) => {
        const initial = initialGroupSectionState();

        // The initial state reports the key Collapsed; one toggle Expands it.
        expect(isExpanded(initial, k)).toBe(false);
        const once = toggle(initial, k);
        expect(isExpanded(once, k)).toBe(true);

        // A second toggle restores the original (empty) membership (R7.3).
        const twice = toggle(once, k);
        expect(sameMembership(twice, initial)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
