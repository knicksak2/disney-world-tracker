/**
 * Property-based test for the Changes_Checkpoint lifecycle
 * (design.md → "Property 8: Checkpoint lifecycle").
 *
 * Unlike the sibling `documentStore.prop.test.ts` (Property 9), which drives the
 * REAL Postgres-backed store against `pg-mem`, this property is about the
 * *checkpoint transition* around a `Catalog_Sync` run, so it uses a faithful
 * IN-MEMORY fake of the `DocumentStore` interface (per the task and the design's
 * Testing Strategy note that the cores run "deterministically in-memory without
 * real timers, Redis, network, or a database"). The fake mirrors the production
 * `applyDelta` contract exactly: document upserts/tombstones AND the new
 * checkpoint move together in one atomic step, so a fault before or during the
 * persist leaves BOTH untouched — the same all-or-nothing guarantee the real
 * store gets from wrapping the writes in a single transaction.
 *
 * A run is simulated as: read the prior checkpoint, perform an enumeration that
 * may fail, and — only on a successful enumeration+fetch — call
 * `applyDelta({ upserts, deletes, lastSeq })`. For any generated prior
 * checkpoint (absent or present), enumeration result, and failure mode, the
 * test asserts:
 *
 *   1. After a successful enumeration+persist, `getCheckpoint()` equals the
 *      enumeration's `last_seq` (R6.3, R7.5).
 *
 *   2. When the run fails at any point before the atomic persist — whether
 *      `applyDelta` is never reached (enumeration/fetch threw) or `applyDelta`
 *      itself throws before mutating (a rolled-back transaction) — the
 *      checkpoint remains byte-identical to its prior value, so the next run
 *      resumes from the last successful sequence (R6.5).
 *
 * // Feature: disney-source-resilience, Property 8: Checkpoint lifecycle
 * Validates: Requirements 6.3, 6.5, 7.5
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { FacilityDocument } from '../disney/facilityDoc.js';
import type {
  ApplyDeltaInput,
  DocumentStore,
  StoredFacilityDocument,
} from '../documentStore.js';

// ---------------------------------------------------------------------------
// In-memory DocumentStore fake
// ---------------------------------------------------------------------------

/**
 * A faithful in-memory implementation of the `DocumentStore` interface. It
 * mirrors the production store's semantics that matter for the checkpoint
 * lifecycle:
 *
 *   - `applyDelta` is ATOMIC: it computes the whole next state and commits it in
 *     one shot, so the checkpoint only ever advances together with the document
 *     writes (R6.3, R7.5). This is the in-memory analogue of the real store's
 *     single-transaction `BEGIN … COMMIT`.
 *
 *   - When `failNextApplyDelta` is armed, `applyDelta` throws BEFORE mutating any
 *     state — the in-memory analogue of a transaction that errors and rolls
 *     back. Neither the documents nor the checkpoint change (R6.5).
 *
 * The document map is present for interface fidelity; the checkpoint is the
 * subject under test.
 */
class InMemoryDocumentStore implements DocumentStore {
  private readonly docs = new Map<string, StoredFacilityDocument>();
  private checkpoint: string | null;

  /** When armed, the next `applyDelta` throws before touching any state. */
  failNextApplyDelta = false;

  constructor(initialCheckpoint: string | null) {
    this.checkpoint = initialCheckpoint;
  }

  upsertDocuments(docs: readonly StoredFacilityDocument[]): Promise<void> {
    for (const doc of docs) {
      this.docs.set(doc.enterpriseId, { ...doc, deleted: false });
    }
    return Promise.resolve();
  }

  markDeleted(enterpriseIds: readonly string[], seq: string): Promise<void> {
    for (const id of enterpriseIds) {
      const existing = this.docs.get(id);
      if (existing !== undefined) {
        this.docs.set(id, { ...existing, deleted: true, changeSeq: seq });
      }
    }
    return Promise.resolve();
  }

  getActiveDocuments(): Promise<readonly FacilityDocument[]> {
    return Promise.resolve(
      [...this.docs.values()].filter((d) => !d.deleted).map((d) => d.body),
    );
  }

  getCheckpoint(): Promise<string | null> {
    return Promise.resolve(this.checkpoint);
  }

  setCheckpoint(seq: string): Promise<void> {
    this.checkpoint = seq;
    return Promise.resolve();
  }

