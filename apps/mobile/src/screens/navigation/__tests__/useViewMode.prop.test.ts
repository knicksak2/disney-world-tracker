// Feature: friend-profile-navigation, Property 5: Mode selection always resolves to exactly one mode
/**
 * Property-based tests for the selection state machine `resolveSelectedMode`
 * (the pure core of `useViewMode`).
 *
 * Validates: Requirements 1.3, 1.4, 1.8, 8.3, 8.4, 8.8, 8.9
 *
 * Property 5 — Mode selection always resolves to exactly one mode:
 *
 *   For any mode tuple (the Profile_View_Modes or the Own_Stats_View_Modes)
 *   and any candidate selection set, `resolveSelectedMode` returns exactly
 *   one mode:
 *     - the sole selected mode when exactly one valid mode is selected
 *       (R1.4 / R8.4), and
 *     - otherwise the default mode `modes[0]` (Overview / Own_Overview) —
 *       covering the initial empty selection (R1.3 / R8.3), the
 *       no-mode-selected state, and the more-than-one-mode-selected state
 *       (R1.8 / R8.8);
 *   and selecting the already-active mode leaves that same mode active, i.e.
 *   selection is idempotent on the active mode (R8.9).
 *
 * Runs with `numRuns: 100` per the spec convention. The generator
 * `selectionArb` produces empty, singleton, and multi/duplicate selection
 * sets over both catalog tuples so every branch of the resolver is exercised.
 */

import fc from 'fast-check';

import { resolveSelectedMode } from '../useViewMode';

/** Profile_View_Modes tuple — Friend_Profile_View's View_Selector (R1.1). */
const PROFILE_VIEW_MODES = ['Overview', 'Parks', 'Categories', 'Experiences'] as const;
type ProfileViewMode = (typeof PROFILE_VIEW_MODES)[number];

/** Own_Stats_View_Modes tuple — Own_Stats_View's Own_Stats_Selector (R8.1). */
const OWN_STATS_VIEW_MODES = [
  'Own_Overview',
  'Own_Parks',
  'Own_Categories',
  'Own_Experiences',
] as const;
type OwnStatsViewMode = (typeof OWN_STATS_VIEW_MODES)[number];

const NUM_RUNS = 100;

/**
 * The distinct valid modes contained in a candidate selection, in the order
 * they first appear among `modes`. Used as the test oracle: the resolver must
 * return the sole element when this set is a singleton, else the default.
 */
function distinctValid<M extends string>(
  modes: readonly [M, ...M[]],
  selected: readonly M[],
): M[] {
  return modes.filter((m) => selected.includes(m));
}

/**
 * Build an arbitrary that, given a mode tuple, yields candidate selection
 * sets covering the three resolver branches:
 *   - empty selection (length 0),
 *   - singleton selection (length 1),
 *   - multi/duplicate selections (length 2..6, duplicates allowed).
 */
function selectionArb<M extends string>(
  modes: readonly [M, ...M[]],
): fc.Arbitrary<readonly M[]> {
  return fc.array(fc.constantFrom(...modes), { minLength: 0, maxLength: 6 });
}

describe('resolveSelectedMode — Property 5: always resolves to exactly one mode', () => {
  /**
   * Run the property against a single tuple. Asserts the resolver returns
   * exactly one valid mode and that it matches the oracle for every branch.
   */
  function runForTuple<M extends string>(
    label: string,
    modes: readonly [M, ...M[]],
  ): void {
    it(`${label}: returns the sole valid mode, else the default`, () => {
      fc.assert(
        fc.property(selectionArb(modes), (selected) => {
          const result = resolveSelectedMode(modes, selected);

          // The result is always exactly one valid mode (R1.4 / R8.4).
          expect(modes).toContain(result);

          const valid = distinctValid(modes, selected);
          if (valid.length === 1) {
            // Exactly one valid mode selected -> that sole mode (R1.4/R8.4).
            expect(result).toBe(valid[0]);
          } else {
            // Zero (R1.3/R8.3 initial, R1.8/R8.8 none) or more than one
            // (R1.8/R8.8) -> the canonical default modes[0].
            expect(result).toBe(modes[0]);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it(`${label}: selecting the already-active mode is idempotent (R8.9)`, () => {
      fc.assert(
        fc.property(fc.constantFrom(...modes), (active) => {
          // `useViewMode.select(next)` routes through
          // `resolveSelectedMode(modes, [next])`; selecting the active mode
          // must keep that same mode active, and re-resolving is stable.
          const once = resolveSelectedMode(modes, [active]);
          expect(once).toBe(active);
          expect(resolveSelectedMode(modes, [once])).toBe(active);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  }

  runForTuple<ProfileViewMode>('Profile_View_Modes', PROFILE_VIEW_MODES);
  runForTuple<OwnStatsViewMode>('Own_Stats_View_Modes', OWN_STATS_VIEW_MODES);

  it('empty selection resolves to the default for both tuples (R1.3, R8.3)', () => {
    expect(resolveSelectedMode(PROFILE_VIEW_MODES, [])).toBe('Overview');
    expect(resolveSelectedMode(OWN_STATS_VIEW_MODES, [])).toBe('Own_Overview');
  });

  it('a multi-mode selection resolves to the default (R1.8, R8.8)', () => {
    expect(resolveSelectedMode(PROFILE_VIEW_MODES, ['Parks', 'Categories'])).toBe(
      'Overview',
    );
    expect(
      resolveSelectedMode(OWN_STATS_VIEW_MODES, ['Own_Parks', 'Own_Experiences']),
    ).toBe('Own_Overview');
  });
});
