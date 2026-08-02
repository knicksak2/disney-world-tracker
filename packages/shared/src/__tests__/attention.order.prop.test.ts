// Feature: notification-center, Property 3: Default (timestamp-descending) ordering is a total order
/**
 * Property-based test for the Notification_Center default (`timestampDesc`)
 * ordering of the Attention_Feed.
 *
 * Property 3 (design.md → Correctness Properties):
 *
 *   For any set of Attention_Items, ordering in the default mode yields a
 *   permutation of the input that is sorted by source timestamp descending,
 *   then by domain type in the fixed sequence Friend_Request, Trip_Invite,
 *   Rode_With_Tag, Share, then by domain item identifier in ascending
 *   lexicographic order.
 *
 * The test drives `orderItems(items, 'timestampDesc')` (and, for the pairwise
 * comparator, `compareItems`) from `../attention.ts`. Generators deliberately
 * draw timestamps and ids from small pools so duplicate timestamps and ids
 * shared across domains are common — that is what exercises the
 * domain-sequence (DOMAIN_ORDER) and id-ascending tie-breaks (R1.5, R1.6)
 * rather than only the primary timestamp key (R1.4).
 *
 * Validates: Requirements 1.4, 1.5, 1.6
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DOMAIN_ORDER,
  compareItems,
  orderItems,
  type AttentionDomain,
  type AttentionItem,
} from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators — small pools force timestamp collisions and shared ids so the
// domain-sequence and id tie-breaks are exercised, not just the timestamp key.
// ---------------------------------------------------------------------------

/**
 * A small pool of ISO-8601 timestamps. Several share the same instant (some
 * even via a distinct-but-equal string), so `Date.parse` collisions are common
 * and the domain/id tie-breaks are frequently reached (R1.5, R1.6).
 */
const timestampPool = [
  '2024-01-01T00:00:00.000Z',
  '2024-01-01T00:00:00.000Z',
  '2023-12-31T23:59:59.000Z',
  '2024-06-15T12:30:00.000Z',
  '2024-06-15T12:30:00.001Z',
  '2022-03-09T08:15:42.500Z',
] as const;

/**
 * A small pool of domain item identifiers. Because the pool is shared across
 * all four domains, the same id routinely appears on items of different
 * domains, forcing the domain-sequence tie-break, and equal ids within a domain
 * force the id-ascending tie-break. The values are chosen so lexicographic
 * order is non-trivial (e.g. '10' < '2', 'Z' < 'a').
 */
const idPool = ['a', 'b', 'c', 'aa', 'ab', 'Z', '1', '2', '10'] as const;

const domainArb: fc.Arbitrary<AttentionDomain> = fc.constantFrom(
  ...DOMAIN_ORDER,
);

/** One Attention_Item drawn from the colliding pools. */
const itemArb: fc.Arbitrary<AttentionItem> = fc
  .record({
    domain: domainArb,
    id: fc.constantFrom(...idPool),
    sourceTimestamp: fc.constantFrom(...timestampPool),
  })
  .map(({ domain, id, sourceTimestamp }) => ({
    domain,
    id,
    sourceTimestamp,
    // summary/ref are irrelevant to ordering; derive summary deterministically
    // so identical (domain,id,timestamp) items serialize identically for the
    // multiset (permutation) check below.
    summary: `${domain}:${id}`,
    ref: {},
  }));

/** A set of Attention_Items, allowing duplicates and empty sets. */
const itemsArb = fc.array(itemArb, { maxLength: 30 });

// ---------------------------------------------------------------------------
// Independent expected comparator — mirrors the specified ordering directly so
// the assertion does not merely restate the implementation under test.
// ---------------------------------------------------------------------------

const domainIndex = (d: AttentionDomain) => DOMAIN_ORDER.indexOf(d);

/**
 * The ordering the spec prescribes (R1.4–R1.6): timestamp descending, then
 * DOMAIN_ORDER index ascending, then id ascending lexicographic. Returns a
 * negative number when `a` must precede `b`, positive when it must follow, and
 * `0` only when the two are indistinguishable under all three keys.
 */
function expectedCompare(a: AttentionItem, b: AttentionItem): number {
  const ta = Date.parse(a.sourceTimestamp);
  const tb = Date.parse(b.sourceTimestamp);
  if (ta !== tb) return tb - ta; // most recent first
  const da = domainIndex(a.domain);
  const db = domainIndex(b.domain);
  if (da !== db) return da - db;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Stable serialization of an item's identity for multiset comparison. */
const key = (i: AttentionItem) =>
  JSON.stringify([i.domain, i.id, i.sourceTimestamp, i.summary]);

/** Multiset equality: same elements with the same multiplicities, any order. */
function sameMultiset(xs: readonly AttentionItem[], ys: readonly AttentionItem[]): boolean {
  if (xs.length !== ys.length) return false;
  const a = xs.map(key).sort();
  const b = ys.map(key).sort();
  return a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

describe('Property 3: Default (timestamp-descending) ordering is a total order', () => {
  it('yields a permutation of the input (same multiset) — no item added, dropped, or duplicated (R1.4)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const ordered = orderItems(items, 'timestampDesc');
        expect(ordered).toHaveLength(items.length);
        expect(sameMultiset(items, ordered)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sorts by timestamp desc, then DOMAIN_ORDER, then id ascending (R1.4, R1.5, R1.6)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const ordered = orderItems(items, 'timestampDesc');
        for (let i = 0; i + 1 < ordered.length; i += 1) {
          // Each adjacent pair must be non-decreasing under the specified order.
          expect(expectedCompare(ordered[i], ordered[i + 1])).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not mutate the caller\u2019s input array (R1.4)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const before = items.map(key);
        orderItems(items, 'timestampDesc');
        expect(items.map(key)).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('compareItems agrees with the specified total order on every pair (R1.4, R1.5, R1.6)', () => {
    fc.assert(
      fc.property(itemArb, itemArb, (a, b) => {
        expect(Math.sign(compareItems(a, b))).toBe(Math.sign(expectedCompare(a, b)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
