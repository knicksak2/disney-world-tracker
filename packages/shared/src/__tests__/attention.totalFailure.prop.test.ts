// Feature: notification-center, Property 11: Total-failure state
/**
 * Property-based test for the Notification_Center pure attention model's
 * total-failure state (`buildAttentionState`, and the `classifyView`
 * corroboration).
 *
 * Property 11 (design.md → Correctness Properties):
 *
 *   For any combination of per-source outcomes in which every source failed,
 *   the Notification_Center is in the error state (never the empty-success
 *   state) and the Attention_Badge displays no count indicator.
 *
 * Validates: Requirements 8.3, 8.7
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildAttentionState,
  classifyView,
  DOMAIN_ORDER,
  type AttentionDomain,
  type AttentionSourceOutcome,
  type SortMode,
} from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * A non-empty set of per-source outcomes in which EVERY source is a failure.
 * A non-empty subset of the four domains is drawn in an arbitrary order, and
 * each selected domain contributes a `failure` outcome — the exact input space
 * of the total-failure case (R8.3, R8.7).
 */
const allFailedOutcomesArb: fc.Arbitrary<AttentionSourceOutcome[]> = fc
  .subarray([...DOMAIN_ORDER], { minLength: 1, maxLength: DOMAIN_ORDER.length })
  .chain((domains) =>
    // Shuffle so source order is arbitrary, not always DOMAIN_ORDER.
    fc.shuffledSubarray(domains, {
      minLength: domains.length,
      maxLength: domains.length,
    }),
  )
  .map((domains: AttentionDomain[]) =>
    domains.map((domain) => ({ domain, status: 'failure' as const })),
  );

const sortModeArb: fc.Arbitrary<SortMode> = fc.constantFrom(
  'timestampDesc',
  'groupByDomain',
);

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

describe('Property 11: Total-failure state', () => {
  it('when every source fails, state is error (allFailed) with an empty feed and hidden badge, never empty-success (R8.3, R8.7)', () => {
    fc.assert(
      fc.property(allFailedOutcomesArb, sortModeArb, (outcomes, sortMode) => {
        const state = buildAttentionState(outcomes, sortMode);

        // Total failure: every source failed, so the state reports allFailed
        // and never presents an empty-success feed (R8.7).
        expect(state.allFailed).toBe(true);

        // The feed is empty and no successful source contributed any item.
        expect(state.items).toHaveLength(0);

        // The Attention_Badge displays no count indicator (R8.7): the count is
        // zero and the derived display mode is hidden.
        expect(state.badgeCount).toBe(0);
        expect(state.badgeDisplay).toBe('hidden');

        // Every failed source is reported in failedDomains.
        expect([...state.failedDomains].sort()).toEqual(
          outcomes.map((o) => o.domain).sort(),
        );

        // With nothing in flight and every read failed, the view classifier
        // returns the error view — never empty-success (R8.3).
        expect(classifyView(false, outcomes)).toBe('error');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
