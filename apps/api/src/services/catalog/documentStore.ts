/**
 * Document_Store — durable local persistence of fetched Facility_Documents and
 * the Changes_Checkpoint (Requirement 7).
 *
 * The store is the single point of contact between `Catalog_Sync` and the two
 * Postgres tables introduced by migration `0005_disney_source_resilience.sql`:
 *
 *   - `disney_documents`        — one row per Disney entity, keyed by its
 *                                 Enterprise_Id (`enterprise_id` PK). The
 *                                 parsed Facility_Document body is stored in a
 *                                 JSONB column, a `deleted` boolean carries the
 *                                 tombstone marker (R7.3), and `change_seq`
 *                                 records the `_changes` sequence the persisted
 *                                 version came from.
 *   - `disney_sync_checkpoint`  — a singleton row (`id = 1`) holding the last
 *                                 processed `_changes` sequence (R6.3, R7.5).
 *
 * The store exposes:
 *
 *   - `upsertDocuments`     — persist fetched documents so they survive
 *                             restarts (R7.1); a re-upsert of the same
 *                             Enterprise_Id replaces the prior version and
 *                             re-activates a previously tombstoned row (R7.2).
 *   - `markDeleted`         — flip `deleted = true` on tombstoned documents
 *                             while keeping the row and advancing `change_seq`
 *                             so checkpoint continuity is preserved (R7.3).
 *   - `getActiveDocuments`  — return the non-deleted document bodies that
 *                             reconciliation derives the upstream entity set
 *                             from, without a full re-enumeration (R7.4).
 *   - `getCheckpoint`       — read the persisted `_changes` sequence at the
 *                             start of each run, or `null` on first boot (R7.5).
 *   - `setCheckpoint`       — persist the `_changes` sequence (R6.3, R7.5).
 *   - `applyDelta`          — write document upserts, tombstones, and the new
 *                             checkpoint in ONE transaction so the stored
 *                             documents and the checkpoint can never diverge
 *                             (R6.3, R7.2, R7.3, R7.5).
 *
 * The document body is parameterized as `FacilityDocument` (the tolerant shape
 * from `disney/facilityDoc.ts`); the shared `StoredDocument<TBody>` type keeps
 * `@dwt/shared` free of that `apps/api`-local shape.
 *
 * Validates: Requirements 6.3, 7.1, 7.2, 7.3, 7.4, 7.5
 */

import type { PoolClient } from 'pg';

import type { StoredDocument } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import type { FacilityDocument } from './disney/facilityDoc.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A Facility_Document persisted in the Document_Store, keyed by Enterprise_Id. */
export type StoredFacilityDocument = StoredDocument<FacilityDocument>;

/**
 * Input to {@link DocumentStore.applyDelta}. Captures the outcome of a single
 * `_changes` enumeration + `_bulk_get` fetch: the changed documents to upsert,
 * the ids reported deleted/tombstoned, and the `last_seq` to persist as the new
 * checkpoint. All three are written in one transaction (R6.3, R7.5).
 */
export interface ApplyDeltaInput {
  /** Changed documents fetched this run; each replaces the prior version (R7.2). */
  readonly upserts: readonly StoredFacilityDocument[];
  /** Enterprise_Ids reported deleted/tombstoned this run (R7.3). */
  readonly deletes: readonly string[];
  /** The `_changes` `last_seq` to persist as the new checkpoint (R6.3, R7.5). */
  readonly lastSeq: string;
}

/**
 * Durable local persistence of fetched Facility_Documents and the
 * Changes_Checkpoint. Returned by {@link createDocumentStore}.
 */
