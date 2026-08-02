// Feature: trips, Property 24: The Trip_Feed is totally ordered reverse-chronologically with a deterministic tie-break
/**
 * Property-based tests for Trip_Feed ordering.
 *
 * Validates: Requirements 13.3
 *
 * Property 24 (design.md → Correctness Properties):
 *
 *   For any set of Trip_Feed_Items, the displayed order is by descending
 *   creation timestamp, breaking ties between identical timestamps by
 *   descending Trip_Feed_Item identifier, producing a single deterministic
 *   ordering.
 *
 * Requirement 13.3 restated: WHEN the Trip_Detail_View displays the
 * Trip_Feed, THE App SHALL display the Trip_Feed_Items in reverse-
 * chronological order by creation timestamp, breaking ties between
 * Trip_Feed_Items with identical timestamps by descending Trip_Feed_Item
 * identifier so that the order is deterministic.
 *
 * Test design
 * -----------
 * `orderFeed` is a pure comparator-based sort over `{ id, createdAt }`, so
 * the test drives the real production function directly (no fakes needed).
 *
 * Generators are shaped to exercise the tie-break path with a non-trivial
 * collision rate:
 *
 *   - `createdAt` values are drawn from a *small* pool of ISO-8601 UTC
 *     timestamps. A small pool guarantees frequent timestamp collisions so
 *     the `id`-descending tie-break (the heart of Property 24) is actually
 *     covered rather than being vanishingly rare.
 *   - `id` values are unique across the set (Trip_Feed_Item identifiers are
 *     unique), zero-padded so lexicographic ordering is well-defined and
 *     shrinking output stays readable.
 *
 * The reference oracle re-derives the expected order from the requirement
 * text directly: sort by `createdAt` descending, then by `id` descending.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { orderFeed, type OrderableFeedItem } from '../feedOrder.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A small pool of distinct ISO-8601 UTC timestamps. Drawing `createdAt`
 * from this pool (rather than the full timestamp domain) forces frequent
 * collisions so the `id`-descending tie-break is exercised on most runs.
 */
const TIMESTAMP_POOL: readonly string[] = [
  '2024-01-01T00:00:00.000Z',
  '2024-01-01T00:00:00.001Z',
  '2024-06-15T12:30:00.000Z',
  '2024-06-15T12:30:00.500Z',
  '2024-12-31T23:59:59.999Z',
  '2025-03-10T08:15:42.250Z',
];

const createdAtArb: fc.Arbitrary<string> = fc.constantFrom(...TIMESTAMP_POOL);

/**
 * One Trip_Feed_Item projected to the minimal orderable shape. `idx` is
 * mapped to a zero-padded unique id; uniqueness is enforced at the array
 * level via the `id` selector below.
 */
const feedItemArb: fc.Arbitrary<OrderableFeedItem> = fc
  .record({
    idx: fc.integer({ min: 0, max: 9999 }),
    createdAt: createdAtArb,
  })
  .map((r) => ({
    id: `feed-${String(r.idx).padStart(4, '0')}`,
    createdAt: r.createdAt,
  }));

/**
 * A set of Trip_Feed_Items with unique identifiers (Trip_Feed_Item ids are
 * unique). Sizes span the empty case up to a comfortable ceiling.
 */
const feedArb = fc.uniqueArray(feedItemArb, {
  minLength: 0,
  maxLength: 40,
  selector: (r: OrderableFeedItem) => r.id,
});

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/**
 * Expected order per Requirement 13.3: `createdAt` descending, ties broken
 * by `id` descending. Compares strings lexicographically, which matches
 * chronological order for UTC ISO-8601 timestamps.
 */
function expectedOrder(
  items: readonly OrderableFeedItem[],
): OrderableFeedItem[] {
  return [...items].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? 1 : -1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('feedOrder — Property 24: reverse-chronological order with deterministic tie-break', () => {
  it('orders by createdAt DESC then id DESC for any set of feed items (R13.3)', () => {
    fc.assert(
      fc.property(feedArb, (items) => {
        const actual = orderFeed(items);
        expect(actual).toEqual(expectedOrder(items));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces a total, monotonically non-increasing order (R13.3)', () => {
    fc.assert(
      fc.property(feedArb, (items) => {
        const actual = orderFeed(items);
        for (let i = 1; i < actual.length; i++) {
          const prev = actual[i - 1]!;
          const curr = actual[i]!;
          // Later createdAt sorts first; equal timestamps fall back to id.
          if (prev.createdAt !== curr.createdAt) {
            expect(prev.createdAt > curr.createdAt).toBe(true);
          } else {
            // Tie-break: larger id sorts first, and since ids are unique
            // within a feed the pair is never equal.
            expect(prev.id > curr.id).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: any input permutation yields the same order (R13.3)', () => {
    fc.assert(
      fc.property(feedArb, (items) => {
        const shuffled = [...items].reverse();
        expect(orderFeed(shuffled)).toEqual(orderFeed(items));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is a permutation of its input and does not mutate it (R13.3)', () => {
    fc.assert(
      fc.property(feedArb, (items) => {
        const snapshot = [...items];
        const actual = orderFeed(items);
        // Same multiset of ids (nothing added, dropped, or duplicated).
        expect([...actual].map((i) => i.id).sort()).toEqual(
          [...items].map((i) => i.id).sort(),
        );
        // Input array left untouched.
        expect(items).toEqual(snapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
