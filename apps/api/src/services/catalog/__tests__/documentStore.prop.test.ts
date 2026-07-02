/**
 * Property-based test for the Document_Store reconciliation semantics
 * (design.md → "Property 9: Document store reconciliation").
 *
 * The store is Postgres-backed, so this test exercises the REAL
 * `createDocumentStore` against a real Postgres-style engine (`pg-mem`) — the
 * same in-memory Postgres the catalog repo integration test and the smoke
 * harness use (see `repo.apply.integration.test.ts` and
 * `test/smoke/harness.ts`). Migrations `0001`–`0005` are applied to a fresh
 * pg-mem database so the production SQL in `documentStore.ts` (JSONB upserts,
 * the tombstone `deleted` flag, the singleton checkpoint row) runs verbatim
 * against actual tables — migration `0005_disney_source_resilience.sql` is the
 * one that creates `disney_documents` and `disney_sync_checkpoint`.
 *
 * For any generated sequence of upserts, tombstones, checkpoint writes, and
 * atomic deltas, the test drives the store and an in-memory reference model in
 * lockstep and then asserts:
 *
 *   1. Re-upserting an `Enterprise_Id` leaves EXACTLY ONE stored entry with the
 *      latest body (the PK collapses re-upserts; the persisted body is the last
 *      one written) — verified by comparing the full `disney_documents` table
 *      to the model row-for-row and asserting the row count equals the number
 *      of distinct ids (R7.2).
 *
 *   2. A tombstoned id is excluded from the active document set while checkpoint
 *      continuity holds — verified by asserting `getActiveDocuments()` omits
 *      every tombstoned id, that each tombstoned row's `change_seq` advanced to
 *      its deleting sequence, and that `getCheckpoint()` still equals the last
 *      persisted checkpoint (a tombstone never disturbs it) (R7.3, R7.5).
 *
 *   3. The upstream entity set fed to `buildUpstreamCatalog` equals the set
 *      derived from the store's active documents — verified by feeding
 *      `getActiveDocuments()` and the model's expected active bodies through the
 *      real `buildUpstreamCatalog` and asserting the two builds are identical
 *      (R7.4, R10.3).
 *
 * // Feature: disney-source-resilience, Property 9: Document store reconciliation
 * Validates: Requirements 7.2, 7.3, 7.4, 10.3
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import { createDocumentStore, type StoredFacilityDocument } from '../documentStore.js';
import { __internal } from '../sync.js';

const { buildUpstreamCatalog } = __internal;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.apply.integration.test.ts + smoke harness)
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
 * pg-mem limitation — exactly parallel to the GIN-index strip the other pg-mem
 * suites apply — and leaves the store's real SQL (JSONB upserts, ON CONFLICT,
 * transactions, the singleton checkpoint) running verbatim.
 *
 * The store never issues a `= ANY` predicate with an empty array (both
 * `markDeleted` and `applyDelta` short-circuit on empty input), so an empty
 * `IN ()` list can never be produced here.
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

/** Query every persisted document row, ordered by id, for whole-table checks. */
async function readAllRows(
  pool: DbPool,
): Promise<
  ReadonlyArray<{
    enterprise_id: string;
    body: FacilityDocument;
    deleted: boolean;
    change_seq: string;
  }>
