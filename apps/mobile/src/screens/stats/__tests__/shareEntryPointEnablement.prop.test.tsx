// Feature: social-sharing-loop, Property 1: Share entry point enablement tracks content-load state
//
// Validates: Requirements 1.2, 1.7
//
// Property 1 (from design.md):
//   For any combination of content-load flags on a Share_Entry_Point
//   (Experience/Rating/Note loading on the Experience_Detail_View;
//   completion-data loading on the Progress_Screen), the entry point is
//   enabled if and only if none of its required content is still loading.
//
// This targets the pure enablement logic behind both entry points:
//   - `isExperienceShareEntryEnabled({ detailLoading, ratingLoading,
//     noteLoading })` — the Experience_Detail_View control (R1.2). Enabled iff
//     none of the Experience detail, the viewer's Rating, or the viewer's Note
//     is loading.
//   - `isProgressShareEntryEnabled(completionLoading)` — the Progress_Screen
//     control (R1.7). Enabled iff the viewer's completion data is not loading.
//     This is the pure form of `StatsScreen`'s `disabled={stats === undefined}`
//     rule (the resolved `GET /me/stats` snapshot is absent while loading).
//
// Test strategy:
//   - Both predicates are framework-free pure functions, so the property runs
//     without rendering — no React, react-navigation, or expo mocks needed.
//   - Experience side: generate all combinations of the three boolean load
//     flags with `fc.boolean()` (fast-check covers the full 2^3 space plus
//     shrinking). Assert the biconditional against the independently computed
//     reference `!detailLoading && !ratingLoading && !noteLoading`, and assert
//     both directions explicitly: any single flag loading forces disabled, and
//     all-clear forces enabled.
//   - Progress side: model completion-data load state as a discriminated union
//     — `{ kind: 'loading' }` (no snapshot yet) vs `{ kind: 'loaded' }` (the
//     snapshot is present) — mapped to the `completionLoading` boolean the
//     screen derives from `stats === undefined`. Assert enabled iff loaded.

import fc from 'fast-check';

import { isExperienceShareEntryEnabled } from '../../catalog/shareEntryPoint';
import { isProgressShareEntryEnabled } from '../progressShareEntry';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** The three content-load flags the Experience_Detail_View entry depends on. */
const experienceLoadStateArb = fc.record({
  detailLoading: fc.boolean(),
  ratingLoading: fc.boolean(),
  noteLoading: fc.boolean(),
});

/**
 * The Progress_Screen's completion-data load state. `StatsScreen` derives the
 * `completionLoading` flag as `stats === undefined`: while `GET /me/stats` is
 * in flight there is no snapshot ("loading"); once it resolves the snapshot is
 * present ("loaded").
 */
type CompletionLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded' };

const completionLoadStateArb: fc.Arbitrary<CompletionLoadState> = fc.oneof(
  fc.constant({ kind: 'loading' as const }),
  fc.constant({ kind: 'loaded' as const }),
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 1: Share entry point enablement tracks content-load state (R1.2, R1.7)', () => {
  test('Experience_Detail_View entry is enabled iff none of Experience/Rating/Note is loading', () => {
    fc.assert(
      fc.property(experienceLoadStateArb, (flags) => {
        const enabled = isExperienceShareEntryEnabled(flags);

        // Reference: enabled exactly when nothing required is loading.
        const anyLoading =
          flags.detailLoading || flags.ratingLoading || flags.noteLoading;
        expect(enabled).toBe(!anyLoading);

        // Both directions, stated explicitly.
        if (anyLoading) {
          expect(enabled).toBe(false);
        } else {
          expect(enabled).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('Progress_Screen entry is enabled iff completion data is not loading', () => {
    fc.assert(
      fc.property(completionLoadStateArb, (state) => {
        const completionLoading = state.kind === 'loading';
        const enabled = isProgressShareEntryEnabled(completionLoading);

        expect(enabled).toBe(!completionLoading);

        if (state.kind === 'loading') {
          expect(enabled).toBe(false);
        } else {
          expect(enabled).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
