/**
 * Property-based test for the Bootstrap_Sync / Delta_Sync decision
 * (design.md → "Property 6: Sync-mode decision").
 *
 * At the start of every `Catalog_Sync` run the persisted Changes_Checkpoint is
 * read and the pure `decideSyncMode(checkpoint)` seam turns it into the
 * enumeration plan:
 *
 *   - An ABSENT checkpoint (`null`, the first-ever boot) drives a
 *     `Bootstrap_Sync`: a full Facilities_Channel enumeration with NO `since`
 *     value (R6.1).
 *
 *   - A PRESENT checkpoint (any stored `_changes` sequence token) drives a
 *     `Delta_Sync`: an incremental enumeration whose `since` equals the stored
 *     checkpoint exactly, byte-for-byte (R6.2).
 *
 * `decideSyncMode` is pure and total, so this property runs entirely in-memory
 * with no timers, network, or database — driving the decision across the whole
 * checkpoint input space (absent, and arbitrary non-empty sequence tokens).
 *
 * // Feature: disney-source-resilience, Property 6: Sync-mode decision
 * Validates: Requirements 6.1, 6.2
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decideSyncMode, partitionChanges } from '../sync.js';
import type { ChannelChange } from '../disney/facilitiesClient.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A present Changes_Checkpoint: an arbitrary non-empty `_changes` sequence
 * token. The Sync Gateway emits opaque sequence strings, so the generator
 * spans both the conventional `seq-<n>` / `<n>-<hash>` shapes and arbitrary
 * non-empty strings to prove the decision passes the checkpoint through
 * verbatim regardless of its internal form.
 */
const presentCheckpointArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0, max: 9_999_999 }).map((n) => `${n}`),
  fc.integer({ min: 0, max: 9_999_999 }).map((n) => `${n}-abcdef0123456789`),
  fc.string({ minLength: 1 }),
);

// ---------------------------------------------------------------------------
// Property 6: Sync-mode decision
// ---------------------------------------------------------------------------