> {
  const result = await pool.query<{
    enterprise_id: string;
    body: FacilityDocument;
    deleted: boolean;
    change_seq: string;
  }>(
    `SELECT enterprise_id, body, deleted, change_seq
       FROM disney_documents
      ORDER BY enterprise_id ASC`,
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Reference model — the expected Document_Store state after a sequence of ops
// ---------------------------------------------------------------------------

interface ModelRow {
  body: FacilityDocument;
  deleted: boolean;
  changeSeq: string;
}

/**
 * A faithful in-memory mirror of the store's reconciliation semantics. Applying
 * the same operation stream to the model and the real store lets the test
 * assert they agree on the full table, the active set, and the checkpoint.
 */
class StoreModel {
  private readonly rows = new Map<string, ModelRow>();
  private checkpoint: string | null = null;

  upsert(docs: readonly StoredFacilityDocument[]): void {
    // A re-upsert replaces the prior body and re-activates the row (R7.2).
    for (const doc of docs) {
      this.rows.set(doc.enterpriseId, {
        body: doc.body,
        deleted: false,
        changeSeq: doc.changeSeq,
      });
    }
  }

  markDeleted(ids: readonly string[], seq: string): void {
    // Tombstone existing rows only; the row is kept and change_seq advances to
    // the deleting sequence (R7.3). The checkpoint is untouched.
    for (const id of ids) {
      const existing = this.rows.get(id);
      if (existing !== undefined) {
        this.rows.set(id, { ...existing, deleted: true, changeSeq: seq });
      }
    }
  }

  setCheckpoint(seq: string): void {
    this.checkpoint = seq;
  }

  applyDelta(input: {
    upserts: readonly StoredFacilityDocument[];
    deletes: readonly string[];
    lastSeq: string;
  }): void {
    // Ordering mirrors the store: upserts → tombstones → checkpoint, all atomic.
    this.upsert(input.upserts);
    this.markDeleted(input.deletes, input.lastSeq);
    this.checkpoint = input.lastSeq;
  }

  getCheckpoint(): string | null {
    return this.checkpoint;
  }

  /** Every row ordered by enterprise_id ascending (matches the store's SELECT). */
  allRowsSorted(): ReadonlyArray<{
    enterprise_id: string;
    body: FacilityDocument;
    deleted: boolean;
    change_seq: string;
  }> {
    return [...this.rows.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([enterprise_id, row]) => ({
        enterprise_id,
        body: row.body,
        deleted: row.deleted,
        change_seq: row.changeSeq,
      }));
  }

  /** Active (non-tombstoned) document bodies, ordered by enterprise_id ascending. */
  activeBodiesSorted(): readonly FacilityDocument[] {
    return [...this.rows.entries()]
      .filter(([, row]) => !row.deleted)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => row.body);
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A small, fixed pool of well-formed Enterprise_Ids so that upserts, tombstones,
 * and deltas across a sequence collide on the same ids — which is exactly what
 * exercises re-upsert-replaces-body and tombstone-then-reactivate.
 */
const ID_POOL: readonly string[] = [
  '80010177;entityType=Attraction',
  '90001111;entityType=Restaurant',
  '80010407;entityType=Resort',
  '70000001;entityType=Transportation',
  '80010200;entityType=Entertainment',
  '80010500;entityType=Attraction',
];

const idArb = fc.constantFrom(...ID_POOL);

/** JSON-safe non-blank display name (round-trips cleanly through JSONB). */
const nameArb = fc
  .array(fc.constantFrom(...'ABCDEFabcdef012345 '.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .map((chars) => chars.join(''))
  .filter((s) => s.trim().length > 0);

/** The Facility_Type field that drives the buildUpstreamCatalog split. */
const typeArb = fc.constantFrom(
  'attraction',
  'restaurant',
  'resort',
  'entertainment',
  'transportation',
);

/**
 * Build a tolerant Facility_Document body for a given id. Optional fields are
 * omitted (never set to `undefined`) so the value is a faithful JSONB round-trip
 * and satisfies `exactOptionalPropertyTypes`.
 */
function bodyArb(id: string): fc.Arbitrary<FacilityDocument> {
  return fc
    .record({
      type: typeArb,
      name: nameArb,
      description: fc.option(nameArb, { nil: undefined }),
    })
    .map((fields): FacilityDocument => {
      const body: {
        id: string;
        type?: string;
        name?: string;
        description?: string;
      } = { id, type: fields.type, name: fields.name };
      if (fields.description !== undefined) {
        body.description = fields.description;
      }
      return body;
    });
}

/** A stored document (store key + tolerant body + change sequence). */
function storedDocArb(): fc.Arbitrary<StoredFacilityDocument> {
  return idArb.chain((id) =>
    fc.record({
      body: bodyArb(id),
      changeSeq: seqArb,
    }).map(({ body, changeSeq }) => ({
      enterpriseId: id,
      body,
      deleted: false,
      changeSeq,
    })),
  );
}

/** A `_changes` sequence token. */
const seqArb = fc.integer({ min: 1, max: 9999 }).map((n) => `seq-${n}`);

type Op =
  | { readonly kind: 'upsert'; readonly docs: readonly StoredFacilityDocument[] }
  | { readonly kind: 'markDeleted'; readonly ids: readonly string[]; readonly seq: string }
  | { readonly kind: 'setCheckpoint'; readonly seq: string }
  | {
      readonly kind: 'applyDelta';
      readonly upserts: readonly StoredFacilityDocument[];
      readonly deletes: readonly string[];
      readonly lastSeq: string;
    };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc
    .array(storedDocArb(), { minLength: 0, maxLength: 4 })
    .map((docs) => ({ kind: 'upsert' as const, docs })),
  fc
    .record({
      ids: fc.array(idArb, { minLength: 0, maxLength: 4 }),
      seq: seqArb,
    })
    .map(({ ids, seq }) => ({ kind: 'markDeleted' as const, ids, seq })),
  seqArb.map((seq) => ({ kind: 'setCheckpoint' as const, seq })),
  fc
    .record({
      upserts: fc.array(storedDocArb(), { minLength: 0, maxLength: 4 }),
      deletes: fc.array(idArb, { minLength: 0, maxLength: 4 }),
      lastSeq: seqArb,
    })
    .map(({ upserts, deletes, lastSeq }) => ({
      kind: 'applyDelta' as const,
      upserts,
      deletes,
      lastSeq,
    })),
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 20 });

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Document_Store reconciliation (Property 9, pg-mem)', () => {
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
  });

  afterEach(async () => {
    await (pool as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('reconciles upserts/tombstones/deltas: one latest entry per id, tombstones excluded with checkpoint continuity, active set drives buildUpstreamCatalog', async () => {
    const bridge = new Map<string, string>();

    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        // A fresh store + model per run against a truncated table so runs are
        // independent (the pg-mem db is shared across the property's runs).
        await pool.query('DELETE FROM disney_documents');
        await pool.query('DELETE FROM disney_sync_checkpoint');

        const store = createDocumentStore(withAnyArrayCompat(pool));
        const model = new StoreModel();

        for (const op of ops) {
          switch (op.kind) {
            case 'upsert':
              await store.upsertDocuments(op.docs);
              model.upsert(op.docs);
              break;
            case 'markDeleted':
              await store.markDeleted(op.ids, op.seq);
              model.markDeleted(op.ids, op.seq);
              break;
            case 'setCheckpoint':
              await store.setCheckpoint(op.seq);
              model.setCheckpoint(op.seq);
              break;
            case 'applyDelta':
              await store.applyDelta({
                upserts: op.upserts,
                deletes: op.deletes,
                lastSeq: op.lastSeq,
              });
              model.applyDelta({
                upserts: op.upserts,
                deletes: op.deletes,
                lastSeq: op.lastSeq,
              });
              break;
          }
        }

        // (1) Exactly one entry per Enterprise_Id with the latest body: the full
        // table matches the model row-for-row, and the row count equals the
        // number of distinct ids (the PK collapses re-upserts) (R7.2).
        const rows = await readAllRows(pool);
        const expectedRows = model.allRowsSorted();
        expect(rows).toEqual(expectedRows);
        const distinctIds = new Set(rows.map((r) => r.enterprise_id));
        expect(rows.length).toBe(distinctIds.size);

        // (2) Tombstoned ids are excluded from the active set while checkpoint
        // continuity holds (R7.3, R7.5).
        const active = await store.getActiveDocuments();
        const activeIds = new Set(active.map((d) => d.id));
        for (const row of expectedRows) {
          if (row.deleted) {
            expect(activeIds.has(row.enterprise_id)).toBe(false);
          } else {
            expect(activeIds.has(row.enterprise_id)).toBe(true);
          }
        }
        expect(await store.getCheckpoint()).toBe(model.getCheckpoint());

        // (3) The upstream entity set fed to buildUpstreamCatalog equals the set
        // derived from the store's active documents (R7.4, R10.3).
        expect(active).toEqual(model.activeBodiesSorted());
        const fromStore = buildUpstreamCatalog(active, bridge);
        const fromModel = buildUpstreamCatalog(model.activeBodiesSorted(), bridge);
        expect(fromStore).toEqual(fromModel);
      }),
      { numRuns: 100 },
    );
  });
});
