/**
 * Integration test for Document_Store durability (task 7.4).
 *
 * The Document_Store is Postgres-backed, so this test exercises the REAL
 * `createDocumentStore` against a real Postgres-style engine (`pg-mem`) — the
 * same in-memory Postgres the Document_Store property test, the catalog repo
 * integration test, and the smoke harness use (see `documentStore.prop.test.ts`,
 * `repo.apply.integration.test.ts`, and `test/smoke/harness.ts`). Migrations
 * `0001`–`0005` are applied to a fresh pg-mem database so the production SQL in
 * `documentStore.ts` (JSONB upserts, the tombstone `deleted` flag, the singleton
 * checkpoint row) runs verbatim against actual tables — migration
 * `0005_disney_source_resilience.sql` is the one that creates `disney_documents`
 * and `disney_sync_checkpoint`.
 *
 * Where the property test asserts reconciliation semantics, this test asserts
 * DURABILITY: that documents and the checkpoint persisted by one store instance
 * survive a "reopen" and are visible to a brand-new store instance bound to the
 * same underlying database (R7.1). With pg-mem the persisted state lives in the
 * `IMemoryDb`, so a "reopen" is modelled two ways, both of which must observe
 * the same durable state:
 *
 *   1. A fresh `createDocumentStore` bound to the SAME pool — standing in for an
 *      application re-instantiating the store against a live connection.
 *   2. A fresh `createDocumentStore` bound to a NEW `Pool` created from the SAME
 *      `IMemoryDb` — standing in for a process restart that opens brand-new
 *      connections to the same durable database.
 *
 * Scenarios:
 *
 *   - Active documents survive a reopen (R7.1): documents upserted (and a
 *     checkpoint set) via `applyDelta` on one store are re-read, body-for-body,
 *     through a fresh store instance, and the checkpoint round-trips intact.
 *
 *   - A new connection pool sees the same durable state (R7.1): the same
 *     assertions hold through a store bound to a brand-new `Pool` opened against
 *     the same `IMemoryDb`, standing in for a full process restart.
 *
 *   - Tombstones and re-upserts survive a reopen (R7.1, R7.2, R7.3): a deleted
 *     document stays excluded from the active set after reopen, and a document
 *     re-upserted with a new body exposes the latest body after reopen.
 *
 * Validates: Requirements 7.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import { createDocumentStore, type StoredFacilityDocument } from '../documentStore.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors documentStore.prop.test.ts + repo.apply.integration.test.ts)
// ---------------------------------------------------------------------------

/** Build a fresh pg-mem db with the schema's extensions/functions registered. */
function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {
    // citext is supported natively by pg-mem.
  });
  db.registerExtension('pg_trgm', () => {
    // pg_trgm is only consulted by the GIN trigram indexes we strip below.
  });
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });

  return db;
}

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → catalog → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

/** Apply migration 0001, stripping the GIN trigram indexes pg-mem can't model. */
function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** Apply a later migration verbatim (no GIN indexes in 0002–0005). */
function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

/**
 * pg-mem cannot bind an array parameter to a `col = ANY($n)` predicate (real
 * Postgres does this natively) — the update silently matches nothing. The store
 * relies on `= ANY($1)` for its tombstone SQL, so this wrapper rewrites any such
 * predicate into an equivalent `col IN ($a, $b, …)` list, appending the array's
 * elements as fresh trailing parameters. It is a harness-only shim for a known
 * pg-mem limitation (identical to the shim in `documentStore.prop.test.ts`) and
 * leaves the store's real SQL (JSONB upserts, ON CONFLICT, transactions, the
 * singleton checkpoint) running verbatim.
 */
function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)\)/gi, (match, num: string) => {
    const arr = params[Number(num) - 1];
    if (!Array.isArray(arr)) {
      return match;
    }
    const placeholders = arr.map((value) => {
      newParams.push(value);
      return `$${newParams.length}`;
    });
    return `IN (${placeholders.join(', ')})`;
  });
  return [newText, newParams];
}