describe('decideSyncMode (Property 6: Sync-mode decision)', () => {
  it('drives a Bootstrap_Sync (full enumeration, no since) when the checkpoint is absent', () => {
    // A `null` checkpoint is a single concrete input, but assert it inside the
    // property harness for parity with the present-checkpoint case.
    fc.assert(
      fc.property(fc.constant(null), (checkpoint) => {
        const decision = decideSyncMode(checkpoint);

        // (R6.1) Absent checkpoint ⇒ Bootstrap_Sync with NO `since`: a full
        // Facilities_Channel enumeration.
        expect(decision.mode).toBe('bootstrap');
        expect(decision.since).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('drives a Delta_Sync whose since equals the stored checkpoint when one is present', () => {
    fc.assert(
      fc.property(presentCheckpointArb, (checkpoint) => {
        const decision = decideSyncMode(checkpoint);

        // (R6.2) Present checkpoint ⇒ Delta_Sync whose `since` is exactly the
        // stored checkpoint (byte-identical), never a mutated/normalized form.
        expect(decision.mode).toBe('delta');
        expect(decision.since).toBe(checkpoint);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Delta fetch set
// ---------------------------------------------------------------------------

/**
 * Property-based test for the delta fetch set (design.md → "Property 7: Delta
 * fetch set").
 *
 * Every `Catalog_Sync` walks the Facilities_Channel `_changes` feed and the
 * pure `partitionChanges(changes)` seam splits it into the two id sets the
 * orchestrator acts on:
 *
 *   - `changedIds` — the non-deleted changed ids. These, and ONLY these, are
 *     fetched via `_bulk_get` (R6.4). An unchanged document never appears in
 *     the feed at all, so it is never fetched; a tombstoned (deleted) change
 *     is filtered out of the fetch set.
 *
 *   - `deletedIds` — the deleted/tombstoned ids, propagated to the
 *     Document_Store as deletes (R7.3), never bulk-fetched.
 *
 * `partitionChanges` is a pure, total, order-preserving filter that does NOT
 * deduplicate: each feed entry contributes its id to exactly one of the two
 * lists based on its `deleted` flag, so duplicate ids (including an id that
 * appears as both a non-deleted and a deleted change) are carried through with
 * their multiplicity and relative order intact. This property drives that seam
 * across arbitrary feeds — empty, all-deleted, all-changed, and mixed feeds
 * with duplicate ids across the deleted/non-deleted boundary.
 *
 * // Feature: disney-source-resilience, Property 7: Delta fetch set
 * Validates: Requirements 6.4
 */

/**
 * A small id pool so generated feeds routinely contain duplicate ids — both
 * repeated within a partition and crossing the deleted/non-deleted boundary —
 * which is exactly the case the documented (non-deduplicating) behavior of
 * `partitionChanges` must be pinned down against.
 */
const changeIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'doc-a',
  'doc-b',
  'doc-c',
  'doc-d',
  'doc-e',
);

/** A single `_changes` entry: an id plus a tombstone flag. */
const channelChangeArb: fc.Arbitrary<ChannelChange> = fc.record({
  id: changeIdArb,
  deleted: fc.boolean(),
});

/**
 * An arbitrary `_changes` feed: an array of changes with a realistic mix of
 * deleted / non-deleted entries and (thanks to the small id pool) duplicate
 * ids, including ids that show up on both sides of the boundary.
 */
const changesFeedArb: fc.Arbitrary<ChannelChange[]> = fc.array(
  channelChangeArb,
  { maxLength: 40 },
);

describe('partitionChanges (Property 7: Delta fetch set)', () => {
  it('fetches exactly the non-deleted changed ids and never a deleted/unchanged one', () => {
    fc.assert(
      fc.property(changesFeedArb, (changes) => {
        const { changedIds, deletedIds } = partitionChanges(changes);

        // The reference partition derived straight from the feed's `deleted`
        // flags, preserving order and multiplicity (the documented behavior:
        // `partitionChanges` is a pure order-preserving filter, no dedup).
        const expectedChanged = changes
          .filter((c) => !c.deleted)
          .map((c) => c.id);
        const expectedDeleted = changes
          .filter((c) => c.deleted)
          .map((c) => c.id);

        // (1) `changedIds` — the `_bulk_get` fetch set — equals EXACTLY the
        // non-deleted changed ids (R6.4): same ids, same order, same
        // multiplicity.
        expect(changedIds).toEqual(expectedChanged);

        // (3) `deletedIds` equals EXACTLY the deleted ids (R7.3 tombstones),
        // likewise order- and multiplicity-preserving.
        expect(deletedIds).toEqual(expectedDeleted);

        // Every fetched id is backed by a real non-deleted change in the feed,
        // and no unchanged document (one absent from the feed) is ever fetched.
        const changedFromFeed = new Set(expectedChanged);
        for (const id of changedIds) {
          expect(changedFromFeed.has(id)).toBe(true);
        }

        // (2) No purely-tombstoned document is fetched: an id whose EVERY feed
        // entry is a deletion never appears in the `_bulk_get` fetch set. (An
        // id that also has a non-deleted change is legitimately fetched — the
        // documented per-entry, non-deduplicating behavior.)
        const changedFetchSet = new Set(changedIds);
        const idsWithAnyNonDeleted = new Set(expectedChanged);
        for (const id of deletedIds) {
          if (!idsWithAnyNonDeleted.has(id)) {
            expect(changedFetchSet.has(id)).toBe(false);
          }
        }

        // Conservation: the two partitions together account for every feed
        // entry and nothing is invented — no id leaks into both fetch and
        // tombstone sets except by an explicit non-deleted + deleted pair.
        expect(changedIds.length + deletedIds.length).toBe(changes.length);
      }),
      { numRuns: 100 },
    );
  });
});
