// Feature: notification-center, Property 4: Group-by-domain ordering
/**
 * Property-based test for the Notification_Center group-by-domain ordering
 * (`orderItems(items, 'groupByDomain')`).
 *
 * Property 4 (design.md → Correctness Properties):
 *
 *   For any set of Attention_Items, ordering in the group-by-domain mode yields
 *   a permutation of the input in which items are grouped by domain type in the
 *   fixed sequence Friend_Request, Trip_Invite, Rode_With_Tag, Share, and
 *   within each group are sorted by source timestamp descending.
 *
 * The test generates arbitrary Attention_Item sets spanning all four domains
 * with deliberately colliding timestamps (drawn from a small pool) so the
 * id tie-break inside a group is exercised, then asserts three things:
 *
 *   1. the output is a permutation of the input (same multiset of items),
 *   2. items are grouped by domain — all items of one domain are contiguous and
 *      the groups appear in the fixed DOMAIN_ORDER sequence, and
 *   3. within each group, items are sorted by source timestamp descending, with
 *      the domain item id as the ascending tie-break for equal timestamps.
 *
 * Validates: Requirements 1.8
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DOMAIN_ORDER,
  orderItems,
  type AttentionDomain,
  type AttentionItem,
} from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Every domain the feed groups over — spans the full DOMAIN_ORDER sequence. */
const domainArb = fc.constantFrom<AttentionDomain>(
  'friendRequest',
  'tripInvite',
  'rodeWithTag',
  'share',
);

/**
 * A small pool of distinct, valid ISO-8601 timestamps. Drawing from a small set
 * forces frequent collisions across items so the intra-group timestamp ordering
 * and the id tie-break are both exercised.
 */
const timestampArb = fc.constantFrom(
  '2023-11-20T08:00:00.000Z',
  '2024-01-01T00:00:00.000Z',
  '2024-01-01T00:00:00.001Z',
  '2024-03-15T12:30:00.000Z',
  '2024-06-01T00:00:00.000Z',
);

/** A short domain item identifier; short so equal-id ties are plausible. */
const idArb = fc.string({ minLength: 1, maxLength: 6 });

/** One arbitrary normalized Attention_Item. */
const itemArb: fc.Arbitrary<AttentionItem> = fc.record({
  domain: domainArb,
  id: idArb,
  sourceTimestamp: timestampArb,
  summary: fc.string({ maxLength: 24 }),
  ref: fc.constant({}),
});

/** An arbitrary (possibly empty) set of Attention_Items across all domains. */
const itemsArb = fc.array(itemArb, { maxLength: 40 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A stable canonical key for multiset comparison of two item arrays. */
function itemKey(item: AttentionItem): string {
  return JSON.stringify([item.domain, item.id, item.sourceTimestamp, item.summary]);
}

/** True when `a` and `b` contain the same items with the same multiplicities. */
function isPermutation(a: readonly AttentionItem[], b: readonly AttentionItem[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(itemKey).sort();
  const kb = b.map(itemKey).sort();
  return ka.every((k, i) => k === kb[i]);
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Property 4: Group-by-domain ordering', () => {
  it('is a permutation grouped in DOMAIN_ORDER, each group timestamp-descending (R1.8)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const output = orderItems(items, 'groupByDomain');

        // 1. Permutation: same multiset of items as the input, nothing lost or
        //    invented.
        expect(isPermutation(items, output)).toBe(true);

        // 2. Grouping: collapse the output into its sequence of domain blocks.
        //    A block boundary is a change in domain from the previous item.
        const blocks: AttentionDomain[] = [];
        for (const item of output) {
          if (blocks.length === 0 || blocks[blocks.length - 1] !== item.domain) {
            blocks.push(item.domain);
          }
        }

        //    Each domain forms exactly one contiguous block: no domain reappears
        //    after another domain interrupts it.
        expect(new Set(blocks).size).toBe(blocks.length);

        //    The blocks appear in the fixed DOMAIN_ORDER sequence
        //    (friendRequest, tripInvite, rodeWithTag, share).
        const ranks = blocks.map((d) => DOMAIN_ORDER.indexOf(d));
        for (let i = 1; i < ranks.length; i += 1) {
          expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
        }

        // 3. Within each group: source timestamp descending, with the id as an
        //    ascending tie-break when timestamps are equal.
        for (const domain of DOMAIN_ORDER) {
          const group = output.filter((item) => item.domain === domain);
          for (let i = 1; i < group.length; i += 1) {
            const prev = Date.parse(group[i - 1]!.sourceTimestamp);
            const cur = Date.parse(group[i]!.sourceTimestamp);
            expect(prev).toBeGreaterThanOrEqual(cur);
            if (prev === cur) {
              // Equal timestamps → ids in ascending lexicographic order.
              expect(group[i - 1]!.id <= group[i]!.id).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