  applyDelta(input: ApplyDeltaInput): Promise<void> {
    // Model a transaction that errors before writing anything: nothing mutates,
    // so the prior checkpoint and documents survive intact (R6.5).
    if (this.failNextApplyDelta) {
      return Promise.reject(new Error('simulated persist failure (rolled back)'));
    }
    // Atomic commit: upserts → tombstones → checkpoint, all together (R6.3, R7.5).
    for (const doc of input.upserts) {
      this.docs.set(doc.enterpriseId, { ...doc, deleted: false });
    }
    for (const id of input.deletes) {
      const existing = this.docs.get(id);
      if (existing !== undefined) {
        this.docs.set(id, { ...existing, deleted: true, changeSeq: input.lastSeq });
      }
    }
    this.checkpoint = input.lastSeq;
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Run simulation — the checkpoint-driven lifecycle around one Catalog_Sync run
// ---------------------------------------------------------------------------

/** Where, if anywhere, a run fails relative to the atomic persist. */
type FailureMode =
  | 'none' // successful enumeration + persist
  | 'before-persist' // enumeration/fetch threw; applyDelta never reached
  | 'during-persist'; // applyDelta threw before mutating (rolled back)

/** The result of a single simulated enumeration this run would persist. */
interface Enumeration {
  readonly upserts: readonly StoredFacilityDocument[];
  readonly deletes: readonly string[];
  readonly lastSeq: string;
}

/**
 * Simulate the checkpoint-relevant portion of a `Catalog_Sync` run against the
 * store: read the checkpoint, enumerate (may fail), and persist ONLY on a
 * successful enumeration via the atomic `applyDelta`. Returns whether the run
 * succeeded; throws are caught here so the property can inspect the resulting
 * checkpoint either way (the orchestrator likewise leaves state untouched on a
 * caught failure).
 */
async function simulateRun(
  store: InMemoryDocumentStore,
  enumeration: Enumeration,
  failureMode: FailureMode,
): Promise<boolean> {
  // Step: read the checkpoint at the start of the run (R7.5). Read for fidelity
  // with the real lifecycle even though the transition is what we assert on.
  await store.getCheckpoint();

  try {
    if (failureMode === 'before-persist') {
      // Enumeration or _bulk_get failed before any persist could be attempted.
      throw new Error('simulated enumeration failure before persist');
    }

    if (failureMode === 'during-persist') {
      // The persist transaction itself fails and rolls back.
      store.failNextApplyDelta = true;
    }

    await store.applyDelta({
      upserts: enumeration.upserts,
      deletes: enumeration.deletes,
      lastSeq: enumeration.lastSeq,
    });
    return true;
  } catch {
    // A failed run leaves the checkpoint (and cache) unchanged (R6.5, R12.1).
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A `_changes` sequence token (the checkpoint / last_seq form). */
const seqArb = fc
  .integer({ min: 0, max: 999_999 })
  .map((n) => `seq-${n}`);

/** A prior checkpoint: absent (first-ever run) or a previously persisted seq. */
const priorCheckpointArb = fc.option(seqArb, { nil: null });

/** A small pool of Enterprise_Ids so upserts/deletes can collide. */
const idArb = fc.constantFrom(
  '80010177;entityType=Attraction',
  '90001111;entityType=Restaurant',
  '80010407;entityType=Resort',
  '80010200;entityType=Entertainment',
);

/** A tolerant Facility_Document body keyed by its Enterprise_Id. */
function bodyArb(id: string): fc.Arbitrary<FacilityDocument> {
  return fc
    .record({ type: fc.constantFrom('attraction', 'restaurant', 'resort') })
    .map((fields): FacilityDocument => ({ id, type: fields.type, name: 'Doc' }));
}

/** A stored document (store key + body + originating change sequence). */
const storedDocArb: fc.Arbitrary<StoredFacilityDocument> = idArb.chain((id) =>
  fc
    .record({ body: bodyArb(id), changeSeq: seqArb })
    .map(({ body, changeSeq }) => ({
      enterpriseId: id,
      body,
      deleted: false,
      changeSeq,
    })),
);

/** A generated enumeration result the run would persist. */
const enumerationArb: fc.Arbitrary<Enumeration> = fc.record({
  upserts: fc.array(storedDocArb, { minLength: 0, maxLength: 4 }),
  deletes: fc.array(idArb, { minLength: 0, maxLength: 4 }),
  lastSeq: seqArb,
});

const failureModeArb = fc.constantFrom<FailureMode>(
  'none',
  'before-persist',
  'during-persist',
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Changes_Checkpoint lifecycle (Property 8, in-memory fake)', () => {
  it('advances the checkpoint to last_seq on a successful persist and leaves it byte-identical on failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        priorCheckpointArb,
        enumerationArb,
        failureModeArb,
        async (prior, enumeration, failureMode) => {
          const store = new InMemoryDocumentStore(prior);

          const succeeded = await simulateRun(store, enumeration, failureMode);
          const after = await store.getCheckpoint();

          if (failureMode === 'none') {
            // (1) Successful enumeration+persist ⇒ checkpoint == last_seq (R6.3, R7.5).
            expect(succeeded).toBe(true);
            expect(after).toBe(enumeration.lastSeq);
          } else {
            // (2) Failure before the atomic persist ⇒ checkpoint byte-identical
            //     to its prior value (R6.5).
            expect(succeeded).toBe(false);
            expect(after).toBe(prior);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resumes from the last successful sequence across a failed then successful run', async () => {
    await fc.assert(
      fc.asyncProperty(
        priorCheckpointArb,
        enumerationArb,
        enumerationArb,
        async (prior, failedEnum, goodEnum) => {
          const store = new InMemoryDocumentStore(prior);

          // A failed run must not disturb the prior checkpoint (R6.5).
          await simulateRun(store, failedEnum, 'before-persist');
          expect(await store.getCheckpoint()).toBe(prior);

          // The next successful run resumes and advances to its last_seq (R6.3, R7.5).
          await simulateRun(store, goodEnum, 'none');
          expect(await store.getCheckpoint()).toBe(goodEnum.lastSeq);
        },
      ),
      { numRuns: 100 },
    );
  });
});
