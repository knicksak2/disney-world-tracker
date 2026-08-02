// Feature: notification-center, Property 1: Feed composition over successful sources
/**
 * Property-based test for the Notification_Center pure attention model's feed
 * composition over per-source read outcomes (`buildAttentionState`).
 *
 * Property 1 (design.md → Correctness Properties):
 *
 *   For any combination of per-source outcomes (each source either a success
 *   with an arbitrary set of pending items, or a failure), the Attention_Feed
 *   contains exactly one Attention_Item for each pending item of each
 *   successful source and no item from any failed source, and the reported
 *   failed-domain set equals exactly the set of failed sources.
 *
 * Validates: Requirements 1.2, 6.1, 6.3, 8.1
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
 * `id` (from a run-scoped counter) so identical-looking items never collide in
 * the multiset comparison — two items are "the same" only when they are the
 * very same generated object.
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
      .array(itemArb(domain, nextId), { maxLength: 6 })
      .map((items) => ({ domain, status: 'success' as const, items })),
    fc.constant({ domain, status: 'failure' as const }),
  );

/**
 * An arbitrary set of per-source outcomes — one outcome per domain, over an
 * arbitrary (possibly empty) subset of the four domains, in an arbitrary order.
 * A run-scoped id counter keeps every generated item's `id` unique so the feed
 * can be compared as a multiset by `id`.
 */
const outcomesArb: fc.Arbitrary<AttentionSourceOutcome[]> = fc
  .subarray([...DOMAIN_ORDER], { minLength: 0, maxLength: DOMAIN_ORDER.length })
  .chain((domains) =>
    // Shuffle so source order is arbitrary, not always DOMAIN_ORDER.
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

/** Multiset of item ids, as a sorted array for order-independent comparison. */
const idMultiset = (items: readonly AttentionItem[]): string[] =>
  items.map((i) => i.id).sort();

const successOutcomes = (outcomes: readonly AttentionSourceOutcome[]) =>
  outcomes.filter((o): o is Extract<AttentionSourceOutcome, { status: 'success' }> =>
    o.status === 'success',
  );

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: Feed composition over successful sources', () => {
  it('feed is exactly the multiset union of successful sources, excludes failed sources, and failedDomains equals the failed set (R1.2, R6.1, R6.3, R8.1)', () => {
    fc.assert(
      fc.property(outcomesArb, sortModeArb, (outcomes, sortMode) => {
        const state = buildAttentionState(outcomes, sortMode);

        const succeeded = successOutcomes(outcomes);

        // Expected feed: one item per pending item of every successful source.
        const expectedItems = succeeded.flatMap((o) => o.items);

        // The feed contains exactly those items (as a multiset), so there is
        // one Attention_Item per pending item of each successful source and no
        // item from any failed source (R1.2, R6.1, R6.3, R8.1).
        expect(idMultiset(state.items)).toEqual(idMultiset(expectedItems));
        expect(state.items).toHaveLength(expectedItems.length);

        // No item in the feed came from a failed source.
        const failedDomainSet = new Set(
          outcomes.filter((o) => o.status === 'failure').map((o) => o.domain),
        );
        for (const item of state.items) {
          expect(failedDomainSet.has(item.domain)).toBe(false);
        }

        // failedDomains equals exactly the set of failed sources (R8.1).
        const expectedFailed = outcomes
          .filter((o) => o.status === 'failure')
          .map((o) => o.domain)
          .sort();
        expect([...state.failedDomains].sort()).toEqual(expectedFailed);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