export interface DocumentStore {
  /** Persist fetched documents durably; a re-upsert replaces the prior version (R7.1, R7.2). */
  upsertDocuments(docs: readonly StoredFacilityDocument[]): Promise<void>;
  /** Tombstone the given documents while preserving the row and checkpoint continuity (R7.3). */
  markDeleted(enterpriseIds: readonly string[], seq: string): Promise<void>;
  /** Return the non-deleted document bodies reconciliation reads from (R7.4). */
  getActiveDocuments(): Promise<readonly FacilityDocument[]>;
  /** Read the persisted `_changes` checkpoint, or `null` when none exists (R7.5). */
  getCheckpoint(): Promise<string | null>;
  /** Persist the `_changes` checkpoint (R6.3, R7.5). */
  setCheckpoint(seq: string): Promise<void>;
  /** Apply document upserts, tombstones, and the new checkpoint atomically (R6.3, R7.5). */
  applyDelta(input: ApplyDeltaInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * Shape of a `disney_documents` row as read for the active set. `pg`'s JSONB
 * parser returns the already-decoded object, so `body` comes back as a
 * `FacilityDocument` without a manual `JSON.parse`.
 */
interface DocumentBodyRow {
  body: FacilityDocument;
}

/** Shape of the singleton `disney_sync_checkpoint` row. */
interface CheckpointRow {
  last_seq: string;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Build a {@link DocumentStore} bound to the supplied pool.
 *
 * Constructor injection (rather than reaching for `getPool()` at module scope)
 * keeps the store testable: integration tests pass a pool connected to a
 * sandbox database, and unit tests can pass a fake `query`/`connect`.
 */
export function createDocumentStore(pool: DbPool): DocumentStore {
  return {
    upsertDocuments: (docs) => upsertDocuments(pool, docs),
    markDeleted: (ids, seq) => markDeleted(pool, ids, seq),
    getActiveDocuments: () => getActiveDocuments(pool),
    getCheckpoint: () => getCheckpoint(pool),
    setCheckpoint: (seq) => setCheckpoint(pool, seq),
    applyDelta: (input) => applyDelta(pool, input),
  };
}

// ---------------------------------------------------------------------------
// SQL fragments (shared by the single-op and transactional paths)
// ---------------------------------------------------------------------------

/**
 * Upsert one stored document. A conflict on the `enterprise_id` primary key
 * replaces the prior version (R7.2) and, because a fetched document is by
 * definition present upstream, flips `deleted` back to `false` — the same
 * reactivation path a previously tombstoned id follows when it reappears.
 */
const UPSERT_DOCUMENT_SQL = `
  INSERT INTO disney_documents (enterprise_id, body, deleted, change_seq, updated_at)
  VALUES ($1, $2::jsonb, FALSE, $3, now())
  ON CONFLICT (enterprise_id) DO UPDATE SET
    body       = EXCLUDED.body,
    deleted    = FALSE,
    change_seq = EXCLUDED.change_seq,
    updated_at = now()`;

/**
 * Tombstone every document whose Enterprise_Id is in the supplied array. The
 * row is kept (so referential continuity and history survive) and `change_seq`
 * advances to the deleting sequence so the tombstone and the checkpoint stay in
 * lockstep (R7.3).
 */
const MARK_DELETED_SQL = `
  UPDATE disney_documents
     SET deleted    = TRUE,
         change_seq = $2,
         updated_at = now()
   WHERE enterprise_id = ANY($1)`;

/**
 * Persist the singleton checkpoint. The migration's `id = 1` CHECK makes the
 * row a true singleton; `INSERT ... ON CONFLICT (id) DO UPDATE` inserts it on
 * first success and updates it thereafter (R6.3, R7.5).
 */
const SET_CHECKPOINT_SQL = `
  INSERT INTO disney_sync_checkpoint (id, last_seq, updated_at)
  VALUES (1, $1, now())
  ON CONFLICT (id) DO UPDATE SET
    last_seq   = EXCLUDED.last_seq,
    updated_at = now()`;

// ---------------------------------------------------------------------------
// upsertDocuments
// ---------------------------------------------------------------------------

/**
 * Persist fetched documents durably (R7.1). Each document is upserted keyed by
 * its Enterprise_Id, replacing any prior version (R7.2). An empty input is a
 * no-op that avoids acquiring a connection.
 */
async function upsertDocuments(
  pool: DbPool,
  docs: readonly StoredFacilityDocument[],
): Promise<void> {
  if (docs.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertDocumentsOnClient(client, docs);
    await client.query('COMMIT');
  } catch (err) {
    await rollbackQuietly(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// markDeleted
// ---------------------------------------------------------------------------

/**
 * Tombstone the given documents while preserving each row and advancing its
 * `change_seq` to `seq` so checkpoint continuity is preserved (R7.3). An empty
 * id list is a no-op.
 */
async function markDeleted(
  pool: DbPool,
  enterpriseIds: readonly string[],
  seq: string,
): Promise<void> {
  if (enterpriseIds.length === 0) {
    return;
  }
  await pool.query(MARK_DELETED_SQL, [enterpriseIds, seq]);
}

// ---------------------------------------------------------------------------
// getActiveDocuments
// ---------------------------------------------------------------------------

/**
 * Return the bodies of every non-tombstoned document. This is the upstream
 * entity set reconciliation derives from, so no full re-enumeration from Disney
 * is required (R7.4). Ordered by `enterprise_id` for a stable, deterministic
 * result the reconcile step can rely on.
 */
async function getActiveDocuments(
  pool: DbPool,
): Promise<readonly FacilityDocument[]> {
  const result = await pool.query<DocumentBodyRow>(
    `SELECT body
       FROM disney_documents
      WHERE deleted = FALSE
      ORDER BY enterprise_id ASC`,
  );
  return result.rows.map((row) => row.body);
}

// ---------------------------------------------------------------------------
// getCheckpoint
// ---------------------------------------------------------------------------

/**
 * Read the persisted `_changes` checkpoint. Returns `null` when the singleton
 * row does not yet exist (first boot), which the orchestrator treats as "no
 * checkpoint ⇒ Bootstrap_Sync" (R6.1, R7.5).
 */
async function getCheckpoint(pool: DbPool): Promise<string | null> {
  const result = await pool.query<CheckpointRow>(
    `SELECT last_seq
       FROM disney_sync_checkpoint
      WHERE id = 1`,
  );
  return result.rows[0]?.last_seq ?? null;
}

// ---------------------------------------------------------------------------
// setCheckpoint
// ---------------------------------------------------------------------------

/** Persist the `_changes` checkpoint on the singleton row (R6.3, R7.5). */
async function setCheckpoint(pool: DbPool, seq: string): Promise<void> {
  await pool.query(SET_CHECKPOINT_SQL, [seq]);
}

// ---------------------------------------------------------------------------
// applyDelta
// ---------------------------------------------------------------------------

/**
 * Apply document upserts, tombstones, and the new checkpoint in a single
 * transaction (R6.3, R7.5). Because the document writes and the checkpoint move
 * together, a failure anywhere rolls the whole delta back — the stored document
 * set and the persisted checkpoint can never diverge, so the next run resumes
 * cleanly from the last good sequence (R6.5).
 *
 * Ordering within the transaction is upserts → tombstones → checkpoint. Upserts
 * run before tombstones so that if the same id appears in both (it should not,
 * but the store stays correct regardless) the tombstone wins the final state.
 */
async function applyDelta(pool: DbPool, input: ApplyDeltaInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (input.upserts.length > 0) {
      await upsertDocumentsOnClient(client, input.upserts);
    }

    if (input.deletes.length > 0) {
      await client.query(MARK_DELETED_SQL, [input.deletes, input.lastSeq]);
    }

    await client.query(SET_CHECKPOINT_SQL, [input.lastSeq]);

    await client.query('COMMIT');
  } catch (err) {
    await rollbackQuietly(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of documents on an already-open client (inside a caller's
 * transaction). Shared by `upsertDocuments` and `applyDelta` so the upsert SQL
 * and the JSONB encoding live in exactly one place.
 */
async function upsertDocumentsOnClient(
  client: PoolClient,
  docs: readonly StoredFacilityDocument[],
): Promise<void> {
  for (const doc of docs) {
    await client.query(UPSERT_DOCUMENT_SQL, [
      doc.enterpriseId,
      JSON.stringify(doc.body),
      doc.changeSeq,
    ]);
  }
}

/**
 * Roll back a transaction, swallowing any rollback error so the original cause
 * surfaces to the caller (the pool layer logs rollback failures).
 */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original cause; rollback failures are surfaced elsewhere.
  }
}