/** Wrap a pg-mem pool so `= ANY($n)` array predicates work (see above). */
function withAnyArrayCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptAnyArrayParams(text, params);
      return raw.query(t, p);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptAnyArrayParams(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A well-formed stored document keyed by Enterprise_Id. */
function storedDoc(
  enterpriseId: string,
  body: FacilityDocument,
  changeSeq: string,
): StoredFacilityDocument {
  return { enterpriseId, body, deleted: false, changeSeq };
}

const ATTRACTION_ID = '80010177;entityType=Attraction';
const RESTAURANT_ID = '90001111;entityType=Restaurant';
const RESORT_ID = '80010407;entityType=Resort';

/** Sort helper so active-set comparisons are order-independent. */
function byId(docs: readonly FacilityDocument[]): readonly FacilityDocument[] {
  return [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Document_Store durability (integration, pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool } = db.adapters.createPg();
    pool = new Pool() as unknown as DbPool;

    applyInitMigration(db);
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0003_note_shareable.sql');
    applyMigration(db, '0004_disney_sources.sql');
    applyMigration(db, '0005_disney_source_resilience.sql');
    applyMigration(db, '0006_experience_land.sql');
    applyMigration(db, '0007_experience_resort_area.sql');
  });

  afterEach(async () => {
    await (pool as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('active documents and the checkpoint survive a reopen on the same pool (R7.1)', async () => {
    const writer = createDocumentStore(withAnyArrayCompat(pool));

    const docs: readonly StoredFacilityDocument[] = [
      storedDoc(ATTRACTION_ID, { id: ATTRACTION_ID, type: 'attraction', name: 'Space Mountain' }, 'seq-10'),
      storedDoc(RESTAURANT_ID, { id: RESTAURANT_ID, type: 'restaurant', name: 'Cinderella Royal Table' }, 'seq-10'),
      storedDoc(RESORT_ID, { id: RESORT_ID, type: 'resort', name: 'Grand Floridian' }, 'seq-10'),
    ];

    await writer.applyDelta({ upserts: docs, deletes: [], lastSeq: 'seq-10' });

    // Reopen: a brand-new store instance bound to the same durable database
    // stands in for the application re-instantiating the store.
    const reopened = createDocumentStore(withAnyArrayCompat(pool));

    const active = await reopened.getActiveDocuments();
    expect(byId(active)).toEqual(byId(docs.map((d) => d.body)));

    expect(await reopened.getCheckpoint()).toBe('seq-10');
  });

  it('a new connection pool sees the same durable documents and checkpoint (R7.1)', async () => {
    const writer = createDocumentStore(withAnyArrayCompat(pool));

    const docs: readonly StoredFacilityDocument[] = [
      storedDoc(ATTRACTION_ID, { id: ATTRACTION_ID, type: 'attraction', name: 'Haunted Mansion' }, 'seq-42'),
      storedDoc(RESTAURANT_ID, { id: RESTAURANT_ID, type: 'restaurant', name: 'Be Our Guest' }, 'seq-42'),
    ];

    await writer.upsertDocuments(docs);
    await writer.setCheckpoint('seq-42');

    // Reopen against a BRAND-NEW Pool opened on the same IMemoryDb: this is the
    // closest pg-mem analogue to a process restart reconnecting to the same
    // durable Postgres. The persisted state must survive the new connection.
    const { Pool: FreshPool } = db.adapters.createPg();
    const freshPool = new FreshPool() as unknown as DbPool;
    try {
      const reopened = createDocumentStore(withAnyArrayCompat(freshPool));

      const active = await reopened.getActiveDocuments();
      expect(byId(active)).toEqual(byId(docs.map((d) => d.body)));

      expect(await reopened.getCheckpoint()).toBe('seq-42');
    } finally {
      await (freshPool as unknown as { end?: () => Promise<void> }).end?.();
    }
  });

  it('tombstones and re-upserts survive a reopen (R7.1, R7.2, R7.3)', async () => {
    const writer = createDocumentStore(withAnyArrayCompat(pool));

    // Bootstrap: three active documents at seq-1.
    await writer.applyDelta({
      upserts: [
        storedDoc(ATTRACTION_ID, { id: ATTRACTION_ID, type: 'attraction', name: 'Original Name' }, 'seq-1'),
        storedDoc(RESTAURANT_ID, { id: RESTAURANT_ID, type: 'restaurant', name: 'Diner' }, 'seq-1'),
        storedDoc(RESORT_ID, { id: RESORT_ID, type: 'resort', name: 'Contemporary' }, 'seq-1'),
      ],
      deletes: [],
      lastSeq: 'seq-1',
    });

    // Delta at seq-2: tombstone the restaurant, re-upsert the attraction with a
    // new body, advancing the checkpoint.
    await writer.applyDelta({
      upserts: [
        storedDoc(ATTRACTION_ID, { id: ATTRACTION_ID, type: 'attraction', name: 'Renamed Attraction' }, 'seq-2'),
      ],
      deletes: [RESTAURANT_ID],
      lastSeq: 'seq-2',
    });

    // Reopen and assert the durable state reflects the tombstone + re-upsert.
    const reopened = createDocumentStore(withAnyArrayCompat(pool));

    const active = await reopened.getActiveDocuments();
    const activeIds = active.map((d) => d.id).sort();
    expect(activeIds).toEqual([ATTRACTION_ID, RESORT_ID].sort());

    const attraction = active.find((d) => d.id === ATTRACTION_ID);
    expect(attraction?.name).toBe('Renamed Attraction');

    expect(await reopened.getCheckpoint()).toBe('seq-2');
  });
});
