// Feature: notification-center, Property 7: Badge count equals feed size
/**
 * Property-based test for the Notification_Center pure attention model's badge
 * count invariant (`buildAttentionState` in `../attention.ts`).
 *
 * Property 7 (design.md → Correctness Properties):
 *
 *   For any combination of per-source outcomes, the Attention_Badge count
 *   equals the number of Attention_Items presented in the Attention_Feed for
 *   those same outcomes (counting only successful sources); consequently,
 *   removing any k items from the feed reduces the count by exactly k and the
 *   count is never negative.
 *
 * Because `badgeCount` is *defined as* `items.length` over the same successful
 * outcomes used to build the feed, the badge and feed can never disagree — this
 * property test guards that structural invariant across arbitrary per-source
 * outcomes, and additionally models removing k items from a successful source
 * and asserts the recomputed count drops by exactly k and never goes negative.
 *
 * Validates: Requirements 4.1, 4.5, 5.3, 5.6, 6.2, 8.4
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildAttentionState,
  DOMAIN_ORDER,
  type AttentionDomain,
  type AttentionItem,
  type AttentionSourceOutcome,
  type SortMode,
} from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** An ISO-8601 timestamp drawn from a wide but bounded instant range. */
const timestampArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970 .. ~2100
  .map((ms) => new Date(ms).toISOString());

/**
 * A single {@link AttentionItem} for the given domain. Every item gets a unique
 * `id` (from a run-scoped counter) so identical-looking items never collide —
 * two items are "the same" only when they are the very same generated object.
 */
const itemArb = (domain: AttentionDomain, nextId: () => string): fc.Arbitrary<AttentionItem> =>
  fc
    .tuple(timestampArb, fc.string({ maxLength: 40 }))
    .map(([sourceTimestamp, summary]) => ({
      domain,
      id: nextId(),
      sourceTimestamp,
      summary,
      ref: {},
    }));

/**
 * A per-source outcome for `domain`: either a `success` carrying an arbitrary
 * (possibly empty) set of pending items, or a `failure` carrying none.
 */
const outcomeArb = (
  domain: AttentionDomain,
  nextId: () => string,
): fc.Arbitrary<AttentionSourceOutcome> =>
  fc.oneof(
    fc
      .array(itemArb(domain, nextId), { maxLength: 8 })
      .map((items) => ({ domain, status: 'success' as const, items })),
    fc.constant({ domain, status: 'failure' as const }),
  );

/**
 * An arbitrary set of per-source outcomes — one outcome per domain, over an
 * arbitrary (possibly empty) subset of the four domains, in an arbitrary order.
 * A run-scoped id counter keeps every generated item's `id` unique.
 */
const outcomesArb: fc.Arbitrary<AttentionSourceOutcome[]> = fc
  .subarray([...DOMAIN_ORDER], { minLength: 0, maxLength: DOMAIN_ORDER.length })
  .chain((domains) =>
    fc.shuffledSubarray(domains, { minLength: domains.length, maxLength: domains.length }),
  )
  .chain((domains) => {
    let counter = 0;
    const nextId = () => `item-${counter++}`;
    return domains.length === 0
      ? fc.constant<AttentionSourceOutcome[]>([])
      : fc.tuple(...domains.map((d) => outcomeArb(d, nextId)));
  });

const sortModeArb: fc.Arbitrary<SortMode> = fc.constantFrom(
  'timestampDesc',
  'groupByDomain',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const successOutcomes = (outcomes: readonly AttentionSourceOutcome[]) =>
  outcomes.filter(
    (o): o is Extract<AttentionSourceOutcome, { status: 'success' }> =>
      o.status === 'success',
  );

/**
 * Remove `k` items (by id) from the first successful source in `outcomes`,
 * returning the mutated outcome set and the actual number removed (bounded by
 * that source's item count). Every other outcome is preserved unchanged.
 */
function removeKFromASuccess(
  outcomes: readonly AttentionSourceOutcome[],
  k: number,
): { outcomes: AttentionSourceOutcome[]; removed: number } {
  let removed = 0;
  let done = false;
  const next = outcomes.map((o) => {
    if (!done && o.status === 'success' && o.items.length > 0) {
      const take = Math.min(k, o.items.length);
      removed = take;
      done = true;
      // Drop the first `take` items from this source.
      return { ...o, items: o.items.slice(take) };
    }
    return o;
  });
  return { outcomes: next, removed };
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Property 7: Badge count equals feed size', () => {
  it('badgeCount equals the rendered item count over the same outcomes (R4.1, R4.5, R5.6, R6.2, R8.4)', () => {
    fc.assert(
      fc.property(outcomesArb, sortModeArb, (outcomes, sortMode) => {
        const state = buildAttentionState(outcomes, sortMode);

        // The badge count is exactly the number of items in the feed.
        expect(state.badgeCount).toBe(state.items.length);

        // And that equals the total pending items across successful sources
        // only — failed sources contribute nothing to either the feed or the
        // count (R8.4).
        const expectedCount = successOutcomes(outcomes).reduce(
          (sum, o) => sum + o.items.length,
          0,
        );
        expect(state.badgeCount).toBe(expectedCount);

        // The count is never negative.
        expect(state.badgeCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removing k items reduces the count by exactly k and it never goes negative (R5.3, R5.6)', () => {
    fc.assert(
      fc.property(
        outcomesArb,
        sortModeArb,
        fc.integer({ min: 0, max: 10 }),
        (outcomes, sortMode, k) => {
          const before = buildAttentionState(outcomes, sortMode);

          const { outcomes: afterOutcomes, removed } = removeKFromASuccess(
            outcomes,
            k,
          );
          const after = buildAttentionState(afterOutcomes, sortMode);

          // Removing `removed` items drops the count by exactly that many.
          expect(after.badgeCount).toBe(before.badgeCount - removed);

          // The count stays a valid, non-negative feed size.
          expect(after.badgeCount).toBeGreaterThanOrEqual(0);
          expect(after.badgeCount).toBe(after.items.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
